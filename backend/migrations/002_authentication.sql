BEGIN;

-- Short-lived, single-use NEP-413 login challenges.
CREATE TABLE auth_challenges (
    id UUID PRIMARY KEY,
    network TEXT NOT NULL,
    account_id TEXT NOT NULL,
    message TEXT NOT NULL,
    nonce BYTEA NOT NULL UNIQUE CHECK (octet_length(nonce) = 32),
    recipient TEXT NOT NULL,
    state TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_challenges_expiry_idx
    ON auth_challenges (expires_at);

CREATE INDEX auth_challenges_account_idx
    ON auth_challenges (network, account_id, created_at DESC);

-- Store only SHA-256 hashes of opaque session tokens.
CREATE TABLE auth_sessions (
    token_hash BYTEA PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    network TEXT NOT NULL,
    account_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_sessions_account_idx
    ON auth_sessions (network, account_id, created_at DESC);

CREATE INDEX auth_sessions_expiry_idx
    ON auth_sessions (expires_at);

INSERT INTO schema_migrations (version)
VALUES ('002_authentication');

COMMIT;
