import type { QueryResultRow } from "pg";
import { query } from "../../db/pool.js";

export type TradeState =
  | "AwaitingAcceptance"
  | "Accepted"
  | "Funded"
  | "DocumentReview"
  | "InspectionPending"
  | "InspectionPassed"
  | "InspectionFailed"
  | "Disputed"
  | "ReleaseAuthorized"
  | "RefundAuthorized"
  | "PayoutPending"
  | "RefundPending"
  | "Completed"
  | "Refunded"
  | "Cancelled";

export interface TradeScope {
  network: string;
  contractId: string;
  accountId: string;
}

export interface TradeCursor {
  createdAtNs: string;
  tradeId: string;
}

export interface TradeListFilter {
  state?: TradeState;
  limit: number;
  cursor?: TradeCursor;
}

export interface TradeRecord {
  tradeId: string;
  buyerAccount: string;
  supplierAccount: string;
  resolverAccount: string;
  paymentToken: string;
  amountRaw: string;
  state: TradeState;
  createdAtNs: string;
  acceptByNs: string;
  fundByNs: string | null;
  fundedAtNs: string | null;
  documentsCompletedAtNs: string | null;
  inspectorAssignedAtNs: string | null;
  observedBlockHeight: string | null;
}

type TradeRow = QueryResultRow & TradeRecord;

const TRADE_COLUMNS = `
  trade_id::text AS "tradeId",
  buyer_account AS "buyerAccount",
  supplier_account AS "supplierAccount",
  resolver_account AS "resolverAccount",
  payment_token AS "paymentToken",
  amount_raw::text AS "amountRaw",
  state AS "state",
  created_at_ns::text AS "createdAtNs",
  accept_by_ns::text AS "acceptByNs",
  fund_by_ns::text AS "fundByNs",
  funded_at_ns::text AS "fundedAtNs",
  documents_completed_at_ns::text AS "documentsCompletedAtNs",
  inspector_assigned_at_ns::text AS "inspectorAssignedAtNs",
  observed_block_height::text AS "observedBlockHeight"
`;

export async function listVisibleTrades(
  scope: TradeScope,
  filter: TradeListFilter
): Promise<{ items: TradeRecord[]; hasMore: boolean }> {
  const values: unknown[] = [
    scope.network,
    scope.contractId,
    scope.accountId
  ];

  const conditions = [
    "network = $1",
    "contract_id = $2",
    "(buyer_account = $3 OR supplier_account = $3 OR resolver_account = $3)"
  ];

  if (filter.state !== undefined) {
    values.push(filter.state);
    conditions.push(`state = $${values.length}`);
  }

  if (filter.cursor !== undefined) {
    values.push(filter.cursor.createdAtNs, filter.cursor.tradeId);
    conditions.push(
      `(created_at_ns, trade_id) < ($${values.length - 1}::numeric, $${values.length}::numeric)`
    );
  }

  values.push(filter.limit + 1);

  const result = await query<TradeRow>(
    `
      SELECT ${TRADE_COLUMNS}
      FROM trades
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at_ns DESC, trade_id DESC
      LIMIT $${values.length}
    `,
    values
  );

  const hasMore = result.rows.length > filter.limit;

  return {
    items: result.rows.slice(0, filter.limit),
    hasMore
  };
}

export async function findVisibleTrade(
  scope: TradeScope,
  tradeId: string
): Promise<TradeRecord | null> {
  const result = await query<TradeRow>(
    `
      SELECT ${TRADE_COLUMNS}
      FROM trades
      WHERE network = $1
        AND contract_id = $2
        AND trade_id = $3::numeric
        AND (
          buyer_account = $4
          OR supplier_account = $4
          OR resolver_account = $4
        )
      LIMIT 1
    `,
    [
      scope.network,
      scope.contractId,
      tradeId,
      scope.accountId
    ]
  );

  return result.rows[0] ?? null;
}
