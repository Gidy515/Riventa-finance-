mod errors;
mod state;
mod types;

use crate::errors::{assert_account_distinct, require};
use crate::state::{DocumentCommitment, StorageKey, Trade};
use crate::types::{DocumentType, TradeState, TradeView};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, AccountId, PanicOnDefault, PromiseOrValue};

const ACCEPTANCE_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const FUNDING_WINDOW_NS: u64 = 48 * 60 * 60 * 1_000_000_000;
const REQUIRED_FUNDING_AMOUNT: u128 = 10_000_000_000;
const MAX_FUNDING_MSG_BYTES: usize = 64;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Riventa {
    admin: AccountId,
    token_contract: AccountId,
    paused: bool,
    next_trade_id: u64,
    trades: LookupMap<u64, Trade>,
    document_commitments: LookupMap<u64, Vec<DocumentCommitment>>,
}

#[near]
impl Riventa {
    #[init]
    pub fn new(admin: AccountId, token_contract: AccountId) -> Self {
        require(admin != token_contract, "ADMIN_AND_TOKEN_MUST_DIFFER");
        Self {
            admin,
            token_contract,
            paused: false,
            next_trade_id: 0,
            trades: LookupMap::new(StorageKey::Trades),
            document_commitments: LookupMap::new(StorageKey::TradeDocuments),
        }
    }

