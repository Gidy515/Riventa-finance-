BEGIN;

CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable, idempotently indexed NEAR contract events.
CREATE TABLE chain_events (
    id BIGSERIAL PRIMARY KEY,
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    block_height NUMERIC(20,0) NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    log_index INTEGER NOT NULL CHECK (log_index >= 0),
    block_timestamp_ns NUMERIC(20,0),
    standard TEXT NOT NULL,
    event_version TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_data JSONB NOT NULL,
    raw_log TEXT NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (network, contract_id, receipt_id, log_index)
);

CREATE INDEX chain_events_block_idx
    ON chain_events (network, contract_id, block_height);

CREATE INDEX chain_events_name_idx
    ON chain_events (event_name, block_height);

CREATE INDEX chain_events_transaction_idx
    ON chain_events (transaction_hash);

-- Current mandate projection, refreshed from verified contract state.
CREATE TABLE mandates (
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    mandate_id NUMERIC(20,0) NOT NULL,
    buyer_account TEXT NOT NULL,
    agent_account TEXT NOT NULL,
    supplier_account TEXT NOT NULL,
    resolver_account TEXT NOT NULL,
    payment_token TEXT NOT NULL,
    max_trade_amount_raw NUMERIC(78,0) NOT NULL,
    aggregate_budget_raw NUMERIC(78,0) NOT NULL,
    reserved_budget_raw NUMERIC(78,0) NOT NULL,
    consumed_budget_raw NUMERIC(78,0) NOT NULL,
    allow_release_after_pass BOOLEAN NOT NULL,
    allow_refund_after_fail BOOLEAN NOT NULL,
    expires_at_ns NUMERIC(20,0) NOT NULL,
    revoked BOOLEAN NOT NULL,
    version NUMERIC(20,0) NOT NULL,
    observed_block_height NUMERIC(20,0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (network, contract_id, mandate_id),

    CHECK (max_trade_amount_raw >= 0),
    CHECK (aggregate_budget_raw >= 0),
    CHECK (reserved_budget_raw >= 0),
    CHECK (consumed_budget_raw >= 0)
);

CREATE INDEX mandates_buyer_idx
    ON mandates (network, buyer_account);

CREATE INDEX mandates_agent_idx
    ON mandates (network, agent_account);

-- Current trade projection.
CREATE TABLE trades (
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    trade_id NUMERIC(20,0) NOT NULL,
    buyer_account TEXT NOT NULL,
    supplier_account TEXT NOT NULL,
    resolver_account TEXT NOT NULL,
    payment_token TEXT NOT NULL,
    amount_raw NUMERIC(78,0) NOT NULL CHECK (amount_raw > 0),
    state TEXT NOT NULL,
    created_at_ns NUMERIC(20,0) NOT NULL,
    accept_by_ns NUMERIC(20,0) NOT NULL,
    fund_by_ns NUMERIC(20,0),
    funded_at_ns NUMERIC(20,0),
    documents_completed_at_ns NUMERIC(20,0),
    inspector_assigned_at_ns NUMERIC(20,0),
    observed_block_height NUMERIC(20,0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (network, contract_id, trade_id)
);

CREATE INDEX trades_buyer_idx
    ON trades (network, buyer_account, created_at_ns DESC);

CREATE INDEX trades_supplier_idx
    ON trades (network, supplier_account, created_at_ns DESC);

CREATE INDEX trades_state_idx
    ON trades (network, state, created_at_ns DESC);

-- Immutable mandate rules captured when an agent creates a trade.
CREATE TABLE trade_policy_snapshots (
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    trade_id NUMERIC(20,0) NOT NULL,
    mandate_id NUMERIC(20,0) NOT NULL,
    mandate_version NUMERIC(20,0) NOT NULL,
    buyer_account TEXT NOT NULL,
    agent_account TEXT NOT NULL,
    supplier_account TEXT NOT NULL,
    resolver_account TEXT NOT NULL,
    payment_token TEXT NOT NULL,
    amount_raw NUMERIC(78,0) NOT NULL,
    allow_release_after_pass BOOLEAN NOT NULL,
    allow_refund_after_fail BOOLEAN NOT NULL,
    mandate_expires_at_ns NUMERIC(20,0) NOT NULL,
    observed_block_height NUMERIC(20,0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (network, contract_id, trade_id),

    FOREIGN KEY (network, contract_id, trade_id)
        REFERENCES trades (network, contract_id, trade_id)
);

-- On-chain commitments plus metadata for privately stored documents.
-- Document bytes must never be stored in this table.
CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    trade_id NUMERIC(20,0) NOT NULL,
    document_type TEXT NOT NULL CHECK (
        document_type IN (
            'commercial_invoice',
            'packing_list',
            'certificate_of_origin'
        )
    ),
    version SMALLINT NOT NULL CHECK (version BETWEEN 1 AND 255),
    commitment BYTEA NOT NULL CHECK (OCTET_LENGTH(commitment) = 32),
    submitted_by TEXT NOT NULL,
    submitted_at_ns NUMERIC(20,0) NOT NULL,

    storage_provider TEXT,
    storage_key TEXT,
    original_filename TEXT,
    content_type TEXT,
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    encryption_metadata JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (network, contract_id, trade_id, document_type, version),

    FOREIGN KEY (network, contract_id, trade_id)
        REFERENCES trades (network, contract_id, trade_id)
);

CREATE INDEX documents_trade_idx
    ON documents (network, contract_id, trade_id);

-- AI output is advisory and never authorizes settlement.
CREATE TABLE ai_reports (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents(id),
    model_name TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'failed')
    ),
    risk_level TEXT CHECK (
        risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'unknown')
    ),
    summary TEXT,
    findings JSONB,
    confidence NUMERIC(5,4) CHECK (
        confidence IS NULL OR confidence BETWEEN 0 AND 1
    ),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_reports_document_idx
    ON ai_reports (document_id, created_at DESC);

