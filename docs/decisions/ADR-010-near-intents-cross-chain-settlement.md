# ADR-010: NEAR Intents Cross-Chain Settlement

- **Status:** Proposed
- **Date:** 2026-11-04
- **Proposed supersession:** D-011, D-044 and the fixed-amount portion of D-049; proposed revision of D-012 and D-062. These changes take effect only when this ADR is accepted.
- **Related:** ADR-009, D-018, D-022, D-024, D-053, D-060, D-061

## 1. Context

Riventa is extending its trade escrow workflow to support cross-chain supplier settlement through NEAR Intents.

The initial integration target is Tidepool, a community-built testnet sandbox exposing a 1Click-compatible API. Tidepool is not an official NEAR or Defuse-operated service. Its test assets have no monetary value.

A dry quote successfully accepted the following route:

- Source asset: NEAR testnet USDC.
- Source asset ID: `nep141:usdc.tidepool-sandbox.testnet`.
- Destination network: Ethereum Sepolia.
- Destination asset ID: `nep141:eth-0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2.tp-omft.testnet`.
- Destination token contract: `0x2e6AD9E6D59bB4585ea0E6762c3b637dde29DAD2`.
- Destination decimals: 6.
- Source amount: 10 USDC (`10000000` raw units).

The successful dry quote returned an expected output of 9.974 USDC and a minimum output of 9.87426 USDC at 100 basis points slippage tolerance.

This demonstrates quote availability only. It does not demonstrate deposit, swap execution, destination delivery or refund execution. The quoted output is not a guaranteed supplier payment.

## 2. Decision

### 2.1 Funding and escrow asset

The testnet escrow asset will be Tidepool's NEAR testnet USDC:

`usdc.tidepool-sandbox.testnet`

The Riventa contract continues to receive funds through NEP-141 `ft_transfer_call`. The configured token contract remains an initialization parameter. The contract must not hardcode a deployment-specific token account.

The local SDD token remains available as a development and test fixture. It is not the intended testnet settlement asset and must not be described as a real stablecoin or as having monetary value.

Testnet deployment configuration must explicitly initialize Riventa with the selected NEAR testnet USDC contract account. Local use of SDD does not imply that the deployed testnet contract accepts SDD.

The contract must validate the configured token contract on every funding and refund-related token receipt. Token selection must not be inferred from a user-supplied transfer message.

NEP-145 storage registration remains mandatory wherever required by the selected token implementation:

- The buyer must be registered before funding.
- Riventa must be registered to receive tokens.
- The supplier must be registered before any direct NEP-141 payout, if that payout path is used.
- Any external Tidepool deposit account must satisfy the token's receiving-account requirements before Riventa transfers funds to it.

The backend must not assume that a generated deposit address is automatically registered. Registration requirements and the actual receiving-account semantics must be validated before any live testnet transfer.

Project treasury remains responsible for project-sponsored registration and storage costs under the applicable deployment configuration.

### 2.2 Trade amount and destination proceeds

The MVP trade source amount is fixed at 10 USDC:

- Raw amount: `10000000`.
- Decimals: 6.

The 10 USDC amount is the gross amount funded into NEAR escrow.

The supplier receives the actual net output delivered on Ethereum Sepolia after route execution. The supplier is not promised a fixed 10 USDC destination amount.

Every settlement quote must specify and be bound to:

- Source amount.
- Source asset.
- Expected destination amount.
- Minimum destination amount.
- Slippage tolerance.
- Destination asset and network.
- Supplier destination address.
- Quote expiry/deadline.
- Tidepool quote signature.
- Relevant quote or execution identifier.

The contract/backend must reject a quote whose source amount differs from the trade's escrowed amount or whose minimum output is below the trade's agreed minimum. An expired, malformed or mismatched quote cannot authorize a deposit.

The cross-chain route represents delivery of the selected USDC test asset across networks, not an FX conversion. The MVP remains all-or-nothing:

