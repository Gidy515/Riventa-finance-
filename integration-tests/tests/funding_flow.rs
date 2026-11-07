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

    let root = worker.root_account()?;

    let admin1 = worker.dev_create_account().await?;
    let admin2 = worker.dev_create_account().await?;
    let admin3 = worker.dev_create_account().await?;

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
            "admins": [
                admin1.id(),
                admin2.id(),
                admin3.id(),
            ],
            "token_contract": token.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    // Register the buyer, supplier, and Riventa as SDD token accounts.
    // The supplier must be registered to receive outgoing settlement transfers.
    // One NEAR is deliberately attached; any excess storage deposit is
    // handled by the NEP-145 implementation.
    for account_id in [buyer.id(), supplier.id(), riventa.id()] {
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

#[tokio::test]
async fn settlement_flow_executes_real_payout_and_refund_transfers() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    let admin1 = worker.dev_create_account().await?;
    let admin2 = worker.dev_create_account().await?;
    let admin3 = worker.dev_create_account().await?;

    let buyer = worker.dev_create_account().await?;
    let supplier = worker.dev_create_account().await?;
    let resolver = worker.dev_create_account().await?;
    let inspector = worker.dev_create_account().await?;

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
            "admins": [admin1.id(), admin2.id(), admin3.id()],
            "token_contract": token.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    // Register the accounts that will hold SDD.
    for account_id in [buyer.id(), supplier.id(), riventa.id()] {
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

    // Give the buyer enough SDD to fund two trades.
    root.call(token.id(), "ft_transfer")
        .args_json(json!({
            "receiver_id": buyer.id(),
            "amount": "20000000000",
            "memo": "Riventa settlement integration test",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(token_balance(&token, buyer.id()).await?, "20000000000");

    // Register the inspector through the actual 2-of-3 admin process.
    let proposal_result = admin1
        .call(riventa.id(), "propose_admin_action")
        .args_json(json!({
            "action": {
                "register_inspector": {
                    "account_id": inspector.id(),
                    "credential_commitment": vec![1u8; 32],
                }
            }
        }))
        .transact()
        .await?;

    proposal_result.into_result()?;

    // The first proposal on a fresh contract has ID 0.
    let inspector_proposal_id = 0u64;

    admin2
        .call(riventa.id(), "approve_admin_action")
        .args_json(json!({
            "proposal_id": inspector_proposal_id,
        }))
        .transact()
        .await?
        .into_result()?;

    root.call(riventa.id(), "execute_admin_action")
        .args_json(json!({
            "proposal_id": inspector_proposal_id,
        }))
        .transact()
        .await?
        .into_result()?;

    // ============================================================
    // TRADE 0: passing inspection -> buyer authorization -> payout
    // ============================================================

    let payout_trade_id = 0u64;

    buyer
        .call(riventa.id(), "create_trade")
        .args_json(json!({
            "supplier": supplier.id(),
            "proposed_resolver": resolver.id(),
            "inspection_criteria_commitment": vec![7u8; 32],
            "refund_terms_commitment": vec![8u8; 32],
            "agreement_commitment": vec![9u8; 32],
        }))
        .transact()
        .await?
        .into_result()?;

    supplier
        .call(riventa.id(), "accept_trade")
        .args_json(json!({
            "trade_id": payout_trade_id,
        }))
        .transact()
        .await?
        .into_result()?;

    buyer
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": riventa.id(),
            "amount": FUNDING_AMOUNT,
            "msg": json!({
                "trade_id": payout_trade_id,
            })
            .to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, payout_trade_id).await?, "Funded");

    // Supplier submits all three required document commitments.
    for document_type in [
        "commercial_invoice",
        "packing_list",
        "certificate_of_origin",
    ] {
        supplier
            .call(riventa.id(), "record_document_commitment")
            .args_json(json!({
                "trade_id": payout_trade_id,
                "document_type": document_type,
                "version": 1,
                "commitment": vec![3u8; 32],
            }))
            .transact()
            .await?
            .into_result()?;
    }

    assert_eq!(
        trade_state(&riventa, payout_trade_id).await?,
        "DocumentReview"
    );

    buyer
        .call(riventa.id(), "assign_inspector")
        .args_json(json!({
            "trade_id": payout_trade_id,
            "inspector_account": inspector.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, payout_trade_id).await?,
        "InspectionPending"
    );

    inspector
        .call(riventa.id(), "submit_inspection_attestation")
        .args_json(json!({
            "trade_id": payout_trade_id,
            "outcome": "pass",
            "evidence_commitment": vec![4u8; 32],
        }))
        .transact()
        .await?
        .into_result()?;

    // Attestation alone must not transfer funds.
    assert_eq!(
        trade_state(&riventa, payout_trade_id).await?,
        "InspectionPassed"
    );
    assert_eq!(token_balance(&token, riventa.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, supplier.id()).await?, "0");

    // Buyer explicitly authorizes the payout.
    buyer
        .call(riventa.id(), "confirm_release")
        .args_json(json!({
            "trade_id": payout_trade_id,
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, payout_trade_id).await?,
        "ReleaseAuthorized"
    );

    // A separate account triggers the authorized NEP-141 transfer.
    root.call(riventa.id(), "release_payment")
        .args_json(json!({
            "trade_id": payout_trade_id,
        }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, payout_trade_id).await?, "Completed");

    assert_eq!(token_balance(&token, supplier.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, riventa.id()).await?, "0");
    assert_eq!(token_balance(&token, buyer.id()).await?, FUNDING_AMOUNT);

    println!("Payout settlement completed; supplier received SDD.");

    // ============================================================
    // TRADE 1: failed inspection -> buyer authorization -> refund
    // ============================================================

    let refund_trade_id = 1u64;

    buyer
        .call(riventa.id(), "create_trade")
        .args_json(json!({
            "supplier": supplier.id(),
            "proposed_resolver": resolver.id(),
            "inspection_criteria_commitment": vec![10u8; 32],
            "refund_terms_commitment": vec![11u8; 32],
            "agreement_commitment": vec![12u8; 32],
        }))
        .transact()
        .await?
        .into_result()?;

    supplier
        .call(riventa.id(), "accept_trade")
        .args_json(json!({
            "trade_id": refund_trade_id,
        }))
        .transact()
        .await?
        .into_result()?;

    buyer
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": riventa.id(),
            "amount": FUNDING_AMOUNT,
            "msg": json!({
                "trade_id": refund_trade_id,
            })
            .to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, refund_trade_id).await?, "Funded");

    for document_type in [
        "commercial_invoice",
        "packing_list",
        "certificate_of_origin",
    ] {
        supplier
            .call(riventa.id(), "record_document_commitment")
            .args_json(json!({
                "trade_id": refund_trade_id,
                "document_type": document_type,
                "version": 1,
                "commitment": vec![13u8; 32],
            }))
            .transact()
            .await?
            .into_result()?;
    }

    buyer
        .call(riventa.id(), "assign_inspector")
        .args_json(json!({
            "trade_id": refund_trade_id,
            "inspector_account": inspector.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    inspector
        .call(riventa.id(), "submit_inspection_attestation")
        .args_json(json!({
            "trade_id": refund_trade_id,
            "outcome": "fail",
            "evidence_commitment": vec![14u8; 32],
        }))
        .transact()
        .await?
        .into_result()?;

    // Failed inspection does not automatically refund the buyer.
    assert_eq!(
        trade_state(&riventa, refund_trade_id).await?,
        "InspectionFailed"
    );
    assert_eq!(token_balance(&token, riventa.id()).await?, FUNDING_AMOUNT);

    // Buyer explicitly chooses a refund.
    buyer
        .call(riventa.id(), "choose_refund")
        .args_json(json!({
            "trade_id": refund_trade_id,
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, refund_trade_id).await?,
        "RefundAuthorized"
    );

    // Trigger the authorized refund transfer.
    root.call(riventa.id(), "refund_escrow")
        .args_json(json!({
            "trade_id": refund_trade_id,
        }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, refund_trade_id).await?, "Refunded");

    // Final balances: payout went to supplier; refund returned to buyer.
    assert_eq!(token_balance(&token, buyer.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, supplier.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, riventa.id()).await?, "0");

    println!("Refund settlement completed; buyer received SDD back.");
    println!("Both outgoing NEP-141 settlement paths passed in sandbox.");

    Ok(())
}

#[tokio::test]
async fn mandate_authorized_settlements_execute_real_nep141_transfers() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;

    let admin1 = worker.dev_create_account().await?;
    let admin2 = worker.dev_create_account().await?;
    let admin3 = worker.dev_create_account().await?;

    let buyer = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let supplier = worker.dev_create_account().await?;
    let resolver = worker.dev_create_account().await?;
    let inspector = worker.dev_create_account().await?;

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
            "admins": [admin1.id(), admin2.id(), admin3.id()],
            "token_contract": token.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    // Register every account that will hold SDD.
    for account_id in [buyer.id(), supplier.id(), riventa.id()] {
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

    // Fund the buyer for two trades.
    root.call(token.id(), "ft_transfer")
        .args_json(json!({
            "receiver_id": buyer.id(),
            "amount": "20000000000",
            "memo": "Riventa mandate settlement integration test",
        }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(token_balance(&token, buyer.id()).await?, "20000000000");

    // Register the inspector through the real 2-of-3 admin process.
    admin1
        .call(riventa.id(), "propose_admin_action")
        .args_json(json!({
            "action": {
                "register_inspector": {
                    "account_id": inspector.id(),
                    "credential_commitment": vec![1u8; 32],
                }
            }
        }))
        .transact()
        .await?
        .into_result()?;

    admin2
        .call(riventa.id(), "approve_admin_action")
        .args_json(json!({
            "proposal_id": 0,
        }))
        .transact()
        .await?
        .into_result()?;

    root.call(riventa.id(), "execute_admin_action")
        .args_json(json!({
            "proposal_id": 0,
        }))
        .transact()
        .await?
        .into_result()?;

    // Buyer creates one mandate authorizing both settlement outcomes.
    // The far-future expiry is expressed in nanoseconds.
    buyer
        .call(riventa.id(), "create_mandate")
        .args_json(json!({
            "agent": agent.id(),
            "supplier": supplier.id(),
            "resolver": resolver.id(),
            "max_trade_amount": FUNDING_AMOUNT,
            "aggregate_budget": "20000000000",
            "allow_release_after_pass": true,
            "allow_refund_after_fail": true,
            "expires_at": 9_000_000_000_000_000_000u64,
        }))
        .transact()
        .await?
        .into_result()?;

    // A fresh contract assigns mandate ID 0.
    let mandate_id = 0u64;
    let payout_trade_id = 0u64;
    let refund_trade_id = 1u64;

    // The agent creates both trades under the buyer's mandate.
    for trade_id in [payout_trade_id, refund_trade_id] {
        agent
            .call(riventa.id(), "create_trade_under_mandate")
            .args_json(json!({
                "mandate_id": mandate_id,
                "inspection_criteria_commitment": vec![7u8; 32],
                "refund_terms_commitment": vec![8u8; 32],
                "agreement_commitment": vec![9u8; 32],
            }))
            .transact()
            .await?
            .into_result()?;

        assert_eq!(trade_state(&riventa, trade_id).await?, "AwaitingAcceptance");
    }

    // Supplier accepts both trades.
    for trade_id in [payout_trade_id, refund_trade_id] {
        supplier
            .call(riventa.id(), "accept_trade")
            .args_json(json!({
                "trade_id": trade_id,
            }))
            .transact()
            .await?
            .into_result()?;

        assert_eq!(trade_state(&riventa, trade_id).await?, "Accepted");
    }

    // Buyer independently funds both trades.
    for trade_id in [payout_trade_id, refund_trade_id] {
        buyer
            .call(token.id(), "ft_transfer_call")
            .args_json(json!({
                "receiver_id": riventa.id(),
                "amount": FUNDING_AMOUNT,
                "msg": json!({
                    "trade_id": trade_id,
                })
                .to_string(),
            }))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?
            .into_result()?;

        assert_eq!(trade_state(&riventa, trade_id).await?, "Funded");
    }

    assert_eq!(token_balance(&token, buyer.id()).await?, "0");
    assert_eq!(token_balance(&token, riventa.id()).await?, "20000000000");

    // Supplier submits all required documents for each trade.
    for trade_id in [payout_trade_id, refund_trade_id] {
        for document_type in [
            "commercial_invoice",
            "packing_list",
            "certificate_of_origin",
        ] {
            supplier
                .call(riventa.id(), "record_document_commitment")
                .args_json(json!({
                    "trade_id": trade_id,
                    "document_type": document_type,
                    "version": 1,
                    "commitment": vec![3u8; 32],
                }))
                .transact()
                .await?
                .into_result()?;
        }

        assert_eq!(trade_state(&riventa, trade_id).await?, "DocumentReview");

        buyer
            .call(riventa.id(), "assign_inspector")
            .args_json(json!({
                "trade_id": trade_id,
                "inspector_account": inspector.id(),
            }))
            .transact()
            .await?
            .into_result()?;

        assert_eq!(trade_state(&riventa, trade_id).await?, "InspectionPending");
    }

    // Inspector passes the first trade.
    inspector
        .call(riventa.id(), "submit_inspection_attestation")
        .args_json(json!({
            "trade_id": payout_trade_id,
            "outcome": "pass",
            "evidence_commitment": vec![4u8; 32],
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, payout_trade_id).await?,
        "InspectionPassed"
    );

    // Passing inspection alone must not move the escrow.
    assert_eq!(token_balance(&token, riventa.id()).await?, "20000000000");
    assert_eq!(token_balance(&token, supplier.id()).await?, "0");

    // The mandate-authorized agent authorizes payout.
    agent
        .call(riventa.id(), "authorize_mandated_release")
        .args_json(json!({
            "trade_id": payout_trade_id,
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, payout_trade_id).await?,
        "ReleaseAuthorized"
    );

    // A separate account triggers the actual NEP-141 payout.
    root.call(riventa.id(), "release_payment")
        .args_json(json!({
            "trade_id": payout_trade_id,
        }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, payout_trade_id).await?, "Completed");
    assert_eq!(token_balance(&token, supplier.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, riventa.id()).await?, FUNDING_AMOUNT);

    // Inspector fails the second trade.
    inspector
        .call(riventa.id(), "submit_inspection_attestation")
        .args_json(json!({
            "trade_id": refund_trade_id,
            "outcome": "fail",
            "evidence_commitment": vec![5u8; 32],
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, refund_trade_id).await?,
        "InspectionFailed"
    );

    // Failed inspection alone must not refund the buyer.
    assert_eq!(token_balance(&token, riventa.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, buyer.id()).await?, "0");

    // The mandate-authorized agent authorizes the refund.
    agent
        .call(riventa.id(), "authorize_mandated_refund")
        .args_json(json!({
            "trade_id": refund_trade_id,
        }))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(
        trade_state(&riventa, refund_trade_id).await?,
        "RefundAuthorized"
    );

    // A separate account triggers the actual NEP-141 refund.
    root.call(riventa.id(), "refund_escrow")
        .args_json(json!({
            "trade_id": refund_trade_id,
        }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;

    assert_eq!(trade_state(&riventa, refund_trade_id).await?, "Refunded");

    // Final balances prove both real transfers completed.
    assert_eq!(token_balance(&token, buyer.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, supplier.id()).await?, FUNDING_AMOUNT);
    assert_eq!(token_balance(&token, riventa.id()).await?, "0");

    println!("Mandate-authorized payout completed; supplier received SDD.");
    println!("Mandate-authorized refund completed; buyer received SDD back.");

    Ok(())
}
