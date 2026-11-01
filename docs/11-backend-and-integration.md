# 11. Backend and Integration

## Stack
Node.js 26.13.0 LTS, TypeScript 5.9.3, Fastify 5.6.2 REST API plus PostgreSQL-backed worker, PostgreSQL 18.6 with `pg` 8.16.3, private local filesystem object storage, NEAR RPC and local Ollama 0.40.11 (`qwen3:4b-instruct-2507-q4_K_M`, digest prefix `0edcdef34593`). Next.js 16.4.2 frontend is a separate package. Use npm workspaces and committed lockfile.

## Responsibilities
Wallet challenge/session, role-scoped access grants, encryption/decryption, file validation, OCR/extraction, deterministic comparisons, local AI explanations, event indexing/reconciliation, notifications and audit logs.

## Authentication
Challenge binds account ID, exact application origin, random 32-byte nonce, audience `riventa-web`, issue time and 5-minute expiry. Wallet signs the exact challenge using NEP-413 message signing. Verify the NEP-413 payload/signature and account key against NEAR account state. Nonce is single-use. Session expires after 30 minutes inactivity. Wallet control is not legal identity.

## API
`POST /auth/challenge`, `POST /auth/verify`, `POST /auth/logout`, `POST /trades/:id/documents/upload-intent`, `POST /trades/:id/documents/:docId/complete`, `GET /trades/:id/documents`, `GET /trades/:id/ai-reports`, `GET /trades/:id/activity`, `GET /health`.

Financial state changes are wallet-signed contract calls. Backend may prepare unsigned transaction payloads but never signs as a user or holds participant keys.

## Indexing
Consume NEP-297 events and query contract views. Process idempotently with transaction/receipt identity; persist block height/hash; support replay/backfill; reconcile all trade/settlement views. If indexer lag exceeds 2 minutes, mark data stale and query contract directly before granting access or displaying finality.

## Integrations
No external issuer, logistics, bank, customs, payment rail or hosted AI integration in MVP. All external parties are represented by demo users. No real KYB/KYC.

## Observability
Track auth failures, access grants, upload/parser failures, AI job status, RPC/indexer lag, settlement pending duration, callback failures and database/storage health. Never log document contents, encryption keys, nonce, signed URL or wallet signature.
