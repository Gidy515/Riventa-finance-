# Riventa Decision Register — Baseline v1.1

**Status:** Frozen for hackathon MVP implementation, including ADR-009. **Baseline:** v1.1. **Effective:** 3 November 2026.

This is the authoritative decision ledger for approved project decisions and explicitly identified proposals. Decisions recorded as current remain effective unless superseded by an accepted ADR. Proposed ADRs do not change existing implementation requirements until accepted. Pilot/production gates are constraints, not unfinished MVP decisions.

## Product and market

| ID | Final decision |
|---|---|
| D-001 | Final hackathon product name: **Riventa**. Tagline: **Confidential Trade Operations and Conditional Settlement for Businesses**. No trademark/domain clearance is represented. |
| D-002 | Historical product-positioning decision: AI-assisted trade operations. Superseded by D-053 / ADR-009. The AI remains advisory, while a deterministic agent executes customer-mandated operations and the contract enforces financial authorization. |
| D-003 | Initial target thesis: African SMEs in cross-border trade. This is a hypothesis, not validated traction or proof of demand. |
| D-004 | Fictional demo: Lagos, Nigeria buyer purchases 1,000 kg bagged cocoa beans from Tema, Ghana supplier; pre-dispatch inspection at Tema. No real shipment or counterparty is implied. |
| D-005 | One buyer, one supplier, one resolver, one inspector, one payment token and one full-amount settlement per trade. Multiple trades may coexist. No partial settlement or multi-leg shipment. |
| D-006 | Demo documents: commercial invoice and packing list (supplier-submitted), certificate of origin (supplier-submitted as an unverified issuer document), and inspection report (assigned inspector-submitted). Bill of lading, customs filings and phytosanitary certification are outside this MVP. |
| D-007 | Inspector is selected and paid off-chain by the buyer. Riventa does not collect or escrow inspection fees. Registry approval is an administrative eligibility check, not a guarantee of competence or independence. Suspension blocks new assignments and further attestations from that account; if currently assigned, buyer may use the single permitted replacement. |

## Chain, token and contract

| ID | Final decision |
|---|---|
| D-008 | NEAR testnet is the only target network for the MVP. No mainnet deployment. |
| D-009 | Contract language/runtime: Rust with `near-sdk 5.29.1` and `near-contract-standards 5.29.1`; one trade-operations contract. Version 5.29.1 is pinned to the stable NEAR 2.13 protocol/tooling line; do not move to SDK 5.30.0 until the matching NEAR 2.14 runtime is stable. |
| D-010 | Tooling baseline: Rust stable `1.99.1`; `near-cli-rs 0.30.1`; `cargo-near 0.22.0`; NEAR sandbox `2.13.4`; `near-workspaces 0.23.0` for Rust sandbox integration tests. Use stable releases only. |
| D-011 | Current local development funding fixture: project-deployed NEP-141 **Sandbox Dollar (SDD)** test token with 6 decimals, no market value, no redemption and no stablecoin claim. ADR-010 proposes NEAR testnet USDC (`usdc.tidepool-sandbox.testnet`) as the testnet deployment asset. That change is pending ADR-010 acceptance. The configured token contract remains an initialization parameter and is allowlisted in contract state. |
| D-012 | Escrow funding is exact-amount only through NEP-141 `ft_transfer_call`. The buyer and Riventa contract must satisfy the selected token's NEP-145 storage-registration requirements before funding; any direct NEP-141 payout recipient must also be registered where required. External deposit accounts must be checked before transfer. Project treasury pays applicable registration/storage costs. ADR-010 proposes the testnet asset change; its acceptance is pending. |
| D-013 | One contract owns all trade, inspector, dispute, document commitment and settlement records. No per-trade NEAR accounts. |
| D-014 | Contract storage is project-sponsored and bounded. Per-trade maximum: 4 required document types, 2 versions per type, 1 inspector replacement, 1 resolver replacement per dispute, 1 active dispute and 1 pending settlement. Inputs have explicit byte/length limits in the contract constants. |
| D-015 | A 2-of-3 multisig-controlled NEAR account is the contract administrator. Through exposed contract methods, it may register/suspend inspectors, pause new trade creation/funding and unpause. It cannot edit trade terms, resolve disputes, change participants, transfer allocated escrow or withdraw user funds. The multisig has no code-deployment authority after initial deployment. |
| D-016 | Emergency pause blocks `create_trade` and new `ft_on_transfer` funding only. It does not block document evidence, inspection, dispute, settlement, refund or callbacks for existing trades. Only the same 2-of-3 multisig may unpause. |
| D-017 | Settlement initiation is permissionless after authorization. Any caller may trigger payout/refund; recipient and amount are derived exclusively from stored contract state. |
| D-018 | All trades use all-or-nothing payout/refund. No partial payout, split recipient, multi-token or FX conversion. |

