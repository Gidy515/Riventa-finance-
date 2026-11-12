import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest
} from "fastify";

import { config } from "../config.js";
import { getIndexerCheckpoint } from "../near/indexer-repository.js";
import { AuthError } from "../auth/auth-service.js";
import { requireSession } from "../auth/session-guard.js";
import {
  getTrade,
  getTrades,
  InvalidTradeQueryError,
  validateTradeId,
  validateTradeListParameters
} from "../domain/trades/trade-service.js";
import {
  getMandate,
  getMandates,
  validateMandateId,
  validateMandateListParameters
} from "../domain/trades/mandate-service.js";
import type { TradeScope } from "../domain/trades/trade-repository.js";

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
    accountId: session.accountId
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
      error: error.message
    });
  }

  if (error instanceof InvalidTradeQueryError) {
    return reply.code(400).send({
      error: "INVALID_QUERY",
      message: error.message
    });
  }

  if (error instanceof ContractNotConfiguredError) {
    return reply.code(503).send({
      error: "CONTRACT_NOT_CONFIGURED",
      message: "The NEAR contract ID has not been configured on this server."
    });
  }

  request.log.error({ err: error }, "Workspace API request failed");

  return reply.code(500).send({
    error: "INTERNAL_SERVER_ERROR"
  });
}

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
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
          expiresAt: session.expiresAt
        },
        infrastructure: {
          contract: {
            accountId: contractId,
            deploymentStatus: config.near.contractId
              ? "deployment_unverified"
              : "not_deployed"
          },
          indexer: {
            status: checkpoint ? "indexed" : "not_started",
            lastFinalizedBlockHeight:
              checkpoint?.lastFinalizedBlockHeight ?? null
          },
          projections: {
            status: checkpoint ? "available" : "waiting_for_indexer"
          }
        }
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

        const hasCursorCreatedAtNs =
          query.cursorCreatedAtNs !== undefined;
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
                tradeId: query.cursorTradeId!
              }
            : undefined;

        const limit = parseLimit(query.limit);

        validateTradeListParameters({
          state: query.state,
          limit,
          cursor
        });

        const scope = createTradeScope(session);

        const result = await getTrades({
          scope,
          state: query.state,
          limit,
          cursor
        });

        return reply.send(result);
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

        const trade = await getTrade(scope, tradeId);

        if (!trade) {
          return reply.code(404).send({
            error: "TRADE_NOT_FOUND"
          });
        }

        return reply.send({ trade });
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
          beforeMandateId: query.beforeMandateId
        });

        const scope = createTradeScope(session);

        const result = await getMandates({
          scope,
          limit,
          beforeMandateId: query.beforeMandateId
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
            error: "MANDATE_NOT_FOUND"
          });
        }

        return reply.send({ mandate });
      } catch (error) {
        return sendWorkspaceError(request, reply, error);
      }
    }
  );
};
