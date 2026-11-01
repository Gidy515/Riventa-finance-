# 9. Security Model and Invariants

## Security invariants
1. Only buyer creates a trade.
2. Only designated supplier accepts.
3. Buyer, supplier, resolver, assigned inspector and contract administrator are five distinct accounts.
4. Accepted terms/resolver cannot change except mutual resolver replacement after timeout during a dispute.
5. Only configured token contract may invoke accepted funding.
6. Funding sender is buyer and amount is exact.
7. Rejected deposits return full amount through NEP-141 resolver.
8. Only buyer/supplier may commit their allowed document types.
9. Document versions are append-only and bounded.
10. Inspector assignment requires all required supplier documents, active registry status and an inspector account distinct from buyer, supplier, resolver and contract administrator.
11. Only assigned active inspector may attest; one final attestation only.
12. Pass requires buyer confirmation.
13. Failed inspection requires buyer choice of refund or dispute.
14. Refund authorization cannot later become dispute.
15. Only current resolver resolves a dispute; one replacement maximum requires bilateral approval and is unavailable to the admin.
16. Dispute blocks ordinary settlement.
17. Only defined states and deadlines permit disputes: either party in Funded/DocumentReview/InspectionPending; either party in InspectionPassed only after 72 hours; only buyer chooses refund/dispute in InspectionFailed.
18. Settlement recipient/amount derive from stored trade.
19. Settlement authorization is single-use.
20. At most one pending settlement per trade.
21. Liability decreases only on confirmed successful transfer.
22. Failed transfer preserves liability and authorization.
23. Callback is private, active-ID-bound, result-checked and replay-safe.
24. Per-trade conservation: funded = paid + refunded + remaining.
25. Global token balance covers aggregate outstanding liabilities.
26. Through contract methods, admin cannot withdraw allocated funds or edit trade/dispute outcomes. After deployment, the deployer full-access key is removed and the contract account has no full-access key or upgrade method; code is immutable for that deployment.
27. Pause affects only new trade creation/funding.
28. AI cannot authorize money or alter contract state.
29. Backend/indexer cannot override contract state.
30. Private documents, keys, nonces and reports never appear in chain events/logs.

## Threat model
Compromised wallets, malicious NEP-141 token calls, forged callback attempts, reentrancy-like async races, duplicate settlement, stale indexer, compromised backend/storage, malicious files, prompt injection, dishonest inspector/resolver, admin compromise and metadata inference.

## Controls
Caller/state validation in every mutation; strict token predecessor and sender checks; exact amount checks; bounded inputs; no arbitrary token acceptance; private callbacks; unique settlement IDs; CEI-style state-before-promise; idempotent callback; encrypted objects; short-lived grants; parser isolation; AI output schema validation; secret-safe logs; multisig admin; deterministic solvency checks.

## Required tests
Wrong token/sender/amount; duplicate/partial/over funding; NEP-141 refund on rejected receiver; missing/duplicate docs; wrong submitter; inactive inspector; inspector replacement boundary; unauthorized attestation; pass without buyer confirmation; failed inspection refund/dispute exclusivity; disputes in every state; non-resolver decision; resolver timeout and two-party replacement; duplicate/concurrent settlement; forged/replayed/stale callback; failed token transfer; unregistered recipient; multi-trade aggregate solvency; pause scope; encrypted object access across roles; expired/replayed wallet challenge; prompt injection; malicious/malformed file.
