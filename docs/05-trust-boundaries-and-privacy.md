# 5. Trust Boundaries and Privacy

## Public-chain exposure
NEAR exposes contract account, caller accounts, method names, trade IDs, token amounts, status transitions, timestamps and commitment values. Users must not treat trade metadata as private. No original filenames, raw contents, extracted fields, commercial descriptions, evidence URLs or AI reports are stored on-chain. The fixed document-type enum and version are public.

## Encryption
MVP uses TLS in transit and backend-managed AES-256-GCM envelope encryption at rest. Each object receives a fresh 256-bit data-encryption key and 96-bit nonce; the DEK is wrapped by an application master key supplied through environment configuration. Authentication tags are verified on every decrypt. Master keys are never stored in PostgreSQL or source control. Key rotation is not supported in the hackathon build; replacing the master key requires decrypting and re-encrypting every retained object before the old key is retired.

This is server-side encryption, not end-to-end encryption. Authorized backend workers can decrypt documents for processing. The local AI worker runs on the same trusted deployment boundary; document contents are not sent to a hosted model provider. Production must replace environment-key handling with managed KMS/HSM and undergo a separate key-management review.

## Access policy
Buyer and supplier can access trade documents. Inspector receives access only to the assigned inspection packet while assigned. Resolver receives access to dispute evidence only after a dispute opens. Backend checks current on-chain role/state before issuing a short-lived, single-object grant (maximum 5 minutes). Grants are not reusable across objects or trades. Every access is audit logged without logging content or secrets.


## Agent and mandate trust boundary

The customer signs the mandate through the customer's own wallet. The mandate is stored and enforced by the NEAR contract. The agent uses a separate NEAR account and never receives or uses the customer's private key.

The contract is authoritative for mandate ownership, agent identity, expiry, revocation, supplier/token/amount constraints, aggregate budget reservation, trade-to-mandate binding and permitted settlement outcomes. Backend policy checks are defense in depth, not financial authority. An LLM response, backend database row or frontend state cannot authorize a contract transition.

A trade records the mandate identifier and policy version that authorized its creation. Later mandate updates do not silently rewrite that trade's snapshot. Revocation prevents new agent-created trades. Funded trades continue only under the operations already authorized by their recorded snapshot. Accepted but unfunded trades receive no further agent-initiated actions after revocation; the buyer may fund directly or cancel.

## Financial segregation

Customer trade escrow is a contract liability and is not Riventa operating revenue or treasury balance. Riventa service revenue, operating treasury, inference expenditure and revenue distribution are accounted for separately. No fee is silently deducted from customer escrow. Any fee requires explicit disclosure and a separately authorized payment path.

The agent may operate Riventa's own treasury only under a separate operating policy and authorization. Customer trade mandates do not authorize spending customer escrow for operating expenses. SDD is a valueless test token; synthetic accounting entries and test-token transfers must not be presented as real revenue or profit.

## Agent execution limits

The agent may submit only contract methods permitted by an active mandate or by the recorded policy snapshot of an already-funded trade. It cannot change accepted terms, change participants, submit inspector attestations, decide disputes, bypass a failed policy check or redirect settlement recipients. The NEAR contract independently checks all financial authorization conditions.

## Commitment format
`file_digest = SHA256(raw_file_bytes)`.
`commitment = SHA256(UTF8("RIVENTA-DOC-V1") || 0x00 || trade_id_u64_be || type_len_u16_be || type_utf8 || version_u32_be || file_digest || nonce_32)`.
Type is a lowercase ASCII enum; nonce is 32 random bytes from a cryptographic RNG. All integer encodings are unsigned big-endian. Commitment is lowercase hex in API and `[u8;32]` on-chain. Nonce and mapping metadata are stored only in encrypted private metadata.

## Retention
Active trade files remain available to authorized roles. For a trade that enters dispute, all trade documents and dispute evidence are retained 180 days after resolution. For a trade that never enters dispute, files are deleted 30 days after Completed or Refunded. No backup service is operated; loss of the host volume or master key can permanently destroy off-chain files. Public-chain records remain immutable. Demo deployment does not implement legal hold or user-requested chain erasure.

## Limits
Hash commitments prove byte/metadata consistency only. They do not prove issuer authenticity, document truth, completeness or physical delivery. Wallet authentication proves control of an account, not legal identity or KYB. Privacy does not mean anonymity.
