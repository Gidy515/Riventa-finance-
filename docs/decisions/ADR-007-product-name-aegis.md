# ADR-007: Rename the product to Aegis and adopt a B2B tagline

- **Status:** Superseded by ADR-008
- **Date:** 1 November 2026
- **Decision owners:** Project team
- **Supersedes:** ADR-006 / D-050
- **Superseded by:** ADR-008 / D-052

## Context

The project is an AI-assisted B2B cross-border trade operations and conditional-settlement platform. The previous working name, SealineFi, and its tagline did not communicate the business-to-business use case as directly as desired. The rename is being made before contract deployment and public testnet integration.

## Decision

Use **Aegis** as the product and project name. Use the tagline **“Confidential Trade Operations and Conditional Settlement for Businesses.”** Apply the name consistently across user-facing documentation, repository metadata, Rust package/type identifiers, the NEP-297 event namespace, authentication audience, and the document-commitment domain separator (`AEGIS-DOC-V1`).

## Consequences

- This is a naming and product-communication change only. It does not alter product scope, trust boundaries, business rules, contract behavior, token economics, privacy design, or deployment target.
- Rust package/type identifiers and the NEP-297 event namespace use `aegis` / `Aegis` consistently.
- The document commitment domain separator changes before deployment; no deployed commitments or persisted production data need migration.
- Existing local paths and archives named `sealine` or `sealinefi` should be renamed when updating a developer checkout.
- **Aegis** remains a working identity pending independent trademark, domain and legal clearance. This ADR does not establish ownership or availability of the mark.


## Historical status

This ADR records the previously accepted Aegis naming decision. It is retained for decision-history integrity and is no longer the current product identity. ADR-008 selects Riventa.
