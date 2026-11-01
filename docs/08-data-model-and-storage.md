# 8. Data Model and Storage

## On-chain
- `TradeTerms`: `total_amount: U128`, `payment_token: AccountId`, fixed required document type enum list, 32-byte inspection criteria commitment, 32-byte refund terms commitment, 32-byte agreement commitment, acceptance/funding deadlines.
- `Trade`: ID, buyer, supplier, current resolver, terms, remaining escrow liability, state, optional inspector, inspection outcome, dispute timestamps/decision, active settlement ID, inspector replacement count and timestamps.
- `DocumentCommitment`: trade ID, enum type, version, `[u8;32]` commitment, submitter and block timestamp.
- `InspectorRecord`: account ID, active status, credential commitment and registration timestamp.
- `SettlementRecord`: settlement ID, trade ID, kind, recipient, amount and pending/succeeded/failed status.
- `ResolverReplacement`: proposed account, proposer, reason commitment, approval status and timestamp. `DisputeRecord`: opening reason commitment, resolver decision commitment, outcome, opening timestamp and resolution timestamp.

Use persistent maps with explicit prefixed keys and deterministic integer IDs. No PDA terminology; NEAR contract storage keys are ordinary application keys. Resolver replacement is limited to one per dispute; the replacement resolver receives a new 5-day deadline.

## Off-chain PostgreSQL
Stores wallet sessions, object metadata, encrypted key envelopes, role-scoped access audit, extraction jobs, typed extracted fields, AI explanation reports, event projections and notification jobs. It is rebuildable where derived from chain data. It is not escrow ledger or permission authority.

## File object
Private local filesystem path keyed by random opaque object ID. File bytes encrypted using AES-256-GCM; original filename is stored only in encrypted metadata. Maximum upload size 15 MiB; PDF maximum 20 pages; accepted formats PDF, PNG and JPEG; reject archives, executables, macros and unsupported formats. Extracted text is capped at 100,000 characters per file. Only synthetic demo documents are accepted. No antivirus scanner is included; MIME/signature allowlisting, strict size limits and parser isolation are mandatory before OCR.

## Lifecycle
Authenticate wallet → verify current on-chain role/state → issue one-object upload grant → encrypt and store → compute commitment → user signs on-chain commitment → verify transaction → process only authorized file → persist private report. Backend never writes a commitment on behalf of a wallet without explicit signed transaction.

## Retention
Completed/refunded objects: delete after 30 days. Dispute evidence: delete 180 days after resolution. No backup service is operated in the hackathon MVP. Loss of the persistent host volume can permanently destroy off-chain files. On-chain metadata remains permanently public. No legal-hold mechanism in MVP.
