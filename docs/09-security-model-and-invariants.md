# 9. Security Model and Invariants

## Mandate and agent invariants

1. Only the buyer may create, update, renew or revoke that buyer's mandate.
2. The mandate owner, authorized agent, supplier, resolver, assigned inspector and contract administrator satisfy the required account-separation rules.
3. An agent-created trade stores the mandate owner as buyer; the agent is never substituted for the buyer.
4. Agent trade creation requires the caller to equal the mandate's authorized agent.
5. New agent-created trades require an active, unexpired and unrevoked mandate.
6. Supplier, token, per-trade amount and aggregate budget must satisfy the mandate.
7. Every agent-created trade stores an immutable mandate ID, policy version, authorized agent and settlement-policy snapshot.
8. Mandate updates and revocation do not rewrite existing trade snapshots.
9. Revocation blocks new agent-created trades and new commitments under the mandate.
10. An accepted but unfunded trade receives no further agent-initiated actions after revocation; the buyer may fund directly or cancel.
11. A funded trade may continue only under the operations already authorized by its recorded snapshot.
12. The agent never signs as the buyer and never receives or uses the buyer's private key.
13. An LLM response, backend database record or frontend state cannot authorize a contract transition.

## Budget invariants

14. `aggregate_budget >= reserved_budget + consumed_budget` for every mandate.
15. Agent-created trade budget reservation is atomic with trade creation.
16. A reservation is released at most once and only when the trade is cancelled before successful funding.
17. Successful funding converts a reservation to consumed budget exactly once.
18. Failed/rejected funding does not consume budget.
19. A refund after successful funding does not automatically restore consumed mandate budget.
20. Concurrent trade creation cannot oversubscribe the aggregate budget.
21. All budget arithmetic uses checked integer operations; no floating-point arithmetic.

## Trade and escrow invariants

22. Only the designated supplier accepts.
23. Accepted terms and resolver cannot change except mutual resolver replacement during a dispute.
24. Only configured token contract may invoke accepted funding.
25. Funding sender is the stored buyer and amount is exact.
26. Rejected deposits return full amount through the NEP-141 resolver.
27. Only buyer/supplier may commit their allowed document types.
28. Document versions are append-only and bounded.
29. Inspector assignment requires all required supplier documents, active registry status and an inspector distinct from buyer, supplier, resolver and contract administrator.
30. Only assigned active inspector may attest; one final attestation only.
31. Mandate-authorized immediate release requires a funded trade, matching stored agent/snapshot, passing inspection and `InspectionPassed` state.
32. Without snapshot permission for immediate release, the existing buyer confirmation path applies.
33. Mandate-authorized failed-inspection refund requires a funded trade, matching stored agent/snapshot, failed inspection and `InspectionFailed` state.
34. Without snapshot permission for agent refund, only buyer may choose refund or dispute after failed inspection.
35. Either party may dispute in Funded, DocumentReview or InspectionPending; either party may dispute in InspectionPassed before ReleaseAuthorized.
36. No dispute may open after ReleaseAuthorized, RefundAuthorized, PayoutPending, RefundPending, Completed or Refunded.
37. Only current resolver resolves a dispute; one replacement maximum requires bilateral approval and is unavailable to the admin.
38. Refund authorization cannot later become dispute; release/refund authorization is single-use.
39. Settlement recipient and amount derive from stored trade state.
40. At most one pending settlement per trade.
41. Liability decreases only on confirmed successful transfer.
42. Failed transfer preserves liability and restores the authorized state.
43. Callback is private, active-ID-bound, result-checked and replay-safe.
44. Per-trade conservation: funded = paid + refunded + remaining liability.
45. Global token balance covers aggregate outstanding liabilities.
46. Through contract methods, admin cannot withdraw allocated funds or edit trade/dispute outcomes. After deployment, deployer full-access key is removed and the contract account has no full-access key or upgrade method; code is immutable for that deployment.
47. Pause affects only new trade creation and funding.

## AI, backend and privacy invariants

48. AI cannot authorize money, alter mandates, fabricate evidence or independently change contract state.
49. Backend/indexer cannot override contract state or mandate authority.
50. Customer escrow is never treated as Riventa operating treasury or service revenue.
51. No service fee is silently deducted from customer escrow.
52. Private documents, keys, nonces and reports never appear in chain events/logs.
53. Agent operational credentials are separate from customer keys and are restricted to required contract methods where supported.

## Threat model

Compromised buyer or agent keys, malicious NEP-141 token calls, forged callback attempts, reentrancy-like async races, duplicate settlement, stale indexer, compromised backend/storage, malicious files, prompt injection, dishonest inspector/resolver, admin compromise, mandate overreach, concurrent budget exhaustion, replayed mandate actions and metadata inference.

## Controls

Caller/state validation in every mutation; mandate owner/agent binding; immutable trade policy snapshots; strict token predecessor and sender checks; exact amount checks; bounded inputs; checked budget arithmetic; atomic reservations; no arbitrary token acceptance; private callbacks; unique settlement IDs; CEI-style state-before-promise; idempotent callback; encrypted objects; short-lived grants; parser isolation; AI output schema validation; secret-safe logs; multisig admin; deterministic solvency checks.

## Required tests

Wrong mandate owner/agent; unauthorized agent; expired/revoked mandate; wrong supplier/token/amount; per-trade cap exceeded; aggregate budget exhausted; concurrent reservation attempts; reservation released twice; cancellation reservation release; successful funding reservation consumption; rejected/failed funding budget behavior; refund does not restore consumed budget; mandate update does not alter existing snapshots; revocation blocks new trades; revoked accepted/unfunded trade agent action rejected; buyer-funded revoked trade continues under snapshot; immediate release permitted/forbidden; immediate release wrong caller/state; dispute before ReleaseAuthorized; dispute after ReleaseAuthorized rejected; failed-inspection refund permitted/forbidden; agent cannot resolve dispute; wrong token/sender/amount; duplicate/partial/over funding; NEP-141 refund on rejected receiver; missing/duplicate docs; wrong submitter; inactive inspector; inspector replacement boundary; unauthorized attestation; failed inspection refund/dispute exclusivity; disputes in every state; non-resolver decision; resolver timeout and two-party replacement; duplicate/concurrent settlement; forged/replayed/stale callback; failed token transfer; unregistered recipient; multi-trade aggregate solvency; pause scope; encrypted object access across roles; expired/replayed wallet challenge; prompt injection; malicious/malformed file.
