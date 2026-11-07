use crate::types::{AdminAction, DocumentType, InspectionOutcome, TradeState};
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{AccountId, BorshStorageKey};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
pub enum StorageKey {
    Trades,
    TradeDocuments,
    AdminProposals,
    Inspectors,
    TradeInspections,
    Mandates,
    TradePolicySnapshots,
    SettlementRecords,
    ActiveSettlements,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Trade {
    pub id: u64,
    pub buyer: AccountId,
    pub supplier: AccountId,
    pub resolver: AccountId,
    pub payment_token: AccountId,
    pub amount: u128,
    pub state: TradeState,
    pub created_at: u64,
    pub accept_by: u64,
    pub fund_by: Option<u64>,
    pub inspection_criteria_commitment: [u8; 32],
    pub refund_terms_commitment: [u8; 32],
    pub agreement_commitment: [u8; 32],
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct ExecutionMandate {
    pub id: u64,
    pub buyer: AccountId,
    pub agent: AccountId,
    pub supplier: AccountId,
    pub resolver: AccountId,
    pub payment_token: AccountId,
    pub max_trade_amount: u128,
    pub aggregate_budget: u128,
    pub reserved_budget: u128,
    pub consumed_budget: u128,
    pub allow_release_after_pass: bool,
    pub allow_refund_after_fail: bool,
    pub expires_at: u64,
    pub revoked: bool,
    pub version: u64,
}

/// Immutable policy captured when an agent creates a trade.
/// Later mandate updates or revocation must never modify this record.
#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct TradePolicySnapshot {
    pub trade_id: u64,
    pub mandate_id: u64,
    pub mandate_version: u64,
    pub buyer: AccountId,
    pub agent: AccountId,
    pub supplier: AccountId,
    pub resolver: AccountId,
    pub payment_token: AccountId,
    pub amount: u128,
    pub allow_release_after_pass: bool,
    pub allow_refund_after_fail: bool,
    pub mandate_expires_at: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub enum SettlementKind {
    Payout,
    Refund,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Copy, PartialEq, Eq, Debug)]
#[borsh(crate = "near_sdk::borsh")]
pub enum SettlementStatus {
    Pending,
    Succeeded,
    Failed,
}

#[derive(BorshDeserialize, BorshSerialize, Clone)]
#[borsh(crate = "near_sdk::borsh")]
pub struct SettlementRecord {
    pub id: u64,
    pub trade_id: u64,
    pub recipient: AccountId,
    pub amount: u128,
    pub kind: SettlementKind,
    pub status: SettlementStatus,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    near_sdk::serde::Serialize,
    near_sdk::serde::Deserialize,
    Clone,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct DocumentCommitment {
    pub document_type: DocumentType,
    pub version: u8,
    pub commitment: [u8; 32],
    pub submitted_by: AccountId,
    pub submitted_at: u64,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    near_sdk::serde::Serialize,
    near_sdk::serde::Deserialize,
    Clone,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct AdminProposal {
    pub id: u64,
    pub action: AdminAction,
    pub proposer: AccountId,
    pub approvals: Vec<AccountId>,
    pub created_at: u64,
    pub expires_at: u64,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    near_sdk::serde::Serialize,
    near_sdk::serde::Deserialize,
    Clone,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct InspectorRecord {
    pub credential_commitment: [u8; 32],
    pub registered_at: u64,
    pub active: bool,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    near_sdk::serde::Serialize,
    near_sdk::serde::Deserialize,
    Clone,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct InspectionAttestation {
    pub outcome: InspectionOutcome,
    pub evidence_commitment: [u8; 32],
    pub inspector: AccountId,
    pub submitted_at: u64,
}

#[derive(
    BorshDeserialize,
    BorshSerialize,
    near_sdk::serde::Serialize,
    near_sdk::serde::Deserialize,
    Clone,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct InspectionRecord {
    pub assigned_inspector: AccountId,
    pub replacement_count: u8,
    pub attestation: Option<InspectionAttestation>,
}
