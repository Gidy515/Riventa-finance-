use anyhow::{Context, Result};
use near_workspaces::types::NearToken;
use serde_json::{json, Value};
use std::path::PathBuf;

const FUNDING_AMOUNT: &str = "10000000000";
const BUYER_INITIAL_BALANCE: &str = "20000000000";
const TOKEN_INITIAL_SUPPLY: &str = "100000000000";

fn wasm_path(file_name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../target/wasm32-unknown-unknown/release")
        .join(file_name)
}

async fn token_balance(
    token: &near_workspaces::Contract,
    account_id: &near_workspaces::types::AccountId,
) -> Result<String> {
    let result = token
        .view("ft_balance_of")
        .args_json(json!({
            "account_id": account_id,
        }))
        .await?;

    let value: Value = result.json()?;

    value
        .as_str()
        .map(str::to_owned)
        .context("Expected ft_balance_of to return a JSON string")
}

async fn trade_state(contract: &near_workspaces::Contract, trade_id: u64) -> Result<String> {
    let result = contract
        .view("get_trade")
        .args_json(json!({
            "trade_id": trade_id,
        }))
        .await?;

    let value: Value = result.json()?;

    value
        .get("state")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .context("Expected get_trade to return a trade with a state")
}

#[tokio::test]
async fn funding_flow_accepts_valid_transfer_and_refunds_rejected_transfer() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;

    let root = worker
        .root_account()
        .context("Sandbox root account was unavailable")?;

    let buyer = worker.dev_create_account().await?;
    let supplier = worker.dev_create_account().await?;
    let resolver = worker.dev_create_account().await?;

    // Deploy the test-only SDD NEP-141 token.
    let token_wasm = std::fs::read(wasm_path("riventa_sdd_token.wasm"))?;
    let token = worker.dev_deploy(&token_wasm).await?;

    token
        .call("new")
        .args_json(json!({
            "owner_id": root.id(),
            "total_supply": TOKEN_INITIAL_SUPPLY,
        }))
        .transact()
        .await?
        .into_result()?;

    // Deploy and initialize Riventa.
    let riventa_wasm = std::fs::read(wasm_path("riventa_trade_operations.wasm"))?;
    let riventa = worker.dev_deploy(&riventa_wasm).await?;

    riventa
        .call("new")
        .args_json(json!({
            "admin": root.id(),
            "token_contract": token.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    // Register the buyer and Riventa as SDD token accounts.
    // One NEAR is deliberately attached; any excess storage deposit is
    // handled by the NEP-145 implementation.
    for account_id in [buyer.id(), riventa.id()] {
        token
            .call("storage_deposit")
            .args_json(json!({
                "account_id": account_id,
                "registration_only": true,
            }))
            .deposit(NearToken::from_near(1))
            .transact()
            .await?
            .into_result()?;
    }

    // Give the buyer enough SDD for one valid and one rejected attempt.
    root.call(token.id(), "ft_transfer")
        .args_json(json!({
            "receiver_id": buyer.id(),
            "amount": BUYER_INITIAL_BALANCE,
            "memo": "Sandbox funding-flow test",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        token_balance(&token, buyer.id()).await?,
        BUYER_INITIAL_BALANCE
    );

    // Create trade 0. The first trade ID is expected to be zero.
    let create_result = buyer
        .call(riventa.id(), "create_trade")
        .args_json(json!({
            "supplier": supplier.id(),
            "proposed_resolver": resolver.id(),
            "inspection_criteria_commitment": vec![1u8; 32],
            "refund_terms_commitment": vec![2u8; 32],
            "agreement_commitment": vec![3u8; 32],
        }))
        .transact()
        .await?;

    create_result.into_result()?;

    assert_eq!(trade_state(&riventa, 0).await?, "AwaitingAcceptance");

    // Supplier accepts the trade.
    supplier
        .call(riventa.id(), "accept_trade")
        .args_json(json!({
            "trade_id": 0,
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, 0).await?, "Accepted");

    // Valid NEP-141 transfer_call: Riventa should retain the exact amount.
    buyer
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": riventa.id(),
            "amount": FUNDING_AMOUNT,
            "memo": "Fund Riventa trade 0",
            "msg": "{\"trade_id\":0}",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, 0).await?, "Funded");
    assert_eq!(token_balance(&token, riventa.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, buyer.id()).await?, FUNDING_AMOUNT);

    // Rejected transfer_call: trade 999 does not exist.
    // NEP-141 should refund the full unused amount to the buyer.
    buyer
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": riventa.id(),
            "amount": FUNDING_AMOUNT,
            "memo": "Attempt funding against nonexistent trade",
            "msg": "{\"trade_id\":999}",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    // The rejected transfer must not alter Riventa's escrow balance.
    assert_eq!(token_balance(&token, riventa.id()).await?, FUNDING_AMOUNT);

    // The rejected amount must be returned to the buyer.
    assert_eq!(token_balance(&token, buyer.id()).await?, FUNDING_AMOUNT);

    // The original funded trade must remain funded.
    assert_eq!(trade_state(&riventa, 0).await?, "Funded");

    println!("Valid funding transfer accepted.");
    println!("Invalid funding transfer rejected and refunded.");
    println!("Riventa escrow balance: {} raw SDD units.", FUNDING_AMOUNT);

    Ok(())
}