- One authorized source amount.
- One supplier recipient.
- One verified destination delivery.
- No partial supplier payout.
- No split recipient.
- No silent service-fee deduction.

A destination amount below the authorized minimum is not an acceptable partial settlement. It must enter a failure or reconciliation path.

Riventa service revenue remains separate from customer escrow. Any service fee requires explicit disclosure and a separately authorized payment path.

### 2.3 Destination network and asset

The external destination for this MVP is Ethereum Sepolia, not Base Sepolia.

The destination asset is the Ethereum Sepolia USDC test asset listed by Tidepool. It must be identified by Tidepool's exact asset ID. It must not be represented as Circle's official USDC contract unless independently verified.

Destination asset ID:

`nep141:eth-0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2.tp-omft.testnet`

Destination token contract:

`0x2e6AD9E6D59bB4585ea0E6762c3b637dde29DAD2`

Ethereum Sepolia chain ID: `11155111`.

The destination recipient must be a validated Ethereum address supplied and authorized for the trade. Placeholder addresses are permitted only in dry-run tests.

The destination asset, network and recipient must be immutable for the lifetime of an authorized settlement execution.

### 2.4 Intents integration boundary

The Riventa NEAR contract remains the owner of customer escrow and trade authorization.

Tidepool is the initial external testnet adapter. The backend is responsible for:

1. Requesting a fresh Tidepool quote.
2. Validating quote fields against the trade and mandate snapshot.
3. Coordinating the authorized source-chain deposit.
4. Monitoring Tidepool order status.
5. Obtaining the Ethereum Sepolia transaction reference.
6. Independently verifying the destination transaction and recipient delivery.
7. Submitting a settlement attestation to the Riventa contract.

The contract must not call Tidepool HTTP endpoints directly.

The backend must not have authority to change trade terms, recipient, token, amount or mandate permissions. Its settlement role is limited to executing and reporting an already-authorized operation.

The integration must distinguish between:

- `ORIGIN_CHAIN`: assets are transferred to the quote's source-chain deposit address.
- `INTENTS`: assets are already held in the NEAR Intents verifier account.

For Riventa's escrow-funded source transfer, `ORIGIN_CHAIN` is the intended deposit type. The implementation must not use `INTENTS` unless the funding architecture is explicitly changed and separately reviewed.

A dry quote is not an executable deposit instruction. A live quote must be obtained and validated immediately before the corresponding source transfer.

### 2.5 Settlement verification and trust

A Tidepool status response or backend assertion alone is not cryptographic proof of supplier receipt.

For the testnet MVP, an explicitly authorized settlement reporter may submit an attestation after independently checking the Ethereum Sepolia transaction receipt and actual destination token transfer.

The backend verifier must check at least:

- Expected Ethereum Sepolia chain ID.
- Successful transaction receipt.
- Expected destination token contract.
- A valid token `Transfer` event.
- Expected supplier recipient.
- Delivered token amount.
- Minimum authorized output.
- Transaction finality/confirmation policy.
- Binding to the corresponding Riventa trade and settlement execution.

The contract must record at least:

- Trade ID.
- Unique settlement execution ID.
- Source amount and source asset.
- Destination asset and network.
- Destination recipient.
- Minimum and expected output.
- Destination transaction hash.
- Verified destination amount.
- Attesting reporter.
- Attestation timestamp.

Duplicate execution IDs and duplicate destination transaction hashes must be rejected.

The reporter is a trusted oracle in this MVP. This trust assumption must be visible in the security documentation. It must not be described as trustless cross-chain verification.

The reporter's authority must be explicitly configured and restricted. It must not be equivalent to unrestricted administrative authority over customer escrow.

### 2.6 Asynchronous execution

Cross-chain settlement is asynchronous. The contract and backend must distinguish at least the following operational stages:

