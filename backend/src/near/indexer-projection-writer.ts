import type { PoolClient } from "pg";
import type { BlockProjectionViews } from "./indexer-projections.js";
import type { IndexedContractEvent } from "./data-server.js";

type Row = Record<string, unknown>;

function object(value: unknown, field: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`INDEXER_INVALID_VIEW_OBJECT:${field}`);
  }
  return value as Row;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`INDEXER_INVALID_VIEW_STRING:${field}`);
  }
  return value;
}

function decimal(value: unknown, field: string): string {
  if (
    typeof value !== "string" &&
    !(
      typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= 0
    )
  ) {
    throw new Error(`INDEXER_INVALID_VIEW_DECIMAL:${field}`);
  }

  const result = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) {
    throw new Error(`INDEXER_INVALID_VIEW_DECIMAL:${field}`);
  }
  return result;
}

function optionalDecimal(value: unknown, field: string): string | null {
  return value === null || value === undefined
    ? null
    : decimal(value, field);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`INDEXER_INVALID_VIEW_BOOLEAN:${field}`);
  }
  return value;
}

function bytes32(value: unknown, field: string): Buffer {
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
    throw new Error(`INDEXER_INVALID_VIEW_BYTES32:${field}`);
  }
  return Buffer.from(value);
}

function optionalObject(value: unknown, field: string): Row | null {
  if (value === null || value === undefined) return null;
  return object(value, field);
}

function eventPayload(event: IndexedContractEvent): Row {
  if (
    !Array.isArray(event.eventData) ||
    event.eventData.length !== 1
  ) {
    throw new Error(`INDEXER_INVALID_EVENT_DATA:${event.eventName}`);
  }
  return object(event.eventData[0], event.eventName);
}

function eventActor(payload: Row): string | null {
  for (const key of ["actor", "inspector", "submitted_by"]) {
    if (typeof payload[key] === "string") return payload[key] as string;
  }
  return null;
}

function eventId(payload: Row, key: string): string | null {
  const value = payload[key];
  if (value === undefined || value === null) return null;
  return decimal(value, key);
}

