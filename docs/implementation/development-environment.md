# Development Environment

## Pinned baseline
- Rust stable 1.99.1.
- `near-sdk` and `near-contract-standards` 5.29.1, pinned to the stable NEAR 2.13 protocol/tooling line. Do not upgrade to SDK 5.30.0 until the matching NEAR 2.14 runtime is stable.
- `near-cli-rs` 0.30.1; `cargo-near` 0.22.0; NEAR sandbox 2.13.4; `near-workspaces` 0.23.0 for Rust sandbox integration tests.
- Node.js 26.13.0 LTS; TypeScript 5.9.3; Next.js 16.4.2 App Router; Fastify 5.6.2; `pg` 8.16.3; `pdfjs-dist` 5.4.149; `tesseract.js` 6.0.1; npm workspaces.
- PostgreSQL 18.6; Docker Compose; Ollama 0.40.11 with `qwen3:4b-instruct-2507-q4_K_M` (digest prefix `0edcdef34593`).

Commit Rust `Cargo.lock`, root `package-lock.json`, `.nvmrc` set to `26.13.0`, `rust-toolchain.toml` set to `1.99.1`, Docker image digests and CI build scripts. The selected application/runtime versions are fixed by the decision register. No floating `latest` tags. Build and test contract with NEAR sandbox before testnet deployment.

Never commit `.env`, seed phrases, private keys, encryption master key or real documents. Use synthetic fixtures only.
