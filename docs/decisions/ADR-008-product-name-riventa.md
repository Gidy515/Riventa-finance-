# ADR-008: Adopt Riventa as the final product name

- **Status:** Accepted
- **Date:** 1 November 2026
- **Decision owners:** Project team
- **Supersedes:** ADR-007 / D-051

## Context

The project is an AI-assisted B2B cross-border trade operations and conditional-settlement platform. Aegis was selected as a working name, but it is widely used across technology and financial services, creating avoidable brand-confusion risk. The team selected Riventa as the final hackathon product identity.

## Decision

Use **Riventa** as the product and project name. Use the tagline **“Confidential Trade Operations and Conditional Settlement for Businesses.”** Apply the name consistently across user-facing documentation, repository metadata, Rust package/type identifiers, the NEP-297 event namespace, wallet-authentication audience, and the document-commitment domain separator (`RIVENTA-DOC-V1`).

## Consequences

- This is a naming and product-communication change only. It does not alter product scope, trust boundaries, business rules, contract behavior, token economics, privacy design, or deployment target.
- Rust package/type identifiers and the NEP-297 event namespace use `riventa` / `Riventa` consistently.
- The document-commitment domain separator changes before deployment; no deployed commitments or persisted production data need migration.
- The test token is described generically as Sandbox Dollar (SDD); its ticker and six-decimal test behavior are unchanged.
- Historical naming decisions for Sealine, SealineFi and Aegis remain in the ADR/decision history as superseded records.
- **Riventa** is the final hackathon identity, subject to independent trademark, domain and legal clearance. This ADR does not establish ownership or availability of the mark.
