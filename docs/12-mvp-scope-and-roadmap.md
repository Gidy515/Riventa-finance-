# 12. MVP Scope and Roadmap

## Objective
Demonstrate one complete fictional cocoa-trade workflow with private documents, explainable anomaly detection, independent inspection attestation and conditional NEAR test-token settlement.

## Demo script
1. Buyer creates trade for 1,000 kg bagged cocoa beans from Tema to Lagos; supplier and resolver accounts are fixed.
2. Supplier accepts; buyer funds exact SDD amount.
3. Supplier uploads invoice, packing list and certificate of origin; files are encrypted off-chain and commitments recorded on-chain.
4. Seed one controlled mismatch between invoice and packing list (e.g. quantity discrepancy); deterministic engine flags it with source/page evidence; local model explains it.
5. Buyer assigns registered inspector; inspector submits pass or fail and report commitment.
6. Show buyer confirmation after pass, or buyer refund/dispute choice after fail.
7. If disputed, show resolver decision and (if timeout scenario) mutual resolver replacement.
8. Trigger payout/refund; demonstrate success and failed-transfer retry preserving liability.
9. Verify explorer events and UI against contract views; show no raw documents or AI report on-chain.

## Build order
1. Contract types, storage, transition logic and invariant tests.
2. Mock NEP-141 integration and NEAR sandbox tests for `ft_transfer_call`, resolver behavior and async transfer callbacks.
3. Backend wallet challenge, private file storage, encryption, upload grants and indexer.
4. Deterministic document extraction/comparison; Ollama explanation adapter.
5. Frontend buyer/supplier/inspector/resolver flows.
6. Full E2E, adversarial review, testnet deploy and demo rehearsal.

## Exclusions
Mainnet, real funds, real shipments, production KYB/KYC, partial/multi-token settlement, FX, lending, external banking/logistics/issuer verification, ZK proof system, legal automation and commercial launch.

## Definition of done
All documented state transitions and authorization rules pass unit and sandbox tests; asynchronous settlement failure is tested; access control and encryption are tested; demo scenario works on testnet using SDD; docs and diagrams match code; limitations are shown to reviewers.
