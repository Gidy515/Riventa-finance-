import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { config } from "../config.js";
import {
  callNearView,
  getFinalizedTip,
  nearU64Args,
} from "../near/indexer-rpc.js";
import { getIndexerCheckpoint } from "../near/indexer-repository.js";
import { AuthError } from "../auth/auth-service.js";
import { requireSession } from "../auth/session-guard.js";
import {
  getTrade,
  getTrades,
  InvalidTradeQueryError,
  validateTradeId,
  validateTradeListParameters,
} from "../domain/trades/trade-service.js";
import {
  getMandate,
  getMandates,
  validateMandateId,
  validateMandateListParameters,
} from "../domain/trades/mandate-service.js";
import type {
  TradeRecord,
  TradeScope,
  TradeState,
} from "../domain/trades/trade-repository.js";
import {
  getTradeLifecycleProjection,
  type TradeLifecycle,
} from "../domain/trades/trade-lifecycle-repository.js";

interface TradeListQuery {
  state?: string;
  limit?: string;
  cursorCreatedAtNs?: string;
  cursorTradeId?: string;
}

interface MandateListQuery {
  limit?: string;
  beforeMandateId?: string;
}

class ContractNotConfiguredError extends Error {
  constructor() {
    super("The NEAR contract ID is not configured.");
    this.name = "ContractNotConfiguredError";
  }
}

function createTradeScope(session: {
  accountId: string;
  network: string;
}): TradeScope {
  const contractId = config.near.contractId;

  if (!contractId) {
    throw new ContractNotConfiguredError();
  }

  return {
    network: session.network,
    contractId,
    accountId: session.accountId,
  };
}

interface TradePolicySnapshot {
  buyer: string;
  agent: string;
  allowReleaseAfterPass: boolean;
  allowRefundAfterFail: boolean;
}

type FinalizedBlock = Awaited<ReturnType<typeof getFinalizedTip>>;

type NearTradeLifecycle = Pick<TradeLifecycle, "documents" | "inspection">;

async function getTradePolicySnapshot(
  contractId: string,
  tradeId: string,
  block: FinalizedBlock,
  nearReader: WorkspaceNearReader
): Promise<TradePolicySnapshot | null> {
  const value = await nearReader.callNearView<unknown>(
    config.auth.rpcUrl,
    contractId,
    "get_trade_policy_snapshot",
    nearU64Args([tradeId]),
    {
      height: block.header.height,
      hash: block.header.hash,
    }
  );

  if (value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_TRADE_POLICY_SNAPSHOT");
  }

  const snapshot = value as Record<string, unknown>;

  if (
    typeof snapshot.buyer !== "string" ||
    typeof snapshot.agent !== "string" ||
    typeof snapshot.allow_release_after_pass !== "boolean" ||
    typeof snapshot.allow_refund_after_fail !== "boolean"
  ) {
    throw new Error("INVALID_TRADE_POLICY_SNAPSHOT");
  }

  return {
    buyer: snapshot.buyer,
    agent: snapshot.agent,
    allowReleaseAfterPass: snapshot.allow_release_after_pass,
    allowRefundAfterFail: snapshot.allow_refund_after_fail,
  };
}

function nearBytes32ToHex(value: unknown, field: string): string {
  if (
    !Array.isArray(value) ||
    value.length !== 32 ||
    !value.every(
      (item) =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        item >= 0 &&
        item <= 255
    )
  ) {
    throw new Error(`INVALID_NEAR_LIFECYCLE_BYTES32:${field}`);
  }

  return Buffer.from(value).toString("hex");
}