    /// Creates a trade proposal. The caller is the buyer. No funds are accepted here.
    pub fn create_trade(
        &mut self,
        supplier: AccountId,
        proposed_resolver: AccountId,
        inspection_criteria_commitment: Vec<u8>,
        refund_terms_commitment: Vec<u8>,
        agreement_commitment: Vec<u8>,
    ) -> u64 {
        require(!self.paused, "NEW_TRADES_PAUSED");
        require(
            inspection_criteria_commitment.len() == 32,
            "INVALID_INSPECTION_COMMITMENT",
        );
        require(
            refund_terms_commitment.len() == 32,
            "INVALID_REFUND_COMMITMENT",
        );
        require(
            agreement_commitment.len() == 32,
            "INVALID_AGREEMENT_COMMITMENT",
        );

        let buyer = env::predecessor_account_id();
        assert_account_distinct(&buyer, &supplier, "BUYER_AND_SUPPLIER_MUST_DIFFER");
        assert_account_distinct(&buyer, &proposed_resolver, "BUYER_AND_RESOLVER_MUST_DIFFER");
        assert_account_distinct(
            &supplier,
            &proposed_resolver,
            "SUPPLIER_AND_RESOLVER_MUST_DIFFER",
        );
        assert_account_distinct(&buyer, &self.admin, "BUYER_AND_ADMIN_MUST_DIFFER");
        assert_account_distinct(&supplier, &self.admin, "SUPPLIER_AND_ADMIN_MUST_DIFFER");
        assert_account_distinct(
            &proposed_resolver,
            &self.admin,
            "RESOLVER_AND_ADMIN_MUST_DIFFER",
        );

        let now = env::block_timestamp();
        let trade_id = self.next_trade_id;
        self.next_trade_id = self
            .next_trade_id
            .checked_add(1)
            .expect("TRADE_ID_OVERFLOW");

        let trade = Trade {
            id: trade_id,
            buyer,
            supplier,
            resolver: proposed_resolver,
            payment_token: self.token_contract.clone(),
            amount: REQUIRED_FUNDING_AMOUNT,
            state: TradeState::AwaitingAcceptance,
            created_at: now,
            accept_by: now
                .checked_add(ACCEPTANCE_WINDOW_NS)
                .expect("TIMESTAMP_OVERFLOW"),
            fund_by: None,
            inspection_criteria_commitment: inspection_criteria_commitment.try_into().unwrap(),
            refund_terms_commitment: refund_terms_commitment.try_into().unwrap(),
            agreement_commitment: agreement_commitment.try_into().unwrap(),
        };

        self.trades.insert(&trade_id, &trade);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"trade_created\",\"data\":[{{\"trade_id\":{trade_id},\"state\":\"AwaitingAcceptance\"}}]}}"));
        trade_id
    }

    /// Supplier accepts the buyer's immutable trade proposal.
    pub fn accept_trade(&mut self, trade_id: u64) {
        let mut trade = self.get_trade_or_panic(trade_id);
        require(
            trade.state == TradeState::AwaitingAcceptance,
            "INVALID_TRADE_STATE",
        );
        require(
            env::predecessor_account_id() == trade.supplier,
            "ONLY_SUPPLIER_MAY_ACCEPT",
        );
        require(
            env::block_timestamp() < trade.accept_by,
            "ACCEPTANCE_DEADLINE_PASSED",
        );
        let now = env::block_timestamp();
        trade.state = TradeState::Accepted;
        trade.fund_by = Some(
            now.checked_add(FUNDING_WINDOW_NS)
                .expect("TIMESTAMP_OVERFLOW"),
        );
        self.trades.insert(&trade_id, &trade);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"trade_accepted\",\"data\":[{{\"trade_id\":{trade_id},\"state\":\"Accepted\"}}]}}"));
    }

    /// Buyer may cancel an unaccepted proposal, or an accepted but unfunded trade after fund_by.
    pub fn cancel_trade(&mut self, trade_id: u64) {
        let mut trade = self.get_trade_or_panic(trade_id);
        require(
            env::predecessor_account_id() == trade.buyer,
            "ONLY_BUYER_MAY_CANCEL",
        );
        match trade.state {
            TradeState::AwaitingAcceptance => {}
            TradeState::Accepted => {
                let fund_by = trade.fund_by.expect("MISSING_FUNDING_DEADLINE");
                require(
                    env::block_timestamp() >= fund_by,
                    "FUNDING_DEADLINE_NOT_PASSED",
                );
            }
            _ => env::panic_str("TRADE_CANNOT_BE_CANCELLED"),
        }
        trade.state = TradeState::Cancelled;
        self.trades.insert(&trade_id, &trade);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"trade_cancelled\",\"data\":[{{\"trade_id\":{trade_id},\"state\":\"Cancelled\"}}]}}"));
    }

    /// Records an immutable supplier document commitment.
    ///
    /// The document itself, filename, nonce and extracted content remain off-chain.
    /// Versions are sequential: version 1 must exist before version 2.
    pub fn record_document_commitment(
        &mut self,
        trade_id: u64,
        document_type: DocumentType,
        version: u8,
        commitment: Vec<u8>,
    ) {
        let mut trade = self.get_trade_or_panic(trade_id);

        require(
            matches!(trade.state, TradeState::Funded | TradeState::DocumentReview),
            "INVALID_TRADE_STATE_FOR_DOCUMENT",
        );

        let caller = env::predecessor_account_id();
        require(
            caller == trade.supplier,
            "ONLY_SUPPLIER_MAY_SUBMIT_DOCUMENT",
        );

        require(commitment.len() == 32, "INVALID_DOCUMENT_COMMITMENT");
        require((1..=2).contains(&version), "INVALID_DOCUMENT_VERSION");

        let mut documents = self.document_commitments.get(&trade_id).unwrap_or_default();

        let version_exists = documents
            .iter()
            .any(|document| document.document_type == document_type && document.version == version);

        require(!version_exists, "DOCUMENT_VERSION_ALREADY_EXISTS");

        if version == 1 {
            let has_existing_version = documents
                .iter()
                .any(|document| document.document_type == document_type);

            require(!has_existing_version, "DOCUMENT_VERSION_ALREADY_EXISTS");
        } else {
            let has_version_one = documents
                .iter()
                .any(|document| document.document_type == document_type && document.version == 1);

            require(has_version_one, "DOCUMENT_VERSION_ONE_REQUIRED");
        }

        let document_commitment: [u8; 32] =
            commitment.try_into().expect("INVALID_DOCUMENT_COMMITMENT");

        documents.push(DocumentCommitment {
            document_type,
            version,
            commitment: document_commitment,
            submitted_by: caller,
            submitted_at: env::block_timestamp(),
        });

        self.document_commitments.insert(&trade_id, &documents);

        // The first valid document moves the funded trade into document review.
        if trade.state == TradeState::Funded {
            trade.state = TradeState::DocumentReview;
            self.trades.insert(&trade_id, &trade);
        }

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"document_commitment_recorded\",\"data\":[{{\"trade_id\":{},\"document_type\":\"{}\",\"version\":{}}}]}}",
            trade_id,
            document_type.as_str(),
            version
        ));
    }

    /// Returns the public on-chain commitments and non-sensitive submission metadata.
    pub fn get_document_commitments(&self, trade_id: u64) -> Vec<DocumentCommitment> {
        self.document_commitments.get(&trade_id).unwrap_or_default()
    }

    pub fn are_required_supplier_documents_complete(&self, trade_id: u64) -> bool {
        require(self.trades.get(&trade_id).is_some(), "TRADE_NOT_FOUND");
        self.required_supplier_documents_complete(trade_id)
    }

    /// True only when all three required supplier document types have version 1.
    /// Used by the inspector-assignment flow in the next implementation slice.
    fn required_supplier_documents_complete(&self, trade_id: u64) -> bool {
        let documents = self.document_commitments.get(&trade_id).unwrap_or_default();

        DocumentType::required_supplier_types()
            .iter()
            .all(|required_type| {
                documents.iter().any(|document| {
                    document.document_type == *required_type && document.version == 1
                })
            })
    }

    pub fn get_trade(&self, trade_id: u64) -> Option<TradeView> {
        self.trades.get(&trade_id).map(TradeView::from)
    }

    pub fn get_contract_config(&self) -> ContractConfig {
        ContractConfig {
            admin: self.admin.clone(),
            token_contract: self.token_contract.clone(),
            paused: self.paused,
            next_trade_id: self.next_trade_id,
        }
    }

    fn get_trade_or_panic(&self, trade_id: u64) -> Trade {
        self.trades
            .get(&trade_id)
            .unwrap_or_else(|| env::panic_str("TRADE_NOT_FOUND"))
    }
}

