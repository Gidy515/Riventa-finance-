# 4. System Architecture

## Fixed architecture
Hybrid architecture with one NEAR trade-operations contract, one TypeScript backend/worker service, one Next.js frontend, PostgreSQL read-model/job database, private encrypted local file storage and local Ollama inference.

## Components and authority
- **NEAR contract:** authoritative participants, accepted terms, trade state, token allowlist, escrow liability, document commitments, inspector registry/assignment, inspection outcome, dispute state, settlement state and events.
- **Frontend:** wallet connection, uploads, role workflows, AI report display and explicit transaction prompts. It cannot authorize anything by hiding/showing UI.
- **Backend/API:** wallet challenge verification, current role checks, scoped file grants, file encryption, document processing, AI orchestration, indexing, reconciliation and notifications. No custody or financial authority.
- **PostgreSQL:** metadata, job state, audit/access logs and rebuildable index projections only.
- **Private filesystem:** encrypted document objects and encrypted commitment nonces. No public URLs.
- **Ollama:** local model used only to explain structured findings; no remote model calls.

## Sequence
1. Buyer creates; supplier accepts.
2. Buyer registers escrow recipient if required and funds exact amount via NEP-141 `ft_transfer_call`.
3. Buyer/supplier upload documents; backend encrypts and stores bytes.
4. Participant submits commitment on-chain; backend verifies receipt and stores object mapping.
5. Deterministic extraction/comparison runs; local model may produce explanatory text.
6. When required supplier documents are committed, buyer assigns registered inspector.
7. Inspector submits final attestation/evidence commitment.
8. Buyer confirms, refunds after failure or opens dispute; resolver resolves disputes.
9. Any caller may trigger authorized transfer; private callback finalizes success/failure.
10. Indexer reconciles projections against contract views.

## Contract account control

The contract is deployed with a temporary full-access deployer key. After initialization and code-hash verification, the key is removed; the contract account has no full-access key and the contract exposes no upgrade method. Code is immutable for that deployment. A future code version requires a new contract account; state/escrow migration is outside the MVP. The 2-of-3 admin multisig cannot redeploy code.

Failure isolation
Backend, database, storage or AI outage cannot alter contract state or release funds. If file access fails, workflow pauses. If AI fails, human review continues. If RPC/indexer is stale, backend marks status stale and does not infer settlement. Failed outgoing transfer preserves liability.