## Workflow, deadlines and dispute policy

| ID | Final decision |
|---|---|
| D-019 | Buyer creates trade; supplier accepts; resolver is proposed by buyer and accepted with the trade. Buyer, supplier, resolver and contract administrator must be distinct accounts. Resolver is immutable after acceptance except the narrowly defined mutually approved replacement during a dispute. |
| D-020 | Acceptance deadline: 7 days from creation. Funding deadline: 48 hours from supplier acceptance. If missed, buyer may cancel an unfunded trade; no token is due. No automatic financial transition occurs. |
| D-021 | No on-chain deadline is imposed for document upload, inspector assignment or inspection completion. UI reminders are advisory and cannot change escrow state. |
| D-022 | For a mandate-bound trade whose mandate explicitly authorizes release after a passing inspection, the agent may initiate release immediately after the passing attestation; no 72-hour buyer review period applies to this path. Otherwise, the existing explicit buyer-confirmation path remains. A passing attestation never automatically transfers funds. After a failed inspection, the agent may initiate refund only if the mandate explicitly authorizes it; otherwise only the buyer may choose refund or dispute. No automatic release/refund. |
| D-023 | Resolver response window: 5 days after dispute opens. Buyer and supplier may mutually replace the resolver at any time through a two-step proposal/approval. If no decision is recorded within 5 days, either party may initiate the replacement proposal; the other party must still approve. The replacement must be a new account distinct from buyer, supplier, inspector, old resolver and administrator. The replacement resolver receives a fresh 5-day decision window. No second replacement, admin unilateral replacement or automatic decision; if the replacement is not approved or the replacement resolver is unavailable, escrow remains locked. |
| D-024 | Both buyer and supplier may open a dispute in `Funded`, `DocumentReview` or `InspectionPending`. In `InspectionPassed`, either party may dispute before the trade enters `ReleaseAuthorized`; there is no mandatory 72-hour wait for a mandate-authorized immediate-release path. In `InspectionFailed`, the agent may initiate `RefundAuthorized` only when the mandate explicitly permits it; otherwise only buyer may choose `RefundAuthorized` or `Disputed`, with no expiry. No dispute can open after `ReleaseAuthorized`, `RefundAuthorized`, `PayoutPending`, `RefundPending`, `Completed` or `Refunded`. |
| D-025 | A failed inspection is not an automatic refund. Buyer must explicitly choose refund or dispute. These choices are mutually exclusive. |
| D-026 | Historical rule requiring explicit buyer `confirm_acceptance` after every passing inspection. Superseded for mandate-bound trades whose customer-signed mandate explicitly authorizes immediate release after a passing attestation. The explicit buyer-confirmation path remains when the mandate does not authorize immediate release. |
| D-027 | In a dispute, only the currently stored resolver may decide release or refund. Resolver decision is final under the encoded agreement; the contract cannot assess real-world correctness. Buyer and supplier attest in the agreement that they have no known conflict with the resolver. Resolver evidence is a 32-byte salted SHA-256 commitment to an encrypted off-chain dispute packet. One decision only; no on-chain appeal or admin override. |
| D-028 | Inspector can be replaced once, only by buyer, while `InspectionPending` and before any attestation. Replacement must be an active registered inspector and must be a different account from buyer, supplier, resolver and contract administrator. The previous assignment is permanently recorded as superseded. |

## Documents, privacy and AI

| ID | Final decision |
|---|---|
| D-029 | Raw documents and encryption keys remain off-chain. No document bytes, original filenames, extracted fields, AI reports, names of goods, invoice references or private evidence are written on-chain. The fixed document-type enum and version are public. |
| D-030 | Hackathon storage uses backend-managed AES-256-GCM envelope encryption at rest, TLS in transit, private local filesystem storage and a key supplied through environment configuration. This is **not end-to-end encryption**: authorized backend/AI workers can decrypt. |
| D-031 | AI processing is local-only through Ollama `0.40.11` with `qwen3:4b-instruct-2507-q4_K_M` (digest prefix `0edcdef34593`); no document content is sent to a hosted model provider. Deterministic extraction/validation/comparison is the source of structured findings; the local model may explain findings only. |
| D-032 | Document commitment: SHA-256 over a domain-separated, length-prefixed binary envelope containing trade ID, document type, version, SHA-256(file bytes) and a fresh 32-byte cryptographic nonce. Nonce and envelope metadata remain encrypted off-chain. |
| D-033 | The commitment proves correspondence to the committed bytes and metadata only. It does not prove issuer identity, authenticity, completeness, truth or lack of prior alteration. |
| D-034 | Access requires wallet-bound session, current on-chain participant/role check and short-lived trade-scoped grant. Buyer/supplier can access their trade documents; inspector can access only assigned inspection packet; resolver can access dispute packet only after dispute opens. |
| D-035 | Retention for demo: active trades retained; if a trade enters dispute, all trade documents and dispute evidence are deleted 180 days after resolution; otherwise files are deleted 30 days after Completed/Refunded. No backup service is provided; loss of the host volume or master key can permanently destroy off-chain files. On-chain records cannot be erased. Legal hold is not implemented in the hackathon prototype. |

