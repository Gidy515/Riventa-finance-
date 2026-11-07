# 6. Trade Lifecycle

## 6.1 Purpose and implementation boundary

This document defines the on-chain lifecycle of a Riventa trade, including buyer acceptance, escrow funding, supplier document commitments, inspection, conditional settlement, and mandate-based execution.

The current contract implements the trade, mandate, funding, document-commitment, inspector, and settlement flows described here.

Dispute resolution is not implemented. Although `Disputed` exists in the `TradeState` enum and each trade stores a resolver account, the current public contract API does not expose dispute-opening, dispute-resolution, or resolver-replacement methods.

The application layer, document storage, AI document analysis, and NEAR Intents integration are also outside the implemented contract lifecycle.

## 6.2 Trade states

The contract defines the following states:

| State                | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `AwaitingAcceptance` | Trade created; supplier has not accepted.                                         |
| `Accepted`           | Supplier accepted; buyer may fund within the funding window.                      |
| `Funded`             | The required escrow amount was received.                                          |
| `DocumentReview`     | Supplier has started submitting document commitments.                             |
| `InspectionPending`  | Required supplier document commitments are complete and an inspector is assigned. |
| `InspectionPassed`   | Assigned inspector submitted a passing attestation.                               |
| `InspectionFailed`   | Assigned inspector submitted a failing attestation.                               |
| `Disputed`           | Reserved state; no dispute transition is implemented.                             |
| `ReleaseAuthorized`  | Supplier payout has been authorized.                                              |
| `RefundAuthorized`   | Buyer refund has been authorized.                                                 |
| `PayoutPending`      | Outgoing supplier transfer is awaiting its callback.                              |
| `RefundPending`      | Outgoing buyer refund is awaiting its callback.                                   |
| `Completed`          | Supplier payout transfer succeeded.                                               |
| `Refunded`           | Buyer refund transfer succeeded.                                                  |
| `Cancelled`          | Trade was cancelled before funding.                                               |

### Implemented state transitions

```text
                         create_trade
                              |
                              v
                    AwaitingAcceptance
                              |
                     accept_trade
                              |
                              v
                          Accepted
                              |
                    buyer funds escrow
                              |
                              v
                            Funded
                              |
               supplier records first document
                              |
                              v
                       DocumentReview
                              |
                 all required documents complete
                              |
                  buyer assigns inspector
                              |
                              v
                     InspectionPending
                         /        \
                      Pass        Fail
                       |            |
                       v            v
                InspectionPassed  InspectionFailed
                       |            |
               authorization  authorization
                 (payout)       (refund)
                       |            |
                       v            v
               ReleaseAuthorized RefundAuthorized
                       |            |
                release_payment  refund_escrow
                       |            |
                       v            v
                 PayoutPending   RefundPending
                       |            |
                 callback        callback
                       |            |
                 success/fail   success/fail
                    /   \         /   \
                   v     v       v     v
             Completed  Release  Refunded Refund
                        Authorized       Authorized
```

A failed outgoing transfer restores the corresponding authorization state, allowing the permissionless execution trigger to be called again.

Cancellation is a separate pre-funding path:

- `AwaitingAcceptance` can be cancelled by the buyer.
- `Accepted` can be cancelled by the buyer only once its funding deadline has elapsed.
- Funded trades cannot use this cancellation method.

## 6.3 Trade creation

The contract supports two trade-creation paths.

### Direct buyer-created trade

The buyer calls:

`create_trade(supplier, proposed_resolver, inspection_criteria_commitment, refund_terms_commitment, agreement_commitment)`

The buyer specifies the supplier, proposed resolver, and three commitments.

The contract:

- Requires the contract not to be paused.
- Requires the three commitments to be exactly 32 bytes each.
- Validates that buyer, supplier, and resolver are distinct and not administrators.
- Uses the configured payment token.
- Sets the fixed required funding amount.
- Sets the state to `AwaitingAcceptance`.
- Sets the supplier acceptance deadline to seven days after creation.

### Mandate-created trade

A buyer first creates an execution mandate using:

`create_mandate(agent, supplier, resolver, max_trade_amount, aggregate_budget, allow_release_after_pass, allow_refund_after_fail, expires_at)`

The buyer defines the agent, supplier, resolver, token, spending limits, delegated settlement permissions, and expiry.

The authorized agent then calls:

`create_trade_under_mandate(mandate_id, inspection_criteria_commitment, refund_terms_commitment, agreement_commitment)`

The contract verifies that:

- The caller is the mandate's agent.
- The mandate has not been revoked.
- The mandate has not expired.
- The mandate uses the configured payment token.
- The required trade amount does not exceed the mandate's maximum per-trade amount.
- The aggregate budget can accommodate the additional reservation.

The contract reserves the required trade amount and creates an immutable `TradePolicySnapshot` containing the mandate version and the trade's buyer, agent, supplier, resolver, token, amount, settlement permissions, and mandate expiry.

