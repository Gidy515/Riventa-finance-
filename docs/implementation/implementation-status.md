# Implementation Status

**Architecture baseline:** v1.1, with ADR-009 accepted and mandate-based execution implemented.
**Settlement baseline:** Local NEP-141 escrow funding and outgoing payout/refund transfers. ADR-010 (NEAR Intents cross-chain settlement) remains proposed.
**Latest verified contract commit:** `030c1d570e1a987363b27d5defb4427270778fe4` — `feat: add mandate-based execution and escrow settlement`
**Branch:** `main`
**Latest recorded verification:** 87 contract unit tests, 3 integration tests, and 1 NEAR sandbox smoke test passed (91 tests total).

## 1. Implemented in source

The following capabilities are present in the contract source at the verified milestone.

### Contract foundation and administration

- Contract initialization with three administrators and a 2-of-3 administrative approval threshold.
- Allowlisted NEP-141 token contract configuration.
- Persistent trade storage and monotonic trade IDs.
- Buyer-originated trade creation.
- Account-separation and role-authorization checks.
- Fixed funding amount of 10,000 SDD raw units configured for the test workflow.
- Seven-day supplier acceptance deadline.
- Supplier-only trade acceptance and funding deadline initialization.
- Eligible unfunded trade cancellation.
- Administrative proposals, approvals, execution, and expiry.
- Inspector registration and status management.
- Administrative pause controls for new trade creation and funding.
- Read-only contract configuration, trade, and administrative proposal views.

### NEP-141 funding

- `FungibleTokenReceiver::ft_on_transfer`.
- Bounded transfer message containing the trade ID.
- Validation of the calling token contract, original sender, buyer identity, trade state, exact funding amount, funding deadline, pause state, and transfer message.
- Duplicate-funding protection.
- Full unused-amount return when an incoming transfer is rejected.
- Funding validation and integration coverage.

Rejected incoming transfers use NEP-141 transfer-call resolution. The contract does not treat a rejected transfer as an independently initiated outgoing refund.

### Document commitments and inspection

- Supplier commitments for invoice, packing list, and certificate of origin.
- Fixed 32-byte commitment validation.
- Immutable first document versions and append-only subsequent versions within the implemented version limit.
- Required-document completeness checks.
- Inspector registration, suspension, and reactivation.
- Buyer assignment of an eligible registered inspector after required supplier documents are complete.
- One inspector replacement before final attestation.
- Assigned-inspector-only final pass/fail attestation.
- Inspection record and inspector views.

The contract records document commitments, not document contents. A commitment does not establish that a document is authentic or factually correct.

### Mandates and delegated execution — ADR-009

- Buyer-authorized mandate creation, update, renewal, and revocation.
- Agent identity validation.
- Mandate-bound agent trade creation through `create_trade_under_mandate`.
- Constraints for authorized supplier, token, trade amount, aggregate budget, expiry, and permitted settlement outcomes.
- Immutable per-trade policy snapshots.
- Atomic budget reservation when an agent creates a trade.
- Reservation release when an eligible trade is cancelled before funding.
- Conversion of reserved budget into consumed budget after successful funding.
- Revocation rules that prevent new agent-created trades and applicable agent actions on accepted but unfunded trades.
- Funded trades continue under their stored policy snapshots.
- Mandate-authorized release and refund paths.
- Contract-side checks that prevent an agent from directly transferring customer escrow.

The contract, rather than backend calculations, enforces mandate authorization and budget accounting.

### Outgoing escrow settlement

- Separate authorization and execution steps for payout and refund.
- Buyer confirmation and refund-choice paths.
- Mandate-authorized release and refund paths.
- Unique settlement IDs and pending settlement records.
- NEP-141 outgoing token transfers.
- Private asynchronous settlement callback.
- Callback validation of settlement identity and promise result.
- Successful transfer finalization.
- Failed transfer handling that restores the relevant authorization path and preserves the trade's escrow liability for retry.
- Protection against stale or replayed settlement callback results.
- Integration tests exercising real NEP-141 payout and refund transfers, including mandate-authorized settlement.

A permissionless caller can trigger an already-authorized settlement. That caller does not gain authority to create or alter the underlying payout or refund authorization.

## 2. Not implemented or not fully verified

### Dispute resolution

The wider product architecture includes dispute handling, but the current verified contract interface does not implement the complete dispute workflow.

Not implemented:

- Contract dispute opening and lifecycle.
- Resolver decisions and enforcement.
- Mutual resolver replacement.
- Dispute-specific settlement authorization and execution.

Do not describe dispute resolution as an implemented contract capability.

### Additional contract-level accounting and events

The current milestone implements per-trade settlement records and retry behavior. The following broader capabilities are not established as complete by the current verification baseline:

- Global escrow liability aggregation and reconciliation across all trades.
- Full NEP-297 event coverage for every relevant state transition.
- Production-grade accounting and operational reconciliation procedures.

These should be treated as separate engineering and verification tasks rather than inferred from the successful settlement integration tests.

### Cross-chain settlement — ADR-010

ADR-010 remains proposed. Its capabilities are not part of the approved or verified local NEP-141 escrow implementation.

Not implemented or production-verified:

- Live NEAR Intents deposit and outbound settlement orchestration.
- Production embedded-wallet signing compatibility for the complete cross-chain flow.
- Chain Signatures integration.
- Destination-chain transaction and token-transfer verification.
- Cross-chain replay protection and reconciliation.
- Cross-chain refund execution and recovery.
- Production asset and network support.