/// NEP-141 transfer-call receiver. The message is intentionally limited to a trade ID.
#[near]
impl FungibleTokenReceiver for Riventa {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // Reject by returning the entire amount as unused. Do not panic: the FT contract's
        // ft_resolve_transfer callback must be allowed to refund the original sender.
        let unused = || PromiseOrValue::Value(amount);

        if env::predecessor_account_id() != self.token_contract {
            return unused();
        }
        if self.paused || msg.len() > MAX_FUNDING_MSG_BYTES {
            return unused();
        }

        let funding_message = match near_sdk::serde_json::from_str::<FundingMessage>(&msg) {
            Ok(message) => message,
            Err(_) => return unused(),
        };

        let mut trade = match self.trades.get(&funding_message.trade_id) {
            Some(trade) => trade,
            None => return unused(),
        };

        let now = env::block_timestamp();
        let fund_by = match trade.fund_by {
            Some(deadline) => deadline,
            None => return unused(),
        };

        if sender_id != trade.buyer
            || trade.payment_token != env::predecessor_account_id()
            || trade.state != TradeState::Accepted
            || amount.0 != trade.amount
            || amount.0 != REQUIRED_FUNDING_AMOUNT
            || now >= fund_by
        {
            return unused();
        }

        // All validation is complete. This is the only state mutation in the receiver.
        trade.state = TradeState::Funded;
        self.trades.insert(&trade.id, &trade);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"trade_funded\",\"data\":[{{\"trade_id\":{},\"state\":\"Funded\"}}]}}",
            trade.id
        ));

        PromiseOrValue::Value(U128(0))
    }
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct FundingMessage {
    trade_id: u64,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct ContractConfig {
    pub admin: AccountId,
    pub token_contract: AccountId,
    pub paused: bool,
    pub next_trade_id: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(value: &str) -> AccountId {
        value.parse().unwrap()
    }

    fn context(predecessor: &str, timestamp: u64) {
        let mut builder = VMContextBuilder::new();
        builder.predecessor_account_id(account(predecessor));
        builder.block_timestamp(timestamp);
        testing_env!(builder.build());
    }

    fn contract() -> Riventa {
        context("buyer.testnet", 1_000);
        Riventa::new(account("admin.testnet"), account("sdd.testnet"))
    }

    fn commitment() -> Vec<u8> {
        vec![7u8; 32]
    }

    fn accepted_trade(contract: &mut Riventa, now: u64) -> u64 {
        context("buyer.testnet", now);
        let id = contract.create_trade(
            account("supplier.testnet"),
            account("resolver.testnet"),
            commitment(),
            commitment(),
            commitment(),
        );
        context("supplier.testnet", now + 1);
        contract.accept_trade(id);
        id
    }

    fn funded_trade(contract: &mut Riventa, now: u64) -> u64 {
        let id = accepted_trade(contract, now);

        let unused = receive(
            contract,
            "sdd.testnet",
            "buyer.testnet",
            now + 1_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{id}}}"#),
        );

        assert_eq!(unused, 0);
        id
    }

    fn receive(
        contract: &mut Riventa,
        token_predecessor: &str,
        sender: &str,
        timestamp: u64,
        amount: u128,
        msg: &str,
    ) -> u128 {
        context(token_predecessor, timestamp);
        match contract.ft_on_transfer(account(sender), U128(amount), msg.to_string()) {
            PromiseOrValue::Value(unused) => unused.0,
            PromiseOrValue::Promise(_) => panic!("receiver must not return a promise"),
        }
    }

    #[test]
    fn buyer_creates_trade_and_supplier_accepts() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    #[should_panic(expected = "ONLY_SUPPLIER_MAY_ACCEPT")]
    fn unrelated_account_cannot_accept() {
        let mut contract = contract();
        context("buyer.testnet", 1_000);
        let id = contract.create_trade(
            account("supplier.testnet"),
            account("resolver.testnet"),
            commitment(),
            commitment(),
            commitment(),
        );
        context("attacker.testnet", 2_000);
        contract.accept_trade(id);
    }

    #[test]
    fn buyer_can_cancel_expired_unfunded_trade() {
        let mut contract = contract();
        context("buyer.testnet", 1_000);
        let id = contract.create_trade(
            account("supplier.testnet"),
            account("resolver.testnet"),
            commitment(),
            commitment(),
            commitment(),
        );
        context("supplier.testnet", 2_000);
        contract.accept_trade(id);
        context("buyer.testnet", 48 * 60 * 60 * 1_000_000_000 + 2_001);
        contract.cancel_trade(id);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Cancelled);
    }

    #[test]
    fn exact_funding_from_buyer_and_allowlisted_token_funds_trade() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{id}}}"#),
        );
        assert_eq!(unused, 0);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Funded);
    }

    #[test]
    fn wrong_token_contract_is_fully_refunded_and_does_not_mutate_trade() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let unused = receive(
            &mut contract,
            "attacker.testnet",
            "buyer.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{id}}}"#),
        );
        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    fn wrong_sender_is_fully_refunded() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "attacker.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{id}}}"#),
        );
        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    fn incorrect_amount_is_fully_refunded() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let incorrect_amount = REQUIRED_FUNDING_AMOUNT - 1;
        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_000,
            incorrect_amount,
            &format!(r#"{{"trade_id":{id}}}"#),
        );
        assert_eq!(unused, incorrect_amount);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    fn malformed_or_oversized_message_is_fully_refunded() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let malformed = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            "not-json",
        );
        assert_eq!(malformed, REQUIRED_FUNDING_AMOUNT);
        let oversized_msg = format!(r#"{{"trade_id":{id},"padding":"{}"}}"#, "x".repeat(80));
        let oversized = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            &oversized_msg,
        );
        assert_eq!(oversized, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    fn funding_after_deadline_is_fully_refunded() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let deadline = 1_001 + FUNDING_WINDOW_NS;
        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            deadline,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{id}}}"#),
        );
        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    fn paused_contract_rejects_funding() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        contract.paused = true;
        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{id}}}"#),
        );
        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Accepted);
    }

    #[test]
    fn duplicate_funding_is_fully_refunded() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);
        let msg = format!(r#"{{"trade_id":{id}}}"#);
        let first = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_000,
            REQUIRED_FUNDING_AMOUNT,
            &msg,
        );
        let second = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            2_001,
            REQUIRED_FUNDING_AMOUNT,
            &msg,
        );
        assert_eq!(first, 0);
        assert_eq!(second, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(contract.get_trade(id).unwrap().state, TradeState::Funded);
    }

    #[test]
    fn supplier_document_submission_moves_funded_trade_to_document_review() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, commitment());

        assert_eq!(
            contract.get_trade(id).unwrap().state,
            TradeState::DocumentReview
        );

        let documents = contract.get_document_commitments(id);
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].document_type, DocumentType::CommercialInvoice);
        assert_eq!(documents[0].version, 1);
        assert_eq!(documents[0].submitted_by, account("supplier.testnet"));
        assert_eq!(documents[0].commitment, [7u8; 32]);
    }

    #[test]
    #[should_panic(expected = "ONLY_SUPPLIER_MAY_SUBMIT_DOCUMENT")]
    fn buyer_cannot_submit_supplier_document() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("buyer.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, commitment());
    }

    #[test]
    #[should_panic(expected = "INVALID_TRADE_STATE_FOR_DOCUMENT")]
    fn supplier_cannot_submit_document_before_funding() {
        let mut contract = contract();
        let id = accepted_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, commitment());
    }

    #[test]
    #[should_panic(expected = "INVALID_DOCUMENT_COMMITMENT")]
    fn document_commitment_must_be_exactly_32_bytes() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, vec![1u8; 31]);
    }

    #[test]
    #[should_panic(expected = "DOCUMENT_VERSION_ONE_REQUIRED")]
    fn version_two_cannot_be_submitted_before_version_one() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 2, commitment());
    }

    #[test]
    #[should_panic(expected = "DOCUMENT_VERSION_ALREADY_EXISTS")]
    fn existing_document_version_cannot_be_overwritten() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, commitment());

        context("supplier.testnet", 4_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, vec![9u8; 32]);
    }

    #[test]
    fn supplier_can_append_version_two_without_overwriting_version_one() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, commitment());

        context("supplier.testnet", 4_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 2, vec![9u8; 32]);

        let documents = contract.get_document_commitments(id);
        assert_eq!(documents.len(), 2);
        assert_eq!(documents[0].version, 1);
        assert_eq!(documents[0].commitment, [7u8; 32]);
        assert_eq!(documents[1].version, 2);
        assert_eq!(documents[1].commitment, [9u8; 32]);
    }

    #[test]
    #[should_panic(expected = "INVALID_DOCUMENT_VERSION")]
    fn third_document_version_is_rejected() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 3, commitment());
    }

    #[test]
    fn inspector_eligibility_requires_all_three_supplier_documents() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        assert!(!contract.are_required_supplier_documents_complete(id));

        context("supplier.testnet", 3_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 1, commitment());

        assert!(!contract.are_required_supplier_documents_complete(id));

        context("supplier.testnet", 4_000);
        contract.record_document_commitment(id, DocumentType::PackingList, 1, vec![8u8; 32]);

        assert!(!contract.are_required_supplier_documents_complete(id));

        context("supplier.testnet", 5_000);
        contract.record_document_commitment(
            id,
            DocumentType::CertificateOfOrigin,
            1,
            vec![9u8; 32],
        );

        assert!(contract.are_required_supplier_documents_complete(id));

        // Document completion does not assign an inspector or change the state.
        assert_eq!(
            contract.get_trade(id).unwrap().state,
            TradeState::DocumentReview
        );
    }

    #[test]
    fn document_type_serializes_to_snake_case() {
        assert_eq!(
            near_sdk::serde_json::to_string(&DocumentType::CommercialInvoice).unwrap(),
            "\"commercial_invoice\""
        );

        assert_eq!(
            near_sdk::serde_json::to_string(&DocumentType::PackingList).unwrap(),
            "\"packing_list\""
        );

        assert_eq!(
            near_sdk::serde_json::to_string(&DocumentType::CertificateOfOrigin).unwrap(),
            "\"certificate_of_origin\""
        );
    }
}
