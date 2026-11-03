mod errors;
mod state;
mod types;

use crate::errors::{assert_account_distinct, require};
use crate::state::{
    AdminProposal, DocumentCommitment, InspectionAttestation, InspectionRecord, InspectorRecord,
    StorageKey, Trade,
};
use crate::types::{AdminAction, DocumentType, InspectionOutcome, TradeState, TradeView};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, AccountId, PanicOnDefault, PromiseOrValue};

const ACCEPTANCE_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const FUNDING_WINDOW_NS: u64 = 48 * 60 * 60 * 1_000_000_000;
const ADMIN_PROPOSAL_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const REQUIRED_FUNDING_AMOUNT: u128 = 10_000_000_000;
const MAX_FUNDING_MSG_BYTES: usize = 64;
const ADMIN_COUNT: usize = 3;
const ADMIN_APPROVAL_THRESHOLD: usize = 2;
const MAX_PENDING_ADMIN_PROPOSALS: u8 = 32;

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

        self.trade_inspections.insert(
            &trade_id,
            &InspectionRecord {
                assigned_inspector: inspector_account.clone(),
                replacement_count: 0,
                attestation: None,
            },
        );

        trade.state = TradeState::InspectionPending;
        self.trades.insert(&trade_id, &trade);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"riventa\",\"version\":\"1.0.0\",\"event\":\"inspector_assigned\",\"data\":[{{\"trade_id\":{trade_id},\"inspector\":\"{inspector_account}\"}}]}}"
        ));
    }

    /// Buyer may replace the assigned inspector once, before an attestation exists.
    pub fn replace_inspector(&mut self, trade_id: u64, replacement: AccountId) {
        let trade = self.get_trade_or_panic(trade_id);

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

        record.assigned_inspector = replacement.clone();
        record.replacement_count = 1;
        self.trade_inspections.insert(&trade_id, &record);

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

        let evidence: [u8; 32] = evidence_commitment
            .try_into()
            .expect("INVALID_INSPECTION_EVIDENCE_COMMITMENT");

        record.attestation = Some(InspectionAttestation {
            outcome,
            evidence_commitment: evidence,
            inspector: caller.clone(),
            submitted_at: env::block_timestamp(),
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

        context("buyer.testnet", 14_000);
        contract.replace_inspector(trade_id, account("inspector2.testnet"));

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
}