async function getNearTradeLifecycle(
  contractId: string,
  tradeId: string,
  block: FinalizedBlock,
  nearReader: WorkspaceNearReader
): Promise<NearTradeLifecycle> {
  const blockReference = {
    height: block.header.height,
    hash: block.header.hash,
  };

  const [documentsValue, inspectionValue] = await Promise.all([
    nearReader.callNearView<unknown>(
      config.auth.rpcUrl,
      contractId,
      "get_document_commitments",
      nearU64Args([tradeId]),
      blockReference
    ),
    nearReader.callNearView<unknown>(
      config.auth.rpcUrl,
      contractId,
      "get_inspection_record",
      nearU64Args([tradeId]),
      blockReference
    ),
  ]);

  if (!Array.isArray(documentsValue)) {
    throw new Error("INVALID_NEAR_DOCUMENT_COMMITMENTS");
  }

  const allowedDocumentTypes = new Set([
    "commercial_invoice",
    "packing_list",
    "certificate_of_origin",
  ]);

  const documents = documentsValue.map((value) => {
    if (!isObject(value)) {
      throw new Error("INVALID_NEAR_DOCUMENT_COMMITMENT");
    }

    const documentType = value.document_type;

    if (
      typeof documentType !== "string" ||
      !allowedDocumentTypes.has(documentType)
    ) {
      throw new Error("INVALID_NEAR_DOCUMENT_TYPE");
    }

    const version = Number(toDecimalString(value.version, "document_version"));

    if (!Number.isSafeInteger(version) || version < 1 || version > 255) {
      throw new Error("INVALID_NEAR_DOCUMENT_VERSION");
    }

    if (typeof value.submitted_by !== "string" || !value.submitted_by) {
      throw new Error("INVALID_NEAR_DOCUMENT_SUBMITTER");
    }

    return {
      documentType,
      version,
      commitment: nearBytes32ToHex(value.commitment, "document_commitment"),
      submittedBy: value.submitted_by,
      submittedAtNs: toDecimalString(
        value.submitted_at,
        "document_submitted_at"
      ),
    };
  });

  if (inspectionValue === null) {
    return {
      documents,
      inspection: null,
    };
  }

  if (!isObject(inspectionValue)) {
    throw new Error("INVALID_NEAR_INSPECTION_RECORD");
  }

  if (
    typeof inspectionValue.assigned_inspector !== "string" ||
    !inspectionValue.assigned_inspector
  ) {
    throw new Error("INVALID_NEAR_ASSIGNED_INSPECTOR");
  }

  const replacementCount = Number(
    toDecimalString(
      inspectionValue.replacement_count,
      "inspection_replacement_count"
    )
  );

  if (
    !Number.isSafeInteger(replacementCount) ||
    replacementCount < 0 ||
    replacementCount > 255
  ) {
    throw new Error("INVALID_NEAR_INSPECTION_REPLACEMENT_COUNT");
  }

  let outcome: string | null = null;
  let attestingInspector: string | null = null;
  let evidenceCommitment: string | null = null;
  let submittedAtNs: string | null = null;

  const attestation = inspectionValue.attestation;

  if (attestation !== null && attestation !== undefined) {
    if (!isObject(attestation)) {
      throw new Error("INVALID_NEAR_INSPECTION_ATTESTATION");
    }

    if (attestation.outcome !== "pass" && attestation.outcome !== "fail") {
      throw new Error("INVALID_NEAR_INSPECTION_OUTCOME");
    }

    if (typeof attestation.inspector !== "string" || !attestation.inspector) {
      throw new Error("INVALID_NEAR_ATTESTING_INSPECTOR");
    }

    outcome = attestation.outcome;
    attestingInspector = attestation.inspector;
    evidenceCommitment = nearBytes32ToHex(
      attestation.evidence_commitment,
      "inspection_evidence_commitment"
    );
    submittedAtNs = toDecimalString(
      attestation.submitted_at,
      "inspection_submitted_at"
    );
  }

  return {
    documents,
    inspection: {
      assignedInspector: inspectionValue.assigned_inspector,
      replacementCount,
      outcome,
      attestingInspector,
      evidenceCommitment,
      submittedAtNs,
    },
  };
}

async function getNearAssignedInspector(
  contractId: string,
  tradeId: string,
  block: FinalizedBlock,
  nearReader: WorkspaceNearReader
): Promise<string | null> {
  const value = await nearReader.callNearView<unknown>(
    config.auth.rpcUrl,
    contractId,
    "get_inspection_record",
    nearU64Args([tradeId]),
    {
      height: block.header.height,
      hash: block.header.hash,
    }
  );

  if (value === null) {
    return null;
  }

  if (
    !isObject(value) ||
    typeof value.assigned_inspector !== "string" ||
    value.assigned_inspector.length === 0
  ) {
    throw new Error("INVALID_NEAR_ASSIGNED_INSPECTOR");
  }

  return value.assigned_inspector;
}

