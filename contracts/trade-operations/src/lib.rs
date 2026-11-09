mod errors;
mod state;
mod types;

use crate::errors::{assert_account_distinct, require};
use crate::state::{
    AdminProposal, DocumentCommitment, ExecutionMandate, InspectionAttestation, InspectionRecord,
    InspectorRecord, SettlementKind, SettlementReason, SettlementRecord, SettlementStatus,
    StorageKey, Trade, TradePolicySnapshot,
};
use crate::types::{AdminAction, DocumentType, InspectionOutcome, TradeState, TradeView};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{
    env, ext_contract, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait ExtRiventa {
    fn on_settlement_transfer_complete(&mut self, trade_id: u64, settlement_id: u64) -> bool;
}

const ACCEPTANCE_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const FUNDING_WINDOW_NS: u64 = 48 * 60 * 60 * 1_000_000_000;
const ADMIN_PROPOSAL_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const SUPPLIER_DOCUMENT_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const INSPECTOR_ASSIGNMENT_WINDOW_NS: u64 = 3 * 24 * 60 * 60 * 1_000_000_000;
const INSPECTION_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const REQUIRED_FUNDING_AMOUNT: u128 = 10_000_000_000;
const MAX_FUNDING_MSG_BYTES: usize = 64;
const ADMIN_COUNT: usize = 3;
const ADMIN_APPROVAL_THRESHOLD: usize = 2;
const MAX_PENDING_ADMIN_PROPOSALS: u8 = 32;
const SETTLEMENT_TRANSFER_GAS: Gas = Gas::from_tgas(10);
const SETTLEMENT_CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Riventa {
    admins: Vec<AccountId>,
    token_contract: AccountId,
    paused: bool,
    next_trade_id: u64,
    next_admin_proposal_id: u64,
    pending_admin_proposals: u8,
    trades: LookupMap<u64, Trade>,
    document_commitments: LookupMap<u64, Vec<DocumentCommitment>>,
    admin_proposals: LookupMap<u64, AdminProposal>,
    inspectors: LookupMap<AccountId, InspectorRecord>,
    trade_inspections: LookupMap<u64, InspectionRecord>,
    next_mandate_id: u64,
    mandates: LookupMap<u64, ExecutionMandate>,
    trade_policy_snapshots: LookupMap<u64, TradePolicySnapshot>,
    next_settlement_id: u64,
    settlement_records: LookupMap<u64, SettlementRecord>,
    active_settlements: LookupMap<u64, u64>,
}

#[near]
impl Riventa {
    #[init]
    pub fn new(admins: Vec<AccountId>, token_contract: AccountId) -> Self {
        require(admins.len() == ADMIN_COUNT, "EXACTLY_THREE_ADMINS_REQUIRED");

        for (index, admin) in admins.iter().enumerate() {
            require(admin != &token_contract, "ADMIN_AND_TOKEN_MUST_DIFFER");

            for other in admins.iter().skip(index + 1) {
                assert_account_distinct(admin, other, "ADMIN_ACCOUNTS_MUST_BE_DISTINCT");
            }
        }

        Self {
            admins,
            token_contract,
            paused: false,
            next_trade_id: 0,
            next_admin_proposal_id: 0,
            pending_admin_proposals: 0,
            trades: LookupMap::new(StorageKey::Trades),
            document_commitments: LookupMap::new(StorageKey::TradeDocuments),
            admin_proposals: LookupMap::new(StorageKey::AdminProposals),
            inspectors: LookupMap::new(StorageKey::Inspectors),
            trade_inspections: LookupMap::new(StorageKey::TradeInspections),
            next_mandate_id: 0,
            mandates: LookupMap::new(StorageKey::Mandates),
            trade_policy_snapshots: LookupMap::new(StorageKey::TradePolicySnapshots),
            next_settlement_id: 0,
            settlement_records: LookupMap::new(StorageKey::SettlementRecords),
            active_settlements: LookupMap::new(StorageKey::ActiveSettlements),
        }
    }

    /// Buyer creates an execution mandate using a buyer-authorized transaction.
    pub fn create_mandate(
        &mut self,
        agent: AccountId,
        supplier: AccountId,
        resolver: AccountId,
        max_trade_amount: U128,
        aggregate_budget: U128,
        allow_release_after_pass: bool,
        allow_refund_after_fail: bool,
        expires_at: u64,
    ) -> u64 {
        let buyer = env::predecessor_account_id();

        self.validate_mandate_accounts(&buyer, &agent, &supplier, &resolver);

        require(!self.paused, "NEW_TRADES_PAUSED");
        require(
            expires_at > env::block_timestamp(),
            "MANDATE_EXPIRY_MUST_BE_IN_FUTURE",
        );
        require(
            max_trade_amount.0 >= REQUIRED_FUNDING_AMOUNT,
            "MANDATE_MAX_TRADE_BELOW_REQUIRED_AMOUNT",
        );
        require(
            aggregate_budget.0 >= max_trade_amount.0,
            "MANDATE_BUDGET_BELOW_MAX_TRADE",
        );

        let mandate_id = self.next_mandate_id;
        self.next_mandate_id = self
            .next_mandate_id
            .checked_add(1)
            .expect("MANDATE_ID_OVERFLOW");

        let mandate = ExecutionMandate {
            id: mandate_id,
            buyer,
            agent,
            supplier,
            resolver,
            payment_token: self.token_contract.clone(),
            max_trade_amount: max_trade_amount.0,
            aggregate_budget: aggregate_budget.0,
            reserved_budget: 0,
            consumed_budget: 0,
            allow_release_after_pass,
            allow_refund_after_fail,
            expires_at,
            revoked: false,
            version: 1,
        };

        self.mandates.insert(&mandate_id, &mandate);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"mandate_created\",\"data\":[{{\"mandate_id\":{mandate_id},\"version\":1}}]}}"
        ));

        mandate_id
    }

    /// Buyer updates the policy for future agent-created trades.
    /// Existing trade snapshots are deliberately not modified.
    pub fn update_mandate(
        &mut self,
        mandate_id: u64,
        agent: AccountId,
        supplier: AccountId,
        resolver: AccountId,
        max_trade_amount: U128,
        aggregate_budget: U128,
        allow_release_after_pass: bool,
        allow_refund_after_fail: bool,
        expires_at: u64,
    ) {
        let buyer = env::predecessor_account_id();
        let mut mandate = self.get_mandate_or_panic(mandate_id);

        require(mandate.buyer == buyer, "ONLY_MANDATE_BUYER_MAY_UPDATE");
        require(!mandate.revoked, "MANDATE_REVOKED");
        require(
            expires_at > env::block_timestamp(),
            "MANDATE_EXPIRY_MUST_BE_IN_FUTURE",
        );
        require(
            max_trade_amount.0 >= REQUIRED_FUNDING_AMOUNT,
            "MANDATE_MAX_TRADE_BELOW_REQUIRED_AMOUNT",
        );

        let committed_budget = mandate
            .reserved_budget
            .checked_add(mandate.consumed_budget)
            .expect("MANDATE_BUDGET_OVERFLOW");

        require(
            aggregate_budget.0 >= committed_budget,
            "NEW_BUDGET_BELOW_COMMITTED_AMOUNT",
        );
        require(
            aggregate_budget.0 >= max_trade_amount.0,
            "MANDATE_BUDGET_BELOW_MAX_TRADE",
        );

        self.validate_mandate_accounts(&buyer, &agent, &supplier, &resolver);

        mandate.agent = agent;
        mandate.supplier = supplier;
        mandate.resolver = resolver;
        mandate.max_trade_amount = max_trade_amount.0;
        mandate.aggregate_budget = aggregate_budget.0;
        mandate.allow_release_after_pass = allow_release_after_pass;
        mandate.allow_refund_after_fail = allow_refund_after_fail;
        mandate.expires_at = expires_at;
        mandate.version = mandate
            .version
            .checked_add(1)
            .expect("MANDATE_VERSION_OVERFLOW");

        self.mandates.insert(&mandate_id, &mandate);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"mandate_updated\",\"data\":[{{\"mandate_id\":{mandate_id},\"version\":{}}}]}}",
            mandate.version
        ));
    }

    /// Buyer renews a mandate. This explicitly reactivates a revoked or expired
    /// mandate without changing its supplier, resolver, agent or permissions.
    pub fn renew_mandate(&mut self, mandate_id: u64, new_expires_at: u64) {
        let buyer = env::predecessor_account_id();
        let mut mandate = self.get_mandate_or_panic(mandate_id);

        require(mandate.buyer == buyer, "ONLY_MANDATE_BUYER_MAY_RENEW");
        require(
            new_expires_at > env::block_timestamp(),
            "MANDATE_EXPIRY_MUST_BE_IN_FUTURE",
        );

        mandate.expires_at = new_expires_at;
        mandate.revoked = false;
        mandate.version = mandate
            .version
            .checked_add(1)
            .expect("MANDATE_VERSION_OVERFLOW");

        self.mandates.insert(&mandate_id, &mandate);
    }

    /// Buyer revokes a mandate. Existing trade snapshots remain immutable.
    pub fn revoke_mandate(&mut self, mandate_id: u64) {
        let buyer = env::predecessor_account_id();
        let mut mandate = self.get_mandate_or_panic(mandate_id);

        require(mandate.buyer == buyer, "ONLY_MANDATE_BUYER_MAY_REVOKE");
        require(!mandate.revoked, "MANDATE_ALREADY_REVOKED");

        mandate.revoked = true;
        mandate.version = mandate
            .version
            .checked_add(1)
            .expect("MANDATE_VERSION_OVERFLOW");

        self.mandates.insert(&mandate_id, &mandate);
    }

    /// Returns the mandate's current policy and accounting state.
    pub fn get_mandate(&self, mandate_id: u64) -> Option<MandateView> {
        self.mandates.get(&mandate_id).map(MandateView::from)
    }

    /// Returns the immutable policy snapshot attached to an agent-created trade.
    pub fn get_trade_policy_snapshot(&self, trade_id: u64) -> Option<TradePolicySnapshotView> {
        self.trade_policy_snapshots
            .get(&trade_id)
            .map(TradePolicySnapshotView::from)
    }

    fn validate_mandate_accounts(
        &self,
        buyer: &AccountId,
        agent: &AccountId,
        supplier: &AccountId,
        resolver: &AccountId,
    ) {
        assert_account_distinct(buyer, agent, "BUYER_AND_AGENT_MUST_DIFFER");
        assert_account_distinct(buyer, supplier, "BUYER_AND_SUPPLIER_MUST_DIFFER");
        assert_account_distinct(buyer, resolver, "BUYER_AND_RESOLVER_MUST_DIFFER");
        assert_account_distinct(agent, supplier, "AGENT_AND_SUPPLIER_MUST_DIFFER");
        assert_account_distinct(agent, resolver, "AGENT_AND_RESOLVER_MUST_DIFFER");
        assert_account_distinct(supplier, resolver, "SUPPLIER_AND_RESOLVER_MUST_DIFFER");

        for admin in &self.admins {
            assert_account_distinct(buyer, admin, "BUYER_AND_ADMIN_MUST_DIFFER");
            assert_account_distinct(agent, admin, "AGENT_AND_ADMIN_MUST_DIFFER");
            assert_account_distinct(supplier, admin, "SUPPLIER_AND_ADMIN_MUST_DIFFER");
            assert_account_distinct(resolver, admin, "RESOLVER_AND_ADMIN_MUST_DIFFER");
        }

        assert_account_distinct(buyer, &self.token_contract, "BUYER_AND_TOKEN_MUST_DIFFER");
        assert_account_distinct(agent, &self.token_contract, "AGENT_AND_TOKEN_MUST_DIFFER");
        assert_account_distinct(
            supplier,
            &self.token_contract,
            "SUPPLIER_AND_TOKEN_MUST_DIFFER",
        );
        assert_account_distinct(
            resolver,
            &self.token_contract,
            "RESOLVER_AND_TOKEN_MUST_DIFFER",
        );
    }

    fn get_mandate_or_panic(&self, mandate_id: u64) -> ExecutionMandate {
        self.mandates
            .get(&mandate_id)
            .unwrap_or_else(|| env::panic_str("MANDATE_NOT_FOUND"))
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
        for admin in &self.admins {
            assert_account_distinct(&buyer, admin, "BUYER_AND_ADMIN_MUST_DIFFER");
            assert_account_distinct(&supplier, admin, "SUPPLIER_AND_ADMIN_MUST_DIFFER");
            assert_account_distinct(&proposed_resolver, admin, "RESOLVER_AND_ADMIN_MUST_DIFFER");
        }

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
            funded_at: None,
            documents_completed_at: None,
            inspector_assigned_at: None,
            refund_reason: None,
        };

        self.trades.insert(&trade_id, &trade);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"trade_created\",\"data\":[{{\"trade_id\":{trade_id},\"state\":\"AwaitingAcceptance\"}}]}}"));
        trade_id
    }

    /// Agent creates a trade using the authority and constraints in a buyer mandate.
    /// The buyer remains the trade buyer and must still fund it independently.
    pub fn create_trade_under_mandate(
        &mut self,
        mandate_id: u64,
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

        let caller = env::predecessor_account_id();
        let mut mandate = self.get_mandate_or_panic(mandate_id);

        require(
            caller == mandate.agent,
            "ONLY_MANDATE_AGENT_MAY_CREATE_TRADE",
        );
        require(!mandate.revoked, "MANDATE_REVOKED");
        require(
            env::block_timestamp() < mandate.expires_at,
            "MANDATE_EXPIRED",
        );
        require(
            mandate.payment_token == self.token_contract,
            "MANDATE_TOKEN_NOT_SUPPORTED",
        );
        require(
            REQUIRED_FUNDING_AMOUNT <= mandate.max_trade_amount,
            "TRADE_EXCEEDS_MANDATE_MAX_AMOUNT",
        );

        let next_committed_budget = mandate
            .reserved_budget
            .checked_add(mandate.consumed_budget)
            .and_then(|value| value.checked_add(REQUIRED_FUNDING_AMOUNT))
            .expect("MANDATE_BUDGET_OVERFLOW");

        require(
            next_committed_budget <= mandate.aggregate_budget,
            "MANDATE_BUDGET_EXCEEDED",
        );

        // Reserve the entire trade amount before creating the trade.
        // NEAR transaction execution is atomic: a later panic rolls this back.
        mandate.reserved_budget = mandate
            .reserved_budget
            .checked_add(REQUIRED_FUNDING_AMOUNT)
            .expect("MANDATE_RESERVED_BUDGET_OVERFLOW");

        let now = env::block_timestamp();
        let trade_id = self.next_trade_id;

        self.next_trade_id = self
            .next_trade_id
            .checked_add(1)
            .expect("TRADE_ID_OVERFLOW");

        let trade = Trade {
            id: trade_id,
            buyer: mandate.buyer.clone(),
            supplier: mandate.supplier.clone(),
            resolver: mandate.resolver.clone(),
            payment_token: mandate.payment_token.clone(),
            amount: REQUIRED_FUNDING_AMOUNT,
            state: TradeState::AwaitingAcceptance,
            created_at: now,
            accept_by: now
                .checked_add(ACCEPTANCE_WINDOW_NS)
                .expect("TIMESTAMP_OVERFLOW"),
            fund_by: None,
            inspection_criteria_commitment: inspection_criteria_commitment
                .try_into()
                .expect("INVALID_INSPECTION_COMMITMENT"),
            refund_terms_commitment: refund_terms_commitment
                .try_into()
                .expect("INVALID_REFUND_COMMITMENT"),
            agreement_commitment: agreement_commitment
                .try_into()
                .expect("INVALID_AGREEMENT_COMMITMENT"),
            funded_at: None,
            documents_completed_at: None,
            inspector_assigned_at: None,
            refund_reason: None,
        };

        let snapshot = TradePolicySnapshot {
            trade_id,
            mandate_id: mandate.id,
            mandate_version: mandate.version,
            buyer: mandate.buyer.clone(),
            agent: mandate.agent.clone(),
            supplier: mandate.supplier.clone(),
            resolver: mandate.resolver.clone(),
            payment_token: mandate.payment_token.clone(),
            amount: REQUIRED_FUNDING_AMOUNT,
            allow_release_after_pass: mandate.allow_release_after_pass,
            allow_refund_after_fail: mandate.allow_refund_after_fail,
            mandate_expires_at: mandate.expires_at,
        };

        self.mandates.insert(&mandate_id, &mandate);
        self.trades.insert(&trade_id, &trade);
        self.trade_policy_snapshots.insert(&trade_id, &snapshot);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"agent_trade_created\",\"data\":[{{\"trade_id\":{trade_id},\"mandate_id\":{mandate_id},\"mandate_version\":{}}}]}}",
            mandate.version
        ));

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

    /// Buyer may cancel an unaccepted proposal, or an accepted but unfunded
    /// trade after fund_by. Agent-created trade reservations are released.
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

        // Only mandate-created trades have a policy snapshot.
        // Release their reservation; ordinary buyer-created trades are unaffected.
        if let Some(snapshot) = self.trade_policy_snapshots.get(&trade_id) {
            let mut mandate = self.get_mandate_or_panic(snapshot.mandate_id);

            mandate.reserved_budget = mandate
                .reserved_budget
                .checked_sub(snapshot.amount)
                .expect("MANDATE_RESERVED_BUDGET_UNDERFLOW");

            self.mandates.insert(&snapshot.mandate_id, &mandate);
        }

        trade.state = TradeState::Cancelled;
        self.trades.insert(&trade_id, &trade);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"trade_cancelled\",\"data\":[{{\"trade_id\":{trade_id},\"state\":\"Cancelled\"}}]}}"
        ));
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

        let now = env::block_timestamp();

        let funded_at = trade
            .funded_at
            .unwrap_or_else(|| env::panic_str("TRADE_FUNDING_TIMESTAMP_MISSING"));

        let document_deadline = funded_at
            .checked_add(SUPPLIER_DOCUMENT_WINDOW_NS)
            .expect("TIMESTAMP_OVERFLOW");

        require(now < document_deadline, "SUPPLIER_DOCUMENT_DEADLINE_PASSED");

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
            submitted_at: now,
        });

        self.document_commitments.insert(&trade_id, &documents);

        // The first valid document moves the funded trade into document review.
        if trade.state == TradeState::Funded {
            trade.state = TradeState::DocumentReview;
        }

        // Start the inspector-assignment window when all required documents exist.
        if trade.documents_completed_at.is_none()
            && self.required_supplier_documents_complete(trade_id)
        {
            trade.documents_completed_at = Some(now);
        }

        self.trades.insert(&trade_id, &trade);

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

    /// Creates a typed administrative proposal.
    /// The proposer automatically supplies the first approval.
    pub fn propose_admin_action(&mut self, action: AdminAction) -> u64 {
        self.require_admin();

        require(
            self.pending_admin_proposals < MAX_PENDING_ADMIN_PROPOSALS,
            "TOO_MANY_PENDING_ADMIN_PROPOSALS",
        );

        let proposer = env::predecessor_account_id();
        let now = env::block_timestamp();
        let proposal_id = self.next_admin_proposal_id;

        let expires_at = now
            .checked_add(ADMIN_PROPOSAL_WINDOW_NS)
            .expect("TIMESTAMP_OVERFLOW");

        self.next_admin_proposal_id = self
            .next_admin_proposal_id
            .checked_add(1)
            .expect("ADMIN_PROPOSAL_ID_OVERFLOW");

        self.pending_admin_proposals = self
            .pending_admin_proposals
            .checked_add(1)
            .expect("PENDING_PROPOSAL_COUNTER_OVERFLOW");

        self.admin_proposals.insert(
            &proposal_id,
            &AdminProposal {
                id: proposal_id,
                action,
                proposer: proposer.clone(),
                approvals: vec![proposer],
                created_at: now,
                expires_at,
            },
        );

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"admin_action_proposed\",\"data\":[{{\"proposal_id\":{proposal_id}}}]}}"
        ));

        proposal_id
    }

    /// Adds the approval of a second, distinct multisig administrator.
    pub fn approve_admin_action(&mut self, proposal_id: u64) {
        self.require_admin();

        let mut proposal = self
            .admin_proposals
            .get(&proposal_id)
            .unwrap_or_else(|| env::panic_str("ADMIN_PROPOSAL_NOT_FOUND"));

        let approver = env::predecessor_account_id();

        require(
            env::block_timestamp() < proposal.expires_at,
            "ADMIN_PROPOSAL_EXPIRED",
        );
        require(
            proposal.approvals.len() < ADMIN_APPROVAL_THRESHOLD,
            "APPROVAL_THRESHOLD_ALREADY_REACHED",
        );
        require(
            !proposal
                .approvals
                .iter()
                .any(|account| account == &approver),
            "ADMIN_ALREADY_APPROVED",
        );

        proposal.approvals.push(approver);

        self.admin_proposals.insert(&proposal_id, &proposal);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"admin_action_approved\",\"data\":[{{\"proposal_id\":{proposal_id},\"approval_count\":{}}}]}}",
            proposal.approvals.len()
        ));
    }

    /// Executes an approved action. Anyone may call this after 2-of-3 approval.
    pub fn execute_admin_action(&mut self, proposal_id: u64) {
        let proposal = self
            .admin_proposals
            .get(&proposal_id)
            .unwrap_or_else(|| env::panic_str("ADMIN_PROPOSAL_NOT_FOUND"));

        require(
            env::block_timestamp() < proposal.expires_at,
            "ADMIN_PROPOSAL_EXPIRED",
        );
        require(
            proposal.approvals.len() >= ADMIN_APPROVAL_THRESHOLD,
            "INSUFFICIENT_ADMIN_APPROVALS",
        );

        match proposal.action {
            AdminAction::RegisterInspector {
                account_id,
                credential_commitment,
            } => {
                self.require_not_admin(&account_id);
                require(
                    account_id != self.token_contract,
                    "INSPECTOR_AND_TOKEN_MUST_DIFFER",
                );
                require(
                    credential_commitment.iter().any(|byte| *byte != 0),
                    "EMPTY_INSPECTOR_CREDENTIAL_COMMITMENT",
                );
                require(
                    self.inspectors.get(&account_id).is_none(),
                    "INSPECTOR_ALREADY_REGISTERED",
                );

                self.inspectors.insert(
                    &account_id,
                    &InspectorRecord {
                        credential_commitment,
                        registered_at: env::block_timestamp(),
                        active: true,
                    },
                );
            }
            AdminAction::SetInspectorStatus { account_id, active } => {
                self.require_not_admin(&account_id);

                let mut inspector = self
                    .inspectors
                    .get(&account_id)
                    .unwrap_or_else(|| env::panic_str("INSPECTOR_NOT_REGISTERED"));

                require(inspector.active != active, "INSPECTOR_STATUS_UNCHANGED");

                inspector.active = active;
                self.inspectors.insert(&account_id, &inspector);
            }
            AdminAction::PauseNewTrades => {
                require(!self.paused, "NEW_TRADES_ALREADY_PAUSED");
                self.paused = true;
            }
            AdminAction::UnpauseNewTrades => {
                require(self.paused, "NEW_TRADES_NOT_PAUSED");
                self.paused = false;
            }
        }

        self.admin_proposals.remove(&proposal_id);
        self.decrement_pending_proposals();

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"admin_action_executed\",\"data\":[{{\"proposal_id\":{proposal_id}}}]}}"
        ));
    }

    /// Removes an expired pending proposal. Anyone may call this.
    pub fn expire_admin_proposal(&mut self, proposal_id: u64) {
        let proposal = self
            .admin_proposals
            .get(&proposal_id)
            .unwrap_or_else(|| env::panic_str("ADMIN_PROPOSAL_NOT_FOUND"));

        require(
            env::block_timestamp() >= proposal.expires_at,
            "ADMIN_PROPOSAL_NOT_YET_EXPIRED",
        );

        self.admin_proposals.remove(&proposal_id);
        self.decrement_pending_proposals();

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"admin_proposal_expired\",\"data\":[{{\"proposal_id\":{proposal_id}}}]}}"
        ));
    }

    pub fn get_admin_proposal(&self, proposal_id: u64) -> Option<AdminProposal> {
        self.admin_proposals.get(&proposal_id)
    }

    pub fn get_inspector(&self, account_id: AccountId) -> Option<InspectorRecord> {
        self.inspectors.get(&account_id)
    }

    /// Buyer assigns an active, eligible inspector after all required documents exist.
    pub fn assign_inspector(&mut self, trade_id: u64, inspector_account: AccountId) {
        let mut trade = self.get_trade_or_panic(trade_id);

        require(
            env::predecessor_account_id() == trade.buyer,
            "ONLY_BUYER_MAY_ASSIGN_INSPECTOR",
        );
        require(
            trade.state == TradeState::DocumentReview,
            "INVALID_TRADE_STATE_FOR_INSPECTOR_ASSIGNMENT",
        );
        require(
            self.required_supplier_documents_complete(trade_id),
            "REQUIRED_SUPPLIER_DOCUMENTS_INCOMPLETE",
        );
        require(
            self.trade_inspections.get(&trade_id).is_none(),
            "INSPECTOR_ALREADY_ASSIGNED",
        );

        let inspector = self
            .inspectors
            .get(&inspector_account)
            .unwrap_or_else(|| env::panic_str("INSPECTOR_NOT_REGISTERED"));

        require(inspector.active, "INSPECTOR_NOT_ACTIVE");
        require(
            inspector_account != trade.buyer,
            "INSPECTOR_AND_BUYER_MUST_DIFFER",
        );
        require(
            inspector_account != trade.supplier,
            "INSPECTOR_AND_SUPPLIER_MUST_DIFFER",
        );
        require(
            inspector_account != trade.resolver,
            "INSPECTOR_AND_RESOLVER_MUST_DIFFER",
        );
        self.require_not_admin(&inspector_account);

        let now = env::block_timestamp();

        let documents_completed_at = trade
            .documents_completed_at
            .unwrap_or_else(|| env::panic_str("DOCUMENT_COMPLETION_TIMESTAMP_MISSING"));

        let assignment_deadline = documents_completed_at
            .checked_add(INSPECTOR_ASSIGNMENT_WINDOW_NS)
            .expect("TIMESTAMP_OVERFLOW");

        require(
            now < assignment_deadline,
            "INSPECTOR_ASSIGNMENT_DEADLINE_PASSED",
        );

        self.trade_inspections.insert(
            &trade_id,
            &InspectionRecord {
                assigned_inspector: inspector_account.clone(),
                replacement_count: 0,
                attestation: None,
            },
        );

        trade.inspector_assigned_at = Some(now);
        trade.state = TradeState::InspectionPending;
        self.trades.insert(&trade_id, &trade);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"inspector_assigned\",\"data\":[{{\"trade_id\":{trade_id},\"inspector\":\"{inspector_account}\"}}]}}"
        ));
    }

    /// Buyer may replace the assigned inspector once, before an attestation exists.
    pub fn replace_inspector(&mut self, trade_id: u64, replacement: AccountId) {
        let mut trade = self.get_trade_or_panic(trade_id);

        require(
            env::predecessor_account_id() == trade.buyer,
            "ONLY_BUYER_MAY_REPLACE_INSPECTOR",
        );
        require(
            trade.state == TradeState::InspectionPending,
            "INVALID_TRADE_STATE_FOR_INSPECTOR_REPLACEMENT",
        );

        let mut record = self
            .trade_inspections
            .get(&trade_id)
            .unwrap_or_else(|| env::panic_str("INSPECTION_RECORD_NOT_FOUND"));

        require(record.attestation.is_none(), "INSPECTION_ALREADY_ATTESTED");
        require(
            record.replacement_count == 0,
            "INSPECTOR_REPLACEMENT_LIMIT_REACHED",
        );
        require(
            replacement != record.assigned_inspector,
            "REPLACEMENT_INSPECTOR_MUST_DIFFER",
        );

        let inspector = self
            .inspectors
            .get(&replacement)
            .unwrap_or_else(|| env::panic_str("INSPECTOR_NOT_REGISTERED"));

        require(inspector.active, "INSPECTOR_NOT_ACTIVE");
        require(
            replacement != trade.buyer,
            "INSPECTOR_AND_BUYER_MUST_DIFFER",
        );
        require(
            replacement != trade.supplier,
            "INSPECTOR_AND_SUPPLIER_MUST_DIFFER",
        );
        require(
            replacement != trade.resolver,
            "INSPECTOR_AND_RESOLVER_MUST_DIFFER",
        );
        self.require_not_admin(&replacement);
        let now = env::block_timestamp();

        let inspector_assigned_at = trade
            .inspector_assigned_at
            .unwrap_or_else(|| env::panic_str("INSPECTOR_ASSIGNMENT_TIMESTAMP_MISSING"));

        let inspection_deadline = inspector_assigned_at
            .checked_add(INSPECTION_WINDOW_NS)
            .expect("TIMESTAMP_OVERFLOW");

        require(now < inspection_deadline, "INSPECTION_DEADLINE_PASSED");

        record.assigned_inspector = replacement.clone();
        record.replacement_count = 1;
        self.trade_inspections.insert(&trade_id, &record);

        trade.inspector_assigned_at = Some(now);
        self.trades.insert(&trade_id, &trade);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"inspector_replaced\",\"data\":[{{\"trade_id\":{trade_id},\"inspector\":\"{replacement}\"}}]}}"
        ));
    }

    /// Assigned inspector submits one final pass/fail attestation.
    pub fn submit_inspection_attestation(
        &mut self,
        trade_id: u64,
        outcome: InspectionOutcome,
        evidence_commitment: Vec<u8>,
    ) {
        let mut trade = self.get_trade_or_panic(trade_id);

        let now = env::block_timestamp();

        require(
            trade.state == TradeState::InspectionPending,
            "INVALID_TRADE_STATE_FOR_INSPECTION_ATTESTATION",
        );
        require(
            evidence_commitment.len() == 32,
            "INVALID_INSPECTION_EVIDENCE_COMMITMENT",
        );

        let caller = env::predecessor_account_id();

        let mut record = self
            .trade_inspections
            .get(&trade_id)
            .unwrap_or_else(|| env::panic_str("INSPECTION_RECORD_NOT_FOUND"));

        require(
            caller == record.assigned_inspector,
            "ONLY_ASSIGNED_INSPECTOR_MAY_ATTEST",
        );
        let inspector_is_active = self
            .inspectors
            .get(&caller)
            .map(|inspector| inspector.active)
            .unwrap_or(false);

        require(inspector_is_active, "INSPECTOR_NOT_ACTIVE");
        require(record.attestation.is_none(), "INSPECTION_ALREADY_ATTESTED");

        let inspector_assigned_at = trade
            .inspector_assigned_at
            .unwrap_or_else(|| env::panic_str("INSPECTOR_ASSIGNMENT_TIMESTAMP_MISSING"));

        let inspection_deadline = inspector_assigned_at
            .checked_add(INSPECTION_WINDOW_NS)
            .expect("TIMESTAMP_OVERFLOW");

        require(now < inspection_deadline, "INSPECTION_DEADLINE_PASSED");

        let evidence: [u8; 32] = evidence_commitment
            .try_into()
            .expect("INVALID_INSPECTION_EVIDENCE_COMMITMENT");

        record.attestation = Some(InspectionAttestation {
            outcome,
            evidence_commitment: evidence,
            inspector: caller.clone(),
            submitted_at: now,
        });

        trade.state = match outcome {
            InspectionOutcome::Pass => TradeState::InspectionPassed,
            InspectionOutcome::Fail => TradeState::InspectionFailed,
        };

        self.trade_inspections.insert(&trade_id, &record);
        self.trades.insert(&trade_id, &trade);

        let outcome_name = match outcome {
            InspectionOutcome::Pass => "pass",
            InspectionOutcome::Fail => "fail",
        };

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"inspection_attested\",\"data\":[{{\"trade_id\":{trade_id},\"outcome\":\"{outcome_name}\",\"inspector\":\"{caller}\"}}]}}"
        ));
    }

    /// Allows the buyer to recover escrow when a required post-funding
    /// lifecycle step misses its deadline.
    ///
    /// This recovery path is independent of the trade's mandate snapshot.
    /// It does not restore consumed mandate budget.
    pub fn refund_after_timeout(&mut self, trade_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let mut trade = self.get_trade_or_panic(trade_id);

        require(
            caller == trade.buyer,
            "ONLY_BUYER_MAY_INITIATE_TIMEOUT_REFUND",
        );

        require(
            self.active_settlements.get(&trade_id).is_none(),
            "SETTLEMENT_ALREADY_PENDING",
        );

        let now = env::block_timestamp();

        let reason = match trade.state {
            TradeState::Funded | TradeState::DocumentReview => {
                if !self.required_supplier_documents_complete(trade_id) {
                    let funded_at = trade
                        .funded_at
                        .unwrap_or_else(|| env::panic_str("TRADE_FUNDING_TIMESTAMP_MISSING"));

                    let deadline = funded_at
                        .checked_add(SUPPLIER_DOCUMENT_WINDOW_NS)
                        .expect("TIMESTAMP_OVERFLOW");

                    require(now >= deadline, "TIMEOUT_DEADLINE_NOT_REACHED");

                    SettlementReason::SupplierDocumentsTimeout
                } else {
                    let documents_completed_at = trade
                        .documents_completed_at
                        .unwrap_or_else(|| env::panic_str("DOCUMENT_COMPLETION_TIMESTAMP_MISSING"));

                    require(
                        self.trade_inspections.get(&trade_id).is_none(),
                        "INSPECTION_RECORD_ALREADY_EXISTS",
                    );

                    let deadline = documents_completed_at
                        .checked_add(INSPECTOR_ASSIGNMENT_WINDOW_NS)
                        .expect("TIMESTAMP_OVERFLOW");

                    require(now >= deadline, "TIMEOUT_DEADLINE_NOT_REACHED");

                    SettlementReason::InspectorAssignmentTimeout
                }
            }

            TradeState::InspectionPending => {
                let record = self
                    .trade_inspections
                    .get(&trade_id)
                    .unwrap_or_else(|| env::panic_str("INSPECTION_RECORD_NOT_FOUND"));

                require(record.attestation.is_none(), "INSPECTION_ALREADY_ATTESTED");

                let inspector_assigned_at = trade
                    .inspector_assigned_at
                    .unwrap_or_else(|| env::panic_str("INSPECTOR_ASSIGNMENT_TIMESTAMP_MISSING"));

                let deadline = inspector_assigned_at
                    .checked_add(INSPECTION_WINDOW_NS)
                    .expect("TIMESTAMP_OVERFLOW");

                require(now >= deadline, "TIMEOUT_DEADLINE_NOT_REACHED");

                SettlementReason::InspectionTimeout
            }

            _ => env::panic_str("NO_ELIGIBLE_TIMEOUT_REFUND"),
        };

        trade.refund_reason = Some(reason);
        trade.state = TradeState::RefundAuthorized;

        self.trades.insert(&trade_id, &trade);

        self.initiate_settlement(trade_id, SettlementKind::Refund)
    }

    /// Agent authorizes supplier payout under the immutable trade policy snapshot.
    ///
    /// The current mandate is deliberately not consulted: an existing funded
    /// trade retains the authority captured in its snapshot.
    pub fn authorize_mandated_release(&mut self, trade_id: u64) {
        self.authorize_mandated_settlement(trade_id, SettlementKind::Payout);
    }

    /// Agent authorizes buyer refund under the immutable trade policy snapshot.
    pub fn authorize_mandated_refund(&mut self, trade_id: u64) {
        self.authorize_mandated_settlement(trade_id, SettlementKind::Refund);
    }

    /// Buyer explicitly confirms supplier payout when delegated release
    /// authority is not enabled for this trade.
    pub fn confirm_release(&mut self, trade_id: u64) {
        self.authorize_buyer_settlement(trade_id, SettlementKind::Payout);
    }

    /// Buyer explicitly chooses a refund when delegated refund authority
    /// is not enabled for this trade.
    pub fn choose_refund(&mut self, trade_id: u64) {
        self.authorize_buyer_settlement(trade_id, SettlementKind::Refund);
    }

    fn authorize_mandated_settlement(&mut self, trade_id: u64, kind: SettlementKind) {
        let caller = env::predecessor_account_id();
        let mut trade = self.get_trade_or_panic(trade_id);

        let snapshot = self
            .trade_policy_snapshots
            .get(&trade_id)
            .unwrap_or_else(|| env::panic_str("TRADE_POLICY_SNAPSHOT_NOT_FOUND"));

        self.validate_policy_snapshot(&trade, &snapshot, trade_id);

        require(
            caller == snapshot.agent,
            "ONLY_MANDATE_AGENT_MAY_AUTHORIZE_SETTLEMENT",
        );

        match kind {
            SettlementKind::Payout => {
                require(
                    snapshot.allow_release_after_pass,
                    "MANDATE_RELEASE_NOT_AUTHORIZED",
                );
                require(
                    trade.state == TradeState::InspectionPassed,
                    "INVALID_TRADE_STATE_FOR_RELEASE_AUTHORIZATION",
                );
            }
            SettlementKind::Refund => {
                require(
                    snapshot.allow_refund_after_fail,
                    "MANDATE_REFUND_NOT_AUTHORIZED",
                );
                require(
                    trade.state == TradeState::InspectionFailed,
                    "INVALID_TRADE_STATE_FOR_REFUND_AUTHORIZATION",
                );
            }
        }

        trade.state = match kind {
            SettlementKind::Payout => TradeState::ReleaseAuthorized,
            SettlementKind::Refund => {
                trade.refund_reason = Some(SettlementReason::Standard);
                TradeState::RefundAuthorized
            }
        };

        self.trades.insert(&trade_id, &trade);

        let kind_name = match kind {
            SettlementKind::Payout => "payout",
            SettlementKind::Refund => "refund",
        };

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"settlement_authorized\",\"data\":[{{\"trade_id\":{trade_id},\"kind\":\"{kind_name}\",\"actor\":\"{caller}\",\"authorization\":\"mandate\"}}]}}"
        ));
    }

    fn authorize_buyer_settlement(&mut self, trade_id: u64, kind: SettlementKind) {
        let caller = env::predecessor_account_id();
        let mut trade = self.get_trade_or_panic(trade_id);

        require(caller == trade.buyer, "ONLY_BUYER_MAY_AUTHORIZE_SETTLEMENT");

        if let Some(snapshot) = self.trade_policy_snapshots.get(&trade_id) {
            self.validate_policy_snapshot(&trade, &snapshot, trade_id);

            match kind {
                SettlementKind::Payout => {
                    require(
                        !snapshot.allow_release_after_pass,
                        "MANDATE_AGENT_AUTHORIZATION_REQUIRED",
                    );
                }
                SettlementKind::Refund => {
                    require(
                        !snapshot.allow_refund_after_fail,
                        "MANDATE_AGENT_AUTHORIZATION_REQUIRED",
                    );
                }
            }
        }

        match kind {
            SettlementKind::Payout => {
                require(
                    trade.state == TradeState::InspectionPassed,
                    "INVALID_TRADE_STATE_FOR_RELEASE_AUTHORIZATION",
                );
            }
            SettlementKind::Refund => {
                require(
                    trade.state == TradeState::InspectionFailed,
                    "INVALID_TRADE_STATE_FOR_REFUND_AUTHORIZATION",
                );
            }
        }

        trade.state = match kind {
            SettlementKind::Payout => TradeState::ReleaseAuthorized,
            SettlementKind::Refund => {
                trade.refund_reason = Some(SettlementReason::Standard);
                TradeState::RefundAuthorized
            }
        };

        self.trades.insert(&trade_id, &trade);

        let kind_name = match kind {
            SettlementKind::Payout => "payout",
            SettlementKind::Refund => "refund",
        };

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"settlement_authorized\",\"data\":[{{\"trade_id\":{trade_id},\"kind\":\"{kind_name}\",\"actor\":\"{caller}\",\"authorization\":\"buyer\"}}]}}"
        ));
    }

    /// Ensures the stored snapshot still describes this trade.
    ///
    /// Authorization relies on the snapshot, not the mutable current mandate.
    fn validate_policy_snapshot(
        &self,
        trade: &Trade,
        snapshot: &TradePolicySnapshot,
        trade_id: u64,
    ) {
        require(
            snapshot.trade_id == trade_id
                && snapshot.buyer == trade.buyer
                && snapshot.supplier == trade.supplier
                && snapshot.resolver == trade.resolver
                && snapshot.payment_token == trade.payment_token
                && snapshot.amount == trade.amount,
            "TRADE_POLICY_SNAPSHOT_MISMATCH",
        );
    }

    /// Permissionlessly triggers a previously authorized supplier payout.
    ///
    /// Authorization must already have transitioned the trade to
    /// ReleaseAuthorized. This method cannot authorize a payout.
    pub fn release_payment(&mut self, trade_id: u64) -> Promise {
        self.initiate_settlement(trade_id, SettlementKind::Payout)
    }

    /// Permissionlessly triggers a previously authorized buyer refund.
    ///
    /// Authorization must already have transitioned the trade to
    /// RefundAuthorized. This method cannot authorize a refund.
    pub fn refund_escrow(&mut self, trade_id: u64) -> Promise {
        self.initiate_settlement(trade_id, SettlementKind::Refund)
    }

    fn initiate_settlement(&mut self, trade_id: u64, kind: SettlementKind) -> Promise {
        let mut trade = self
            .trades
            .get(&trade_id)
            .unwrap_or_else(|| env::panic_str("TRADE_NOT_FOUND"));

        require(
            self.active_settlements.get(&trade_id).is_none(),
            "SETTLEMENT_ALREADY_PENDING",
        );

        match kind {
            SettlementKind::Payout => {
                require(
                    trade.state == TradeState::ReleaseAuthorized,
                    "TRADE_NOT_AUTHORIZED_FOR_PAYOUT",
                );
            }
            SettlementKind::Refund => {
                require(
                    trade.state == TradeState::RefundAuthorized,
                    "TRADE_NOT_AUTHORIZED_FOR_REFUND",
                );
            }
        }

        require(
            trade.payment_token == self.token_contract,
            "UNSUPPORTED_SETTLEMENT_TOKEN",
        );

        let recipient = match kind {
            SettlementKind::Payout => trade.supplier.clone(),
            SettlementKind::Refund => trade.buyer.clone(),
        };

        let settlement_id = self.next_settlement_id;

        self.next_settlement_id = self
            .next_settlement_id
            .checked_add(1)
            .expect("SETTLEMENT_ID_OVERFLOW");

        let reason = match kind {
            SettlementKind::Payout => SettlementReason::Standard,
            SettlementKind::Refund => trade.refund_reason.unwrap_or(SettlementReason::Standard),
        };

        let settlement = SettlementRecord {
            id: settlement_id,
            trade_id,
            recipient: recipient.clone(),
            amount: trade.amount,
            kind,
            reason,
            status: SettlementStatus::Pending,
            created_at: env::block_timestamp(),
            completed_at: None,
        };

        self.settlement_records.insert(&settlement_id, &settlement);

        self.active_settlements.insert(&trade_id, &settlement_id);

        trade.state = match kind {
            SettlementKind::Payout => TradeState::PayoutPending,
            SettlementKind::Refund => TradeState::RefundPending,
        };

        self.trades.insert(&trade_id, &trade);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"settlement_initiated\",\"data\":[{{\"trade_id\":{trade_id},\"settlement_id\":{settlement_id}}}]}}"
        ));

        ext_ft::ext(trade.payment_token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(SETTLEMENT_TRANSFER_GAS)
            .ft_transfer(recipient, U128(trade.amount), None)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(SETTLEMENT_CALLBACK_GAS)
                    .on_settlement_transfer_complete(trade_id, settlement_id),
            )
    }

    /// Private callback for outgoing NEP-141 settlement transfers.
    ///
    /// A missing, stale, duplicate or unexpected result cannot complete
    /// a settlement. Failed transfers restore the original authorization.
    #[private]
    pub fn on_settlement_transfer_complete(&mut self, trade_id: u64, settlement_id: u64) -> bool {
        let active_id = self.active_settlements.get(&trade_id);

        if active_id != Some(settlement_id) {
            return false;
        }

        let mut settlement = match self.settlement_records.get(&settlement_id) {
            Some(record) => record,
            None => return false,
        };

        if settlement.trade_id != trade_id || settlement.status != SettlementStatus::Pending {
            return false;
        }

        let mut trade = match self.trades.get(&trade_id) {
            Some(record) => record,
            None => return false,
        };

        let expected_pending_state = match settlement.kind {
            SettlementKind::Payout => TradeState::PayoutPending,
            SettlementKind::Refund => TradeState::RefundPending,
        };

        if trade.state != expected_pending_state {
            return false;
        }

        // Treat anything other than exactly one successful promise result
        // as failure. Unknown results must never be interpreted as success.
        if env::promise_results_count() != 1 {
            return false;
        }

        let transfer_succeeded = match env::promise_result_checked(0, 0) {
            Ok(_) | Err(PromiseError::TooLong(_)) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => return false,
        };

        let now = env::block_timestamp();

        if transfer_succeeded {
            settlement.status = SettlementStatus::Succeeded;
            settlement.completed_at = Some(now);

            trade.state = match settlement.kind {
                SettlementKind::Payout => TradeState::Completed,
                SettlementKind::Refund => TradeState::Refunded,
            };
        } else {
            settlement.status = SettlementStatus::Failed;
            settlement.completed_at = Some(now);

            trade.state = match settlement.kind {
                SettlementKind::Payout => TradeState::ReleaseAuthorized,
                SettlementKind::Refund => TradeState::RefundAuthorized,
            };
        }

        self.settlement_records.insert(&settlement_id, &settlement);

        self.trades.insert(&trade_id, &trade);

        self.active_settlements.remove(&trade_id);

        let result_name = if transfer_succeeded {
            "succeeded"
        } else {
            "failed"
        };

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"settlement_completed\",\"data\":[{{\"trade_id\":{trade_id},\"settlement_id\":{settlement_id},\"result\":\"{result_name}\"}}]}}"
        ));

        transfer_succeeded
    }

    pub fn get_inspection_record(&self, trade_id: u64) -> Option<InspectionRecord> {
        self.trade_inspections.get(&trade_id)
    }

    pub fn get_trade(&self, trade_id: u64) -> Option<TradeView> {
        self.trades.get(&trade_id).map(TradeView::from)
    }

    pub fn get_contract_config(&self) -> ContractConfig {
        ContractConfig {
            admins: self.admins.clone(),
            approval_threshold: ADMIN_APPROVAL_THRESHOLD as u8,
            token_contract: self.token_contract.clone(),
            paused: self.paused,
            next_trade_id: self.next_trade_id,
            pending_admin_proposals: self.pending_admin_proposals,
        }
    }

    fn is_admin(&self, account_id: &AccountId) -> bool {
        self.admins.iter().any(|admin| admin == account_id)
    }

    fn require_admin(&self) {
        require(
            self.is_admin(&env::predecessor_account_id()),
            "ONLY_MULTISIG_ADMIN",
        );
    }

    fn require_not_admin(&self, account_id: &AccountId) {
        require(!self.is_admin(account_id), "ACCOUNT_CANNOT_BE_ADMIN");
    }

    fn decrement_pending_proposals(&mut self) {
        self.pending_admin_proposals = self
            .pending_admin_proposals
            .checked_sub(1)
            .expect("PENDING_PROPOSAL_COUNTER_UNDERFLOW");
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
        // All transfer and trade validations have passed.
        // For mandate-created trades, verify the immutable policy snapshot
        // against the stored trade before using it for budget accounting.
        if let Some(snapshot) = self.trade_policy_snapshots.get(&trade.id) {
            if snapshot.trade_id != trade.id
                || snapshot.buyer != trade.buyer
                || snapshot.payment_token != trade.payment_token
                || snapshot.amount != trade.amount
                || snapshot.supplier != trade.supplier
                || snapshot.resolver != trade.resolver
            {
                return unused();
            }

            let mut mandate = match self.mandates.get(&snapshot.mandate_id) {
                Some(mandate) => mandate,
                None => return unused(),
            };

            // The snapshot must also belong to the mandate whose budget
            // is being updated.
            if mandate.id != snapshot.mandate_id
                || mandate.buyer != snapshot.buyer
                || mandate.payment_token != snapshot.payment_token
            {
                return unused();
            }

            // Do not accept funds if the accounting invariant is inconsistent.
            let new_reserved = match mandate.reserved_budget.checked_sub(snapshot.amount) {
                Some(value) => value,
                None => return unused(),
            };

            let new_consumed = match mandate.consumed_budget.checked_add(snapshot.amount) {
                Some(value) => value,
                None => return unused(),
            };

            let total_committed = match new_reserved.checked_add(new_consumed) {
                Some(value) => value,
                None => return unused(),
            };

            if total_committed > mandate.aggregate_budget {
                return unused();
            }

            mandate.reserved_budget = new_reserved;
            mandate.consumed_budget = new_consumed;
            self.mandates.insert(&snapshot.mandate_id, &mandate);
        }

        trade.state = TradeState::Funded;
        trade.funded_at = Some(env::block_timestamp());
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
    pub admins: Vec<AccountId>,
    pub approval_threshold: u8,
    pub token_contract: AccountId,
    pub paused: bool,
    pub next_trade_id: u64,
    pub pending_admin_proposals: u8,
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
        Riventa::new(
            vec![
                account("admin1.testnet"),
                account("admin2.testnet"),
                account("admin3.testnet"),
            ],
            account("sdd.testnet"),
        )
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

    fn execute_admin_action_with_two_approvals(
        contract: &mut Riventa,
        action: AdminAction,
        now: u64,
    ) -> u64 {
        context("admin1.testnet", now);
        let proposal_id = contract.propose_admin_action(action);

        context("admin2.testnet", now + 1);
        contract.approve_admin_action(proposal_id);

        // Execution is permissionless after the 2-of-3 threshold.
        context("relayer.testnet", now + 2);
        contract.execute_admin_action(proposal_id);

        proposal_id
    }

    fn register_test_inspector(contract: &mut Riventa, inspector: &str, now: u64) {
        execute_admin_action_with_two_approvals(
            contract,
            AdminAction::RegisterInspector {
                account_id: account(inspector),
                credential_commitment: [7u8; 32],
            },
            now,
        );
    }

    fn add_required_supplier_documents(contract: &mut Riventa, trade_id: u64, now: u64) {
        context("supplier.testnet", now);
        contract.record_document_commitment(
            trade_id,
            DocumentType::CommercialInvoice,
            1,
            vec![7u8; 32],
        );

        context("supplier.testnet", now + 1);
        contract.record_document_commitment(trade_id, DocumentType::PackingList, 1, vec![8u8; 32]);

        context("supplier.testnet", now + 2);
        contract.record_document_commitment(
            trade_id,
            DocumentType::CertificateOfOrigin,
            1,
            vec![9u8; 32],
        );
    }

    fn inspection_pending_trade(contract: &mut Riventa, inspector: &str, now: u64) -> u64 {
        register_test_inspector(contract, inspector, now);

        let trade_id = funded_trade(contract, now + 10_000);

        add_required_supplier_documents(contract, trade_id, now + 12_000);

        context("buyer.testnet", now + 13_000);
        contract.assign_inspector(trade_id, account(inspector));

        trade_id
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

    fn assert_corrupted_snapshot_rejected(mutate: impl FnOnce(&mut TradePolicySnapshot)) {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        context("supplier.testnet", 3_000);
        contract.accept_trade(trade_id);

        let mut snapshot = contract.trade_policy_snapshots.get(&trade_id).unwrap();
        mutate(&mut snapshot);
        contract.trade_policy_snapshots.insert(&trade_id, &snapshot);

        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            4_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );

        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);

        let trade = contract.get_trade(trade_id).unwrap();
        assert_eq!(trade.state, TradeState::Accepted);

        let mandate = contract.mandates.get(&mandate_id).unwrap();
        assert_eq!(mandate.reserved_budget, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(mandate.consumed_budget, 0);
    }

    fn assert_corrupted_mandate_rejected(mutate: impl FnOnce(&mut ExecutionMandate)) {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        context("supplier.testnet", 3_000);
        contract.accept_trade(trade_id);

        let mut mandate = contract.mandates.get(&mandate_id).unwrap();
        mutate(&mut mandate);
        contract.mandates.insert(&mandate_id, &mandate);

        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            4_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );

        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);

        let trade = contract.get_trade(trade_id).unwrap();
        assert_eq!(trade.state, TradeState::Accepted);

        let mandate = contract.mandates.get(&mandate_id).unwrap();
        assert_eq!(mandate.reserved_budget, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(mandate.consumed_budget, 0);
    }

    fn create_test_mandate(
        contract: &mut Riventa,
        now: u64,
        aggregate_budget: u128,
        expires_at: u64,
    ) -> u64 {
        context("buyer.testnet", now);

        contract.create_mandate(
            account("agent.testnet"),
            account("supplier.testnet"),
            account("resolver.testnet"),
            U128(REQUIRED_FUNDING_AMOUNT),
            U128(aggregate_budget),
            true,
            false,
            expires_at,
        )
    }

    fn create_agent_trade(contract: &mut Riventa, mandate_id: u64, now: u64) -> u64 {
        context("agent.testnet", now);

        contract.create_trade_under_mandate(mandate_id, commitment(), commitment(), commitment())
    }

    fn create_test_mandate_with_permissions(
        contract: &mut Riventa,
        now: u64,
        aggregate_budget: u128,
        expires_at: u64,
        allow_release_after_pass: bool,
        allow_refund_after_fail: bool,
    ) -> u64 {
        context("buyer.testnet", now);

        contract.create_mandate(
            account("agent.testnet"),
            account("supplier.testnet"),
            account("resolver.testnet"),
            U128(REQUIRED_FUNDING_AMOUNT),
            U128(aggregate_budget),
            allow_release_after_pass,
            allow_refund_after_fail,
            expires_at,
        )
    }

    fn mandate_inspection_trade(
        contract: &mut Riventa,
        inspector: &str,
        now: u64,
        allow_release_after_pass: bool,
        allow_refund_after_fail: bool,
        outcome: InspectionOutcome,
    ) -> (u64, u64) {
        register_test_inspector(contract, inspector, now);

        let mandate_id = create_test_mandate_with_permissions(
            contract,
            now + 1_000,
            REQUIRED_FUNDING_AMOUNT * 2,
            now + 1_000_000,
            allow_release_after_pass,
            allow_refund_after_fail,
        );

        let trade_id = create_agent_trade(contract, mandate_id, now + 2_000);

        context("supplier.testnet", now + 3_000);
        contract.accept_trade(trade_id);

        let unused = receive(
            contract,
            "sdd.testnet",
            "buyer.testnet",
            now + 4_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );
        assert_eq!(unused, 0);

        add_required_supplier_documents(contract, trade_id, now + 5_000);

        context("buyer.testnet", now + 6_000);
        contract.assign_inspector(trade_id, account(inspector));

        context(inspector, now + 7_000);
        contract.submit_inspection_attestation(trade_id, outcome, commitment());

        (mandate_id, trade_id)
    }

    #[test]
    fn buyer_can_create_execution_mandate() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let mandate = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(mandate.id, mandate_id);
        assert_eq!(mandate.buyer, account("buyer.testnet"));
        assert_eq!(mandate.agent, account("agent.testnet"));
        assert_eq!(mandate.supplier, account("supplier.testnet"));
        assert_eq!(mandate.resolver, account("resolver.testnet"));
        assert_eq!(mandate.payment_token, account("sdd.testnet"));
        assert_eq!(mandate.max_trade_amount, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(mandate.aggregate_budget, REQUIRED_FUNDING_AMOUNT * 2);
        assert_eq!(mandate.reserved_budget, 0);
        assert_eq!(mandate.consumed_budget, 0);
        assert!(mandate.allow_release_after_pass);
        assert!(!mandate.allow_refund_after_fail);
        assert!(!mandate.revoked);
        assert_eq!(mandate.version, 1);
    }

    #[test]
    #[should_panic(expected = "ONLY_MANDATE_AGENT_MAY_CREATE_TRADE")]
    fn unauthorized_account_cannot_create_trade_under_mandate() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("attacker.testnet", 2_000);

        contract.create_trade_under_mandate(mandate_id, commitment(), commitment(), commitment());
    }

    #[test]
    fn agent_created_trade_uses_mandate_identity_and_creates_snapshot() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        let trade = contract.get_trade(trade_id).unwrap();
        let snapshot = contract.trade_policy_snapshots.get(&trade_id).unwrap();
        let mandate = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(trade.buyer, account("buyer.testnet"));
        assert_eq!(trade.supplier, account("supplier.testnet"));
        assert_eq!(trade.resolver, account("resolver.testnet"));
        assert_eq!(trade.payment_token, account("sdd.testnet"));
        assert_eq!(trade.amount, REQUIRED_FUNDING_AMOUNT.to_string());
        assert_eq!(trade.state, TradeState::AwaitingAcceptance);

        assert_eq!(snapshot.trade_id, trade_id);
        assert_eq!(snapshot.mandate_id, mandate_id);
        assert_eq!(snapshot.mandate_version, 1);
        assert_eq!(snapshot.buyer, account("buyer.testnet"));
        assert_eq!(snapshot.agent, account("agent.testnet"));
        assert_eq!(snapshot.supplier, account("supplier.testnet"));
        assert_eq!(snapshot.resolver, account("resolver.testnet"));
        assert_eq!(snapshot.amount, REQUIRED_FUNDING_AMOUNT);
        assert!(snapshot.allow_release_after_pass);
        assert!(!snapshot.allow_refund_after_fail);

        assert_eq!(mandate.reserved_budget, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(mandate.consumed_budget, 0);
    }

    #[test]
    #[should_panic(expected = "MANDATE_REVOKED")]
    fn revoked_mandate_cannot_create_new_trade() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("buyer.testnet", 2_000);
        contract.revoke_mandate(mandate_id);

        context("agent.testnet", 3_000);
        contract.create_trade_under_mandate(mandate_id, commitment(), commitment(), commitment());
    }

    #[test]
    #[should_panic(expected = "MANDATE_EXPIRED")]
    fn expired_mandate_cannot_create_new_trade() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 2_000);

        context("agent.testnet", 2_000);
        contract.create_trade_under_mandate(mandate_id, commitment(), commitment(), commitment());
    }

    #[test]
    #[should_panic(expected = "MANDATE_BUDGET_EXCEEDED")]
    fn mandate_cannot_reserve_more_than_aggregate_budget() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT, 100_000);

        create_agent_trade(&mut contract, mandate_id, 2_000);

        // The first trade has reserved the entire mandate budget.
        // Creating a second trade must fail.
        create_agent_trade(&mut contract, mandate_id, 3_000);
    }

    #[test]
    fn cancelling_agent_created_trade_releases_reserved_budget() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        let mandate_before = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(mandate_before.reserved_budget, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(mandate_before.consumed_budget, 0);

        context("buyer.testnet", 3_000);
        contract.cancel_trade(trade_id);

        let mandate_after = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(
            contract.get_trade(trade_id).unwrap().state,
            TradeState::Cancelled
        );
        assert_eq!(mandate_after.reserved_budget, 0);
        assert_eq!(mandate_after.consumed_budget, 0);
    }

    #[test]
    fn successful_funding_converts_reserved_budget_to_consumed() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        context("supplier.testnet", 3_000);
        contract.accept_trade(trade_id);

        // Revoke the mandate after supplier acceptance.
        // This must not prevent the buyer from funding the existing trade.
        context("buyer.testnet", 4_000);
        contract.revoke_mandate(mandate_id);

        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            5_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );

        assert_eq!(unused, 0);
        let funded_trade = contract.get_trade(trade_id).unwrap();
        assert_eq!(funded_trade.funded_at, Some(5_000));
        assert_eq!(funded_trade.documents_completed_at, None);
        assert_eq!(funded_trade.inspector_assigned_at, None);
        assert_eq!(
            contract.get_trade(trade_id).unwrap().state,
            TradeState::Funded
        );

        let mandate = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(mandate.reserved_budget, 0);
        assert_eq!(mandate.consumed_budget, REQUIRED_FUNDING_AMOUNT);
        assert!(mandate.revoked);
    }

    #[test]
    fn rejected_funding_does_not_change_mandate_budget() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        context("supplier.testnet", 3_000);
        contract.accept_trade(trade_id);

        // An attacker attempts to fund the trade instead of the buyer.
        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "attacker.testnet",
            4_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );

        assert_eq!(unused, REQUIRED_FUNDING_AMOUNT);

        let mandate = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(mandate.reserved_budget, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(mandate.consumed_budget, 0);

        assert_eq!(
            contract.get_trade(trade_id).unwrap().state,
            TradeState::Accepted
        );
    }

    #[test]
    fn corrupted_snapshot_is_rejected_without_budget_mutation() {
        // Snapshot points to a different trade.
        assert_corrupted_snapshot_rejected(|snapshot| {
            snapshot.trade_id += 1;
        });

        // Snapshot identifies a different buyer.
        assert_corrupted_snapshot_rejected(|snapshot| {
            snapshot.buyer = account("attacker.testnet");
        });

        // Snapshot identifies a different payment token.
        assert_corrupted_snapshot_rejected(|snapshot| {
            snapshot.payment_token = account("attacker.testnet");
        });

        // Snapshot amount differs from the actual trade amount.
        assert_corrupted_snapshot_rejected(|snapshot| {
            snapshot.amount += 1;
        });

        // Snapshot identifies a different supplier.
        assert_corrupted_snapshot_rejected(|snapshot| {
            snapshot.supplier = account("attacker.testnet");
        });

        // Snapshot identifies a different resolver.
        assert_corrupted_snapshot_rejected(|snapshot| {
            snapshot.resolver = account("attacker.testnet");
        });
    }

    #[test]
    fn corrupted_mandate_identity_is_rejected_without_budget_mutation() {
        // The mandate buyer no longer matches the snapshot buyer.
        assert_corrupted_mandate_rejected(|mandate| {
            mandate.buyer = account("attacker.testnet");
        });

        // The mandate payment token no longer matches the snapshot token.
        assert_corrupted_mandate_rejected(|mandate| {
            mandate.payment_token = account("attacker.testnet");
        });
    }

    #[test]
    fn updating_mandate_does_not_modify_existing_trade_snapshot() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        let original_snapshot = contract.trade_policy_snapshots.get(&trade_id).unwrap();

        context("buyer.testnet", 3_000);

        contract.update_mandate(
            mandate_id,
            account("newagent.testnet"),
            account("newsupplier.testnet"),
            account("newresolver.testnet"),
            U128(REQUIRED_FUNDING_AMOUNT),
            U128(REQUIRED_FUNDING_AMOUNT * 3),
            false,
            true,
            200_000,
        );

        let updated_mandate = contract.mandates.get(&mandate_id).unwrap();
        let unchanged_snapshot = contract.trade_policy_snapshots.get(&trade_id).unwrap();

        assert_eq!(updated_mandate.version, 2);
        assert_eq!(updated_mandate.agent, account("newagent.testnet"));
        assert_eq!(updated_mandate.supplier, account("newsupplier.testnet"));
        assert_eq!(updated_mandate.resolver, account("newresolver.testnet"));
        assert!(!updated_mandate.allow_release_after_pass);
        assert!(updated_mandate.allow_refund_after_fail);

        assert_eq!(
            unchanged_snapshot.mandate_version,
            original_snapshot.mandate_version
        );
        assert_eq!(unchanged_snapshot.agent, account("agent.testnet"));
        assert_eq!(unchanged_snapshot.supplier, account("supplier.testnet"));
        assert_eq!(unchanged_snapshot.resolver, account("resolver.testnet"));
        assert!(unchanged_snapshot.allow_release_after_pass);
        assert!(!unchanged_snapshot.allow_refund_after_fail);
    }

    #[test]
    #[should_panic(expected = "ONLY_MANDATE_BUYER_MAY_UPDATE")]
    fn unauthorized_account_cannot_update_mandate() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("attacker.testnet", 2_000);

        contract.update_mandate(
            mandate_id,
            account("newagent.testnet"),
            account("newsupplier.testnet"),
            account("newresolver.testnet"),
            U128(REQUIRED_FUNDING_AMOUNT),
            U128(REQUIRED_FUNDING_AMOUNT * 2),
            false,
            true,
            200_000,
        );
    }

    #[test]
    #[should_panic(expected = "ONLY_MANDATE_BUYER_MAY_RENEW")]
    fn unauthorized_account_cannot_renew_mandate() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("attacker.testnet", 2_000);
        contract.renew_mandate(mandate_id, 200_000);
    }

    #[test]
    #[should_panic(expected = "ONLY_MANDATE_BUYER_MAY_REVOKE")]
    fn unauthorized_account_cannot_revoke_mandate() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("attacker.testnet", 2_000);
        contract.revoke_mandate(mandate_id);
    }

    #[test]
    #[should_panic(expected = "NEW_BUDGET_BELOW_COMMITTED_AMOUNT")]
    fn mandate_budget_cannot_be_reduced_below_reserved_amount() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        // Reserve one full trade amount.
        create_agent_trade(&mut contract, mandate_id, 2_000);

        // The buyer attempts to reduce the budget below the reserved amount.
        context("buyer.testnet", 3_000);

        contract.update_mandate(
            mandate_id,
            account("agent.testnet"),
            account("supplier.testnet"),
            account("resolver.testnet"),
            U128(REQUIRED_FUNDING_AMOUNT),
            U128(0),
            true,
            false,
            200_000,
        );
    }

    #[test]
    #[should_panic(expected = "NEW_BUDGET_BELOW_COMMITTED_AMOUNT")]
    fn mandate_budget_cannot_be_reduced_below_consumed_amount() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        context("supplier.testnet", 3_000);
        contract.accept_trade(trade_id);

        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            4_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );

        assert_eq!(unused, 0);

        let mandate = contract.mandates.get(&mandate_id).unwrap();
        assert_eq!(mandate.reserved_budget, 0);
        assert_eq!(mandate.consumed_budget, REQUIRED_FUNDING_AMOUNT);

        // The buyer cannot reduce the budget below funds already consumed.
        context("buyer.testnet", 5_000);

        contract.update_mandate(
            mandate_id,
            account("agent.testnet"),
            account("supplier.testnet"),
            account("resolver.testnet"),
            U128(REQUIRED_FUNDING_AMOUNT),
            U128(0),
            true,
            false,
            200_000,
        );
    }

    #[test]
    fn buyer_can_renew_revoked_mandate_and_reactivate_it() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("buyer.testnet", 2_000);
        contract.revoke_mandate(mandate_id);

        let revoked = contract.mandates.get(&mandate_id).unwrap();
        assert!(revoked.revoked);
        assert_eq!(revoked.version, 2);

        context("buyer.testnet", 3_000);
        contract.renew_mandate(mandate_id, 200_000);

        let renewed = contract.mandates.get(&mandate_id).unwrap();

        assert!(!renewed.revoked);
        assert_eq!(renewed.expires_at, 200_000);
        assert_eq!(renewed.version, 3);

        // Renewal must preserve the existing policy.
        assert_eq!(renewed.agent, account("agent.testnet"));
        assert_eq!(renewed.supplier, account("supplier.testnet"));
        assert_eq!(renewed.resolver, account("resolver.testnet"));
        assert!(renewed.allow_release_after_pass);
        assert!(!renewed.allow_refund_after_fail);
    }

    #[test]
    #[should_panic(expected = "MANDATE_ALREADY_REVOKED")]
    fn already_revoked_mandate_cannot_be_revoked_again() {
        let mut contract = contract();

        let mandate_id =
            create_test_mandate(&mut contract, 1_000, REQUIRED_FUNDING_AMOUNT * 2, 100_000);

        context("buyer.testnet", 2_000);
        contract.revoke_mandate(mandate_id);

        context("buyer.testnet", 3_000);
        contract.revoke_mandate(mandate_id);
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
    fn completing_required_documents_records_timestamp_once() {
        let mut contract = contract();
        let id = funded_trade(&mut contract, 1_000);

        add_required_supplier_documents(&mut contract, id, 3_000);

        let trade = contract.get_trade(id).unwrap();
        assert_eq!(trade.documents_completed_at, Some(3_002));
        assert_eq!(trade.funded_at, Some(2_000));
        assert_eq!(trade.inspector_assigned_at, None);

        // A later document version must not restart the assignment window.
        context("supplier.testnet", 5_000);
        contract.record_document_commitment(id, DocumentType::CommercialInvoice, 2, commitment());

        assert_eq!(
            contract.get_trade(id).unwrap().documents_completed_at,
            Some(3_002)
        );
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

    #[test]
    #[should_panic]
    fn constructor_rejects_admin_count_other_than_three() {
        context("buyer.testnet", 1_000);

        Riventa::new(
            vec![account("admin1.testnet"), account("admin2.testnet")],
            account("sdd.testnet"),
        );
    }

    #[test]
    #[should_panic]
    fn constructor_rejects_duplicate_admins() {
        context("buyer.testnet", 1_000);

        Riventa::new(
            vec![
                account("admin1.testnet"),
                account("admin1.testnet"),
                account("admin3.testnet"),
            ],
            account("sdd.testnet"),
        );
    }

    #[test]
    #[should_panic(expected = "INSUFFICIENT_ADMIN_APPROVALS")]
    fn admin_action_cannot_execute_with_only_one_approval() {
        let mut contract = contract();

        context("admin1.testnet", 1_000);
        let proposal_id = contract.propose_admin_action(AdminAction::PauseNewTrades);

        context("relayer.testnet", 1_001);
        contract.execute_admin_action(proposal_id);
    }

    #[test]
    #[should_panic(expected = "ADMIN_ALREADY_APPROVED")]
    fn admin_cannot_approve_the_same_proposal_twice() {
        let mut contract = contract();

        context("admin1.testnet", 1_000);
        let proposal_id = contract.propose_admin_action(AdminAction::PauseNewTrades);

        context("admin1.testnet", 1_001);
        contract.approve_admin_action(proposal_id);
    }

    #[test]
    #[should_panic(expected = "ONLY_MULTISIG_ADMIN")]
    fn non_admin_cannot_propose_admin_action() {
        let mut contract = contract();

        context("attacker.testnet", 1_000);
        contract.propose_admin_action(AdminAction::PauseNewTrades);
    }

    #[test]
    fn two_admins_can_approve_and_execute_admin_action() {
        let mut contract = contract();

        let proposal_id = execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::PauseNewTrades,
            1_000,
        );

        assert!(contract.paused);
        assert!(contract.get_admin_proposal(proposal_id).is_none());
        assert_eq!(contract.get_contract_config().pending_admin_proposals, 0);
    }

    #[test]
    fn expired_admin_proposal_can_be_removed_permissionlessly() {
        let mut contract = contract();

        context("admin1.testnet", 1_000);
        let proposal_id = contract.propose_admin_action(AdminAction::PauseNewTrades);

        context("relayer.testnet", 1_000 + ADMIN_PROPOSAL_WINDOW_NS);
        contract.expire_admin_proposal(proposal_id);

        assert!(contract.get_admin_proposal(proposal_id).is_none());
        assert_eq!(contract.get_contract_config().pending_admin_proposals, 0);
        assert!(!contract.paused);
    }

    #[test]
    #[should_panic(expected = "ADMIN_PROPOSAL_EXPIRED")]
    fn expired_admin_proposal_cannot_be_executed() {
        let mut contract = contract();

        context("admin1.testnet", 1_000);
        let proposal_id = contract.propose_admin_action(AdminAction::PauseNewTrades);

        context("admin2.testnet", 1_001);
        contract.approve_admin_action(proposal_id);

        context("relayer.testnet", 1_000 + ADMIN_PROPOSAL_WINDOW_NS);
        contract.execute_admin_action(proposal_id);
    }

    #[test]
    fn multisig_can_register_inspector() {
        let mut contract = contract();

        register_test_inspector(&mut contract, "inspector.testnet", 1_000);

        let inspector = contract
            .get_inspector(account("inspector.testnet"))
            .unwrap();

        assert!(inspector.active);
        assert_eq!(inspector.credential_commitment, [7u8; 32]);
        assert_eq!(inspector.registered_at, 1_002);
    }

    #[test]
    #[should_panic]
    fn multisig_cannot_register_an_admin_as_inspector() {
        let mut contract = contract();

        execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::RegisterInspector {
                account_id: account("admin1.testnet"),
                credential_commitment: [7u8; 32],
            },
            1_000,
        );
    }

    #[test]
    #[should_panic]
    fn multisig_cannot_register_token_contract_as_inspector() {
        let mut contract = contract();

        execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::RegisterInspector {
                account_id: account("sdd.testnet"),
                credential_commitment: [7u8; 32],
            },
            1_000,
        );
    }

    #[test]
    fn multisig_can_suspend_and_reactivate_inspector() {
        let mut contract = contract();

        register_test_inspector(&mut contract, "inspector.testnet", 1_000);

        execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::SetInspectorStatus {
                account_id: account("inspector.testnet"),
                active: false,
            },
            2_000,
        );

        assert!(
            !contract
                .get_inspector(account("inspector.testnet"))
                .unwrap()
                .active
        );

        execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::SetInspectorStatus {
                account_id: account("inspector.testnet"),
                active: true,
            },
            3_000,
        );

        assert!(
            contract
                .get_inspector(account("inspector.testnet"))
                .unwrap()
                .active
        );
    }

    #[test]
    #[should_panic(expected = "REQUIRED_SUPPLIER_DOCUMENTS_INCOMPLETE")]
    fn inspector_cannot_be_assigned_before_all_required_documents_exist() {
        let mut contract = contract();

        register_test_inspector(&mut contract, "inspector.testnet", 1_000);

        let trade_id = funded_trade(&mut contract, 10_000);

        context("supplier.testnet", 12_000);
        contract.record_document_commitment(
            trade_id,
            DocumentType::CommercialInvoice,
            1,
            commitment(),
        );

        context("buyer.testnet", 13_000);
        contract.assign_inspector(trade_id, account("inspector.testnet"));
    }

    #[test]
    #[should_panic(expected = "INSPECTOR_NOT_ACTIVE")]
    fn buyer_cannot_assign_suspended_inspector() {
        let mut contract = contract();

        register_test_inspector(&mut contract, "inspector.testnet", 1_000);

        execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::SetInspectorStatus {
                account_id: account("inspector.testnet"),
                active: false,
            },
            2_000,
        );

        let trade_id = funded_trade(&mut contract, 10_000);
        add_required_supplier_documents(&mut contract, trade_id, 12_000);

        context("buyer.testnet", 13_000);
        contract.assign_inspector(trade_id, account("inspector.testnet"));
    }

    #[test]
    fn buyer_can_assign_registered_active_inspector() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        assert_eq!(
            contract.get_trade(trade_id).unwrap().state,
            TradeState::InspectionPending
        );

        let trade = contract.get_trade(trade_id).unwrap();
        assert_eq!(trade.inspector_assigned_at, Some(14_000));

        let record = contract.get_inspection_record(trade_id).unwrap();

        assert_eq!(record.assigned_inspector, account("inspector.testnet"));
        assert_eq!(record.replacement_count, 0);
        assert!(record.attestation.is_none());
    }

    #[test]
    fn buyer_can_replace_inspector_once_before_attestation() {
        let mut contract = contract();

        register_test_inspector(&mut contract, "inspector1.testnet", 1_000);

        register_test_inspector(&mut contract, "inspector2.testnet", 2_000);

        let trade_id = funded_trade(&mut contract, 10_000);
        add_required_supplier_documents(&mut contract, trade_id, 12_000);

        context("buyer.testnet", 13_000);
        contract.assign_inspector(trade_id, account("inspector1.testnet"));

        assert_eq!(
            contract.get_trade(trade_id).unwrap().inspector_assigned_at,
            Some(13_000)
        );

        context("buyer.testnet", 14_000);
        contract.replace_inspector(trade_id, account("inspector2.testnet"));

        assert_eq!(
            contract.get_trade(trade_id).unwrap().inspector_assigned_at,
            Some(14_000)
        );

        let record = contract.get_inspection_record(trade_id).unwrap();

        assert_eq!(record.assigned_inspector, account("inspector2.testnet"));
        assert_eq!(record.replacement_count, 1);
        assert!(record.attestation.is_none());
    }

    #[test]
    #[should_panic(expected = "INSPECTOR_REPLACEMENT_LIMIT_REACHED")]
    fn buyer_cannot_replace_inspector_twice() {
        let mut contract = contract();

        register_test_inspector(&mut contract, "inspector1.testnet", 1_000);

        register_test_inspector(&mut contract, "inspector2.testnet", 2_000);

        register_test_inspector(&mut contract, "inspector3.testnet", 3_000);

        let trade_id = funded_trade(&mut contract, 10_000);
        add_required_supplier_documents(&mut contract, trade_id, 12_000);

        context("buyer.testnet", 13_000);
        contract.assign_inspector(trade_id, account("inspector1.testnet"));

        context("buyer.testnet", 14_000);
        contract.replace_inspector(trade_id, account("inspector2.testnet"));

        context("buyer.testnet", 15_000);
        contract.replace_inspector(trade_id, account("inspector3.testnet"));
    }

    #[test]
    fn assigned_inspector_can_submit_pass_attestation() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        context("inspector.testnet", 20_000);
        contract.submit_inspection_attestation(trade_id, InspectionOutcome::Pass, commitment());

        assert_eq!(
            contract.get_trade(trade_id).unwrap().state,
            TradeState::InspectionPassed
        );

        let record = contract.get_inspection_record(trade_id).unwrap();
        let attestation = record.attestation.unwrap();

        assert_eq!(attestation.outcome, InspectionOutcome::Pass);
        assert_eq!(attestation.inspector, account("inspector.testnet"));
        assert_eq!(attestation.evidence_commitment, [7u8; 32]);
    }

    #[test]
    fn assigned_inspector_can_submit_fail_attestation() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        context("inspector.testnet", 20_000);
        contract.submit_inspection_attestation(trade_id, InspectionOutcome::Fail, commitment());

        assert_eq!(
            contract.get_trade(trade_id).unwrap().state,
            TradeState::InspectionFailed
        );
    }

    #[test]
    #[should_panic(expected = "ONLY_ASSIGNED_INSPECTOR_MAY_ATTEST")]
    fn unrelated_account_cannot_submit_inspection_attestation() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        context("attacker.testnet", 20_000);
        contract.submit_inspection_attestation(trade_id, InspectionOutcome::Pass, commitment());
    }

    #[test]
    #[should_panic(expected = "INSPECTOR_NOT_ACTIVE")]
    fn suspended_inspector_cannot_submit_attestation() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        execute_admin_action_with_two_approvals(
            &mut contract,
            AdminAction::SetInspectorStatus {
                account_id: account("inspector.testnet"),
                active: false,
            },
            20_000,
        );

        context("inspector.testnet", 21_000);
        contract.submit_inspection_attestation(trade_id, InspectionOutcome::Pass, commitment());
    }

    #[test]
    fn mandate_agent_can_authorize_payout_after_passing_inspection() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Pass,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_release(trade_id);

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::ReleaseAuthorized
        );
    }

    #[test]
    fn mandate_agent_can_authorize_refund_after_failed_inspection() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            true,
            InspectionOutcome::Fail,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_refund(trade_id);

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundAuthorized
        );
    }

    #[test]
    #[should_panic(expected = "MANDATE_RELEASE_NOT_AUTHORIZED")]
    fn agent_cannot_authorize_payout_when_snapshot_disables_it() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            false,
            InspectionOutcome::Pass,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_release(trade_id);
    }

    #[test]
    #[should_panic(expected = "MANDATE_REFUND_NOT_AUTHORIZED")]
    fn agent_cannot_authorize_refund_when_snapshot_disables_it() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            false,
            InspectionOutcome::Fail,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_refund(trade_id);
    }

    #[test]
    fn buyer_can_confirm_payout_when_mandate_disables_agent_release() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            false,
            InspectionOutcome::Pass,
        );

        context("buyer.testnet", 10_000);
        contract.confirm_release(trade_id);

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::ReleaseAuthorized
        );
    }

    #[test]
    fn buyer_can_choose_refund_when_mandate_disables_agent_refund() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            false,
            InspectionOutcome::Fail,
        );

        context("buyer.testnet", 10_000);
        contract.choose_refund(trade_id);

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundAuthorized
        );
    }

    #[test]
    #[should_panic(expected = "MANDATE_AGENT_AUTHORIZATION_REQUIRED")]
    fn buyer_cannot_bypass_enabled_agent_release_authority() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Pass,
        );

        context("buyer.testnet", 10_000);
        contract.confirm_release(trade_id);
    }

    #[test]
    #[should_panic(expected = "MANDATE_AGENT_AUTHORIZATION_REQUIRED")]
    fn buyer_cannot_bypass_enabled_agent_refund_authority() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            true,
            InspectionOutcome::Fail,
        );

        context("buyer.testnet", 10_000);
        contract.choose_refund(trade_id);
    }

    #[test]
    #[should_panic(expected = "ONLY_MANDATE_AGENT_MAY_AUTHORIZE_SETTLEMENT")]
    fn unrelated_account_cannot_authorize_mandated_payout() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Pass,
        );

        context("unrelated.testnet", 10_000);
        contract.authorize_mandated_release(trade_id);
    }

    #[test]
    #[should_panic(expected = "INVALID_TRADE_STATE_FOR_RELEASE_AUTHORIZATION")]
    fn agent_cannot_authorize_payout_after_failed_inspection() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Fail,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_release(trade_id);
    }

    #[test]
    fn funded_trade_keeps_snapshot_authority_after_mandate_revocation() {
        let mut contract = contract();

        let (mandate_id, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Pass,
        );

        context("buyer.testnet", 10_000);
        contract.revoke_mandate(mandate_id);

        context("agent.testnet", 11_000);
        contract.authorize_mandated_release(trade_id);

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::ReleaseAuthorized
        );
    }

    #[test]
    fn ordinary_trade_buyer_can_confirm_payout_after_passing_inspection() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        context("inspector.testnet", 10_000);
        contract.submit_inspection_attestation(trade_id, InspectionOutcome::Pass, commitment());

        context("buyer.testnet", 11_000);
        contract.confirm_release(trade_id);

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::ReleaseAuthorized
        );
    }

    fn set_trade_state(contract: &mut Riventa, trade_id: u64, state: TradeState) {
        let mut trade = contract.trades.get(&trade_id).unwrap();
        trade.state = state;
        contract.trades.insert(&trade_id, &trade);
    }

    fn settlement_callback_context(result: near_sdk::PromiseResult) {
        let mut builder = VMContextBuilder::new();

        builder.current_account_id(account("riventa.testnet"));
        builder.predecessor_account_id(account("riventa.testnet"));
        builder.block_timestamp(2_000);

        testing_env!(
            builder.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result],
        );
    }

    #[test]
    fn payout_settlement_succeeds_and_completes_trade() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::ReleaseAuthorized);

        let _promise = contract.release_payment(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let pending = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(pending.trade_id, trade_id);
        assert_eq!(pending.recipient, account("supplier.testnet"));
        assert_eq!(pending.amount, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(pending.kind, SettlementKind::Payout);
        assert_eq!(pending.status, SettlementStatus::Pending);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::PayoutPending
        );

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let completed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(completed.status, SettlementStatus::Succeeded);
        assert!(completed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Completed
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn failed_payout_restores_release_authorization() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::ReleaseAuthorized);

        let _promise = contract.release_payment(trade_id);
        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        settlement_callback_context(near_sdk::PromiseResult::Failed);

        assert!(!contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let failed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(failed.status, SettlementStatus::Failed);
        assert!(failed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::ReleaseAuthorized
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn refund_settlement_succeeds_and_refunds_trade() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::RefundAuthorized);

        let _promise = contract.refund_escrow(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let pending = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(pending.trade_id, trade_id);
        assert_eq!(pending.recipient, account("buyer.testnet"));
        assert_eq!(pending.amount, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(pending.kind, SettlementKind::Refund);
        assert_eq!(pending.status, SettlementStatus::Pending);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundPending
        );

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let completed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(completed.status, SettlementStatus::Succeeded);
        assert!(completed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Refunded
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn failed_refund_restores_refund_authorization() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::RefundAuthorized);

        let _promise = contract.refund_escrow(trade_id);
        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        settlement_callback_context(near_sdk::PromiseResult::Failed);

        assert!(!contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let failed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(failed.status, SettlementStatus::Failed);
        assert!(failed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundAuthorized
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn supplier_document_timeout_refunds_at_exact_deadline() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        let funded_at = contract.trades.get(&trade_id).unwrap().funded_at.unwrap();
        let deadline = funded_at + SUPPLIER_DOCUMENT_WINDOW_NS;

        // One nanosecond before the deadline is not eligible.
        context("buyer.testnet", deadline - 1);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.refund_after_timeout(trade_id).detach();
        }));

        assert!(result.is_err());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Funded
        );

        // Recovery becomes available exactly at the deadline.
        context("buyer.testnet", deadline);
        let _promise = contract.refund_after_timeout(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let settlement = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(settlement.kind, SettlementKind::Refund);
        assert_eq!(
            settlement.reason,
            SettlementReason::SupplierDocumentsTimeout
        );
        assert_eq!(settlement.recipient, account("buyer.testnet"));
        assert_eq!(settlement.status, SettlementStatus::Pending);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundPending
        );
    }

    #[test]
    fn inspector_assignment_timeout_refunds_at_exact_deadline() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        add_required_supplier_documents(&mut contract, trade_id, 3_000);

        let trade = contract.trades.get(&trade_id).unwrap();
        let documents_completed_at = trade.documents_completed_at.unwrap();
        let deadline = documents_completed_at + INSPECTOR_ASSIGNMENT_WINDOW_NS;

        assert_eq!(trade.state, TradeState::DocumentReview);
        assert!(contract.trade_inspections.get(&trade_id).is_none());

        // Recovery must not be available one nanosecond before expiry.
        context("buyer.testnet", deadline - 1);
        let early_attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.refund_after_timeout(trade_id).detach();
        }));

        assert!(early_attempt.is_err());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::DocumentReview
        );
        assert!(contract.active_settlements.get(&trade_id).is_none());

        context("buyer.testnet", deadline);
        let _promise = contract.refund_after_timeout(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let settlement = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(settlement.kind, SettlementKind::Refund);
        assert_eq!(
            settlement.reason,
            SettlementReason::InspectorAssignmentTimeout
        );
        assert_eq!(settlement.recipient, account("buyer.testnet"));
        assert_eq!(settlement.status, SettlementStatus::Pending);
    }

    #[test]
    fn inspection_timeout_refunds_at_exact_deadline() {
        let mut contract = contract();
        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        let trade = contract.trades.get(&trade_id).unwrap();
        let assigned_at = trade.inspector_assigned_at.unwrap();
        let deadline = assigned_at + INSPECTION_WINDOW_NS;

        let inspection = contract.trade_inspections.get(&trade_id).unwrap();
        assert!(inspection.attestation.is_none());

        // Recovery must not be available one nanosecond before expiry.
        context("buyer.testnet", deadline - 1);
        let early_attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.refund_after_timeout(trade_id).detach();
        }));

        assert!(early_attempt.is_err());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::InspectionPending
        );
        assert!(contract.active_settlements.get(&trade_id).is_none());

        context("buyer.testnet", deadline);
        let _promise = contract.refund_after_timeout(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let settlement = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(settlement.kind, SettlementKind::Refund);
        assert_eq!(settlement.reason, SettlementReason::InspectionTimeout);
        assert_eq!(settlement.recipient, account("buyer.testnet"));
        assert_eq!(settlement.status, SettlementStatus::Pending);
    }

    #[test]
    #[should_panic(expected = "NO_ELIGIBLE_TIMEOUT_REFUND")]
    fn attested_inspection_cannot_use_timeout_refund() {
        let mut contract = contract();

        let trade_id = inspection_pending_trade(&mut contract, "inspector.testnet", 1_000);

        context("inspector.testnet", 20_000);
        contract.submit_inspection_attestation(trade_id, InspectionOutcome::Pass, commitment());

        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::InspectionPassed
        );

        // Even after the original inspection deadline, an attested trade
        // must use the ordinary settlement authorization path.
        let assigned_at = contract
            .trades
            .get(&trade_id)
            .unwrap()
            .inspector_assigned_at
            .unwrap();

        let deadline = assigned_at + INSPECTION_WINDOW_NS;

        context("buyer.testnet", deadline);
        contract.refund_after_timeout(trade_id).detach();
    }

    #[test]
    #[should_panic(expected = "ONLY_BUYER_MAY_INITIATE_TIMEOUT_REFUND")]
    fn non_buyer_cannot_initiate_timeout_refund() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        let funded_at = contract.trades.get(&trade_id).unwrap().funded_at.unwrap();
        let deadline = funded_at + SUPPLIER_DOCUMENT_WINDOW_NS;

        context("attacker.testnet", deadline);
        contract.refund_after_timeout(trade_id).detach();
    }

    #[test]
    fn timeout_recovery_bypasses_delegated_refund_authority_without_restoring_budget() {
        let mut contract = contract();

        // This mandate explicitly delegates refund authority to its agent.
        let mandate_id = create_test_mandate_with_permissions(
            &mut contract,
            1_000,
            REQUIRED_FUNDING_AMOUNT * 2,
            u64::MAX,
            true,
            true,
        );

        let trade_id = create_agent_trade(&mut contract, mandate_id, 2_000);

        context("supplier.testnet", 3_000);
        contract.accept_trade(trade_id);

        let unused = receive(
            &mut contract,
            "sdd.testnet",
            "buyer.testnet",
            4_000,
            REQUIRED_FUNDING_AMOUNT,
            &format!(r#"{{"trade_id":{trade_id}}}"#),
        );

        assert_eq!(unused, 0);

        let mandate_before = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(mandate_before.reserved_budget, 0);
        assert_eq!(mandate_before.consumed_budget, REQUIRED_FUNDING_AMOUNT);
        assert!(mandate_before.allow_refund_after_fail);

        let snapshot = contract.trade_policy_snapshots.get(&trade_id).unwrap();
        assert!(snapshot.allow_refund_after_fail);

        let funded_at = contract.trades.get(&trade_id).unwrap().funded_at.unwrap();
        let deadline = funded_at + SUPPLIER_DOCUMENT_WINDOW_NS;

        // The agent's delegated refund permission is not needed for timeout recovery.
        context("buyer.testnet", deadline);
        let _promise = contract.refund_after_timeout(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let settlement = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(
            settlement.reason,
            SettlementReason::SupplierDocumentsTimeout
        );
        assert_eq!(settlement.recipient, account("buyer.testnet"));
        assert_eq!(settlement.status, SettlementStatus::Pending);

        // A timeout refund does not reverse consumed mandate budget.
        let mandate_after = contract.mandates.get(&mandate_id).unwrap();

        assert_eq!(mandate_after.reserved_budget, 0);
        assert_eq!(mandate_after.consumed_budget, REQUIRED_FUNDING_AMOUNT);
    }

    #[test]
    fn failed_timeout_refund_preserves_reason_and_allows_retry() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        let funded_at = contract.trades.get(&trade_id).unwrap().funded_at.unwrap();
        let deadline = funded_at + SUPPLIER_DOCUMENT_WINDOW_NS;

        context("buyer.testnet", deadline);
        let _promise = contract.refund_after_timeout(trade_id);

        let first_settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        let first_settlement = contract
            .settlement_records
            .get(&first_settlement_id)
            .unwrap();

        assert_eq!(
            first_settlement.reason,
            SettlementReason::SupplierDocumentsTimeout
        );

        // Simulate a failed NEP-141 transfer callback.
        settlement_callback_context(near_sdk::PromiseResult::Failed);

        assert!(!contract.on_settlement_transfer_complete(trade_id, first_settlement_id));

        let failed = contract
            .settlement_records
            .get(&first_settlement_id)
            .unwrap();

        assert_eq!(failed.status, SettlementStatus::Failed);
        assert_eq!(failed.reason, SettlementReason::SupplierDocumentsTimeout);
        assert_eq!(contract.active_settlements.get(&trade_id), None);

        let trade = contract.trades.get(&trade_id).unwrap();

        assert_eq!(trade.state, TradeState::RefundAuthorized);
        assert_eq!(
            trade.refund_reason,
            Some(SettlementReason::SupplierDocumentsTimeout)
        );

        // Any account may trigger a previously authorized refund.
        context("keeper.testnet", deadline + 1);
        let _retry_promise = contract.refund_escrow(trade_id);

        let retry_settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        assert_ne!(retry_settlement_id, first_settlement_id);

        let retry = contract
            .settlement_records
            .get(&retry_settlement_id)
            .unwrap();

        assert_eq!(retry.kind, SettlementKind::Refund);
        assert_eq!(retry.reason, SettlementReason::SupplierDocumentsTimeout);
        assert_eq!(retry.recipient, account("buyer.testnet"));
        assert_eq!(retry.status, SettlementStatus::Pending);

        // The retry can complete normally.
        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(contract.on_settlement_transfer_complete(trade_id, retry_settlement_id));

        let completed = contract
            .settlement_records
            .get(&retry_settlement_id)
            .unwrap();

        assert_eq!(completed.status, SettlementStatus::Succeeded);
        assert_eq!(completed.reason, SettlementReason::SupplierDocumentsTimeout);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Refunded
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn mandated_payout_settlement_succeeds_and_completes_trade() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Pass,
        );

        // The mandate agent authorizes the payout.
        context("agent.testnet", 10_000);
        contract.authorize_mandated_release(trade_id);

        // Any account can trigger an already-authorized settlement.
        context("keeper.testnet", 11_000);
        let _promise = contract.release_payment(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let pending = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(pending.trade_id, trade_id);
        assert_eq!(pending.recipient, account("supplier.testnet"));
        assert_eq!(pending.amount, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(pending.kind, SettlementKind::Payout);
        assert_eq!(pending.status, SettlementStatus::Pending);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::PayoutPending
        );

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let completed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(completed.status, SettlementStatus::Succeeded);
        assert!(completed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Completed
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn mandated_refund_settlement_succeeds_and_refunds_trade() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            true,
            InspectionOutcome::Fail,
        );

        // The mandate agent authorizes the refund.
        context("agent.testnet", 10_000);
        contract.authorize_mandated_refund(trade_id);

        // Any account can trigger an already-authorized settlement.
        context("keeper.testnet", 11_000);
        let _promise = contract.refund_escrow(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();
        let pending = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(pending.trade_id, trade_id);
        assert_eq!(pending.recipient, account("buyer.testnet"));
        assert_eq!(pending.amount, REQUIRED_FUNDING_AMOUNT);
        assert_eq!(pending.kind, SettlementKind::Refund);
        assert_eq!(pending.status, SettlementStatus::Pending);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundPending
        );

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let completed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(completed.status, SettlementStatus::Succeeded);
        assert!(completed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Refunded
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn failed_mandated_payout_restores_release_authorization() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            true,
            false,
            InspectionOutcome::Pass,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_release(trade_id);

        context("keeper.testnet", 11_000);
        let _promise = contract.release_payment(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        settlement_callback_context(near_sdk::PromiseResult::Failed);

        assert!(!contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let failed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(failed.status, SettlementStatus::Failed);
        assert!(failed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::ReleaseAuthorized
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn failed_mandated_refund_restores_refund_authorization() {
        let mut contract = contract();

        let (_, trade_id) = mandate_inspection_trade(
            &mut contract,
            "inspector.testnet",
            1_000,
            false,
            true,
            InspectionOutcome::Fail,
        );

        context("agent.testnet", 10_000);
        contract.authorize_mandated_refund(trade_id);

        context("keeper.testnet", 11_000);
        let _promise = contract.refund_escrow(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        settlement_callback_context(near_sdk::PromiseResult::Failed);

        assert!(!contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let failed = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(failed.status, SettlementStatus::Failed);
        assert!(failed.completed_at.is_some());
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::RefundAuthorized
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    fn completed_settlement_callback_cannot_be_replayed() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::ReleaseAuthorized);

        let _promise = contract.release_payment(trade_id);
        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(contract.on_settlement_transfer_complete(trade_id, settlement_id));

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        assert!(!contract.on_settlement_transfer_complete(trade_id, settlement_id));

        let record = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(record.status, SettlementStatus::Succeeded);
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::Completed
        );
        assert_eq!(contract.active_settlements.get(&trade_id), None);
    }

    #[test]
    #[should_panic(expected = "TRADE_NOT_AUTHORIZED_FOR_PAYOUT")]
    fn unauthorized_payout_is_rejected() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        // A funded trade has not yet been authorized for payout.
        let _ = contract.release_payment(trade_id);
    }

    #[test]
    #[should_panic(expected = "TRADE_NOT_AUTHORIZED_FOR_REFUND")]
    fn unauthorized_refund_is_rejected() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        // A funded trade has not yet been authorized for refund.
        let _ = contract.refund_escrow(trade_id);
    }

    #[test]
    #[should_panic(expected = "SETTLEMENT_ALREADY_PENDING")]
    fn duplicate_payout_initiation_is_rejected() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::ReleaseAuthorized);

        // First initiation creates the active settlement.
        let _first_promise = contract.release_payment(trade_id);

        assert!(contract.active_settlements.get(&trade_id).is_some());

        // A second initiation must be rejected.
        let _ = contract.release_payment(trade_id);
    }

    #[test]
    #[should_panic(expected = "SETTLEMENT_ALREADY_PENDING")]
    fn duplicate_refund_initiation_is_rejected() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::RefundAuthorized);

        // First initiation creates the active settlement.
        let _first_promise = contract.refund_escrow(trade_id);

        assert!(contract.active_settlements.get(&trade_id).is_some());

        // A second initiation must be rejected.
        let _ = contract.refund_escrow(trade_id);
    }

    #[test]
    fn stale_settlement_callback_cannot_mutate_pending_settlement() {
        let mut contract = contract();
        let trade_id = funded_trade(&mut contract, 1_000);

        set_trade_state(&mut contract, trade_id, TradeState::ReleaseAuthorized);

        let _promise = contract.release_payment(trade_id);

        let settlement_id = contract.active_settlements.get(&trade_id).unwrap();

        settlement_callback_context(near_sdk::PromiseResult::Successful(vec![]));

        // An incorrect settlement ID must not complete the active settlement.
        assert!(!contract.on_settlement_transfer_complete(trade_id, settlement_id + 1,));

        // The original settlement must remain pending and unchanged.
        let pending = contract.settlement_records.get(&settlement_id).unwrap();

        assert_eq!(pending.status, SettlementStatus::Pending);
        assert_eq!(pending.completed_at, None);
        assert_eq!(pending.trade_id, trade_id);
        assert_eq!(pending.kind, SettlementKind::Payout);

        // The trade must remain in its pending state.
        assert_eq!(
            contract.trades.get(&trade_id).unwrap().state,
            TradeState::PayoutPending
        );

        // The original active settlement reference must remain intact.
        assert_eq!(
            contract.active_settlements.get(&trade_id),
            Some(settlement_id)
        );
    }
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct MandateView {
    pub id: u64,
    pub buyer: AccountId,
    pub agent: AccountId,
    pub supplier: AccountId,
    pub resolver: AccountId,
    pub payment_token: AccountId,
    pub max_trade_amount: U128,
    pub aggregate_budget: U128,
    pub reserved_budget: U128,
    pub consumed_budget: U128,
    pub allow_release_after_pass: bool,
    pub allow_refund_after_fail: bool,
    pub expires_at: u64,
    pub revoked: bool,
    pub version: u64,
}