export async function persistBlockProjections(
  client: PoolClient,
  input: {
    network: string;
    contractId: string;
    blockHeight: number;
    views: BlockProjectionViews;
    events: IndexedContractEvent[];
  }
): Promise<void> {
  const { network, contractId, blockHeight, views, events } = input;
  const height = String(blockHeight);

  // Trades are inserted first because all other trade projections have FKs to them.
  for (const [id, raw] of views.trades) {
    if (raw === null) continue;
    const row = object(raw, `trade:${id}`);

    await client.query(
      `INSERT INTO trades (
        network, contract_id, trade_id, buyer_account, supplier_account,
        resolver_account, payment_token, amount_raw, state, created_at_ns,
        accept_by_ns, fund_by_ns, funded_at_ns, documents_completed_at_ns,
        inspector_assigned_at_ns, observed_block_height
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      ON CONFLICT (network, contract_id, trade_id) DO UPDATE SET
        buyer_account = EXCLUDED.buyer_account,
        supplier_account = EXCLUDED.supplier_account,
        resolver_account = EXCLUDED.resolver_account,
        payment_token = EXCLUDED.payment_token,
        amount_raw = EXCLUDED.amount_raw,
        state = EXCLUDED.state,
        created_at_ns = EXCLUDED.created_at_ns,
        accept_by_ns = EXCLUDED.accept_by_ns,
        fund_by_ns = EXCLUDED.fund_by_ns,
        funded_at_ns = EXCLUDED.funded_at_ns,
        documents_completed_at_ns = EXCLUDED.documents_completed_at_ns,
        inspector_assigned_at_ns = EXCLUDED.inspector_assigned_at_ns,
        observed_block_height = EXCLUDED.observed_block_height,
        updated_at = NOW()
      WHERE trades.observed_block_height IS NULL
         OR trades.observed_block_height <= EXCLUDED.observed_block_height`,
      [
        network, contractId, id,
        string(row.buyer, "trade.buyer"),
        string(row.supplier, "trade.supplier"),
        string(row.resolver, "trade.resolver"),
        string(row.payment_token, "trade.payment_token"),
        decimal(row.amount, "trade.amount"),
        string(row.state, "trade.state"),
        decimal(row.created_at, "trade.created_at"),
        decimal(row.accept_by, "trade.accept_by"),
        optionalDecimal(row.fund_by, "trade.fund_by"),
        optionalDecimal(row.funded_at, "trade.funded_at"),
        optionalDecimal(row.documents_completed_at, "trade.documents_completed_at"),
        optionalDecimal(row.inspector_assigned_at, "trade.inspector_assigned_at"),
        height
      ]
    );
  }

  for (const [id, raw] of views.mandates) {
    if (raw === null) continue;
    const row = object(raw, `mandate:${id}`);

    await client.query(
      `INSERT INTO mandates (
        network, contract_id, mandate_id, buyer_account, agent_account,
        supplier_account, resolver_account, payment_token, max_trade_amount_raw,
        aggregate_budget_raw, reserved_budget_raw, consumed_budget_raw,
        allow_release_after_pass, allow_refund_after_fail, expires_at_ns,
        revoked, version, observed_block_height
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      ON CONFLICT (network, contract_id, mandate_id) DO UPDATE SET
        buyer_account = EXCLUDED.buyer_account,
        agent_account = EXCLUDED.agent_account,
        supplier_account = EXCLUDED.supplier_account,
        resolver_account = EXCLUDED.resolver_account,
        payment_token = EXCLUDED.payment_token,
        max_trade_amount_raw = EXCLUDED.max_trade_amount_raw,
        aggregate_budget_raw = EXCLUDED.aggregate_budget_raw,
        reserved_budget_raw = EXCLUDED.reserved_budget_raw,
        consumed_budget_raw = EXCLUDED.consumed_budget_raw,
        allow_release_after_pass = EXCLUDED.allow_release_after_pass,
        allow_refund_after_fail = EXCLUDED.allow_refund_after_fail,
        expires_at_ns = EXCLUDED.expires_at_ns,
        revoked = EXCLUDED.revoked,
        version = EXCLUDED.version,
        observed_block_height = EXCLUDED.observed_block_height,
        updated_at = NOW()
      WHERE mandates.observed_block_height IS NULL
         OR mandates.observed_block_height <= EXCLUDED.observed_block_height`,
      [
        network, contractId, id,
        string(row.buyer, "mandate.buyer"),
        string(row.agent, "mandate.agent"),
        string(row.supplier, "mandate.supplier"),
        string(row.resolver, "mandate.resolver"),
        string(row.payment_token, "mandate.payment_token"),
        decimal(row.max_trade_amount, "mandate.max_trade_amount"),
        decimal(row.aggregate_budget, "mandate.aggregate_budget"),
        decimal(row.reserved_budget, "mandate.reserved_budget"),
        decimal(row.consumed_budget, "mandate.consumed_budget"),
        boolean(row.allow_release_after_pass, "mandate.allow_release_after_pass"),
        boolean(row.allow_refund_after_fail, "mandate.allow_refund_after_fail"),
        decimal(row.expires_at, "mandate.expires_at"),
        boolean(row.revoked, "mandate.revoked"),
        decimal(row.version, "mandate.version"),
        height
      ]
    );
  }

  for (const [id, raw] of views.policySnapshots) {
    if (raw === null) continue;
    const row = object(raw, `policy_snapshot:${id}`);

    await client.query(
      `INSERT INTO trade_policy_snapshots (
        network, contract_id, trade_id, mandate_id, mandate_version,
        buyer_account, agent_account, supplier_account, resolver_account,
        payment_token, amount_raw, allow_release_after_pass,
        allow_refund_after_fail, mandate_expires_at_ns, observed_block_height
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (network, contract_id, trade_id) DO NOTHING`,
      [
        network, contractId, id,
        decimal(row.mandate_id, "snapshot.mandate_id"),
        decimal(row.mandate_version, "snapshot.mandate_version"),
        string(row.buyer, "snapshot.buyer"),
        string(row.agent, "snapshot.agent"),
        string(row.supplier, "snapshot.supplier"),
        string(row.resolver, "snapshot.resolver"),
        string(row.payment_token, "snapshot.payment_token"),
        decimal(row.amount, "snapshot.amount"),
        boolean(row.allow_release_after_pass, "snapshot.allow_release_after_pass"),
        boolean(row.allow_refund_after_fail, "snapshot.allow_refund_after_fail"),
        decimal(row.mandate_expires_at, "snapshot.mandate_expires_at"),
        height
      ]
    );
  }

  for (const [id, raw] of views.documentCommitments) {
    if (!Array.isArray(raw)) {
      throw new Error(`INDEXER_INVALID_DOCUMENT_COMMITMENTS:${id}`);
    }

    for (const item of raw) {
      const row = object(item, `document:${id}`);
      const documentType = string(row.document_type, "document.document_type");
      if (!["commercial_invoice", "packing_list", "certificate_of_origin"].includes(documentType)) {
        throw new Error("INDEXER_INVALID_DOCUMENT_TYPE");
      }

      await client.query(
        `INSERT INTO documents (
          network, contract_id, trade_id, document_type, version,
          commitment, submitted_by, submitted_at_ns
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (network, contract_id, trade_id, document_type, version)
        DO UPDATE SET
          commitment = EXCLUDED.commitment,
          submitted_by = EXCLUDED.submitted_by,
          submitted_at_ns = EXCLUDED.submitted_at_ns`,
        [
          network, contractId, id, documentType,
          decimal(row.version, "document.version"),
          bytes32(row.commitment, "document.commitment"),
          string(row.submitted_by, "document.submitted_by"),
          decimal(row.submitted_at, "document.submitted_at")
        ]
      );
    }
  }

  for (const [id, raw] of views.inspectionRecords) {
    if (raw === null) continue;
    const row = object(raw, `inspection:${id}`);
    const attestation = optionalObject(row.attestation, "inspection.attestation");

    let outcome: string | null = null;
    let attestingInspector: string | null = null;
    let evidenceCommitment: Buffer | null = null;
    let submittedAt: string | null = null;

    if (attestation) {
      outcome = string(attestation.outcome, "inspection.outcome");
      if (outcome !== "pass" && outcome !== "fail") {
        throw new Error("INDEXER_INVALID_INSPECTION_OUTCOME");
      }
      attestingInspector = string(attestation.inspector, "inspection.inspector");
      evidenceCommitment = bytes32(
        attestation.evidence_commitment,
        "inspection.evidence_commitment"
      );
      submittedAt = decimal(attestation.submitted_at, "inspection.submitted_at");
    }

    await client.query(
      `INSERT INTO inspection_projection (
        network, contract_id, trade_id, assigned_inspector,
        replacement_count, outcome, attesting_inspector,
        evidence_commitment, submitted_at_ns, observed_block_height
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (network, contract_id, trade_id) DO UPDATE SET
        assigned_inspector = EXCLUDED.assigned_inspector,
        replacement_count = EXCLUDED.replacement_count,
        outcome = EXCLUDED.outcome,
        attesting_inspector = EXCLUDED.attesting_inspector,
        evidence_commitment = EXCLUDED.evidence_commitment,
        submitted_at_ns = EXCLUDED.submitted_at_ns,
        observed_block_height = EXCLUDED.observed_block_height,
        updated_at = NOW()
      WHERE inspection_projection.observed_block_height IS NULL
         OR inspection_projection.observed_block_height <= EXCLUDED.observed_block_height`,
      [
        network, contractId, id,
        string(row.assigned_inspector, "inspection.assigned_inspector"),
        decimal(row.replacement_count, "inspection.replacement_count"),
        outcome, attestingInspector, evidenceCommitment, submittedAt, height
      ]
    );
  }

  // Authorization events are recorded independently because the settlement ID
  // does not exist until settlement_initiated.
  for (const event of events) {
    if (event.eventName !== "settlement_authorized") continue;
    const payload = eventPayload(event);
    const tradeId = eventId(payload, "trade_id");
    const authorization = string(payload.authorization, "settlement.authorization");
    const kind = string(payload.kind, "settlement.kind");

    if (!tradeId || !["buyer", "mandate"].includes(authorization) ||
        !["payout", "refund"].includes(kind)) {
      throw new Error("INDEXER_INVALID_SETTLEMENT_AUTHORIZATION");
    }

    await client.query(
      `INSERT INTO settlement_projection (
        network, contract_id, trade_id, kind, status,
        authorization_source, authorized_by, observed_block_height
      ) VALUES ($1,$2,$3,$4,'authorized',$5,$6,$7)`,
      [
        network, contractId, tradeId, kind, authorization,
        string(payload.actor, "settlement.actor"), height
      ]
    );
  }

  for (const [id, raw] of views.settlements) {
    if (raw === null) continue;
    const row = object(raw, `settlement:${id}`);
    const tradeId = decimal(row.trade_id, "settlement.trade_id");
    const kind = string(row.kind, "settlement.kind");
    const reason = string(row.reason, "settlement.reason");
    const status = string(row.status, "settlement.status");

    if (!["payout", "refund"].includes(kind) ||
        !["standard", "supplier_documents_timeout", "inspector_assignment_timeout", "inspection_timeout"].includes(reason) ||
        !["pending", "succeeded", "failed"].includes(status)) {
      throw new Error("INDEXER_INVALID_SETTLEMENT_VIEW");
    }

    const dbStatus = status === "pending" ? "initiated" : status;
    const completedAt = optionalDecimal(row.completed_at, "settlement.completed_at");

    // Attach the new on-chain ID to the latest unlinked authorization, if any.
    const linked = await client.query(
      `UPDATE settlement_projection SET
        settlement_id = $4,
        recipient_account = $5,
        amount_raw = $6,
        reason = $7,
        status = $8,
        initiated_at_ns = $9,
        completed_at_ns = $10,
        transfer_result = $11,
        observed_block_height = $12,
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM settlement_projection
        WHERE network = $1 AND contract_id = $2
          AND trade_id = $3 AND settlement_id IS NULL
          AND status = 'authorized'
        ORDER BY id DESC LIMIT 1
      )
      RETURNING id`,
      [
        network, contractId, tradeId, id,
        string(row.recipient, "settlement.recipient"),
        decimal(row.amount, "settlement.amount"),
        reason, dbStatus,
        decimal(row.created_at, "settlement.created_at"),
        completedAt, status === "pending" ? null : status, height
      ]
    );

    if (linked.rowCount === 0) {
      await client.query(
        `INSERT INTO settlement_projection (
          network, contract_id, trade_id, settlement_id, kind, reason,
          status, recipient_account, amount_raw, initiated_at_ns,
          completed_at_ns, transfer_result, observed_block_height
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (network, contract_id, settlement_id) WHERE settlement_id IS NOT NULL
        DO UPDATE SET
          kind = EXCLUDED.kind,
          reason = EXCLUDED.reason,
          status = EXCLUDED.status,
          recipient_account = EXCLUDED.recipient_account,
          amount_raw = EXCLUDED.amount_raw,
          initiated_at_ns = EXCLUDED.initiated_at_ns,
          completed_at_ns = EXCLUDED.completed_at_ns,
          transfer_result = EXCLUDED.transfer_result,
          observed_block_height = EXCLUDED.observed_block_height,
          updated_at = NOW()
        WHERE settlement_projection.observed_block_height IS NULL
           OR settlement_projection.observed_block_height <= EXCLUDED.observed_block_height`,
        [
          network, contractId, tradeId, id, kind, reason, dbStatus,
          string(row.recipient, "settlement.recipient"),
          decimal(row.amount, "settlement.amount"),
          decimal(row.created_at, "settlement.created_at"),
          completedAt, status === "pending" ? null : status, height
        ]
      );
    }
  }
}
