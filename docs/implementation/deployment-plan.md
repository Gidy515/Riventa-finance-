# Deployment Plan

1. Local: Docker Compose for PostgreSQL 18.6 and private storage volume; local NEAR sandbox; local Ollama.
2. CI: reproducible contract WASM build, Rust/Node lockfiles, tests and secret scan.
3. Testnet: deploy SDD token and trade contract; initialize and verify code hash; record account IDs, code hashes and transaction hashes; configure 2-of-3 admin multisig; register contract and supplier token storage as required; remove the temporary deployer full-access key and verify the contract account has no full-access key.
4. App: deploy backend with test-only encryption key, private filesystem volume, PostgreSQL and local model runtime; deploy frontend with testnet wallet config.
5. Rehearse all success/failure paths and verify contract views against UI/indexer.

No mainnet or production deployment. Production requires independent contract audit, backend/application security review, KMS/HSM key-management design, privacy review, legal/regulatory assessment, incident runbooks, monitoring and explicit release approval.
