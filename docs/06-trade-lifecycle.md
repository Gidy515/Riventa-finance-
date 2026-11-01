# 6. Trade Lifecycle

## State set
`AwaitingAcceptance`, `Accepted`, `Funded`, `DocumentReview`, `InspectionPending`, `InspectionPassed`, `InspectionFailed`, `Disputed`, `ReleaseAuthorized`, `RefundAuthorized`, `PayoutPending`, `RefundPending`, `Completed`, `Refunded`, `Cancelled`.

No separate `InspectionSubmitted` state is used: the assigned inspector's final outcome and evidence commitment are recorded atomically with the transition to Passed/Failed.

## Main flow
1. Buyer `create_trade(supplier, proposed_resolver, terms)`; buyer, supplier, resolver and admin must be distinct. Acceptance expires 7 days after creation.
2. Supplier `accept_trade(trade_id)` before expiry; accepted terms/resolver become fixed.
3. Buyer funds exact amount within 48 hours using supported SDD `ft_transfer_call`.
4. First valid document commitment moves `Funded` to `DocumentReview`.
5. Supplier commits the required invoice, packing list and certificate of origin. When all are present, buyer assigns active inspector; state becomes `InspectionPending`.
6. Assigned inspector submits one final pass/fail attestation and report commitment.
7. Pass → `InspectionPassed`; buyer may call `confirm_acceptance()` only while `now < buyer_decision_deadline` (72 hours after attestation) → `ReleaseAuthorized`. At or after the deadline, confirmation is rejected and either party may open a dispute. If neither party disputes, escrow remains locked; there is no automatic release/refund and no admin recovery path.
8. Fail → `InspectionFailed`; buyer chooses `request_refund_after_failed_inspection()` → `RefundAuthorized`, or `open_dispute()` → `Disputed`.
9. Either party may open dispute in `Funded`, `DocumentReview` or `InspectionPending`. From `InspectionPassed`, either party may open dispute only after the 72-hour buyer decision window expires. From `InspectionFailed`, only buyer may choose refund or dispute, with no expiry. No dispute after authorization/pending/terminal states.
10. Stored resolver decides release/refund. Resolver has 5 days from dispute opening. Buyer and supplier may mutually replace the resolver at any time through a two-step proposal/approval. If no decision is recorded by day 5, either party may initiate the replacement proposal; the other party must approve the exact same account in a separate call. New resolver must be distinct from buyer, supplier, assigned inspector and contract administrator. Buyer and supplier attest that no known conflict exists when agreeing the resolver. One resolver decision is final; no appeal or admin override.
11. Any account may trigger authorized payout/refund. NEP-141 transfer is asynchronous; success callback reaches `Completed`/`Refunded`; failure restores `ReleaseAuthorized`/`RefundAuthorized`.

## Deadlines
Creation acceptance: 7 days. Funding after acceptance: 48 hours. Buyer confirmation after a passing inspection: 72 hours; after expiry, only dispute is allowed from `InspectionPassed`. Failed-inspection buyer choice has no expiry. Resolver decision after dispute: 5 days. Buyer and supplier may mutually replace the resolver at any time; after 5 days without a decision, either party may initiate the proposal, but the other party must still approve. Deadlines use NEAR block timestamp nanoseconds and expire at `now >= deadline`. No automatic financial transition ever occurs on timeout. Missed passing-inspection decision allows either party to dispute. Missed resolver deadline permits either party to initiate mutual replacement; approval by the other party is still mandatory. Document and inspection completion have no protocol deadline. Funding after `fund_by` and acceptance after `accept_by` are rejected; buyer explicitly cancels expired unfunded trades.

## Cancellation and dispute
Buyer may cancel only while `AwaitingAcceptance`, or after funding deadline expires while still `Accepted` and unfunded. A funded trade cannot be cancelled. Dispute blocks all ordinary buyer settlement methods. Refund choice cannot later be converted to dispute. Release/refund authorization is single-use.

## Resolver replacement
During any `Disputed` state, either party may propose one replacement resolver. The other party must approve the exact same account in a separate call. After 5 days without a resolver decision, either party may initiate this process. The replacement account must differ from buyer, supplier, inspector, previous resolver and admin. Both parties attest that they know of no conflict with the replacement. On approval, the new resolver receives a fresh 5-day decision window; previous resolver cannot resolve it. A second replacement is prohibited. If approval is not obtained or the replacement resolver is unavailable, the dispute remains locked with no admin override. No admin may appoint a resolver. Dispute evidence is stored encrypted off-chain; the contract stores only salted 32-byte commitments and the final outcome. The resolver decision is immutable and cannot be appealed or overridden by an administrator.
