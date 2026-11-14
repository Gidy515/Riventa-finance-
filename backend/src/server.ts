import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { database } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { authRoutes } from "./auth/auth-routes.js";
import { workspaceRoutes } from "./workspace/workspace-routes.js";
import { startNearIndexer } from "./near/indexer-worker.js";

const app = Fastify({
  logger: true,
});

let shuttingDown = false;

let stopNearIndexer: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  await app.register(cors, {
    origin: [...config.corsOrigins],
    credentials: true,
  });

  await app.register(authRoutes);
  await app.register(workspaceRoutes);

  app.get("/health", async (_request, reply) => {
    try {
      await database.query("SELECT 1");

      return {
        status: "ok",
        service: "riventa-api",
        database: "connected",
      };
    } catch (error) {
      app.log.error({ err: error }, "Database health check failed");

      return reply.code(503).send({
        status: "degraded",
        service: "riventa-api",
        database: "unavailable",
      });
    }
  });

  await runMigrations(database);

  await app.listen({
    port: config.port,
    host: config.host,
  });

  if (config.near.contractId && config.near.indexerStartBlock) {
    stopNearIndexer = startNearIndexer();

    app.log.info(
      {
        contractId: config.near.contractId,
        network: config.auth.network,
        startBlock: config.near.indexerStartBlock,
      },
      "NEAR event indexer started"
    );
  } else {
    app.log.info(
      "NEAR event indexer disabled: configure NEAR_CONTRACT_ID and NEAR_INDEXER_START_BLOCK"
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, "Shutting down Riventa API");

  const failures: unknown[] = [];

  try {
    if (stopNearIndexer) {
      await stopNearIndexer();
      stopNearIndexer = undefined;
    }
  } catch (error) {
    failures.push(error);
    app.log.error({ err: error }, "Failed to stop NEAR indexer");
  }

  try {
    await app.close();
  } catch (error) {
    failures.push(error);
    app.log.error({ err: error }, "Failed to close Fastify");
  }

  try {
    await database.end();
  } catch (error) {
    failures.push(error);
    app.log.error({ err: error }, "Failed to close database pool");
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Riventa shutdown encountered errors");
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT").catch((error: unknown) => {
    app.log.error(error, "Shutdown failed");
    process.exitCode = 1;
  });
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").catch((error: unknown) => {
    app.log.error(error, "Shutdown failed");
    process.exitCode = 1;
  });
});

start().catch(async (error: unknown) => {
  app.log.error(error, "Failed to start Riventa API");

  await database.end().catch((closeError: unknown) => {
    app.log.error(closeError, "Failed to close database pool");
  });

  process.exitCode = 1;
});