export interface WorkspaceNearReader {
  getFinalizedTip: typeof getFinalizedTip;
  callNearView: typeof callNearView;
}

interface NearTradeView {
  id: number | string;
  buyer: string;
  supplier: string;
  resolver: string;
  payment_token: string;
  amount: string;
  state: TradeState;
  created_at: number | string;
  accept_by: number | string;
  fund_by: number | string | null;
  funded_at: number | string | null;
  documents_completed_at: number | string | null;
  inspector_assigned_at: number | string | null;
}

const TRADE_STATES = new Set<TradeState>([
  "AwaitingAcceptance",
  "Accepted",
  "Funded",
  "DocumentReview",
  "InspectionPending",
  "InspectionPassed",
  "InspectionFailed",
  "Disputed",
  "ReleaseAuthorized",
  "RefundAuthorized",
  "PayoutPending",
  "RefundPending",
  "Completed",
  "Refunded",
  "Cancelled",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDecimalString(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`INVALID_NEAR_TRADE_${field.toUpperCase()}`);
  }

  const result = String(value);

  if (!/^(0|[1-9]\d*)$/.test(result)) {
    throw new Error(`INVALID_NEAR_TRADE_${field.toUpperCase()}`);
  }

  return result;
}

function mapNearTrade(value: unknown, block: FinalizedBlock): TradeRecord {
  if (!isObject(value)) {
    throw new Error("INVALID_NEAR_TRADE");
  }

  const state = value.state;

  if (typeof state !== "string" || !TRADE_STATES.has(state as TradeState)) {
    throw new Error("INVALID_NEAR_TRADE_STATE");
  }

  for (const field of [
    "buyer",
    "supplier",
    "resolver",
    "payment_token",
    "amount",
  ]) {
    if (typeof value[field] !== "string") {
      throw new Error(`INVALID_NEAR_TRADE_${field.toUpperCase()}`);
    }
  }

  return {
    tradeId: toDecimalString(value.id, "id"),
    buyerAccount: value.buyer as string,
    supplierAccount: value.supplier as string,
    resolverAccount: value.resolver as string,
    paymentToken: value.payment_token as string,
    amountRaw: value.amount as string,
    state: state as TradeState,
    createdAtNs: toDecimalString(value.created_at, "created_at"),
    acceptByNs: toDecimalString(value.accept_by, "accept_by"),
    fundByNs:
      value.fund_by === null ? null : toDecimalString(value.fund_by, "fund_by"),
    fundedAtNs:
      value.funded_at === null
        ? null
        : toDecimalString(value.funded_at, "funded_at"),
    documentsCompletedAtNs:
      value.documents_completed_at === null
        ? null
        : toDecimalString(
            value.documents_completed_at,
            "documents_completed_at"
          ),
    inspectorAssignedAtNs:
      value.inspector_assigned_at === null
        ? null
        : toDecimalString(value.inspector_assigned_at, "inspector_assigned_at"),
    observedBlockHeight: String(block.header.height),
  };
}

function canViewTrade(trade: TradeRecord, accountId: string): boolean {
  return (
    trade.buyerAccount === accountId ||
    trade.supplierAccount === accountId ||
    trade.resolverAccount === accountId
  );
}

async function getNearTradeAtBlock(
  contractId: string,
  tradeId: string,
  block: FinalizedBlock,
  nearReader: WorkspaceNearReader
): Promise<TradeRecord | null> {
  const value = await nearReader.callNearView<unknown>(
    config.auth.rpcUrl,
    contractId,
    "get_trade",
    nearU64Args([tradeId]),
    {
      height: block.header.height,
      hash: block.header.hash,
    }
  );

  return value === null ? null : mapNearTrade(value, block);
}

