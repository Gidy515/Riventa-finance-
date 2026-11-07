# 12. MVP Scope and Roadmap

## Objective
Demonstrate an autonomous Riventa trade-operations workflow using a customer-signed mandate: agent-created trade, supplier acceptance, buyer-funded escrow, private documents, explainable anomaly detection, independent inspection attestation and mandate-authorized conditional settlement. Also demonstrate budget enforcement and separation of customer escrow from Riventa's synthetic operating ledger.

## Demo script
1. Buyer creates and signs a mandate authorizing the Riventa agent for the synthetic cocoa trade, with an approved supplier, SDD token, per-trade cap, aggregate budget and settlement policy.
2. Agent creates the trade for 1,000 kg bagged cocoa beans from Tema to Lagos. The contract reserves mandate budget and records the buyer as mandate owner.
3. Supplier accepts; buyer funds the exact SDD amount.
4. Supplier uploads invoice, packing list and certificate of origin; files are encrypted off-chain and commitments recorded on-chain.
5. Seed one controlled mismatch between invoice and packing list (e.g. quantity discrepancy); deterministic engine flags it with source/page evidence; local model explains it.
6. Buyer assigns registered inspector; inspector submits pass or fail and report commitment.
7. On pass, show the agent initiating immediate release under the mandate. Demonstrate that either party can dispute before `ReleaseAuthorized`. On fail, show agent refund only when the mandate authorizes it; otherwise show the buyer's refund/dispute choice.
8. If disputed, show resolver decision and (if timeout scenario) mutual resolver replacement.
9. Trigger payout/refund; demonstrate success and failed-transfer retry preserving liability.
10. Demonstrate a rejected out-of-policy agent action and a budget-limit rejection.
11. Show mandate revocation blocking new trades while an already-funded trade continues under its recorded policy snapshot.
12. Show customer escrow separately from Riventa's clearly labelled synthetic operating ledger. Verify explorer events and UI against contract views; show no raw documents or AI report on-chain.

## Build order
1. Contract types, storage, transition logic and invariant tests.
2. Mock NEP-141 integration and NEAR sandbox tests for `ft_transfer_call`, resolver behavior and async transfer callbacks.
3. Backend wallet challenge, private file storage, encryption, upload grants and indexer.
4. Deterministic document extraction/comparison; Ollama explanation adapter.
5. Frontend buyer/supplier/inspector/resolver flows.
6. Full E2E, adversarial review, testnet deploy and demo rehearsal.

## Exclusions
Mainnet, real funds, real shipments, production KYB/KYC, partial/multi-token settlement, FX, lending, external banking/logistics/issuer verification, ZK proof system, legal automation, unrestricted customer-wallet delegation, LLM-authorized transactions and commercial launch. NEAR Intents is not required for the core testnet demo.

## Definition of done
All documented state transitions, mandate checks, agent authorization rules, budget reservations, revocation behavior and settlement conditions pass unit and sandbox tests; asynchronous settlement failure is tested; access control and encryption are tested; the demo works on testnet using SDD; customer escrow is demonstrably separate from Riventa's synthetic operating ledger; docs and diagrams match code; limitations are shown to reviewers.
