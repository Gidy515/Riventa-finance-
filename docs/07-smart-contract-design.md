# 7. Smart-Contract Design

## 7.1 Implementation target

Riventa's current on-chain component is a Rust smart contract deployed to NEAR.

| Component                  | Current implementation                                  |
| -------------------------- | ------------------------------------------------------- |
| Contract framework         | `near-sdk` 5.29.1                                       |
| Language                   | Rust                                                    |
| Contract target            | `wasm32-unknown-unknown`                                |
| Token standard             | NEP-141                                                 |
| Token funding              | `ft_transfer_call`                                      |
| Token settlement           | `ft_transfer`                                           |
| Contract tests             | Rust unit tests and `near-workspaces` integration tests |
| Integration-test framework | `near-workspaces` 0.23.0                                |

The contract is implemented in the `riventa-trade-operations` workspace crate.

## 7.2 Source organization

The current contract source is organized into four modules:

| File                                       | Responsibility                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `contracts/trade-operations/src/lib.rs`    | Contract state, public methods, validation, funding receiver, settlement transfers, and callbacks. |
| `contracts/trade-operations/src/state.rs`  | Persistent state structures and storage keys.                                                      |
| `contracts/trade-operations/src/types.rs`  | Trade states, views, document types, administrative actions, and inspection outcomes.              |
| `contracts/trade-operations/src/errors.rs` | Shared validation and account-distinctness helpers.                                                |

This is the implemented source layout. A separate `storage.rs`, `settlement.rs`, `mandate.rs`, or `inspection.rs` module is not part of the current contract implementation.

## 7.3 Contract initialization and configuration

The contract is initialized with:

`new(admins, token_contract)`

Initialization requires exactly three distinct administrator accounts. An administrator cannot be the configured token contract.

The contract initializes:

- The administrator set.
- The configured NEP-141 token contract.
- The pause flag.
- Trade, mandate, admin-proposal, and settlement counters.
- Persistent lookup maps for trades, mandates, snapshots, documents, inspections, inspectors, proposals, and settlements.

The approval threshold is two of the three administrators.

The configuration view is available through:

`get_contract_config()`

It exposes the administrators, approval threshold, configured token contract, pause status, next trade ID, and pending proposal count.

## 7.4 Persistent state model

### Trade

A `Trade` stores:

- Trade ID.
- Buyer, supplier, and resolver accounts.
- Payment token and amount.
- Current trade state.
- Creation timestamp.
- Supplier acceptance deadline.
- Optional buyer funding deadline.
- Inspection criteria, refund terms, and agreement commitments.

The trade amount is stored in raw token units.

### ExecutionMandate

An `ExecutionMandate` stores:

- Mandate ID.
- Buyer, agent, supplier, resolver, and payment token.
- Maximum per-trade amount.
- Aggregate budget.
- Reserved budget.
- Consumed budget.
- Delegated release and refund permissions.
- Expiry timestamp.
- Revocation status.
- Version.

### TradePolicySnapshot

A `TradePolicySnapshot` captures the mandate policy used to create a specific trade:

- Trade ID.
- Mandate ID and mandate version.
- Buyer, agent, supplier, and resolver.
- Payment token and amount.
- Release and refund permissions.
- Mandate expiry at the time of trade creation.

The snapshot is immutable through the current public contract API. It is used to validate settlement authorization for that trade independently of later mandate changes.

### DocumentCommitment

A `DocumentCommitment` stores the trade ID, document type, version, 32-byte commitment, submitting account, and submission timestamp.

It does not store the underlying document.

### InspectorRecord

An `InspectorRecord` stores a credential commitment, registration timestamp, and active status.

### InspectionRecord and InspectionAttestation

The inspection record tracks the assigned inspector, replacement count, and optional attestation.

An attestation stores the inspection outcome, inspector, evidence commitment, and timestamp.

### SettlementRecord

A `SettlementRecord` stores:

- Settlement ID and trade ID.
- Recipient and amount.
- Settlement kind (`Payout` or `Refund`).
- Status (`Pending`, `Succeeded`, or `Failed`).
- Creation timestamp.
- Optional completion timestamp.

The contract also tracks the active settlement ID for each trade to prevent concurrent settlement execution.

### AdminProposal

An `AdminProposal` stores its ID, typed administrative action, proposer, approval list, creation time, and expiry time.

## 7.5 Public method groups

### Mandate management