async function getNearTrade(
  contractId: string,
  tradeId: string,
  nearReader: WorkspaceNearReader
): Promise<{ trade: TradeRecord | null; block: FinalizedBlock }> {
  const block = await nearReader.getFinalizedTip(config.auth.rpcUrl);

  return {
    trade: await getNearTradeAtBlock(contractId, tradeId, block, nearReader),
    block,
  };
}

async function listNearTrades(
  scope: TradeScope,
  input: {
    state?: string;
    limit?: number;
    cursor?: {
      createdAtNs: string;
      tradeId: string;
    };
  },
  nearReader: WorkspaceNearReader
): Promise<{
  items: TradeRecord[];
  nextCursor: { createdAtNs: string; tradeId: string } | null;
}> {
  const block = await nearReader.getFinalizedTip(config.auth.rpcUrl);

  const configView = await nearReader.callNearView<unknown>(
    config.auth.rpcUrl,
    scope.contractId,
    "get_contract_config",
    "[]",
    {
      height: block.header.height,
      hash: block.header.hash,
    }
  );

  if (!isObject(configView)) {
    throw new Error("INVALID_NEAR_CONTRACT_CONFIG");
  }

  const nextTradeId = BigInt(
    toDecimalString(configView.next_trade_id, "next_trade_id")
  );

  // Bound fallback work. This is a recent-trades fallback, not a full historical index.
  const scanStart = nextTradeId > 100n ? nextTradeId - 100n : 0n;
  const tradeIds: string[] = [];

  for (let id = scanStart; id < nextTradeId; id += 1n) {
    tradeIds.push(id.toString());
  }

  const trades = await Promise.all(
    tradeIds.map((id) =>
      getNearTradeAtBlock(scope.contractId, id, block, nearReader)
    )
  );

  const existingTrades = trades.filter(
    (trade): trade is TradeRecord => trade !== null
  );

  const visibility = await Promise.all(
    existingTrades.map(async (trade) => {
      if (canViewTrade(trade, scope.accountId)) {
        return { trade, visible: true };
      }

      const assignedInspector = await getNearAssignedInspector(
        scope.contractId,
        trade.tradeId,
        block,
        nearReader
      );

      return {
        trade,
        visible: assignedInspector === scope.accountId,
      };
    })
  );

  const visible = visibility
    .filter((entry) => entry.visible)
    .map((entry) => entry.trade)
    .filter((trade) => input.state === undefined || trade.state === input.state)
    .filter((trade) => {
      if (!input.cursor) return true;

      const created = BigInt(trade.createdAtNs);
      const cursorCreated = BigInt(input.cursor.createdAtNs);

      return (
        created < cursorCreated ||
        (created === cursorCreated &&
          BigInt(trade.tradeId) < BigInt(input.cursor.tradeId))
      );
    })
    .sort((a, b) => {
      const createdDifference = BigInt(b.createdAtNs) - BigInt(a.createdAtNs);

      if (createdDifference !== 0n) {
        return createdDifference > 0n ? 1 : -1;
      }

      const idDifference = BigInt(b.tradeId) - BigInt(a.tradeId);
      return idDifference > 0n ? 1 : idDifference < 0n ? -1 : 0;
    });

  const limit = input.limit ?? 20;
  const page = visible.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const items = page.slice(0, limit);
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && last
        ? {
            createdAtNs: last.createdAtNs,
            tradeId: last.tradeId,
          }
        : null,
  };
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new InvalidTradeQueryError(
      "limit must be an integer between 1 and 50."
    );
  }

  const limit = Number(value);

  if (!Number.isSafeInteger(limit)) {
    throw new InvalidTradeQueryError(
      "limit must be an integer between 1 and 50."
    );
  }

  return limit;
}

function sendWorkspaceError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown
) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({
      error: error.message,
    });
  }

  if (error instanceof InvalidTradeQueryError) {
    return reply.code(400).send({
      error: "INVALID_QUERY",
      message: error.message,
    });
  }

  if (error instanceof ContractNotConfiguredError) {
    return reply.code(503).send({
      error: "CONTRACT_NOT_CONFIGURED",
      message: "The NEAR contract ID has not been configured on this server.",
    });
  }

  request.log.error({ err: error }, "Workspace API request failed");

  return reply.code(500).send({
    error: "INTERNAL_SERVER_ERROR",
  });
}

