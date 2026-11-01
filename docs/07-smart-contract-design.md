# 7. Smart-Contract Design

## Build target
One Rust contract on NEAR testnet. `near-sdk = 5.29.1`, `near-contract-standards = 5.29.1`. Use NEP-141 receiver/transfer interfaces, NEP-145 storage management where required and NEP-297 events. Amounts use `U128` JSON decimal strings; never floating-point numbers.

## Contract modules
`lib.rs`, `state.rs`, `types.rs`, `storage.rs`, `errors.rs`, `events.rs`, `access_control.rs`, `trade.rs`, `documents.rs`, `inspection.rs`, `dispute.rs`, `escrow.rs`, `callbacks.rs`.

## Mutating methods
- `create_trade(supplier, proposed_resolver, terms)` — buyer only; acceptance deadline is 7 days from creation.
- `accept_trade(trade_id)` — named supplier only, before `accept_by`; sets `fund_by` to acceptance timestamp + 48 hours.
- `cancel_trade(trade_id)` — buyer may cancel `AwaitingAcceptance` at any time, or `Accepted` only when `now >= fund_by`; never after funding.
- `ft_on_transfer(sender_id, amount, msg)` — only allowlisted token contract as predecessor; sender must be buyer; state Accepted; exact token and amount; return zero unused on success, full amount on rejection.
- `record_document_commitment(trade_id, document_type, version, commitment)` — only buyer/supplier for their allowed document types; unique immutable version.
- `register_inspector(account_id, credential_commitment)` / `set_inspector_status` — multisig admin only.
- `assign_inspector(trade_id, inspector)` / `replace_inspector(trade_id, inspector)` — buyer only; required supplier docs complete; active registry; max one replacement before attestation.
- `submit_inspection_attestation(trade_id, outcome, evidence_commitment)` — assigned inspector only; one final attestation.
- `confirm_acceptance(trade_id)` — buyer only from InspectionPassed and only while `now < buyer_decision_deadline` (72 hours after attestation); rejected at or after the deadline.
- `request_refund_after_failed_inspection(trade_id)` — buyer only from InspectionFailed.
- `open_dispute(trade_id, reason_commitment)` — parties only in allowed states and deadlines: either party in Funded/DocumentReview/InspectionPending; either party from InspectionPassed only when `now >= buyer_decision_deadline`; only buyer from InspectionFailed. `reason_commitment` is a salted 32-byte commitment to the encrypted off-chain dispute packet.
- `resolve_dispute(trade_id, outcome, decision_commitment)` — current resolver only; stores immutable outcome and 32-byte commitment to off-chain decision/evidence.
- `propose_resolver_replacement(trade_id, new_resolver, reason_commitment)` / `approve_resolver_replacement(trade_id)` — buyer and supplier may mutually replace at any time during Disputed through proposal and approval. After 5 days without a decision, either party may initiate the proposal, but the other party must still approve. New resolver must differ from buyer, supplier, inspector, previous resolver and admin; both parties attest no known conflict. One replacement per dispute; replacement resolver receives a fresh 5-day decision window. No second replacement or appeal.
- `release_payment(trade_id)` / `refund_escrow(trade_id)` — permissionless trigger, state-gated.
- private `on_settlement_transfer_complete(settlement_id)` — callback only.
- `pause_new_trades`, `unpause` — multisig admin only.

## Funding
Buyer calls token contract `ft_transfer_call` with trade ID in `msg`. Token invokes `ft_on_transfer`. Inside receiver, `predecessor_account_id()` is token contract; `sender_id` is buyer. Validate both independently and reject if `now >= fund_by`. NEP-141 resolver later refunds unused amount if receiver returns full amount. Never manually refund rejected funding. Contract and supplier must be registered as token recipients before the corresponding transfer.

## Settlement
Create unique monotonic settlement ID; set state pending before promise. Store recipient, amount, kind and active ID. Call NEP-141 `ft_transfer` with required 1 yoctoNEAR and sufficient gas. Private callback authenticates self-callback, requires exactly one promise result, matches active settlement ID and pending record, and is idempotent. Decrease liability only after successful transfer. On failure clear pending marker and restore authorized state; preserve liability for retry. A callback must never infer success from missing/unknown promise result.

## Accounting
Per trade: `funded_amount = paid_out + refunded + remaining_liability`.
Global per token: `contract_token_balance >= sum(remaining_liability_for_all_trades)` after accounting for NEP-141 transfer-call resolution semantics. No admin withdrawal of allocated funds. Admin may not withdraw surplus in MVP.

## Views and events
Views: `get_trade`, `get_trade_state`, `get_document_commitments`, `get_inspector`, `get_settlement`, `get_supported_tokens`, `get_contract_config`. Emit NEP-297 `EVENT_JSON:` events with standard `riventa`, version `1.0.0`; never include document content, nonce, commercial terms or evidence URLs.

## Storage bounds
At most 4 required document types, 2 versions per type, 1 inspector replacement, 1 resolver replacement, 1 active dispute and 1 pending settlement per trade. Trade amount is fixed at 10,000 SDD. Type enum fixed; no free-form commercial strings; commitments exactly 32 bytes; `ft_on_transfer.msg` is at most 64 bytes and contains only `trade_id`. Project treasury funds contract storage and maintains sufficient native NEAR for transfer gas and the required 1 yoctoNEAR attached to outgoing NEP-141 transfers. No user-supplied arbitrary storage growth. Contract account has no full-access key after initial deployment and exposes no upgrade method; code is immutable.
