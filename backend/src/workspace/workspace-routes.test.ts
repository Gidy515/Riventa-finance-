import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import Fastify from "fastify";

import { config } from "../config.js";
import { database } from "../db/pool.js";
import { workspaceRoutes } from "./workspace-routes.js";

const TEST_CONTRACT = "riventa-test-contract.testnet";
const TRADE_ID = "990000000001";
const MANDATE_ID = "990000000101";

const ACCOUNTS = {
  buyer: "buyer-test.testnet",
  supplier: "supplier-test.testnet",
  resolver: "resolver-test.testnet",
  agent: "agent-test.testnet",
  outsider: "outsider-test.testnet"
} as const;

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

async function insertSession(token: string, accountId: string): Promise<void> {
  await database.query(
    `INSERT INTO auth_sessions (
       token_hash, network, account_id, public_key, expires_at
     )
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
    [
      hashToken(token),
      "testnet",
      accountId,
      "ed25519:test-integration-public-key"
    ]
  );
}

async function insertTrade(): Promise<void> {
  await database.query(
    `INSERT INTO trades (
       network,
       contract_id,
       trade_id,
       buyer_account,
       supplier_account,
       resolver_account,
       payment_token,
       amount_raw,
       state,
       created_at_ns,
       accept_by_ns
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      "testnet",
      TEST_CONTRACT,
      TRADE_ID,
      ACCOUNTS.buyer,
      ACCOUNTS.supplier,
      ACCOUNTS.resolver,
      "usdc.tidepool-sandbox.testnet",
      "1000",
      "Accepted",
      "1000000000",
      "2000000000"
    ]
  );
}

async function insertMandate(): Promise<void> {
  await database.query(
    `INSERT INTO mandates (
       network,
       contract_id,
       mandate_id,
       buyer_account,
       agent_account,
       supplier_account,
       resolver_account,
       payment_token,
       max_trade_amount_raw,
       aggregate_budget_raw,
       reserved_budget_raw,
       consumed_budget_raw,
       allow_release_after_pass,
       allow_refund_after_fail,
       expires_at_ns,
       revoked,
       version
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16, $17
     )`,
    [
      "testnet",
      TEST_CONTRACT,
      MANDATE_ID,
      ACCOUNTS.buyer,
      ACCOUNTS.agent,
      ACCOUNTS.supplier,
      ACCOUNTS.resolver,
      "usdc.tidepool-sandbox.testnet",
      "10000",
      "50000",
      "0",
      "0",
      true,
      true,
      "9999999999999999999",
      false,
      "1"
    ]
  );
}

after(async () => {
  await database.end();
});