export const workspaceRoutes: FastifyPluginAsync<{
  nearReader?: WorkspaceNearReader;
}> = async (app, options) => {
  const nearReader = options.nearReader ?? {
    getFinalizedTip,
    callNearView,
  };
  app.get("/workspace/status", async (request, reply) => {
    reply.header("cache-control", "no-store");

    try {
      const session = await requireSession(request);
      const contractId = config.near.contractId;
      const checkpoint = contractId
        ? await getIndexerCheckpoint(session.network, contractId)
        : null;

      return reply.send({
        authenticated: true,
        account: {
          accountId: session.accountId,
          network: session.network,
          expiresAt: session.expiresAt,
        },
        infrastructure: {
          contract: {
            accountId: contractId,
            deploymentStatus: config.near.contractId
              ? "deployment_unverified"
              : "not_deployed",
          },
          indexer: {
            status: checkpoint ? "indexed" : "not_started",
            lastFinalizedBlockHeight:
              checkpoint?.lastFinalizedBlockHeight ?? null,
          },
          projections: {
            status: checkpoint ? "available" : "waiting_for_indexer",
          },
        },
      });
    } catch (error) {
      return sendWorkspaceError(request, reply, error);
    }
  });

  app.get<{ Querystring: TradeListQuery }>(
    "/workspace/trades",
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        const session = await requireSession(request);
        const query = request.query;

        const hasCursorCreatedAtNs = query.cursorCreatedAtNs !== undefined;
        const hasCursorTradeId = query.cursorTradeId !== undefined;

        if (hasCursorCreatedAtNs !== hasCursorTradeId) {
          throw new InvalidTradeQueryError(
            "Both cursorCreatedAtNs and cursorTradeId are required together."
          );
        }

        const cursor =
          hasCursorCreatedAtNs && hasCursorTradeId
            ? {
                createdAtNs: query.cursorCreatedAtNs!,
                tradeId: query.cursorTradeId!,
              }
            : undefined;

        const limit = parseLimit(query.limit);

        validateTradeListParameters({
          state: query.state,
          limit,
          cursor,
        });

        const scope = createTradeScope(session);

        const [databaseResult, liveResult] = await Promise.all([
          getTrades({
            scope,
            state: query.state,
            limit,
            cursor,
          }),
          listNearTrades(
            scope,
            {
              state: query.state,
              limit,
              cursor,
            },
            nearReader
          ),
        ]);

        // Merge both visibility sources. Chain data takes precedence for
        // duplicate trade IDs because it was read at a finalized block.
        const mergedTrades = new Map<string, TradeRecord>();

        for (const trade of databaseResult.items) {
          mergedTrades.set(trade.tradeId, trade);
        }

        for (const trade of liveResult.items) {
          mergedTrades.set(trade.tradeId, trade);
        }

        const sortedTrades = [...mergedTrades.values()].sort((a, b) => {
          const createdDifference =
            BigInt(b.createdAtNs) - BigInt(a.createdAtNs);

          if (createdDifference !== 0n) {
            return createdDifference > 0n ? 1 : -1;
          }

          const idDifference = BigInt(b.tradeId) - BigInt(a.tradeId);
          return idDifference > 0n ? 1 : idDifference < 0n ? -1 : 0;
        });

        const pageLimit = limit ?? 20;
        const items = sortedTrades.slice(0, pageLimit);
        const hasMore =
          sortedTrades.length > pageLimit ||
          databaseResult.nextCursor !== null ||
          liveResult.nextCursor !== null;

        const last = items.at(-1);

        return reply.send({
          items,
          nextCursor:
            hasMore && last
              ? {
                  createdAtNs: last.createdAtNs,
                  tradeId: last.tradeId,
                }
              : null,
        });
      } catch (error) {
        return sendWorkspaceError(request, reply, error);
      }
    }
  );

  app.get<{ Params: { tradeId: string } }>(
    "/workspace/trades/:tradeId",
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        const session = await requireSession(request);
        const { tradeId } = request.params;

        validateTradeId(tradeId);

        const scope = createTradeScope(session);

        let trade = await getTrade(scope, tradeId);
        let block: FinalizedBlock | null = null;

        if (!trade) {
          const live = await getNearTrade(
            scope.contractId,
            tradeId,
            nearReader
          );

          trade = live.trade;
          block = live.block;
        }

        if (!trade) {
          return reply.code(404).send({
            error: "TRADE_NOT_FOUND",
          });
        }

        if (!canViewTrade(trade, scope.accountId)) {
          const finalizedBlock =
            block ?? (await nearReader.getFinalizedTip(config.auth.rpcUrl));

          const assignedInspector = await getNearAssignedInspector(
            scope.contractId,
            tradeId,
            finalizedBlock,
            nearReader
          );

          if (assignedInspector !== scope.accountId) {
            return reply.code(404).send({
              error: "TRADE_NOT_FOUND",
            });
          }
        }

        return reply.send({ trade });
      } catch (error) {
        return sendWorkspaceError(request, reply, error);
      }
    }
  );

  app.get<{ Params: { tradeId: string } }>(
    "/workspace/trades/:tradeId/lifecycle",
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        const session = await requireSession(request);
        const { tradeId } = request.params;

        validateTradeId(tradeId);

        const scope = createTradeScope(session);

        // Prefer the indexed record, but fall back to a finalized contract view.
        // Prefer the indexed record, but fall back to a finalized contract view.
        let trade = await getTrade(scope, tradeId);
        let block: FinalizedBlock | null = null;

        if (!trade) {
          const live = await getNearTrade(
            scope.contractId,
            tradeId,
            nearReader
          );

          trade = live.trade;
          block = live.block;
        }

        if (!trade) {
          return reply.code(404).send({
            error: "TRADE_NOT_FOUND",
          });
        }

        const finalizedBlock =
          block ?? (await nearReader.getFinalizedTip(config.auth.rpcUrl));

        const [lifecycleProjection, chainLifecycle, policySnapshot] =
          await Promise.all([
            getTradeLifecycleProjection(scope, tradeId),
            getNearTradeLifecycle(
              scope.contractId,
              tradeId,
              finalizedBlock,
              nearReader
            ),
            getTradePolicySnapshot(
              scope.contractId,
              tradeId,
              finalizedBlock,
              nearReader
            ),
          ]);

        const isParticipant = canViewTrade(trade, scope.accountId);
        const isAssignedInspector =
          chainLifecycle.inspection?.assignedInspector === scope.accountId;

        if (!isParticipant && !isAssignedInspector) {
          return reply.code(404).send({
            error: "TRADE_NOT_FOUND",
          });
        }

        return reply.send({
          lifecycle: {
            documents:
              chainLifecycle.documents.length > 0
                ? chainLifecycle.documents
                : lifecycleProjection.documents,
            inspection:
              chainLifecycle.inspection ?? lifecycleProjection.inspection,
            settlements: lifecycleProjection.settlements,
            policySnapshot,
          },
        });
      } catch (error) {
        return sendWorkspaceError(request, reply, error);
      }
    }
  );

  app.get<{ Querystring: MandateListQuery }>(
    "/workspace/mandates",
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        const session = await requireSession(request);
        const query = request.query;
        const limit = parseLimit(query.limit);

        validateMandateListParameters({
          limit,
          beforeMandateId: query.beforeMandateId,
        });

        const scope = createTradeScope(session);

        const result = await getMandates({
          scope,
          limit,
          beforeMandateId: query.beforeMandateId,
        });

        return reply.send(result);
      } catch (error) {
        return sendWorkspaceError(request, reply, error);
      }
    }
  );

  app.get<{ Params: { mandateId: string } }>(
    "/workspace/mandates/:mandateId",
    async (request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        const session = await requireSession(request);
        const { mandateId } = request.params;

        validateMandateId(mandateId);

        const scope = createTradeScope(session);

        const mandate = await getMandate(scope, mandateId);

        if (!mandate) {
          return reply.code(404).send({
            error: "MANDATE_NOT_FOUND",
          });
        }

        return reply.send({ mandate });
      } catch (error) {
        return sendWorkspaceError(request, reply, error);
      }
    }
  );
};
