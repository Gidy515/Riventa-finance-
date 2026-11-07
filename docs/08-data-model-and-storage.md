# 8. Data Model and Storage

## On-chain

### Customer mandate

`ExecutionMandate` stores:

- `mandate_id`: monotonically increasing identifier.
- `buyer`: mandate owner and trade buyer.
- `authorized_agent`: distinct NEAR account permitted to create trades and perform snapshot-authorized actions.
- `approved_supplier`: one approved supplier account in the MVP.
- `payment_token`: approved NEP-141 token contract.
- `max_trade_amount`: maximum amount allowed for one agent-created trade.
- `aggregate_budget`: maximum aggregate amount authorized by the buyer.
- `reserved_budget`: amount reserved by created but not yet successfully funded trades.
- `consumed_budget`: amount successfully funded under this mandate.
- `release_on_pass`: whether the agent may immediately authorize release after a passing inspection.
- `refund_on_fail`: whether the agent may authorize refund after a failed inspection.
- `valid_until`: mandate expiry timestamp.
- `revoked`: revocation flag.
- `policy_version`: monotonically increasing version.

The MVP uses one approved supplier and one token per mandate. Policy fields are fixed and bounded; no arbitrary free-form policy strings or unbounded supplier arrays are stored.

### Trade policy snapshot

Every agent-created `Trade` stores an immutable `TradePolicySnapshot`:

- `mandate_id`
- `policy_version`
- `authorized_agent`
- `release_on_pass`
- `refund_on_fail`

The trade also stores its existing buyer, supplier, terms, payment token, amount, deadlines, state and escrow accounting. The supplier and token are copied from the validated mandate into the accepted trade terms.

The snapshot is fixed at trade creation and cannot be changed by later mandate updates or revocation. Agent settlement methods for a funded trade validate against this snapshot. The current mandate record is used to authorize new trade creation, not to retroactively rewrite existing trades.

### Mandate budget reservation

At agent-created trade creation, the contract checks:

`aggregate_budget >= consumed_budget + reserved_budget + trade_amount`

It then increments `reserved_budget` by the full trade amount atomically.

- Successful funding: decrement `reserved_budget` and increment `consumed_budget` by the trade amount in the same state transition that marks the trade Funded.
- Cancellation before successful funding: decrement `reserved_budget` exactly once.
- Failed/rejected funding: reservation remains until the trade is cancelled or otherwise resolved under the specified unfunded-trade rules; failed funding does not consume budget.
- Refund after successful funding: does not automatically decrement `consumed_budget`.

All arithmetic uses checked integer operations. A reservation must have an explicit lifecycle marker so it cannot be released or consumed twice.

### Other contract records

- `TradeTerms`: `total_amount: U128`, `payment_token: AccountId`, fixed required document type enum list, 32-byte inspection criteria commitment, 32-byte refund terms commitment, 32-byte agreement commitment, acceptance/funding deadlines.
- `Trade`: ID, buyer, supplier, current resolver, terms, remaining escrow liability, state, optional inspector, inspection outcome, dispute timestamps/decision, active settlement ID, inspector replacement count and timestamps, optional trade policy snapshot and mandate budget-reservation status.
- `DocumentCommitment`: trade ID, enum type, version, `[u8;32]` commitment, submitter and block timestamp.
- `InspectorRecord`: account ID, active status, credential commitment and registration timestamp.
- `SettlementRecord`: settlement ID, trade ID, kind, recipient, amount and pending/succeeded/failed status.
- `ResolverReplacement`: proposed account, proposer, reason commitment, approval status and timestamp.
- `DisputeRecord`: opening reason commitment, resolver decision commitment, outcome, opening timestamp and resolution timestamp.

Use persistent maps with explicit prefixed keys and deterministic integer IDs. No PDA terminology; NEAR contract storage keys are ordinary application keys. Resolver replacement is limited to one per dispute; the replacement resolver receives a new 5-day deadline.

## Off-chain PostgreSQL

Stores wallet sessions, mandate/agent job projections, object metadata, encrypted key envelopes, role-scoped access audit, extraction jobs, typed extracted fields, AI explanation reports, event projections and notification jobs.

Mandate and trade projections are rebuildable from contract state/events. PostgreSQL is not the authoritative mandate, budget, escrow ledger or permission authority. Agent job records must reference the mandate ID, trade ID, policy version and transaction/receipt identity.

## File object

Private local filesystem path keyed by random opaque object ID. File bytes encrypted using AES-256-GCM; original filename is stored only in encrypted metadata. Maximum upload size 15 MiB; PDF maximum 20 pages; accepted formats PDF, PNG and JPEG; reject archives, executables, macros and unsupported formats. Extracted text is capped at 100,000 characters per file. Only synthetic demo documents are accepted. No antivirus scanner is included; MIME/signature allowlisting, strict size limits and parser isolation are mandatory before OCR.

## Lifecycle

Authenticate wallet → verify current on-chain role/state → issue one-object upload grant → encrypt and store → compute commitment → user signs on-chain commitment → verify transaction → process only authorized file → persist private report.

Mandate creation, update and revocation require a buyer-wallet-signed contract transaction. Agent-created trades and agent-authorized settlement actions are signed by the agent's own NEAR account and validated by the contract. Backend never signs a transaction as the buyer or another participant.

## Retention

Completed/refunded objects: delete after 30 days. Dispute evidence: delete 180 days after resolution. No backup service is operated in the hackathon MVP. Loss of the persistent host volume can permanently destroy off-chain files. On-chain metadata remains permanently public. No legal-hold mechanism in MVP.
