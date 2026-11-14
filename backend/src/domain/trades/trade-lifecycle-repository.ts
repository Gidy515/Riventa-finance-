import type { QueryResultRow } from "pg";
import { query } from "../../db/pool.js";
import type { TradeScope } from "./trade-repository.js";

interface DocumentRow extends QueryResultRow {
  document_type: string;
  version: number;
  commitment: Buffer | Uint8Array;
  submitted_by: string;
  submitted_at_ns: string;
}

interface InspectionRow extends QueryResultRow {
  assigned_inspector: string;
  replacement_count: number;
  outcome: string | null;
  attesting_inspector: string | null;
  evidence_commitment: Buffer | Uint8Array | null;
  submitted_at_ns: string | null;
}

interface SettlementRow extends QueryResultRow {
  id: string;
  settlement_id: string | null;
  kind: string;
  reason: string | null;
  status: string;
  authorization_source: string | null;
  authorized_by: string | null;
  recipient_account: string | null;
  amount_raw: string | null;
  initiated_at_ns: string | null;
  completed_at_ns: string | null;
  transfer_result: string | null;
}

function toHex(value: Buffer | Uint8Array | null): string | null {
  return value === null ? null : Buffer.from(value).toString("hex");
}

export interface TradeLifecycle {
  documents: Array<{
    documentType: string;
    version: number;
    commitment: string;
    submittedBy: string;
    submittedAtNs: string;
  }>;
  inspection: {
    assignedInspector: string;
    replacementCount: number;
    outcome: string | null;
    attestingInspector: string | null;
    evidenceCommitment: string | null;
    submittedAtNs: string | null;
  } | null;
  settlements: Array<{
    projectionId: string;
    settlementId: string | null;
    kind: string;
    reason: string | null;
    status: string;
    authorizationSource: string | null;
    authorizedBy: string | null;
    recipientAccount: string | null;
    amountRaw: string | null;
    initiatedAtNs: string | null;
    completedAtNs: string | null;
    transferResult: string | null;
  }>;
}

export async function getTradeLifecycleProjection(
  scope: TradeScope,
  tradeId: string
): Promise<TradeLifecycle> {
  const parameters = [scope.network, scope.contractId, tradeId];

  const [documents, inspections, settlements] = await Promise.all([
    query<DocumentRow>(
      `SELECT document_type, version, commitment, submitted_by,
              submitted_at_ns::text AS submitted_at_ns
       FROM documents
       WHERE network = $1 AND contract_id = $2 AND trade_id = $3
       ORDER BY document_type ASC, version ASC`,
      parameters
    ),
    query<InspectionRow>(
      `SELECT assigned_inspector, replacement_count, outcome,
              attesting_inspector, evidence_commitment,
              submitted_at_ns::text AS submitted_at_ns
       FROM inspection_projection
       WHERE network = $1 AND contract_id = $2 AND trade_id = $3`,
      parameters
    ),
    query<SettlementRow>(
      `SELECT id::text AS id, settlement_id, kind, reason, status,
              authorization_source, authorized_by, recipient_account,
              amount_raw::text AS amount_raw,
              initiated_at_ns::text AS initiated_at_ns,
              completed_at_ns::text AS completed_at_ns,
              transfer_result
       FROM settlement_projection
       WHERE network = $1 AND contract_id = $2 AND trade_id = $3
       ORDER BY id ASC`,
      parameters
    )
  ]);

  const inspection = inspections.rows[0];

  return {
    documents: documents.rows.map((row) => ({
      documentType: row.document_type,
      version: row.version,
      commitment: toHex(row.commitment)!,
      submittedBy: row.submitted_by,
      submittedAtNs: row.submitted_at_ns
    })),
    inspection: inspection
      ? {
          assignedInspector: inspection.assigned_inspector,
          replacementCount: inspection.replacement_count,
          outcome: inspection.outcome,
          attestingInspector: inspection.attesting_inspector,
          evidenceCommitment: toHex(inspection.evidence_commitment),
          submittedAtNs: inspection.submitted_at_ns
        }
      : null,
    settlements: settlements.rows.map((row) => ({
      projectionId: row.id,
      settlementId: row.settlement_id,
      kind: row.kind,
      reason: row.reason,
      status: row.status,
      authorizationSource: row.authorization_source,
      authorizedBy: row.authorized_by,
      recipientAccount: row.recipient_account,
      amountRaw: row.amount_raw,
      initiatedAtNs: row.initiated_at_ns,
      completedAtNs: row.completed_at_ns,
      transferResult: row.transfer_result
    }))
  };
}
