use near_contract_standards::{
    fungible_token::{
        core::FungibleTokenCore,
        events::FtMint,
        metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
        resolver::FungibleTokenResolver,
        FungibleToken,
    },
    storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement},
};
use near_sdk::{
    collections::LazyOption, json_types::U128, near, AccountId, BorshStorageKey, NearToken,
    PanicOnDefault, PromiseOrValue,
};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SddToken {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl SddToken {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        assert!(!total_supply.0.eq(&0), "Initial supply must be positive");

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Sandbox Demo Dollar".to_string(),
            symbol: "SDD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };

        let mut token = FungibleToken::new(StorageKey::FungibleToken);
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, total_supply.0);

        FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("Initial sandbox test supply"),
        }
        .emit();

        Self {
            token,
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        }
    }
}

#[near]
impl FungibleTokenCore for SddToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for SddToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for SddToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for SddToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().expect("Token metadata missing")
    }
}
