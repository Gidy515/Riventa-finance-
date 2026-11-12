import assert from "node:assert/strict";
import test from "node:test";

import type { IndexedContractEvent } from "./data-server.js";
import { buildProjectionFetchPlan } from "./indexer-projections.js";

function event(
  eventName: string,
  payload: Record<string, unknown>
): IndexedContractEvent {
  return {
    blockHeight: 100,
    blockHash: "block-hash",
    blockTimestampNs: "1000000000",
    transactionHash: "transaction-hash",
    executionId: "execution-id",
    executionType: "receipt",
    logIndex: 0,
    standard: "riventa",
    eventVersion: "1.0.0",
    eventName,
    eventData: [payload],
    rawLog: "EVENT_JSON:{}"
  };
}

test("builds a deduplicated view plan from events without relying on event order", () => {
  const plan = buildProjectionFetchPlan([
    event("settlement_completed", {
      trade_id: 7,
      settlement_id: 22,
      result: "succeeded"
    }),
    event("mandate_updated", {
      mandate_id: 4,
      version: 2
    }),
    event("document_commitment_recorded", {
      trade_id: 7,
      document_type: "commercial_invoice",
      version: 1
    }),
    event("agent_trade_created", {
      trade_id: 7,
      mandate_id: 4,
      mandate_version: 2
    }),
    event("inspection_attested", {
      trade_id: 9,
      outcome: "pass",
      inspector: "inspector.testnet"
    }),
    event("settlement_initiated", {
      trade_id: 7,
      settlement_id: 22
    }),
    event("admin_action_executed", {
      proposal_id: 3
    })
  ]);

  assert.deepEqual(plan, {
    mandateIds: ["4"],
    tradeIds: ["7", "9"],
    policySnapshotTradeIds: ["7"],
    documentTradeIds: ["7"],
    inspectionTradeIds: ["9"],
    settlementIds: ["22"]
  });
});

test("accepts canonical decimal-string identifiers beyond Number.MAX_SAFE_INTEGER", () => {
  const plan = buildProjectionFetchPlan([
    event("trade_created", {
      trade_id: "9007199254740993",
      state: "AwaitingAcceptance"
    })
  ]);

  assert.deepEqual(plan.tradeIds, ["9007199254740993"]);
});

test("rejects unsafe numeric event identifiers instead of silently rounding them", () => {
  assert.throws(
    () =>
      buildProjectionFetchPlan([
        event("trade_created", {
          trade_id: Number.MAX_SAFE_INTEGER + 1,
          state: "AwaitingAcceptance"
        })
      ]),
    /INDEXER_UNSAFE_EVENT_U64:trade_id/
  );
});

test("rejects malformed relevant event payloads", () => {
  assert.throws(
    () =>
      buildProjectionFetchPlan([
        {
          ...event("trade_created", { trade_id: 1 }),
          eventData: []
        }
      ]),
    /INDEXER_INVALID_EVENT_DATA:trade_created/
  );
});

test("rejects missing settlement identifiers", () => {
  assert.throws(
    () =>
      buildProjectionFetchPlan([
        event("settlement_initiated", {
          trade_id: 1
        })
      ]),
    /INDEXER_INVALID_EVENT_U64:settlement_id/
  );
});
