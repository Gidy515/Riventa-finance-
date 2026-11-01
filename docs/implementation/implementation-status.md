# Implementation Status

**Baseline:** Architecture Baseline v1.0
**Current milestone:** Contract foundation — Slice 1
**Status:** Source scaffold created; compilation not yet verified.

## Implemented in source

- Contract initialization with admin and one allowlisted token account.
- Persistent trade map and monotonic trade IDs.
- Buyer-only trade creation.
- Account-separation checks for buyer, supplier, resolver and administrator.
- Fixed 10,000 SDD raw amount and 32-byte commitment validation.
- Seven-day supplier acceptance deadline.
- Supplier-only acceptance and 48-hour funding deadline initialization.
- Buyer cancellation while awaiting acceptance, or after an accepted trade's funding deadline has elapsed.
- Read-only trade and contract configuration views.
- Initial unit tests for creation/acceptance, unauthorized acceptance and expired unfunded cancellation.

## Not implemented yet

- Document commitment rules and required-document completion.
- Inspector registry, assignment, replacement and attestation.
- Buyer acceptance after inspection.
- Dispute opening, resolver decisions and mutual resolver replacement.
- NEP-141 payout/refund promises and private callbacks.
- Global escrow liability accounting and NEP-297 event coverage for all transitions.
- Sandbox integration tests and deployment scripts.

## Verification state

Slice 1 was verified on the developer machine: 3 native unit tests passed and the `wasm32-unknown-unknown` target check passed without warnings after cleanup. Slice 2 has been authored in source but has not yet been compiled or tested on the developer machine. No NEAR sandbox transfer-resolution test has been run.

## Slice 2 — NEP-141 funding receiver

Implemented in source: `FungibleTokenReceiver::ft_on_transfer`, bounded JSON message (`trade_id` only, maximum 64 bytes), allowlisted token predecessor, buyer sender, exact fixed amount, `Accepted` state, funding deadline, pause check, duplicate-funding protection, and full-unused-amount return on rejection. Unit tests cover the success path and rejection cases.

Next verification: compile and run the expanded native test suite, then run sandbox integration against a test FT contract to verify actual `ft_resolve_transfer` behavior.