Tidepool dry-quote experimentation does not demonstrate a completed deposit, swap, delivery, or refund. Do not treat a quote as settlement evidence.

The current test configuration continues to use SDD, a sandbox token with no represented monetary value. Do not replace the fixed SDD funding configuration with a proposed USDC flow unless ADR-010 is accepted and the implementation and tests are updated accordingly.

### Application layer

The following application capabilities remain planned rather than implemented in the verified contract milestone:

- Frontend trade and mandate workflows.
- Backend wallet challenge and authentication.
- Agent orchestration worker and operational key isolation.
- Deterministic mandate policy engine outside the contract.
- Private document storage and encryption.
- Document extraction, OCR, and AI-assisted analysis.
- Indexing, reconciliation services, and operational monitoring.

The backend and AI components must not be treated as authoritative sources of escrow state or financial authorization.

## 3. Verification state

The latest recorded successful workspace test run contains:

| Test category                            | Passing tests |
| ---------------------------------------- | ------------: |
| Contract unit tests                      |            87 |
| Funding and settlement integration tests |             3 |
| NEAR sandbox smoke test                  |             1 |
| **Total**                                |        **91** |

The three integration tests cover:

- Valid funding and rejected-transfer resolution.
- Actual NEP-141 payout and refund transfers.
- Mandate-authorized settlements executing real NEP-141 transfers.

The following checks were also recorded as passing for the milestone:

- `cargo fmt --all -- --check`
- `cargo test --workspace`
- `git diff --check`

These results establish the tested behavior of the current contract milestone. They do not establish production deployment readiness, dispute resolution, global escrow reconciliation, complete NEP-297 event coverage, cross-chain settlement, or the unimplemented application services.

## 4. Current contract interface

The contract implementation is organized under:

`contracts/trade-operations/src/`

| File        | Responsibility                                                             |
| ----------- | -------------------------------------------------------------------------- |
| `lib.rs`    | Contract methods, authorization, funding receiver, and settlement workflow |
| `state.rs`  | Persistent contract state and stored records                               |
| `types.rs`  | Contract data types and related definitions                                |
| `errors.rs` | Contract error definitions                                                 |

The principal public methods include:

- **Administration:** `new`, `propose_admin_action`, `approve_admin_action`, `execute_admin_action`, `expire_admin_proposal`, `get_admin_proposal`, `get_contract_config`.
- **Mandates:** `create_mandate`, `update_mandate`, `renew_mandate`, `revoke_mandate`, `get_mandate`, `get_trade_policy_snapshot`.
- **Trade lifecycle:** `create_trade`, `create_trade_under_mandate`, `accept_trade`, `cancel_trade`, `get_trade`.
- **Documents and inspection:** `record_document_commitment`, `get_document_commitments`, `are_required_supplier_documents_complete`, `get_inspector`, `assign_inspector`, `replace_inspector`, `submit_inspection_attestation`, `get_inspection_record`.
- **Settlement:** `authorize_mandated_release`, `authorize_mandated_refund`, `confirm_release`, `choose_refund`, `release_payment`, `refund_escrow`, `on_settlement_transfer_complete`.

The NEP-141 `ft_on_transfer` receiver is implemented through the fungible-token receiver interface rather than as an ordinary public contract method.

For exact parameter types, return types, and authorization conditions, the contract source is authoritative.

## 5. Next implementation priorities

The mandate and outgoing settlement milestone is complete at the verified commit. The next work should focus on closing the remaining trust and operational gaps rather than reimplementing the completed mandate layer.

Recommended order:

1. **Reconcile specifications:** Update lifecycle, contract-design, and implementation documents to match the current source and distinguish implemented behavior from planned dispute functionality.
2. **Review escrow accounting:** Establish whether global liability aggregation and reconciliation are required for the intended deployment model, then implement and test them if required.
3. **Complete event coverage:** Define the required NEP-297 event surface and verify event emission for all relevant transitions.
4. **Design dispute handling:** Specify resolver authority, dispute states, replacement rules, and settlement consequences before implementing dispute methods.
5. **Build application services:** Implement wallet authentication, private document handling, deterministic policy evaluation, and agent orchestration without moving financial authority out of the contract.
6. **Evaluate ADR-010 separately:** Require a complete cross-chain security and integration design before implementing live NEAR Intents settlement.

ADR-010 remains a separate decision gate. The core NEP-141 SDD funding and settlement workflow should remain independently testable and should not acquire a dependency on the proposed cross-chain integration.

## 6. Security and deployment qualifications

The current milestone is a hackathon-stage contract implementation, not a production trade-finance deployment.

- A document commitment establishes a cryptographic reference, not document authenticity.
- An inspector attestation records an authorized inspector's claim; it does not independently prove physical-world events.
- A NEAR account is not, by itself, legal identity or KYB verification.
- AI-generated findings are advisory and may be incorrect or incomplete.
- Backend and database records are projections, not authoritative escrow state.
- SDD is a test token and has no represented monetary value.
- Production deployment, key management, monitoring, incident response, and recovery procedures require further work.

The central authority boundary remains unchanged: an agent may act only within buyer-granted authority, and the contract enforces the financial permissions and escrow transitions.
