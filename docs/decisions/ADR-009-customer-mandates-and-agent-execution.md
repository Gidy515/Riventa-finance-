# ADR-009: Customer Mandates and Delegated Agent Execution

- **Status:** Accepted
- **Date:** 3 November 2026
- **Decision owners:** Project team
- **Supersedes:** D-002 in product positioning; D-022 and D-024 for mandate-authorized passing-inspection settlement and dispute timing; D-026 for mandate-authorized immediate release. D-037 is preserved: the backend must not sign as a customer or other participant.

## Context

Riventa is an autonomous trade-operations business. Its agent coordinates cross-border procurement and trade execution under customer-defined authority. The agent must be able to perform permitted operations without requesting fresh customer approval for every routine action.

Unrestricted access to a customer's wallet is unacceptable. An LLM must not receive direct authority to sign arbitrary financial transactions. Riventa therefore requires a contract-enforced delegation model in which customer authority is explicit, bounded, attributable, time-limited and revocable.

Riventa's operating funds and service revenue must remain separate from customer trade escrow.

## Decision

### 1. Customer execution mandate

A buyer creates an on-chain execution mandate through a customer-signed transaction. The mandate identifies the buyer as its owner and a distinct Riventa agent account as its delegate.

A mandate records, at minimum:

- Buyer account.
- Authorized agent account.
- Approved supplier account or explicitly bounded supplier policy.
- Approved NEP-141 token contract.
- Maximum amount per trade.
- Maximum aggregate trade budget.
- Permitted settlement outcomes and their objective conditions.
- Failed-inspection policy.
- Mandate expiry and revocation status.
- Monotonically increasing policy version.

The contract rejects malformed, expired, revoked, out-of-scope or over-budget mandates. Only the buyer may create, update, renew or revoke the buyer's mandate through a wallet-authorized transaction. An LLM cannot change mandate terms or authority.

### 2. Agent identity and authority

The agent acts through its own NEAR account. It does not use the buyer's private key, sign as the buyer or acquire general control over the buyer's account.

For an agent-created trade, the transaction predecessor is the agent account while the stored buyer remains the mandate owner. The contract must validate the distinction on every agent-authorized entry point.

The agent may only perform operations explicitly permitted by an active mandate. The contract independently checks:

- Caller identity against the mandate's authorized agent.
- Mandate existence, validity, expiry and revocation status.
- Supplier, token and amount against mandate limits.
- Aggregate budget reservation and availability.
- Trade-to-mandate binding and policy version.
- Valid trade state and permitted state transition.

The agent cannot change accepted terms, replace the buyer or supplier, choose or replace a resolver unilaterally, submit an inspector attestation, fabricate evidence, decide a dispute or override a contract rule.

The agent uses its own operational signing credential. Where supported, its NEAR FunctionCall access key must be restricted to the Riventa contract and the required agent methods. It is never given a customer's key.

### 3. Trade creation and funding

An agent may create a trade on behalf of a buyer under an active mandate. The trade permanently records its mandate identifier and policy version.

The supplier must explicitly accept the trade. Acceptance freezes the agreed terms and resolver.

The buyer remains responsible for funding escrow through the existing NEP-141 `ft_transfer_call` flow. Agent authority does not permit the agent to transfer tokens from the buyer's wallet.

The customer remains the buyer and beneficiary of the trade agreement. Customer escrow is a trade liability; it must never be transferred to, accounted as, or treated as part of Riventa's operating treasury.

### 4. Budget reservation and accounting

The contract reserves the full trade amount against the mandate's aggregate budget atomically when an agent-created trade is created.

- A trade cancelled before successful funding releases its reservation.
- A successful funding operation converts the reservation into consumed budget.
- A failed funding operation does not consume budget.
- A refund after successful funding does not automatically restore mandate budget.
- Concurrent trade creation must not allow multiple trades to reserve the same remaining budget.

Per-trade maximums and aggregate budget limits are both enforced on-chain. Backend checks are supplementary and are not authoritative.

### 5. Passing inspection and delegated release

For a mandate-bound trade whose mandate explicitly authorizes release after a passing inspection, the agent may initiate release immediately after the assigned inspector records a passing attestation.

There is no mandatory 72-hour buyer review period for this authorized immediate-release path. The agent must still submit an on-chain transaction; a passing inspection does not itself transfer funds or automatically change the trade to a settlement state.

If the mandate does not authorize immediate release, the existing explicit buyer-confirmation path applies.

Either party may open a dispute while the trade remains in `InspectionPassed` and before it enters `ReleaseAuthorized`. Once release is authorized, no new dispute may be opened, consistent with the existing settlement-finality boundary.