The agent does not fund the trade. The buyer remains responsible for funding the escrow independently.

## 6.4 Supplier acceptance and funding deadlines

The supplier accepts a trade by calling:

`accept_trade(trade_id)`

Acceptance is permitted only while the trade is in `AwaitingAcceptance` and before its acceptance deadline.

Successful acceptance:

- Changes the state to `Accepted`.
- Sets `fund_by` to 48 hours after acceptance.

The acceptance window is seven days. The funding window is 48 hours.

The contract does not automatically cancel an expired trade. The buyer can call `cancel_trade` after the relevant deadline.

## 6.5 Escrow funding

The buyer funds the trade through the configured NEP-141 token contract using `ft_transfer_call`.

The funding message contains the trade ID:

```json
{
  "trade_id": 1
}
```

The contract's `ft_on_transfer` receiver validates:

- The calling token contract is the configured payment token.
- The contract is not paused.
- The funding message is valid and within the maximum message size.
- The trade exists and is in `Accepted`.
- The sender is the trade's buyer.
- The trade's payment token matches the calling token contract.
- The transfer amount equals both the trade amount and the required fixed amount.
- The funding deadline has not passed.

For mandate-created trades, the receiver additionally validates the stored policy snapshot and mandate relationship before updating budget accounting.

A rejected transfer returns the full amount as unused so the NEP-141 transfer-call resolution mechanism can return it to the sender.

A successful funding callback changes the trade state to `Funded`.

### Funding amount

The current implementation uses a fixed funding amount of:

`10,000,000,000` raw token units.

The human-readable amount depends on the configured token's decimals. In the six-decimal sandbox test token, this represents 10,000 SDD.

This is a fixed MVP amount, not a general variable-price escrow implementation.

## 6.6 Supplier document commitments

After funding, the supplier submits document commitments through:

`record_document_commitment(trade_id, document_type, version, commitment)`

The supported document types are:

- `CommercialInvoice`
- `PackingList`
- `CertificateOfOrigin`

Each commitment is exactly 32 bytes.

The contract records the document type, version, commitment, submitting account, and submission timestamp. It does not store the document itself.

The current version rules are:

- Only versions 1 and 2 are accepted.
- A document version cannot be submitted twice.
- Version 2 requires version 1 to exist.
- The first document commitment transitions the trade from `Funded` to `DocumentReview`.
- All three required supplier document types must have version 1 before inspector assignment.

The actual files, filenames, extracted text, nonces, and AI analysis remain off-chain.

Read methods:

- `get_document_commitments(trade_id)`
- `are_required_supplier_documents_complete(trade_id)`

## 6.7 Inspector assignment and inspection

The buyer assigns an inspector using:

`assign_inspector(trade_id, inspector_account)`

Assignment requires:

- The caller is the buyer.
- The trade is in `DocumentReview`.
- All required supplier document commitments are complete.
- No inspection record already exists.
- The inspector is registered and active.
- The inspector is distinct from the buyer, supplier, resolver, and administrators.

Successful assignment changes the trade state to `InspectionPending`.

### Inspector replacement

The buyer may replace the assigned inspector once using:

`replace_inspector(trade_id, replacement)`

Replacement is allowed only while the trade remains in `InspectionPending` and before an attestation has been submitted.

The replacement inspector must be registered, active, and satisfy the same account-separation constraints.

### Inspection attestation

The assigned inspector submits an attestation using:

`submit_inspection_attestation(trade_id, outcome, evidence_commitment)`

The evidence commitment must be 32 bytes. The inspector must still be active and must be the inspector currently assigned to the trade.

Only one attestation is accepted.

The outcome is either:

- `Pass`, transitioning the trade to `InspectionPassed`.
- `Fail`, transitioning the trade to `InspectionFailed`.

The contract stores the inspector identity, outcome, evidence commitment, and timestamp. The underlying inspection evidence remains off-chain.

## 6.8 Passing inspection and supplier payout

After a passing inspection, payout authorization depends on the trade's origin.

### Direct trade

The buyer calls:

`confirm_release(trade_id)`

The buyer must be the trade's buyer and the trade must be in `InspectionPassed`.

### Mandate-created trade

The contract checks the immutable trade policy snapshot.

If `allow_release_after_pass` is enabled, the mandate agent may call:

`authorize_mandated_release(trade_id)`

If delegated release is disabled, the buyer must call `confirm_release`.

The agent cannot use this method when the snapshot does not grant release authority.

Successful authorization transitions the trade to `ReleaseAuthorized`.

The actual token transfer is triggered separately by:

`release_payment(trade_id)`

This method is permissionless: any account can trigger an already-authorized payout. It cannot grant payout authorization.

The recipient is the supplier.

## 6.9 Failed inspection and buyer refund

After a failed inspection, refund authorization also depends on the trade's origin and immutable policy snapshot.

### Direct trade