## Application stack and operations

| ID | Final decision |
|---|---|
| D-036 | Backend: Node.js 26.13.0 LTS + TypeScript 5.9.3; Fastify 5.6.2 REST API; PostgreSQL 18.6 with `pg` 8.16.3 and SQL migrations; PostgreSQL job table for background work (no Redis/queue service). |
| D-037 | Frontend: Next.js 16.4.2 App Router + TypeScript 5.9.3. Customer and other participant transactions are signed by their respective wallets; backend never signs as or impersonates a participant. A separately authorized agent signs with its own NEAR account under ADR-009; it never uses a customer's private key. |
| D-038 | Local development storage: private filesystem volume managed by Docker Compose. No public object-store provider is integrated in the MVP. |
| D-039 | Indexer is idempotent and rebuildable; contract views are authoritative. Backend read models must reconcile against chain state. |
| D-040 | Wallet auth uses NEP-413 message signing for a single-use challenge bound to account ID, exact origin, nonce, audience, issue time and 5-minute expiry. Nonces are stored as consumed; sessions expire after 30 minutes of inactivity and are revoked on logout. |
| D-041 | Public repository; code license Apache-2.0, documentation CC-BY-4.0. Brand name remains a working name pending independent trademark/domain review. |
| D-042 | No real KYC/KYB, fiat, bank, logistics, issuer-verification or customs integration. Demo identities, trade and documents are synthetic; only testnet SDD is used. No antivirus product is included; file types are allowlisted and parsing is isolated. |

## Supplemental final decisions (continuation of the authoritative ledger)

| ID | Final decision |
|---|---|
| D-043 | PDF text extraction uses `pdfjs-dist 5.4.149`; scanned PDF/image OCR uses `tesseract.js 6.0.1` with English language data. OCR output is untrusted and requires human review. |
| D-044 | Historical local demo fixture: 10,000 SDD (raw NEP-141 amount `10000000000` at 6 decimals), with no market value. ADR-010 proposes a 10 USDC testnet trade amount (`10000000` raw units at 6 decimals). The proposed testnet amount does not take effect until ADR-010 is accepted. |
| D-045 | Contract deadlines use `env::block_timestamp()` in nanoseconds. A deadline is reached when `now >= deadline`. Funding after `fund_by` is rejected; acceptance after `accept_by` is rejected. Missed acceptance/funding deadlines do not auto-transition state; buyer must call cancellation. |
| D-046 | Resolver must be distinct from buyer, supplier, inspector, previous resolver and contract administrator. Both parties attest no known conflict with a replacement resolver when approving it. Buyer and supplier attest at agreement time that they have no known conflict of interest with the resolver. Contract does not verify subjective conflicts. Either party may propose a replacement during a dispute; the other party must approve. One resolver decision is final, with no appeal or admin override. |
| D-047 | Dispute evidence is an encrypted off-chain packet accessible to both parties and the resolver. `open_dispute` stores a 32-byte salted commitment to that packet; `resolve_dispute` stores a 32-byte commitment to the resolver's written decision/evidence. The contract stores outcome and commitments only. |
| D-048 | The trade contract is deployed using a temporary full-access deployer key. Immediately after deployment, initialization and code-hash verification, that key is removed and the contract account is left with no full-access key and no upgrade method. Contract code is immutable for that deployment. A code change requires a new contract account; state migration and escrow migration are not supported. The 2-of-3 admin multisig cannot redeploy code. |
| D-049 | Current fixed on-chain amount: 10,000 SDD (`10000000000` raw units); ADR-010 proposes replacing this with 10 USDC (`10000000` raw units) for the testnet MVP, pending acceptance. The remaining constraints continue: required document types use a fixed enum; terms contain only account IDs, fixed enums, timestamps and 32-byte commitments—no free-form commercial text. Each trade allows 4 document types and 2 versions/type. Off-chain file limit: 15 MiB; PDF limit: 20 pages; extracted text limit: 100,000 characters/file; accepted formats PDF, PNG and JPEG only. `ft_on_transfer.msg` is JSON containing only a `trade_id` and is limited to 64 bytes. |
| D-050 | Historical decision: **SealineFi** was selected as the product name with the tagline “Private Trade. Trusted Transactions.” This decision was superseded by D-051 / ADR-007 and is retained for audit history. |
| D-051 | Historical decision: **Aegis** was selected as the product name with the B2B tagline. This decision is superseded by D-052 / ADR-008 and retained for audit history. |

