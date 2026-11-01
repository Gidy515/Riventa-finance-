use crate::state::Trade;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{
    serde::{Deserialize, Serialize},
    AccountId,
};

#[derive(
    BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub enum TradeState {
    AwaitingAcceptance,
    Accepted,
    Funded,
    DocumentReview,
    InspectionPending,
    InspectionPassed,
    InspectionFailed,
    Disputed,
    ReleaseAuthorized,
    RefundAuthorized,
    PayoutPending,
    RefundPending,
    Completed,
    Refunded,
    Cancelled,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct TradeView {
    pub id: u64,
    pub buyer: AccountId,
    pub supplier: AccountId,
    pub resolver: AccountId,
    pub payment_token: AccountId,
    pub amount: String,
    pub state: TradeState,
    pub created_at: u64,
    pub accept_by: u64,
    pub fund_by: Option<u64>,
}

impl From<Trade> for TradeView {
    fn from(trade: Trade) -> Self {
        Self {
            id: trade.id,
            buyer: trade.buyer,
            supplier: trade.supplier,
            resolver: trade.resolver,
            payment_token: trade.payment_token,
            amount: trade.amount.to_string(),
            state: trade.state,
            created_at: trade.created_at,
            accept_by: trade.accept_by,
            fund_by: trade.fund_by,
        }
    }
}