The buyer calls:

`choose_refund(trade_id)`

### Mandate-created trade

If `allow_refund_after_fail` is enabled, the mandate agent may call:

`authorize_mandated_refund(trade_id)`

Otherwise, the buyer must call `choose_refund`.

Successful authorization transitions the trade to `RefundAuthorized`.

The actual token transfer is triggered separately by:

`refund_escrow(trade_id)`

This method is permissionless once the refund has been authorized. It cannot grant refund authorization.

The recipient is the buyer.

A failed inspection does not automatically create a dispute. The current contract does not implement a dispute-opening or resolution workflow.

## 6.10 Settlement transfers and callbacks

Settlement execution uses an outgoing NEP-141 `ft_transfer` followed by a private callback.

For either payout or refund, the contract:

1. Verifies the corresponding authorization state.
2. Rejects execution if another settlement is already active for the trade.
3. Verifies the payment token is the configured token.
4. Creates a `SettlementRecord` with a unique settlement ID.
5. Records the active settlement ID for the trade.
6. Changes the trade to `PayoutPending` or `RefundPending`.
7. Initiates the token transfer.
8. Calls `on_settlement_transfer_complete(trade_id, settlement_id)`.

The callback is private and validates the active settlement ID, settlement record, trade ID, pending settlement status, expected trade state, and promise result.

Only exactly one successful promise result is treated as a successful transfer. Missing, stale, duplicate, unexpected, or mismatched callback conditions cannot complete the settlement.

On success:

- Payout changes the trade to `Completed`.
- Refund changes the trade to `Refunded`.
- The settlement record becomes `Succeeded`.

On transfer failure:

- Payout restores `ReleaseAuthorized`.
- Refund restores `RefundAuthorized`.
- The settlement record becomes `Failed`.
- The active settlement entry is removed, allowing a later retry.

The settlement record retains its result and completion timestamp.

## 6.11 Mandate lifecycle and immutable policy

A mandate is controlled by its buyer.

The buyer can:

- Create a mandate.
- Update its agent, supplier, resolver, limits, permissions, and expiry.
- Renew its expiry.
- Revoke it.

Updating a mandate increments its version. Updating is not permitted after revocation.

Renewal requires a future expiry, clears the revoked flag, and increments the version. It does not change the other mandate permissions or account assignments.

Revocation blocks the creation of new trades under that mandate.

Existing trades retain their policy snapshots. Settlement authorization validates the snapshot against the trade and deliberately does not rely on the mutable current mandate.

This means a later mandate update, revocation, or expiry does not rewrite the authority already captured for an existing trade.

## 6.12 Mandate budget accounting

Mandate budget accounting separates reserved capacity from successfully funded trade capacity.

| Event                                   |           Reserved budget |           Consumed budget |
| --------------------------------------- | ------------------------: | ------------------------: |
| Mandate created                         |                 No change |                 No change |
| Mandate trade created                   | Increases by trade amount |                 No change |
| Mandate trade cancelled before funding  | Decreases by trade amount |                 No change |
| Mandate trade successfully funded       | Decreases by trade amount | Increases by trade amount |
| Funded trade later paid out or refunded |                 No change |                 No change |

The contract checks that reserved plus consumed budget does not exceed the aggregate mandate budget.

A successful refund does not restore consumed mandate budget. The current accounting represents the amount committed to successfully funded trades, not the amount of escrow still held at any given time.

## 6.13 Cancellation

The buyer can call `cancel_trade(trade_id)` under two conditions:

- The trade is still `AwaitingAcceptance`; or
- The trade is `Accepted` and its funding deadline has elapsed.

Cancellation is not a refund mechanism for funded trades.

For mandate-created trades, cancellation releases the amount reserved for the unfunded trade.

Once funding succeeds, the trade must proceed through the inspection and settlement paths.

## 6.14 Administrative pause and deadlines

The contract has the following time windows:

| Window                         | Duration |
| ------------------------------ | -------: |
| Supplier acceptance            |   7 days |
| Buyer funding after acceptance | 48 hours |
| Admin proposal expiry          |   7 days |

The contract's pause flag is controlled through approved administrative proposals.

The pause blocks trade creation and funding. It is not a global freeze of existing trade acceptance, inspection, or settlement execution.

Expired admin proposals can be removed by anyone after their expiry.

## 6.15 Dispute handling and resolver role

The trade data model stores a resolver account, and `TradeState` includes `Disputed`.

However, the current contract does not expose:

- A method to open a dispute.
- A method to submit a dispute decision.
- A method to resolve a dispute.
- A resolver replacement proposal or approval flow.
- A dispute-driven payout or refund authorization path.

The resolver field is therefore stored trade metadata in the current implementation. It must not be represented as an operational arbitration system.

A future dispute module must define dispute eligibility, evidence submission, resolver authorization, decision finality, timeout handling, and the interaction between dispute outcomes and escrow settlement.
