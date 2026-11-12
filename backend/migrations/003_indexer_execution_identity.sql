BEGIN;

-- A NEAR execution can be either a transaction or a receipt.
-- Preserve existing rows by classifying legacy receipt_id values as receipts.
ALTER TABLE chain_events
    RENAME COLUMN receipt_id TO execution_id;

ALTER TABLE chain_events
    ADD COLUMN execution_type TEXT NOT NULL DEFAULT 'receipt';

ALTER TABLE chain_events
    ALTER COLUMN execution_type DROP DEFAULT;

ALTER TABLE chain_events
    ADD CONSTRAINT chain_events_execution_type_check
    CHECK (execution_type IN ('transaction', 'receipt'));

-- Replace the legacy uniqueness key with the execution identity.
ALTER TABLE chain_events
    DROP CONSTRAINT IF EXISTS chain_events_network_contract_id_receipt_id_log_index_key;

ALTER TABLE chain_events
    ADD CONSTRAINT chain_events_execution_log_unique
    UNIQUE (network, contract_id, execution_id, log_index);

INSERT INTO schema_migrations (version)
VALUES ('003_indexer_execution_identity');

COMMIT;