- Settlement authorized.
- Source token transfer pending.
- Source token transfer successful.
- External execution pending.
- Destination delivery verified.
- Refund pending.
- Refunded.
- Failed or reconciliation required.

The contract must not mark a trade `Completed` merely because it transferred tokens to a Tidepool deposit address or received a successful Tidepool API status.

A failed source transfer must not consume escrow. A destination settlement must not be marked complete before destination delivery is independently verified and the required attestation is accepted.

An ambiguous Tidepool status, missing transaction hash, reverted destination transaction or amount below the authorized minimum must enter reconciliation. It must not trigger an automatic supplier payout or buyer refund.

### 2.7 Refunds

The intended refund route is back to the Riventa NEAR escrow account, followed by an authorized refund to the buyer.

The buyer must not be refunded merely because the backend reports that an external swap failed. The source-side refund must first be received and reconciled by Riventa.

The contract must bind any returned funds to the relevant settlement execution and reject unrelated or duplicate refund claims.

A refund receipt must be distinguishable from ordinary buyer funding. The implementation must not allow an arbitrary NEP-141 transfer or user-supplied `ft_on_transfer` message to create a valid refund claim.

The exact Tidepool refund mechanics, deposit-address token registration requirements and source-side refund behavior must be validated before live testnet funds are used.

If the source-side return cannot be verified, the trade must remain in a failed or reconciliation state. The backend must not fabricate a refund receipt or mark the trade refunded.

### 2.8 Mandate and agent authorization

ADR-009 remains the governing policy for customer mandates and agent execution.

The following rules continue to apply:

- The buyer creates and controls the mandate.
- The agent is distinct from the buyer.
- The buyer remains the trade buyer and funds escrow.
- The agent cannot move buyer funds directly.
- A trade must be bound to an immutable mandate snapshot.
- The full trade amount is reserved against the mandate budget when an agent creates the trade.
- The reservation is released if the trade is cancelled before funding.
- Successful funding converts the reservation into consumed budget.
- A refund does not restore consumed budget.
- Revocation prevents new agent-created trades and new agent commitments.
- An already-funded trade continues under its recorded mandate snapshot and previously authorized actions.
- AI-generated analysis cannot authorize a settlement, alter a mandate or bypass contract enforcement.

A passing inspection may permit an agent to authorize immediate release only when the mandate snapshot explicitly permits that outcome. A failed inspection may permit an agent refund only when the mandate snapshot explicitly permits it.

The settlement reporter's role is separate from the agent's authorization role. The reporter verifies and attests to external delivery; it cannot independently grant settlement permission.

### 2.9 Testnet-only scope

This ADR authorizes testnet integration only.

- NEAR testnet is the source and escrow network.
- Ethereum Sepolia is the destination network.
- Tidepool is the initial testnet Intents adapter.
- All assets are valueless test assets.
- No mainnet deployment or production settlement is authorized by this ADR.

Tidepool's service availability, maker, quote signer, deposit-address custody, bridge operators and refund worker are external trust dependencies.

The testnet integration must be designed so that the core contract unit tests, mandate tests and escrow tests remain runnable without a live Tidepool service.

## 3. Security requirements

1. Customer escrow remains controlled by the Riventa contract until an authorized settlement operation begins.
2. Every settlement is bound to a specific trade, mandate snapshot, source amount, source asset, destination asset, recipient, quote and expiry.
3. The agent cannot alter the supplier, destination address, amount or settlement permissions after mandate authorization.
4. The contract prevents duplicate execution and replayed settlement attestations.
5. The backend verifies the Ethereum Sepolia transaction receipt and actual token transfer, not merely an API status label.
6. The delivered amount meets or exceeds the authorized minimum output.
7. A failed or ambiguous external operation enters reconciliation; it cannot silently complete or refund.
8. All settlement and refund transitions emit auditable events.
9. AI-generated document analysis remains advisory and cannot authorize settlement.
10. No service fee is deducted from customer escrow without a separately authorized and disclosed payment path.
11. NEP-141 storage registration is verified for all receiving accounts before transfers.
12. Refund receipts are bound to an existing settlement execution and cannot be fabricated through ordinary funding messages.
13. The settlement reporter has narrowly scoped authority and cannot bypass mandate or trade authorization.
14. Cross-chain delivery is not described as trustless while an off-chain reporter is required.
15. Tidepool credentials, account secrets and signing keys are never exposed in frontend code or logs.

