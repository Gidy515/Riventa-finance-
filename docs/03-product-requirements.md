# 3. Product Requirements

## Fixed MVP scope
One buyer, one authorized Riventa agent, one supplier, one pre-agreed resolver, one active inspector assignment (one replacement maximum), one supported NEP-141 test token, four required document types and one all-or-nothing settlement per trade. Every agent-created trade is bound to a customer-signed mandate and immutable policy version. The demo amount is 10,000 SDD (raw amount `10000000000` at 6 decimals). Multiple trades may coexist, subject to the mandate's aggregate budget. No partial releases.

## Document matrix

| Type | Required submitter | Required before inspector assignment |
|---|---|---|
| Commercial invoice | Supplier | Yes |
| Packing list | Supplier | Yes |
| Certificate of origin | Supplier | Yes |
| Inspection report | Assigned inspector | Submitted as the final attestation/evidence record |

The certificate of origin is stored as a document supplied by the supplier; issuer authenticity is not verified by the MVP. The inspector report is submitted by the assigned inspector and committed on-chain. Document bytes remain off-chain.

## Functional requirements
- FR-01 Buyer creates and controls an on-chain execution mandate identifying the authorized agent, supplier policy, token, per-trade maximum, aggregate budget, settlement permissions, failure policy, expiry and policy version.
- FR-02 Only the buyer may create, update or revoke that buyer's mandate through a wallet-authorized transaction.
- FR-03 Authorized agent creates a trade under an active mandate; the stored buyer remains the mandate owner, and the trade records its mandate and policy version.
- FR-04 Buyer, supplier, resolver, inspector, contract administrator and agent must satisfy the distinct-account constraints defined by the contract.
- FR-05 Only the named supplier accepts; acceptance freezes the agreed terms and resolver.
- FR-06 Buyer may cancel an unfunded trade under the existing acceptance and funding deadline rules. Revocation also prevents further agent-initiated actions on accepted but unfunded trades; the buyer may fund directly or cancel.
- FR-07 Only the configured SDD NEP-141 contract may fund; sender must be the stored buyer and amount exact.
- FR-08 Rejected `ft_on_transfer` returns the full amount as unused tokens.
- FR-09 Participants submit only their permitted document commitments; versions are immutable.
- FR-10 Inspector assignment requires all three supplier documents and active registry status.
- FR-11 Assigned inspector submits one final pass/fail outcome and evidence commitment.
- FR-12 For a passing inspection, the agent may initiate release immediately only if the mandate explicitly authorizes it; otherwise buyer must explicitly call `confirm_acceptance`.
- FR-13 After a failed inspection, agent may initiate refund only if the mandate explicitly authorizes it; otherwise buyer chooses refund or dispute.
- FR-14 Both parties may dispute in Funded, DocumentReview and InspectionPending. In InspectionPassed, either party may dispute before ReleaseAuthorized. In InspectionFailed, buyer chooses refund/dispute unless the mandate authorizes agent refund.
- FR-15 Only the current resolver resolves a dispute; resolver timeout replacement requires both parties.
- FR-16 Settlement trigger is permissionless after authorization; recipient and amount are derived from contract state.
- FR-17 Exactly one active settlement per trade; liability decreases only on successful callback.
- FR-18 Failed outgoing transfer restores the authorized state and preserves escrow liability.
- FR-19 Emergency pause blocks only new trade creation and funding.
- FR-20 Agent-created trade amount must satisfy both the mandate per-trade maximum and aggregate budget.
- FR-21 The contract reserves budget atomically at trade creation, releases it on cancellation before funding, consumes it on successful funding and does not automatically restore it after refund.
- FR-22 Revocation prevents new agent-created trades. Funded trades continue under their recorded mandate snapshot and already-authorized operations.
- FR-23 Agent uses its own NEAR account and never signs as or uses the buyer's private key.

## Non-functional requirements
Bounded inputs/storage; deterministic contract authorization; atomic budget accounting; immutable trade-to-mandate policy snapshots; privacy by least privilege; structured non-sensitive events; idempotent indexing; no backend escrow ledger; recoverable async failure; explicit customer consent for mandate permissions; reproducible builds.

## Out of scope
Real money, mainnet, partial settlement, multi-token/FX, multi-milestone payment, lending, KYC/KYB, legal automation, external issuer/logistics/bank integrations, ZK proofs, unrestricted customer-wallet delegation and LLM-authorized transactions. NEAR Intents is not a dependency of the core testnet escrow or mandate flow.
