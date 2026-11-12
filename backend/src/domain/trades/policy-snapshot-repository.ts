import type { QueryResultRow } from "pg";
import { query } from "../../db/pool.js";
import type { TradeScope } from "./trade-repository.js";

export interface TradePolicySnapshotRecord {
  tradeId: string;
  mandateId: string;
  mandateVersion: string;
  buyerAccount: string;
  agentAccount: string;
  supplierAccount: string;
  resolverAccount: string;
  paymentToken: string;
  amountRaw: string;
  allowReleaseAfterPass: boolean;
  allowRefundAfterFail: boolean;
  mandateExpiresAtNs: string;
  observedBlockHeight: string | null;
}

type PolicySnapshotRow = QueryResultRow & TradePolicySnapshotRecord;

const POLICY_SNAPSHOT_COLUMNS = `
  trade_id::text AS "tradeId",
  mandate_id::text AS "mandateId",
  mandate_version::text AS "mandateVersion",
  buyer_account AS "buyerAccount",
  agent_account AS "agentAccount",
  supplier_account AS "supplierAccount",
  resolver_account AS "resolverAccount",
  payment_token AS "paymentToken",
  amount_raw::text AS "amountRaw",
  allow_release_after_pass AS "allowReleaseAfterPass",
  allow_refund_after_fail AS "allowRefundAfterFail",
  mandate_expires_at_ns::text AS "mandateExpiresAtNs",
  observed_block_height::text AS "observedBlockHeight"
`;

export async function findVisiblePolicySnapshot(
  scope: TradeScope,
  tradeId: string
): Promise<TradePolicySnapshotRecord | null> {
  const result = await query<PolicySnapshotRow>(
    `
      SELECT ${POLICY_SNAPSHOT_COLUMNS}
      FROM trade_policy_snapshots
      WHERE network = $1
        AND contract_id = $2
        AND trade_id = $3::numeric
        AND (
          buyer_account = $4
          OR agent_account = $4
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
