use crate::types::TradeState;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{AccountId, BorshStorageKey};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
pub enum StorageKey {
    Trades,
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