test("workspace routes enforce authentication, validation and account visibility", async (t) => {
  assert.equal(
    config.database.database,
    "riventa_test",
    "Refusing to run workspace integration tests outside riventa_test"
  );

  const mutableNearConfig = config.near as unknown as {
    contractId: string | null;
  };

  const previousContractId = mutableNearConfig.contractId;

  const tokens = {
    buyer: createToken(),
    supplier: createToken(),
    resolver: createToken(),
    agent: createToken(),
    outsider: createToken()
  };

  const app = Fastify({ logger: false });

  try {
    for (const role of Object.keys(tokens) as Array<keyof typeof tokens>) {
      await insertSession(tokens[role], ACCOUNTS[role]);
    }

    await insertTrade();
    await insertMandate();

    await app.register(workspaceRoutes);
    await app.ready();

    const request = (
      url: string,
      token?: string
    ) =>
      app.inject({
        method: "GET",
        url,
        headers: token
          ? { cookie: `riventa_session=${token}` }
          : {}
      });

    await t.test("rejects missing and malformed session cookies", async () => {
      const missing = await request("/workspace/status");
      assert.equal(missing.statusCode, 401);

      const malformed = await app.inject({
        method: "GET",
        url: "/workspace/status",
        headers: { cookie: "riventa_session=invalid" }
      });
      assert.equal(malformed.statusCode, 401);
    });

    await t.test("requires authentication before validating route parameters", async () => {
      const response = await request("/workspace/trades/not-a-number");
      assert.equal(response.statusCode, 401);
    });

    await t.test("reports the authenticated workspace status without a contract", async () => {
      mutableNearConfig.contractId = null;

      const response = await request(
        "/workspace/status",
        tokens.buyer
      );

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().authenticated, true);
      assert.equal(
        response.json().infrastructure.contract.deploymentStatus,
        "not_deployed"
      );
      assert.equal(
        response.json().infrastructure.indexer.status,
        "not_started"
      );
      assert.equal(
        response.json().infrastructure.indexer.lastFinalizedBlockHeight,
        null
      );
      assert.equal(
        response.json().infrastructure.projections.status,
        "waiting_for_indexer"
      );
      assert.equal(response.headers["cache-control"], "no-store");
    });

    await t.test("validates malformed trade and mandate requests before contract configuration", async () => {
      const invalidTradeList = await request(
        "/workspace/trades?limit=0",
        tokens.buyer
      );
      assert.equal(invalidTradeList.statusCode, 400);
      assert.equal(invalidTradeList.json().error, "INVALID_QUERY");

      const invalidMandateList = await request(
        "/workspace/mandates?limit=51",
        tokens.buyer
      );
      assert.equal(invalidMandateList.statusCode, 400);
      assert.equal(invalidMandateList.json().error, "INVALID_QUERY");

      const invalidTradeId = await request(
        "/workspace/trades/not-a-number",
        tokens.buyer
      );
      assert.equal(invalidTradeId.statusCode, 400);

      const invalidMandateId = await request(
        "/workspace/mandates/not-a-number",
        tokens.buyer
      );
      assert.equal(invalidMandateId.statusCode, 400);
    });

    await t.test("returns 503 for valid requests when no contract is configured", async () => {
      const trades = await request("/workspace/trades", tokens.buyer);
      assert.equal(trades.statusCode, 503);
      assert.equal(trades.json().error, "CONTRACT_NOT_CONFIGURED");

      const mandates = await request("/workspace/mandates", tokens.buyer);
      assert.equal(mandates.statusCode, 503);
      assert.equal(mandates.json().error, "CONTRACT_NOT_CONFIGURED");
    });

    mutableNearConfig.contractId = TEST_CONTRACT;

    await t.test("reports indexer and projection readiness from its checkpoint", async () => {
      await database.query(
        `INSERT INTO indexer_checkpoints (
           network,
           contract_id,
           last_finalized_block_height,
           last_finalized_block_hash
         )
         VALUES ($1, $2, $3, $4)`,
        ["testnet", TEST_CONTRACT, "277322233", "test-checkpoint-hash"]
      );

      const response = await request(
        "/workspace/status",
        tokens.buyer
      );

      assert.equal(response.statusCode, 200);
      assert.equal(
        response.json().infrastructure.contract.deploymentStatus,
        "deployment_unverified"
      );
      assert.equal(
        response.json().infrastructure.indexer.status,
        "indexed"
      );
      assert.equal(
        response.json().infrastructure.indexer.lastFinalizedBlockHeight,
        "277322233"
      );
      assert.equal(
        response.json().infrastructure.projections.status,
        "available"
      );
    });

    await t.test("allows buyers, suppliers and resolvers to view their trade", async () => {
      for (const role of ["buyer", "supplier", "resolver"] as const) {
        const response = await request(
          `/workspace/trades/${TRADE_ID}`,
          tokens[role]
        );

        assert.equal(response.statusCode, 200, `${role} should see the trade`);
        assert.equal(response.json().trade.tradeId, TRADE_ID);
      }
    });

    await t.test("does not expose trades to unrelated accounts", async () => {
      const list = await request("/workspace/trades", tokens.outsider);

      assert.equal(list.statusCode, 200);
      assert.deepEqual(list.json().items, []);

      const detail = await request(
        `/workspace/trades/${TRADE_ID}`,
        tokens.outsider
      );

      assert.equal(detail.statusCode, 404);
      assert.equal(detail.json().error, "TRADE_NOT_FOUND");
    });

    await t.test("allows only buyers and agents to view their mandate", async () => {
      for (const role of ["buyer", "agent"] as const) {
        const response = await request(
          `/workspace/mandates/${MANDATE_ID}`,
          tokens[role]
        );

        assert.equal(response.statusCode, 200, `${role} should see the mandate`);
        assert.equal(response.json().mandate.mandateId, MANDATE_ID);
      }
    });

    await t.test("does not expose mandates to suppliers or unrelated accounts", async () => {
      for (const role of ["supplier", "resolver", "outsider"] as const) {
        const list = await request("/workspace/mandates", tokens[role]);

        assert.equal(list.statusCode, 200);
        assert.deepEqual(list.json().items, []);

        const detail = await request(
          `/workspace/mandates/${MANDATE_ID}`,
          tokens[role]
        );

        assert.equal(detail.statusCode, 404);
        assert.equal(detail.json().error, "MANDATE_NOT_FOUND");
      }
    });
  } finally {
    try {
      await app.close();

      await database.query(
        "DELETE FROM indexer_checkpoints WHERE network = $1 AND contract_id = $2",
        ["testnet", TEST_CONTRACT]
      );

      await database.query(
        "DELETE FROM trades WHERE network = $1 AND contract_id = $2 AND trade_id = $3",
        ["testnet", TEST_CONTRACT, TRADE_ID]
      );

      await database.query(
        "DELETE FROM mandates WHERE network = $1 AND contract_id = $2 AND mandate_id = $3",
        ["testnet", TEST_CONTRACT, MANDATE_ID]
      );

      for (const token of Object.values(tokens)) {
        await database.query(
          "DELETE FROM auth_sessions WHERE token_hash = $1",
          [hashToken(token)]
        );
      }
    } finally {
      mutableNearConfig.contractId = previousContractId;
    }
  }
});
