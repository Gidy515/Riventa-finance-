import { withTransaction } from "../db/pool.js";
import type { IndexedContractEvent } from "./data-server.js";
import type { NearBlock } from "./indexer-rpc.js";
import type { BlockProjectionViews } from "./indexer-projections.js";
import { persistBlockProjections } from "./indexer-projection-writer.js";

export interface IndexerCheckpoint {
  network: string;
  contractId: string;
  lastFinalizedBlockHeight: string;
  lastFinalizedBlockHash: string;
}

export interface PersistedBlockResult {
  blockHeight: number;
  eventsDiscovered: number;
  eventsInserted: number;
}

function assertIdentity(network: string, contractId: string): void {
  if (!network.trim() || !contractId.trim()) {
    throw new Error("INVALID_INDEXER_IDENTITY");
  }
}

/**
 * Initializes the checkpoint immediately before the configured deployment
 * block. It never overwrites an existing checkpoint.
 */
export async function initializeIndexerCheckpoint(input: {
  network: string;
  contractId: string;
  startBlock: number;
  previousBlockHash: string;
}): Promise<void> {
  const { network, contractId, startBlock, previousBlockHash } = input;

  assertIdentity(network, contractId);

  if (!Number.isSafeInteger(startBlock) || startBlock < 1) {
    throw new Error("INVALID_INDEXER_START_BLOCK");
  }

  if (!previousBlockHash.trim()) {
    throw new Error("INVALID_INDEXER_PREVIOUS_BLOCK_HASH");
  }

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO indexer_checkpoints (
          network,
          contract_id,
          last_finalized_block_height,
          last_finalized_block_hash
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (network, contract_id) DO NOTHING
      `,
      [network, contractId, String(startBlock - 1), previousBlockHash]
    );

    const result = await client.query<{
      last_finalized_block_height: string;
      last_finalized_block_hash: string | null;
    }>(
      `
        SELECT
          last_finalized_block_height::TEXT,
          last_finalized_block_hash
        FROM indexer_checkpoints
        WHERE network = $1 AND contract_id = $2
        FOR UPDATE
      `,
      [network, contractId]
    );

    const checkpoint = result.rows[0];

    if (!checkpoint || !checkpoint.last_finalized_block_hash) {
      throw new Error("INDEXER_CHECKPOINT_INITIALIZATION_FAILED");
    }

    const checkpointHeight = Number(checkpoint.last_finalized_block_height);

    if (
      !Number.isSafeInteger(checkpointHeight) ||
      checkpointHeight < startBlock - 1
    ) {
      throw new Error("INDEXER_CHECKPOINT_BEHIND_START_BLOCK");
    }

    if (
      checkpointHeight === startBlock - 1 &&
      checkpoint.last_finalized_block_hash !== previousBlockHash
    ) {
      throw new Error("INDEXER_CHECKPOINT_START_HASH_MISMATCH");
    }
  });
}

export async function getIndexerCheckpoint(
  network: string,
  contractId: string
): Promise<IndexerCheckpoint | null> {
  assertIdentity(network, contractId);

  const result = await withTransaction(async (client) => {
    return client.query<{
      last_finalized_block_height: string;
      last_finalized_block_hash: string | null;
    }>(
      `
        SELECT
          last_finalized_block_height::TEXT,
          last_finalized_block_hash
        FROM indexer_checkpoints
        WHERE network = $1 AND contract_id = $2
      `,
      [network, contractId]
    );
  });

  const row = result.rows[0];

  if (!row) return null;

  if (!row.last_finalized_block_hash) {
    throw new Error("INDEXER_CHECKPOINT_HASH_MISSING");
  }

  return {
    network,
    contractId,
    lastFinalizedBlockHeight: row.last_finalized_block_height,
    lastFinalizedBlockHash: row.last_finalized_block_hash,
  };
}

/**
 * Persists all Riventa events extracted from one finalized block and advances
 * the checkpoint atomically.
 */
export async function persistFinalizedBlock(input: {
  network: string;
  contractId: string;
  block: NearBlock;
  events: IndexedContractEvent[];
  views?: BlockProjectionViews;
}): Promise<PersistedBlockResult> {
  const { network, contractId, block, events, views } = input;

  assertIdentity(network, contractId);

  const blockHeight = block.header.height;
  const blockHash = block.header.hash;
  const previousBlockHash = block.header.prev_hash;
  const blockTimestampNs = block.header.timestamp_nanosec;

  if (
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 1 ||
    !blockHash ||
    !previousBlockHash
  ) {
    throw new Error("INVALID_INDEXER_BLOCK_METADATA");
  }

  for (const event of events) {
    if (
      event.blockHeight !== blockHeight ||
      event.blockHash !== blockHash ||
      !event.executionId ||
      !event.transactionHash ||
      !Number.isSafeInteger(event.logIndex) ||
      event.logIndex < 0 ||
      (event.executionType !== "transaction" &&
        event.executionType !== "receipt") ||
      event.standard !== "riventa" ||
      event.eventVersion !== "1.0.0" ||
      !event.eventName
    ) {
      throw new Error("INVALID_INDEXER_EVENT");
    }
  }

  return withTransaction(async (client) => {
    const checkpointResult = await client.query<{
      last_finalized_block_height: string;
      last_finalized_block_hash: string | null;
    }>(
      `
        SELECT
          last_finalized_block_height::TEXT,
          last_finalized_block_hash
        FROM indexer_checkpoints
        WHERE network = $1 AND contract_id = $2
        FOR UPDATE
      `,
      [network, contractId]
    );

    const checkpoint = checkpointResult.rows[0];

    if (!checkpoint || !checkpoint.last_finalized_block_hash) {
      throw new Error("INDEXER_CHECKPOINT_NOT_INITIALIZED");
    }

    const checkpointHeight = Number(checkpoint.last_finalized_block_height);

    if (
      !Number.isSafeInteger(checkpointHeight) ||
      blockHeight !== checkpointHeight + 1
    ) {
      throw new Error("INDEXER_BLOCK_HEIGHT_MISMATCH");
    }

    if (previousBlockHash !== checkpoint.last_finalized_block_hash) {
      throw new Error("INDEXER_BLOCK_HASH_MISMATCH");
    }

    let eventsInserted = 0;

    for (const event of events) {
      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO chain_events (
            network,
            contract_id,
            block_height,
            block_hash,
            transaction_hash,
            receipt_id,
            log_index,
            block_timestamp_ns,
            standard,
            event_version,
            event_name,
            event_data,
            raw_log
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::JSONB, $13
          )
          ON CONFLICT (
            network,
            contract_id,
            receipt_id,
            log_index
          ) DO NOTHING
          RETURNING id::TEXT AS id
        `,
        [
          network,
          contractId,
          String(event.blockHeight),
          event.blockHash,
          event.transactionHash,
          event.executionId,
          event.logIndex,
          event.blockTimestampNs || blockTimestampNs,
          event.standard,
          event.eventVersion,
          event.eventName,
          JSON.stringify(event.eventData),
          event.rawLog,
        ]
      );

      eventsInserted += inserted.rowCount ?? 0;

      // Only create activity for an event newly inserted into chain_events.
      // This preserves the chain-event idempotency guarantee.
      const chainEventId = inserted.rows[0]?.id;

      if (chainEventId) {
        const rawPayload =
          Array.isArray(event.eventData) && event.eventData.length === 1
            ? event.eventData[0]
            : null;

        const payload =
          typeof rawPayload === "object" &&
          rawPayload !== null &&
          !Array.isArray(rawPayload)
            ? rawPayload as Record<string, unknown>
            : {};

        const validId = (value: unknown): string | null => {
          if (
            typeof value === "string" &&
            /^(0|[1-9][0-9]*)$/.test(value)
          ) {
            return value;
          }

          if (
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0
          ) {
            return String(value);
          }

          return null;
        };

        const actor =
          typeof payload.actor === "string"
            ? payload.actor
            : typeof payload.inspector === "string"
              ? payload.inspector
              : typeof payload.submitted_by === "string"
                ? payload.submitted_by
                : null;

        await client.query(
          `
            INSERT INTO activity_log (
              chain_event_id,
              network,
              contract_id,
              trade_id,
              mandate_id,
              activity_type,
              actor_account,
              payload,
              occurred_at_ns
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::JSONB,$9)
            ON CONFLICT (chain_event_id) DO NOTHING
          `,
          [
            chainEventId,
            network,
            contractId,
            validId(payload.trade_id),
            validId(payload.mandate_id),
            event.eventName,
            actor,
            JSON.stringify(payload),
            event.blockTimestampNs || blockTimestampNs,
          ]
        );
      }
    }

    // Projection writes and activity writes share the checkpoint transaction.
    // Any projection failure rolls back the events and checkpoint as well.
    if (views) {
      await persistBlockProjections(client, {
        network,
        contractId,
        blockHeight,
        views,
        events
      });
    }

    const checkpointUpdate = await client.query(
      `
        UPDATE indexer_checkpoints
        SET
          last_finalized_block_height = $3,
          last_finalized_block_hash = $4,
          updated_at = NOW()
        WHERE network = $1
          AND contract_id = $2
          AND last_finalized_block_height = $5
      `,
      [
        network,
        contractId,
        String(blockHeight),
        blockHash,
        checkpoint.last_finalized_block_height,
      ]
    );

    if (checkpointUpdate.rowCount !== 1) {
      throw new Error("INDEXER_CHECKPOINT_UPDATE_FAILED");
    }

    return {
      blockHeight,
      eventsDiscovered: events.length,
      eventsInserted,
    };
  });
}