| Method                      | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `create_mandate`            | Creates buyer-authorized agent permissions and spending limits.      |
| `update_mandate`            | Updates a non-revoked mandate and increments its version.            |
| `renew_mandate`             | Sets a future expiry, clears revocation, and increments the version. |
| `revoke_mandate`            | Revokes a mandate for new trade creation.                            |
| `get_mandate`               | Returns the mandate view.                                            |
| `get_trade_policy_snapshot` | Returns a trade's policy snapshot.                                   |

### Trade management

| Method                       | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `create_trade`               | Creates a direct buyer-initiated trade.              |
| `create_trade_under_mandate` | Creates a trade through an authorized mandate agent. |
| `accept_trade`               | Records supplier acceptance.                         |
| `cancel_trade`               | Cancels an eligible unfunded trade.                  |
| `get_trade`                  | Returns the trade view.                              |

### Document commitments

| Method                                     | Purpose                                    |
| ------------------------------------------ | ------------------------------------------ |
| `record_document_commitment`               | Records a supplier document commitment.    |
| `get_document_commitments`                 | Returns document commitment records.       |
| `are_required_supplier_documents_complete` | Checks the required supplier document set. |

### Inspector and inspection management

| Method                          | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `get_inspector`                 | Returns inspector registration data.                              |
| `assign_inspector`              | Assigns a registered active inspector.                            |
| `replace_inspector`             | Replaces the inspector once before attestation.                   |
| `submit_inspection_attestation` | Records the assigned inspector's outcome and evidence commitment. |
| `get_inspection_record`         | Returns the inspection record.                                    |

Inspector registration and activation changes are performed through the administrative proposal mechanism.

### Settlement authorization and execution

| Method                            | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `authorize_mandated_release`      | Agent-authorized payout under a snapshot that permits it.   |
| `authorize_mandated_refund`       | Agent-authorized refund under a snapshot that permits it.   |
| `confirm_release`                 | Buyer-authorized payout when delegated release is disabled. |
| `choose_refund`                   | Buyer-authorized refund when delegated refund is disabled.  |
| `release_payment`                 | Permissionlessly triggers an authorized supplier payout.    |
| `refund_escrow`                   | Permissionlessly triggers an authorized buyer refund.       |
| `on_settlement_transfer_complete` | Private callback that records transfer success or failure.  |

### Administrative proposals

| Method                  | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `propose_admin_action`  | Creates a typed proposal and records the proposer's approval. |
| `approve_admin_action`  | Records approval from a second distinct administrator.        |
| `execute_admin_action`  | Executes an approved, unexpired proposal.                     |
| `expire_admin_proposal` | Removes an expired proposal.                                  |
| `get_admin_proposal`    | Returns proposal data.                                        |

## 7.6 NEP-141 funding

The contract implements `FungibleTokenReceiver` through `ft_on_transfer`.

The buyer funds escrow by calling the configured token contract's `ft_transfer_call`, passing the trade ID in the message.

The receiver checks the token contract, pause state, message validity, sender, trade state, token, amount, and funding deadline.

The amount must equal the trade's required fixed amount. The current constant is:

`REQUIRED_FUNDING_AMOUNT = 10_000_000_000`

All rejected transfers return the full amount as unused. The receiver does not panic for ordinary funding-validation failures because the NEP-141 transfer-call resolution flow must be able to refund rejected funds.

For mandate-created trades, the receiver validates the policy snapshot and mandate relationship before changing mandate accounting.

Only after validation does the contract:

- Move the trade to `Funded`.
- Update mandate budget accounting, where applicable.
- Return zero unused tokens.

This receiver is not a general-purpose deposit endpoint. It accepts only the expected funding flow for a valid trade.

## 7.7 Settlement execution

Settlement authorization and settlement execution are separate operations.

An authorized payout or refund changes the trade into `ReleaseAuthorized` or `RefundAuthorized`.

The corresponding permissionless execution method then creates a pending settlement record and initiates a NEP-141 `ft_transfer`.

The contract stores the active settlement ID before the asynchronous transfer completes. It uses that ID, together with the trade ID, to validate the private callback.

The callback:

1. Verifies that the settlement is still the active settlement for the trade.
2. Loads the matching settlement record.
3. Checks the trade ID and pending status.
4. Checks the expected pending trade state.
5. Requires exactly one promise result.
6. Records success or failure.
7. Completes the trade or restores its authorization state.
8. Removes the active settlement entry.

A failed transfer does not silently complete the trade. It restores the original authorization state and permits a later retry.

