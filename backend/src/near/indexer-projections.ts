import type { IndexedContractEvent } from "./data-server.js";
import {
  callNearView,
  nearU64Args,
  type NearViewBlockReference
} from "./indexer-rpc.js";

export interface ProjectionFetchPlan {
  mandateIds: string[];
  tradeIds: string[];
  policySnapshotTradeIds: string[];
  documentTradeIds: string[];
  inspectionTradeIds: string[];
  settlementIds: string[];
}

export interface BlockProjectionViews {
  mandates: Map<string, unknown>;
  trades: Map<string, unknown>;
  policySnapshots: Map<string, unknown>;
  documentCommitments: Map<string, unknown>;
  inspectionRecords: Map<string, unknown>;
  settlements: Map<string, unknown>;
}

const MANDATE_EVENTS = new Set([
  "mandate_created",
  "mandate_updated",
  "mandate_renewed",
  "mandate_revoked"
]);

const TRADE_EVENTS = new Set([
  "trade_created",
  "agent_trade_created",
  "trade_accepted",
  "trade_cancelled",
  "trade_funded",
  "document_commitment_recorded",
  "inspector_assigned",
  "inspector_replaced",
  "inspection_attested",
  "settlement_authorized",
  "settlement_initiated",
  "settlement_completed"
]);

const DOCUMENT_EVENTS = new Set(["document_commitment_recorded"]);

const INSPECTION_EVENTS = new Set([
  "inspector_assigned",
  "inspector_replaced",
  "inspection_attested"
]);

const SETTLEMENT_EVENTS = new Set([
  "settlement_initiated",
  "settlement_completed"
]);

function readU64(value: unknown, field: string): string {
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error(`INDEXER_INVALID_EVENT_U64:${field}`);
    }

    const parsed = BigInt(value);

    if (parsed > 18446744073709551615n) {
      throw new Error(`INDEXER_EVENT_U64_OVERFLOW:${field}`);
    }

    return value;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`INDEXER_INVALID_EVENT_U64:${field}`);
  }

  // JSON.parse has already converted numeric JSON values to Number.
  // Reject unsafe values instead of querying with a rounded identifier.
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INDEXER_UNSAFE_EVENT_U64:${field}`);
  }

  return String(value);
}

function eventPayload(event: IndexedContractEvent): Record<string, unknown> {
  if (
    !Array.isArray(event.eventData) ||
    event.eventData.length !== 1 ||
    typeof event.eventData[0] !== "object" ||
    event.eventData[0] === null ||
    Array.isArray(event.eventData[0])
  ) {
    throw new Error(`INDEXER_INVALID_EVENT_DATA:${event.eventName}`);
  }

  return event.eventData[0] as Record<string, unknown>;
}

/**
 * Collects the entity IDs needed to reconstruct contract state at a block.
 * Event order is deliberately irrelevant: IDs are deduplicated and sorted.
 */
export function buildProjectionFetchPlan(
  events: readonly IndexedContractEvent[]
): ProjectionFetchPlan {
  const mandates = new Set<string>();
  const trades = new Set<string>();
  const policySnapshots = new Set<string>();
  const documents = new Set<string>();
  const inspections = new Set<string>();
  const settlements = new Set<string>();

  for (const event of events) {
    if (
      !MANDATE_EVENTS.has(event.eventName) &&
      !TRADE_EVENTS.has(event.eventName)
    ) {
      continue;
    }

    const payload = eventPayload(event);

    if (MANDATE_EVENTS.has(event.eventName)) {
      mandates.add(readU64(payload.mandate_id, "mandate_id"));
      continue;
    }

    const tradeId = readU64(payload.trade_id, "trade_id");
    trades.add(tradeId);

    if (event.eventName === "agent_trade_created") {
      mandates.add(readU64(payload.mandate_id, "mandate_id"));
      policySnapshots.add(tradeId);
    }

    if (DOCUMENT_EVENTS.has(event.eventName)) {
      documents.add(tradeId);
    }

    if (INSPECTION_EVENTS.has(event.eventName)) {
      inspections.add(tradeId);
    }

    if (SETTLEMENT_EVENTS.has(event.eventName)) {
      settlements.add(
        readU64(payload.settlement_id, "settlement_id")
      );
    }
  }

  const sorted = (values: Set<string>): string[] =>
    [...values].sort((a, b) => {
      const left = BigInt(a);
      const right = BigInt(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });

  return {
    mandateIds: sorted(mandates),
    tradeIds: sorted(trades),
    policySnapshotTradeIds: sorted(policySnapshots),
    documentTradeIds: sorted(documents),
    inspectionTradeIds: sorted(inspections),
    settlementIds: sorted(settlements)
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= values.length) return;

      results[index] = await operation(values[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

async function fetchViews(
  rpcUrl: string,
  contractId: string,
  methodName: string,
  ids: readonly string[],
  block: NearViewBlockReference
): Promise<Map<string, unknown>> {
  const entries = await mapWithConcurrency(
    ids,
    8,
    async (id): Promise<[string, unknown]> => {
      const value = await callNearView<unknown>(
        rpcUrl,
        contractId,
        methodName,
        nearU64Args([id]),
        block
      );

      return [id, value];
    }
  );

  return new Map(entries);
}

/**
 * Reads every required view against the same finalized block.
 * Network calls complete before the repository opens its DB transaction.
 */
export async function fetchBlockProjectionViews(input: {
  rpcUrl: string;
  contractId: string;
  block: NearViewBlockReference;
  plan: ProjectionFetchPlan;
}): Promise<BlockProjectionViews> {
  const { rpcUrl, contractId, block, plan } = input;

  const [
    mandates,
    trades,
    policySnapshots,
    documentCommitments,
    inspectionRecords,
    settlements
  ] = await Promise.all([
    fetchViews(rpcUrl, contractId, "get_mandate", plan.mandateIds, block),
    fetchViews(rpcUrl, contractId, "get_trade", plan.tradeIds, block),
    fetchViews(
      rpcUrl,
      contractId,
      "get_trade_policy_snapshot",
      plan.policySnapshotTradeIds,
      block
    ),
    fetchViews(
      rpcUrl,
      contractId,
      "get_document_commitments",
      plan.documentTradeIds,
      block
    ),
    fetchViews(
      rpcUrl,
      contractId,
      "get_inspection_record",
      plan.inspectionTradeIds,
      block
    ),
    fetchViews(
      rpcUrl,
      contractId,
      "get_settlement_record",
      plan.settlementIds,
      block
    )
  ]);

  return {
    mandates,
    trades,
    policySnapshots,
    documentCommitments,
    inspectionRecords,
    settlements
  };
}
