# ADR-003: Document Encryption and Commitments

- Status: Accepted for hackathon MVP
- Date: 2026-11-01

## Decision
Raw files remain off-chain. Backend-managed AES-256-GCM envelope encryption is used; backend/authorized local AI workers can decrypt. No end-to-end encryption claim. SHA-256 domain-separated commitment binds trade ID, type, version, file digest and random nonce. Nonce stays encrypted off-chain. Local Ollama only; no hosted model provider.

## Rationale
This is implementable within the hackathon scope and honest about the backend trust boundary. Client-side E2E key distribution is deferred from the product, not left as an implementation uncertainty.