The contract verifies the mandate, inspection outcome, trade state and settlement conditions before authorizing release. The recipient and amount are derived exclusively from stored contract state.

### 6. Failed inspection and delegated refund

After a failed inspection, the agent may initiate a refund only when the mandate explicitly authorizes refund under that condition.

If the mandate does not authorize that refund, the buyer retains the existing explicit choice between refund and dispute. A failed inspection does not itself trigger an automatic refund.

The agent cannot resolve a dispute, replace the resolver unilaterally or override a resolver's decision. Disputes continue under the existing independent resolver process.

### 7. Mandate revocation and existing trades

Revocation prevents the agent from creating new trades or making new commitments under the mandate.

A funded trade continues under the mandate policy snapshot and authorization limits recorded for that trade. Revocation does not silently rewrite its buyer, terms, escrow liability or settlement conditions. The agent may perform only the already-authorized operations required to complete that funded trade.

An accepted but unfunded trade cannot receive further agent-initiated actions after revocation. The buyer may fund it directly or cancel it under the existing cancellation rules. Cancellation releases its reserved mandate budget.

A trade that has already reached an authorized settlement state remains subject to the existing permissionless settlement-trigger and asynchronous callback rules. Revocation does not redirect or erase an authorized settlement.

Updating or revoking a mandate affects future trade creation; it does not retroactively change a trade's recorded policy snapshot.

### 8. Riventa operating treasury and service revenue

Riventa service revenue, operating treasury, inference expenditure and any configured revenue distribution are separate from customer trade escrow.

The agent may operate Riventa's own treasury only under a separate operating policy and treasury authorization. A customer trade mandate does not authorize spending customer escrow for Riventa operating costs.

No service fee may be silently deducted from customer escrow under this ADR. Any fee mechanism requires explicit customer disclosure and a separately authorized payment path.

The MVP must distinguish actual on-chain transfers from internal accounting entries and synthetic demo values. SDD is a valueless test token; it must never be represented as real revenue, profit, yield or purchasing power.

### 9. AI and deterministic authorization boundary

The AI model may interpret requests, compare approved suppliers, summarize documents, explain anomalies and recommend next actions.

The model is not an authorization engine. It cannot decide that a mandate permits an action, change a spending limit, fabricate evidence, sign transactions or bypass a failed policy check.

Before an agent action is submitted, deterministic backend policy checks validate the proposed operation. The NEAR contract independently enforces on-chain identity, mandate, state, budget and settlement rules.

A backend decision, database record or LLM response is never sufficient to authorize a transfer.

### 10. NEAR Intents

NEAR Intents may be explored as a separate payment integration. It is not the trade escrow contract and is not assumed to provide testnet settlement for this MVP.

The core trade lifecycle, mandate enforcement and escrow tests must work without a live NEAR Intents integration.

Any real payment through an external Intents route requires a separately reviewed adapter, explicit asset and network handling, and an independently approved funding action. A dry-run quote is not evidence of a completed payment.

## Consequences

### Positive

- The agent can perform meaningful trade operations under customer-defined authority.
- Customers do not need to approve every routine action individually.
- Customer funds remain isolated from Riventa's operating treasury.
- The contract, rather than an LLM or backend database, enforces financial authorization.
- Agent actions are attributable to a distinct on-chain account.
- Mandate snapshots and budget reservations provide an auditable basis for delegated execution.

### Costs and limitations

- The contract requires mandate storage, validation, budget accounting and agent-specific entry points.
- The product needs clear mandate creation, review, update and revocation UX.
- The backend must protect an operational agent credential and enforce deterministic policy checks.
- Existing buyer-only lifecycle assumptions must be selectively amended.
- Immediate release increases the consequence of a passing-inspection attestation or mandate misconfiguration. Customers must explicitly authorize this behavior.
- No claim of real-world document authenticity, physical delivery, legal identity, payment finality, fraud detection or commercial traction is created by this ADR.

## Required specification and implementation updates

1. Update project positioning and product requirements.
2. Update the decision register and explicitly mark superseded rules.
3. Update architecture, trust boundaries, security invariants and lifecycle diagrams.
4. Define mandate and trade data structures, including immutable policy snapshots.
5. Implement atomic budget reservation and release/consumption accounting.
6. Add adversarial tests for unauthorized agents, expired/revoked mandates, supplier/token/amount violations, concurrent budget exhaustion, revocation and settlement conditions.
7. Keep the core escrow and mandate test suite independent of NEAR Intents.

The accepted policy is frozen by this ADR. Contract implementation must not begin until the mandate schema, storage bounds, revocation behavior, budget accounting and authorization invariants have been reflected in the contract design and tests.
