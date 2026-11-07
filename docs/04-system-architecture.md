# 4. System Architecture

## Fixed architecture
Hybrid autonomous-business architecture with one NEAR trade-operations contract, one TypeScript backend/agent-worker service, one Next.js frontend, PostgreSQL read-model/job database, private encrypted local file storage and local Ollama inference. The contract stores customer mandates, trade-to-mandate policy snapshots, budget reservations and escrow liabilities.

## Components and authority
- **NEAR contract:** authoritative buyer mandates, authorized agent identities, mandate limits and policy versions, trade-to-mandate bindings, budget reservations, participants, accepted terms, trade state, token allowlist, escrow liability, document commitments, inspector registry/assignment, inspection outcome, dispute state, settlement state and events.
- **Agent worker:** interprets approved requests, proposes operations, runs deterministic policy checks and submits permitted transactions using the agent's own NEAR account. It never signs as the buyer and cannot override contract checks.
- **Frontend:** wallet connection, mandate creation/update/revocation, mandate review, uploads, role workflows, AI report display and transaction prompts. It cannot authorize anything by hiding/showing UI.
- **Backend/API:** wallet challenge verification, mandate-aware policy checks, current role checks, scoped file grants, file encryption, document processing, AI orchestration, agent job orchestration, indexing, reconciliation and notifications. It does not hold customer keys or maintain an authoritative escrow ledger.
- **PostgreSQL:** metadata, job state, audit/access logs and rebuildable index projections only.
- **Private filesystem:** encrypted document objects and encrypted commitment nonces. No public URLs.
- **Ollama:** local model used only to explain structured findings; no remote model calls.

## Sequence
1. Buyer creates a mandate and signs it through the buyer's wallet.
2. Agent validates the request against the mandate and creates a trade using its own account; the contract reserves the trade amount against the aggregate budget.
3. Supplier accepts; the buyer funds exact escrow amount through NEP-141 `ft_transfer_call`.
4. Buyer/supplier upload documents; backend encrypts and stores bytes.
5. Participant submits commitment on-chain; backend verifies receipt and stores object mapping.
6. Deterministic extraction/comparison runs; local model may explain structured findings.
7. When required supplier documents are committed, the buyer assigns a registered inspector.
8. Inspector submits final attestation/evidence commitment.
9. If pass and mandate permits immediate release, agent may initiate release. Otherwise buyer uses the explicit confirmation path. If fail, agent may refund only when mandate permits; otherwise buyer chooses refund or dispute. Resolver resolves disputes.
10. Any caller may trigger an authorized transfer; private callback finalizes success/failure.
11. Indexer reconciles projections against contract views.

## Contract account control

The contract is deployed with a temporary full-access deployer key. After initialization and code-hash verification, the key is removed; the contract account has no full-access key and the contract exposes no upgrade method. Code is immutable for that deployment. A future code version requires a new contract account; state/escrow migration is outside the MVP. The 2-of-3 admin multisig cannot redeploy code.

## Mandate and treasury isolation
Customer escrow is held and accounted for by the trade contract. Riventa service revenue and operating treasury are separate. The agent's operating policy cannot authorize transfers from customer escrow to Riventa. Backend policy checks are advisory to contract enforcement; a backend, database or LLM result cannot authorize a financial transition.

## Failure isolation
Backend, database, storage or AI outage cannot alter contract state or release funds. If file access fails, workflow pauses. If AI fails, deterministic checks and human review continue where possible. If RPC/indexer is stale, backend marks status stale and does not infer settlement. Failed outgoing transfer preserves liability.
