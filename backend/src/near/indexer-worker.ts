import { config } from "../config.js";
import {
  extractRiventaEvents,
  getDataServerBlock
} from "./data-server.js";
import {
  getBlockByHeight,
  getFinalizedTip
} from "./indexer-rpc.js";
import {
  getIndexerCheckpoint,
  initializeIndexerCheckpoint,
  persistFinalizedBlock
} from "./indexer-repository.js";
import {
  buildProjectionFetchPlan,
  fetchBlockProjectionViews
} from "./indexer-projections.js";

const POLL_INTERVAL_MS = 3000;
const DATA_SERVER_MIN_INTERVAL_MS = 350;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSameBlock(
  rpcBlock: Awaited<ReturnType<typeof getBlockByHeight>>,
  dataBlock: Awaited<ReturnType<typeof getDataServerBlock>>["block"]
): void {
  if (
    rpcBlock.header.height !== dataBlock.header.height ||
    rpcBlock.header.hash !== dataBlock.header.hash ||
    rpcBlock.header.prev_hash !== dataBlock.header.prev_hash ||
    rpcBlock.header.timestamp_nanosec !==
      dataBlock.header.timestamp_nanosec
  ) {
    throw new Error("INDEXER_BLOCK_SOURCE_MISMATCH");
  }
}

async function pollOnce(shouldStop: () => boolean): Promise<void> {
  const contractId = config.near.contractId;
  const startBlock = config.near.indexerStartBlock;
  const network = config.auth.network;
  const rpcUrl = config.auth.rpcUrl;

  if (!contractId || !startBlock) return;

  let checkpoint = await getIndexerCheckpoint(network, contractId);

  // Initialize only once. Never fetch the deployment predecessor on every poll.
  if (!checkpoint) {
    const previousBlock = await getBlockByHeight(
      rpcUrl,
      startBlock - 1
    );

    await initializeIndexerCheckpoint({
      network,
      contractId,
      startBlock,
      previousBlockHash: previousBlock.header.hash
    });

    checkpoint = await getIndexerCheckpoint(network, contractId);

    if (!checkpoint) {
      throw new Error("INDEXER_CHECKPOINT_NOT_FOUND");
    }
  }

  const tip = await getFinalizedTip(rpcUrl);
  let checkpointHeight = Number(checkpoint.lastFinalizedBlockHeight);
  let checkpointHash = checkpoint.lastFinalizedBlockHash;
  let lastDataServerRequestAt = 0;

  if (!Number.isSafeInteger(checkpointHeight)) {
    throw new Error("INDEXER_CHECKPOINT_HEIGHT_INVALID");
  }

  while (checkpointHeight < tip.header.height && !shouldStop()) {
    const nextHeight = checkpointHeight + 1;

    if (!Number.isSafeInteger(nextHeight)) {
      throw new Error("INDEXER_NEXT_BLOCK_HEIGHT_INVALID");
    }

    const blockStartedAt = Date.now();
    const timings: Record<string, number> = {};

    // Enforce a conservative Data Server request rate during catch-up.
    const elapsed = Date.now() - lastDataServerRequestAt;
    const remaining = DATA_SERVER_MIN_INTERVAL_MS - elapsed;

    if (remaining > 0) {
      await wait(remaining);
    }

    if (shouldStop()) break;

    let stageStartedAt = Date.now();
    const rpcBlock = await getBlockByHeight(rpcUrl, nextHeight);
    timings.rpcBlockMs = Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    const data = await getDataServerBlock(nextHeight);
    timings.dataServerMs = Date.now() - stageStartedAt;
    lastDataServerRequestAt = Date.now();

    assertSameBlock(rpcBlock, data.block);

    if (data.block.header.prev_hash !== checkpointHash) {
      throw new Error("INDEXER_CHECKPOINT_HASH_MISMATCH");
    }

    const events = extractRiventaEvents(data, contractId);

    // Fetch all contract views at this exact finalized block before opening
    // the database transaction.
    const plan = buildProjectionFetchPlan(events);
    stageStartedAt = Date.now();
    const views = await fetchBlockProjectionViews({
      rpcUrl,
      contractId,
      block: {
        height: data.block.header.height,
        hash: data.block.header.hash
      },
      plan
    });
    timings.projectionMs = Date.now() - stageStartedAt;

    stageStartedAt = Date.now();
    const result = await persistFinalizedBlock({
      network,
      contractId,
      block: data.block,
      events,
      views
    });
    timings.persistMs = Date.now() - stageStartedAt;

    // Read back the committed checkpoint before advancing locally.
    stageStartedAt = Date.now();
    const updated = await getIndexerCheckpoint(network, contractId);
    timings.checkpointReadbackMs = Date.now() - stageStartedAt;
    timings.totalMs = Date.now() - blockStartedAt;

    if (
      !updated ||
      updated.lastFinalizedBlockHeight !== String(nextHeight) ||
      updated.lastFinalizedBlockHash !== data.block.header.hash
    ) {
      throw new Error("INDEXER_CHECKPOINT_ADVANCE_VERIFICATION_FAILED");
    }

    checkpointHeight = nextHeight;
    checkpointHash = updated.lastFinalizedBlockHash;

    console.info("[near-indexer] Finalized block persisted", {
      network,
      contractId,
      ...result,
      blockHash: data.block.header.hash,
      timings
    });
  }
}

/**
 * Starts a sequential, non-overlapping polling worker.
 * Returns an async stop function for graceful server shutdown.
 */
export function startNearIndexer(): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const run = async (): Promise<void> => {
    try {
      await pollOnce(() => stopped);
    } catch (error) {
      console.error("[near-indexer] Poll failed", error);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          inFlight = run();
        }, POLL_INTERVAL_MS);
      }
    }
  };

  inFlight = run();

  return async (): Promise<void> => {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    await inFlight;
  };
}
