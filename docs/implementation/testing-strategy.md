# Testing Strategy

## Contract unit tests
Every transition, caller role, deadline boundary, document bound, resolver replacement, inspector replacement, storage bound and accounting invariant.

## NEAR sandbox integration using `near-workspaces 0.23.0`
Real NEP-141 `ft_transfer_call` and resolver refund; exact/incorrect deposits; NEP-145 registration; outgoing transfer success/failure; callback authentication, stale/replay IDs, one-pending-settlement; multiple trades and aggregate solvency.

## Backend tests
NEP-413 wallet challenge signature, nonce replay, origin/audience binding, session expiry, current on-chain role checks, grant expiry/object scope, AES-GCM tamper detection, retention deletion, parser isolation, indexer idempotency/replay and stale-state behavior.

## AI tests
Deterministic field extraction/normalization, mismatch evidence, schema validation, malformed docs, prompt injection and model-unavailable fallback. Model text must not alter structured finding IDs or settlement state.

## E2E
Buyer, supplier, inspector and resolver workflows; pass/payout; fail/refund; fail/dispute/release; fail/dispute/refund; resolver timeout replacement; rejected replacement without bilateral approval; second replacement rejected; failed transfer retry.

## CI gates
Format, lint, compile, unit tests, sandbox tests, backend/frontend tests, dependency audit and secret scan. No testnet deployment on failing gate.


## Mandate and autonomous-agent tests

Contract tests must cover:
- Buyer-only mandate creation, update and revocation.
- Agent identity and buyer/mandate binding.
- Expired, revoked and out-of-scope mandate rejection.
- Supplier, token and per-trade amount enforcement.
- Atomic aggregate budget reservation under concurrent trade creation.
- Reservation release on cancellation before funding.
- Reservation-to-consumed conversion on successful funding.
- Failed/rejected funding does not consume budget.
- Post-funding refund does not automatically restore budget.
- Immutable trade policy snapshots after mandate update/revocation.
- Revocation blocks new agent trades but preserves already-funded trade snapshot authority.
- Immediate release only when explicitly permitted by the snapshot.
- Dispute before `ReleaseAuthorized` and rejection after authorization.
- Agent refund after failure only when explicitly permitted.
- Agent cannot submit inspection attestations or resolve disputes.

Backend tests must cover agent key isolation, deterministic policy rejection, duplicate job delivery, transaction submission/reconciliation and stale mandate projections. LLM output must never bypass the deterministic policy layer.