| D-052 | Product name is **Riventa**. Current tagline: **Confidential Trade Operations and Conditional Settlement for Businesses**. This naming-only decision is recorded in ADR-008 and supersedes D-051 / ADR-007; it does not change MVP behavior. The name remains subject to trademark/domain/legal clearance. |


## Autonomous business and delegated execution decisions (ADR-009)

| ID | Final decision |
|---|---|
| D-053 | Riventa is an autonomous trade-operations business. Its agent executes permitted workflows under customer-signed mandates. AI remains advisory; deterministic backend checks and NEAR contract authorization govern execution. This supersedes the AI-assisted product positioning in D-002. |
| D-054 | A customer mandate is created, updated and revoked only through a buyer-authorized transaction. It identifies the buyer, authorized agent, supplier policy, token, per-trade maximum, aggregate budget, permitted settlement outcomes, failure policy, expiry, revocation status and policy version. |
| D-055 | The agent acts through its own NEAR account. It never signs as the buyer or uses the buyer's private key. Agent-created trades store the mandate owner as buyer and bind the trade to the mandate and policy version. The supplier must still accept; the buyer must still fund escrow through the existing NEP-141 flow. |
| D-056 | The full trade amount is reserved atomically against the mandate aggregate budget at agent-created trade creation. Cancellation before successful funding releases the reservation. Successful funding consumes it. Failed funding does not consume it. A refund after successful funding does not automatically restore the budget. Concurrent reservations cannot exceed the aggregate limit. |
| D-057 | Revocation blocks new agent-created trades and new commitments. Funded trades continue under their recorded mandate snapshot and only its already-authorized operations. Accepted but unfunded trades receive no further agent-initiated actions after revocation; the buyer may fund directly or cancel. Cancellation releases the reservation. Authorized settlement remains subject to existing settlement and callback rules. |
| D-058 | For a mandate-bound trade, the agent may initiate release immediately after a passing inspection only if the mandate explicitly authorizes that outcome. No 72-hour buyer review period applies to this path. Either party may dispute while state is `InspectionPassed` and before `ReleaseAuthorized`. If immediate release is not authorized, the existing buyer-confirmation path remains. |
| D-059 | After failed inspection, the agent may initiate refund only if the mandate explicitly authorizes it. Otherwise the buyer retains the explicit refund-or-dispute choice. The agent cannot resolve disputes or override the independent resolver. |
| D-060 | Riventa service revenue, operating treasury, inference expenditure and revenue distribution are separate from customer trade escrow. No service fee is silently deducted from escrow. Any fee requires explicit disclosure and a separately authorized payment path. SDD demo values are not real revenue or profit. |
| D-061 | The AI model may interpret requests, recommend actions and explain findings, but cannot authorize transactions or alter mandates. Deterministic backend checks are supplementary; the NEAR contract independently enforces on-chain authorization. |
| D-062 | Current policy: NEAR Intents is an optional, separate payment integration, not the Riventa escrow mechanism and not a dependency for core mandate or escrow tests. ADR-010 proposes Tidepool as the initial testnet cross-chain settlement adapter, while retaining Riventa as the owner of customer escrow and authorization. The adapter selection is pending ADR-010 acceptance; core contract, mandate and escrow tests must remain independent of Tidepool. |

## Explicit pilot/production gates (not MVP design questions)

A real-world pilot is prohibited until legal counsel reviews the selected jurisdictions, payment/custody model, data protection, sanctions/KYB obligations and contract enforceability; brand clearance is completed; real inspectors and businesses are independently vetted; storage/AI operational security is reviewed; and the contract/application receive independent security audits. The MVP does not claim those conditions are satisfied.

## Change control
Any change to a decision requires a numbered ADR, a decision-register update, corresponding specification/diagram changes and tests. No implementation may silently reinterpret this baseline.
