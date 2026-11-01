# 3. Product Requirements

## Fixed MVP scope
One buyer, one supplier, one pre-agreed resolver, one active inspector assignment (one replacement maximum), one supported NEP-141 test token, four required document types and one all-or-nothing settlement per trade. The demo amount is 10,000 SDD (raw amount `10000000000` at 6 decimals). Multiple trades may coexist. No partial releases.

## Document matrix

| Type | Required submitter | Required before inspector assignment |
|---|---|---|
| Commercial invoice | Supplier | Yes |
| Packing list | Supplier | Yes |
| Certificate of origin | Supplier | Yes |
| Inspection report | Assigned inspector | Submitted as the final attestation/evidence record |

The certificate of origin is stored as a document supplied by the supplier; issuer authenticity is not verified by the MVP. The inspector report is submitted by the assigned inspector and committed on-chain. Document bytes remain off-chain.

## Functional requirements
- FR-01 Buyer creates trade with supplier, resolver and structured terms.
- FR-02 Buyer, supplier and resolver are distinct accounts.
- FR-03 Only named supplier accepts; acceptance freezes terms and resolver.
- FR-04 Buyer may cancel an unfunded trade before acceptance or after funding deadline expiry.
- FR-05 Only configured SDD NEP-141 contract may fund; sender must be buyer and amount exact.
- FR-06 Rejected `ft_on_transfer` returns full amount as unused tokens.
- FR-07 Participants submit only their permitted document commitments; versions are immutable.
- FR-08 Inspector assignment requires all three supplier documents and active registry status.
- FR-09 Assigned inspector submits one final pass/fail outcome and evidence commitment.
- FR-10 Pass requires explicit buyer `confirm_acceptance`.
- FR-11 Fail requires buyer choice: refund or dispute.
- FR-12 Both parties may dispute in Funded, DocumentReview and InspectionPending; in InspectionPassed only after 72 hours; in InspectionFailed only buyer chooses refund/dispute.
- FR-13 Only current resolver resolves a dispute; resolver timeout replacement requires both parties.
- FR-14 Settlement trigger is permissionless after authorization; recipient/amount are derived from contract state.
- FR-15 Exactly one active settlement per trade; liability decreases only on successful callback.
- FR-16 Failed outgoing transfer restores authorized state and preserves escrow liability.
- FR-17 Emergency pause blocks only new trade creation/funding.

## Non-functional requirements
Bounded inputs/storage; deterministic authorization; privacy by least privilege; structured non-sensitive events; idempotent indexing; no backend escrow ledger; recoverable async failure; clear user confirmation for irreversible choices; reproducible builds.

## Out of scope
Real money, mainnet, partial settlement, multi-token/FX, multi-milestone payment, lending, KYC/KYB, legal automation, external issuer/logistics/bank integrations, ZK proofs and autonomous AI transactions.
