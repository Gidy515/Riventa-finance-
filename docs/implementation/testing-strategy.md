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