The callback is declared private. It is not an externally callable settlement-authorization method.

## 7.8 Mandate authorization rules

The buyer defines an execution mandate. The agent can create trades only within its configured authority.

The mandate enforces:

- Account-role separation.
- A maximum per-trade amount.
- An aggregate budget.
- An expiry.
- Revocation.
- Explicit delegated payout and refund permissions.

The contract reserves budget when an agent creates a trade.

Successful funding converts that reservation into consumed budget. Cancellation before funding releases the reservation.

The contract does not restore consumed mandate budget when a funded trade is later refunded.

### Snapshot-based authorization

Settlement authorization for mandate-created trades uses the trade's stored policy snapshot.

The authorization checks the snapshot against the trade's buyer, supplier, resolver, token, amount, and trade ID.

The current mandate is deliberately not consulted to determine the authority of an existing trade.

Consequently:

- Revocation prevents new trades under the mandate.
- Updating the mandate does not rewrite an existing trade's permissions.
- Renewing or changing the mandate does not rewrite an existing trade's snapshot.
- An existing trade can proceed under its captured authority after the mandate expires or is revoked, subject to the trade's own state and settlement rules.

## 7.9 Administrative security

The contract uses a three-administrator, two-approval proposal mechanism.

The proposer automatically supplies the first approval. A second distinct administrator must approve the proposal before execution.

The supported `AdminAction` variants are:

- `RegisterInspector`
- `SetInspectorStatus`
- `PauseNewTrades`
- `UnpauseNewTrades`

A proposal expires after seven days. The contract limits the number of pending proposals to 32.

Anyone can execute a proposal after the approval threshold is reached and anyone can remove an expired proposal.

The pause flag blocks new trade creation and funding. It does not act as a global settlement lock.

## 7.10 Storage and accounting boundaries

The current contract uses NEAR SDK `LookupMap` collections for persistent records.

The primary collections include:

- Trades.
- Mandates.
- Trade policy snapshots.
- Document commitments.
- Admin proposals.
- Inspector records.
- Inspection records.
- Settlement records.
- Active settlement IDs.

Mandate budget fields track reserved and consumed capacity. They do not represent the contract's total escrow token balance or a complete global escrow-liability ledger.

The trade and settlement records provide per-trade state and transfer outcomes. The current design should not be described as having a separate global escrow-liability counter unless one is added to the contract.

The current implementation also does not expose a general-purpose token withdrawal or arbitrary token recovery method.

## 7.11 Views and events

The current read methods include:

- `get_mandate`
- `get_trade_policy_snapshot`
- `get_document_commitments`
- `are_required_supplier_documents_complete`
- `get_admin_proposal`
- `get_inspector`
- `get_inspection_record`
- `get_trade`
- `get_contract_config`

The contract emits structured `EVENT_JSON` log records using the `riventa` event standard identifier and version `1.0.0`.

Events cover important operations such as mandate creation and updates, trade creation and funding, acceptance and cancellation, document commitments, inspection attestations, administrative proposals and execution, settlement authorization, settlement initiation, and settlement completion.

These logs are application integration signals. Off-chain consumers should still reconcile them against authoritative contract state and transaction outcomes.

## 7.12 Explicitly unimplemented contract capabilities

The following must not be represented as implemented functionality:

- Dispute opening and resolution.
- Resolver replacement and arbitration.
- Dispute-driven escrow release or refund.
- Multi-token escrow support.
- Variable trade amounts.
- A general-purpose global escrow-liability accounting system.
- NEAR Intents-based cross-chain funding or settlement.
- Embedded-wallet authentication and signing integration.
- AI document analysis or off-chain document storage.
- Frontend and backend application workflows.

The `Disputed` trade state and stored resolver account are data-model provisions, not a completed dispute system.

## 7.13 Testing and verification

The contract workspace is tested with Rust unit tests and integration tests.

The verified baseline for the current implementation is:

- `cargo fmt --all -- --check`
- `cargo test --workspace`

The recorded test baseline is 87 contract unit tests, 3 funding/settlement integration tests, and 1 sandbox smoke test, for 91 tests in total.

The integration suite includes coverage for:

- NEP-141 funding acceptance and rejected-transfer refunds.
- Real payout and refund transfers.
- Mandate-authorized settlement transfers.

These test results establish the recorded implementation baseline; they do not establish that the unimplemented application, dispute, or cross-chain features are operational.