-- Current inspector assignment and attestation projection.
CREATE TABLE inspection_projection (
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    trade_id NUMERIC(20,0) NOT NULL,
    assigned_inspector TEXT NOT NULL,
    replacement_count SMALLINT NOT NULL DEFAULT 0
        CHECK (replacement_count >= 0),
    outcome TEXT CHECK (
        outcome IS NULL OR outcome IN ('pass', 'fail')
    ),
    attesting_inspector TEXT,
    evidence_commitment BYTEA CHECK (
        evidence_commitment IS NULL OR OCTET_LENGTH(evidence_commitment) = 32
    ),
    submitted_at_ns NUMERIC(20,0),
    observed_block_height NUMERIC(20,0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (network, contract_id, trade_id),

    FOREIGN KEY (network, contract_id, trade_id)
        REFERENCES trades (network, contract_id, trade_id)
);

-- Settlement projection. Authorization and transfer events are separate:
-- settlement_id is not known until settlement_initiated is emitted.
CREATE TABLE settlement_projection (
    id BIGSERIAL PRIMARY KEY,
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    trade_id NUMERIC(20,0) NOT NULL,
    settlement_id NUMERIC(20,0),

    kind TEXT CHECK (kind IS NULL OR kind IN ('payout', 'refund')),
    reason TEXT CHECK (
        reason IS NULL OR reason IN (
            'standard',
            'supplier_documents_timeout',
            'inspector_assignment_timeout',
            'inspection_timeout'
        )
    ),
    status TEXT NOT NULL CHECK (
        status IN ('authorized', 'initiated', 'succeeded', 'failed')
    ),

    authorization_source TEXT CHECK (
        authorization_source IS NULL OR authorization_source IN ('buyer', 'mandate')
    ),
    authorized_by TEXT,
    recipient_account TEXT,
    amount_raw NUMERIC(78,0) CHECK (
        amount_raw IS NULL OR amount_raw >= 0
    ),

    initiated_at_ns NUMERIC(20,0),
    completed_at_ns NUMERIC(20,0),
    transfer_result TEXT CHECK (
        transfer_result IS NULL OR transfer_result IN ('succeeded', 'failed')
    ),

    observed_block_height NUMERIC(20,0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (network, contract_id, trade_id)
        REFERENCES trades (network, contract_id, trade_id)
);

CREATE UNIQUE INDEX settlement_chain_id_unique
    ON settlement_projection (network, contract_id, settlement_id)
    WHERE settlement_id IS NOT NULL;

CREATE INDEX settlement_trade_idx
    ON settlement_projection (network, contract_id, trade_id);

-- Human-readable timeline derived from verified contract events.
CREATE TABLE activity_log (
    id BIGSERIAL PRIMARY KEY,
    chain_event_id BIGINT NOT NULL UNIQUE REFERENCES chain_events(id),
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    trade_id NUMERIC(20,0),
    mandate_id NUMERIC(20,0),
    activity_type TEXT NOT NULL,
    actor_account TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at_ns NUMERIC(20,0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_trade_timeline_idx
    ON activity_log (network, contract_id, trade_id, id DESC);

CREATE INDEX activity_mandate_idx
    ON activity_log (network, contract_id, mandate_id, id DESC);

-- Durable checkpoint for finalized NEAR event indexing.
CREATE TABLE indexer_checkpoints (
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    last_finalized_block_height NUMERIC(20,0) NOT NULL,
    last_finalized_block_hash TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (network, contract_id)
);

INSERT INTO schema_migrations (version)
VALUES ('001_initial_schema');

COMMIT;
