import type { QueryResultRow } from "pg";
import { query } from "../../db/pool.js";
import type { TradeScope } from "./trade-repository.js";

export interface MandateRecord {
  mandateId: string;
  buyerAccount: string;
  agentAccount: string;
  supplierAccount: string;
  resolverAccount: string;
  paymentToken: string;
  maxTradeAmountRaw: string;
  aggregateBudgetRaw: string;
  reservedBudgetRaw: string;
  consumedBudgetRaw: string;
  allowReleaseAfterPass: boolean;
  allowRefundAfterFail: boolean;
  expiresAtNs: string;
  revoked: boolean;
  version: string;
  observedBlockHeight: string | null;
}

export interface MandateListFilter {
  limit: number;
  beforeMandateId?: string;
}

type MandateRow = QueryResultRow & MandateRecord;

const MANDATE_COLUMNS = `
  mandate_id::text AS "mandateId",
  buyer_account AS "buyerAccount",
  agent_account AS "agentAccount",
  supplier_account AS "supplierAccount",
  resolver_account AS "resolverAccount",
  payment_token AS "paymentToken",
  max_trade_amount_raw::text AS "maxTradeAmountRaw",
  aggregate_budget_raw::text AS "aggregateBudgetRaw",
  reserved_budget_raw::text AS "reservedBudgetRaw",
  consumed_budget_raw::text AS "consumedBudgetRaw",
  allow_release_after_pass AS "allowReleaseAfterPass",
  allow_refund_after_fail AS "allowRefundAfterFail",
  expires_at_ns::text AS "expiresAtNs",
  revoked AS "revoked",
  version::text AS "version",
  observed_block_height::text AS "observedBlockHeight"
`;

export async function listVisibleMandates(
  scope: TradeScope,
  filter: MandateListFilter
): Promise<{ items: MandateRecord[]; hasMore: boolean }> {
  const values: unknown[] = [
    scope.network,
    scope.contractId,
    scope.accountId
  ];

  const conditions = [
    "network = $1",
    "contract_id = $2",
    "(buyer_account = $3 OR agent_account = $3)"
  ];

  if (filter.beforeMandateId !== undefined) {
    values.push(filter.beforeMandateId);
    conditions.push(`mandate_id < $${values.length}::numeric`);
  }

  values.push(filter.limit + 1);

  const result = await query<MandateRow>(
    `
      SELECT ${MANDATE_COLUMNS}
      FROM mandates
      WHERE ${conditions.join(" AND ")}
      ORDER BY mandate_id DESC
      LIMIT $${values.length}
    `,
    values
  );

  return {
    items: result.rows.slice(0, filter.limit),
    hasMore: result.rows.length > filter.limit
  };
}

export async function findVisibleMandate(
  scope: TradeScope,
  mandateId: string
): Promise<MandateRecord | null> {
  const result = await query<MandateRow>(
    `
      SELECT ${MANDATE_COLUMNS}
      FROM mandates
      WHERE network = $1
        AND contract_id = $2
        AND mandate_id = $3::numeric
        AND (buyer_account = $4 OR agent_account = $4)
      LIMIT 1
    `,
    [
      scope.network,
      scope.contractId,
      mandateId,
      scope.accountId
    ]
  );

  return result.rows[0] ?? null;
}
