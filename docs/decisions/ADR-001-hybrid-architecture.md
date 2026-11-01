# ADR-001: Hybrid Architecture

- Status: Accepted
- Date: 2026-11-01

## Decision
NEAR owns authoritative trade state, authorization, escrow liabilities and settlement. Backend handles private documents, processing, AI, indexing and notifications. PostgreSQL is rebuildable metadata/read-model storage. Frontend submits user-authorized wallet transactions.

## Rationale
On-chain documents expose sensitive information and are expensive. Fully off-chain financial state centralizes enforcement. Hybrid architecture isolates money rules from document/AI services.

## Consequences
Public metadata remains visible; key management and cross-system reconciliation require care. Backend outages pause document operations but do not corrupt escrow.
