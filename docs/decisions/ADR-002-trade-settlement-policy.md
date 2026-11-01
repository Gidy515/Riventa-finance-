# ADR-002: Settlement Authorization and Disputes

- Status: Accepted
- Date: 2026-11-01

## Decision
Buyer confirmation required after pass. Buyer chooses refund or dispute after fail. Parties can dispute only in specified pre-authorization states. Stored independent resolver decides. Resolver timeout permits mutual two-step replacement, not admin intervention or automatic outcome. Settlement initiation is permissionless after authorization. Async failure restores authorization and liability.

## Rationale
Avoids inspector/AI unilateral payment authority, prevents unilateral admin custody and avoids permanent deadlock if resolver disappears while retaining bilateral consent for replacement.