impl From<ExecutionMandate> for MandateView {
    fn from(m: ExecutionMandate) -> Self {
        Self {
            id: m.id,
            buyer: m.buyer,
            agent: m.agent,
            supplier: m.supplier,
            resolver: m.resolver,
            payment_token: m.payment_token,
            max_trade_amount: U128(m.max_trade_amount),
            aggregate_budget: U128(m.aggregate_budget),
            reserved_budget: U128(m.reserved_budget),
            consumed_budget: U128(m.consumed_budget),
            allow_release_after_pass: m.allow_release_after_pass,
            allow_refund_after_fail: m.allow_refund_after_fail,
            expires_at: m.expires_at,
            revoked: m.revoked,
            version: m.version,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct TradePolicySnapshotView {
    pub trade_id: u64,
    pub mandate_id: u64,
    pub mandate_version: u64,
    pub buyer: AccountId,
    pub agent: AccountId,
    pub supplier: AccountId,
    pub resolver: AccountId,
    pub payment_token: AccountId,
    pub amount: U128,
    pub allow_release_after_pass: bool,
    pub allow_refund_after_fail: bool,
    pub mandate_expires_at: u64,
}

impl From<TradePolicySnapshot> for TradePolicySnapshotView {
    fn from(s: TradePolicySnapshot) -> Self {
        Self {
            trade_id: s.trade_id,
            mandate_id: s.mandate_id,
            mandate_version: s.mandate_version,
            buyer: s.buyer,
            agent: s.agent,
            supplier: s.supplier,
            resolver: s.resolver,
            payment_token: s.payment_token,
            amount: U128(s.amount),
            allow_release_after_pass: s.allow_release_after_pass,
            allow_refund_after_fail: s.allow_refund_after_fail,
            mandate_expires_at: s.mandate_expires_at,
        }
    }
}
