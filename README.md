# Riventa

**Confidential Trade Operations and Conditional Settlement for Businesses**

AI-assisted infrastructure for confidential cross-border trade operations and conditional settlement.

## Status

Architecture Baseline v1.0 is frozen for the hackathon MVP. The contract source currently implements initialization, trade proposal creation, supplier acceptance, cancellation of unfunded trades, read views, and a NEP-141 `ft_on_transfer` receiver for exact trade funding. Slice 2 source has been authored, but its compilation, unit tests and sandbox behavior still require local verification. Document workflows, inspection, disputes and settlement are not yet implemented.

## Repository

- `docs/` — normative architecture, requirements, decisions, ADRs and diagrams.
- `contracts/trade-operations/` — NEAR Rust contract.
- `backend/` and `frontend/` — planned application modules; not yet implemented.

## Build contract

See `docs/DECISION-REGISTER.md` and `docs/07-smart-contract-design.md`. Changes require a numbered ADR and corresponding tests/spec updates.