## 4. Consequences

- Existing SDD test fixtures can remain for local development and tests.
- Testnet deployment configuration must use NEAR testnet USDC.
- The fixed funding amount changes from 10,000 SDD (`10000000000`) to 10 USDC (`10000000`).
- D-012's NEP-145 registration and project-sponsored storage requirements remain applicable.
- D-018's all-or-nothing settlement rule remains applicable; cross-network delivery does not introduce partial payout or split recipients.
- D-049's fixed 10,000 SDD amount is superseded if this ADR is accepted. Its document limits, required document types and transfer-message size constraints remain unless separately changed.
- The contract requires outbound NEP-141 transfer handling and asynchronous callbacks.
- The contract requires explicit settlement authorization, execution tracking, reporter authorization and replay protection.
- The refund path requires source-side receipt reconciliation before buyer refund.
- The backend requires a Tidepool adapter and Ethereum Sepolia receipt verifier.
- The settlement reporter is an explicit trust assumption until a stronger verification mechanism is implemented.
- Core mandate and escrow tests remain independent of live Tidepool availability.
- The project must not claim that the testnet assets represent redeemable or economically valuable USDC.

## 5. Acceptance criteria

This ADR is implemented only when:

1. Local funding tests pass using a six-decimal NEP-141 fixture and the 10 USDC raw amount (`10000000`).
2. The local SDD fixture and testnet USDC deployment configuration are clearly separated.
3. A mandate-bound trade can authorize only its permitted settlement outcome.
4. Settlement authorization is bound to the trade, mandate snapshot, source amount, source asset, destination asset, recipient, minimum output and expiry.
5. An expired, mismatched, malformed or below-minimum quote cannot be executed.
6. Source transfer failure leaves customer escrow accounted for and recoverable.
7. Duplicate settlement execution IDs and destination transaction hashes are rejected.
8. The backend verifies an Ethereum Sepolia transaction receipt and actual destination token transfer.
9. The verified destination recipient and amount match the authorized settlement.
10. The contract cannot mark a trade complete before verified destination delivery is attested by an authorized reporter.
11. Refunds require actual source-side funds to return and be reconciled.
12. Unrelated token transfers cannot be mistaken for settlement refunds.
13. NEP-145 registration requirements are checked before source transfers.
14. Testnet documentation identifies Tidepool, bridge operators and the settlement reporter as trust dependencies.
15. Core contract, mandate and escrow tests pass without a live Tidepool API.

## 6. Implementation sequence

Implementation must proceed in the following order:

1. Reconcile and update the decision register after ADR-010 is accepted.
2. Update the contract funding amount and test fixtures while preserving the configured token-account model.
3. Implement mandate-bound settlement authorization and immutable settlement execution records.
4. Implement reporter authorization and replay protection.
5. Implement outbound NEP-141 transfer handling and asynchronous callback state transitions.
6. Implement source-side refund receipt reconciliation and buyer refund authorization.
7. Implement the backend Tidepool quote and execution adapter.
8. Implement independent Ethereum Sepolia transaction and token-transfer verification.
9. Add adversarial contract and backend tests for expiry, replay, wrong recipient, wrong token, insufficient output, failed transfer, ambiguous status and refund mismatch.
10. Perform a complete testnet rehearsal using valueless test assets before considering any broader deployment.

No live deposit or settlement is authorized merely by accepting this ADR. The deposit and refund paths must first pass the implementation and test gates above.
