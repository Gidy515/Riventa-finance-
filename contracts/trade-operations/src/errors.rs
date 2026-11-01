use near_sdk::{env, AccountId};

pub(crate) fn require(condition: bool, message: &'static str) {
    if !condition {
        env::panic_str(message);
    }
}

pub(crate) fn assert_account_distinct(a: &AccountId, b: &AccountId, message: &'static str) {
    require(a != b, message);
}
