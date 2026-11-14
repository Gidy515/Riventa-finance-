"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getTradeLifecycle,
  type TradeLifecycle,
  type TradeRecord,
} from "@/lib/auth-client";

type DocumentType =
  | "commercial_invoice"
  | "packing_list"
  | "certificate_of_origin";

type WalletCall = (
  methodName: string,
  args: Record<string, unknown>,
  gas: string,
  deposit: string
) => Promise<unknown>;

interface Props {
  trade: TradeRecord;
  accountId: string;
  walletConnected: boolean;
  parentBusy: boolean;
  onWalletCall: WalletCall;
  onTokenWalletCall: WalletCall;
}

const CONTRACT_GAS = "50000000000000";
const SETTLEMENT_GAS = "100000000000000";
const DOCUMENT_TYPES: Array<{ value: DocumentType; label: string }> = [
  { value: "commercial_invoice", label: "Commercial invoice" },
  { value: "packing_list", label: "Packing list" },
  { value: "certificate_of_origin", label: "Certificate of origin" },
];

function safeTradeId(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Invalid trade ID.");
  }

  const parsed = BigInt(value);

  if (parsed < BigInt("0") || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Trade ID exceeds the safe JSON integer range.");
  }

  return Number(parsed);
}

async function sha256(bytes: BufferSource): Promise<number[]> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest));
}

function display(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "Not recorded";
}

export function TradeLifecyclePanel({
  trade,
  accountId,
  walletConnected,
  parentBusy,
  onWalletCall,
  onTokenWalletCall,
}: Props) {
  const [lifecycle, setLifecycle] = useState<TradeLifecycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [documentType, setDocumentType] =
    useState<DocumentType>("commercial_invoice");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [inspectorAccount, setInspectorAccount] = useState("");
  const [replacementAccount, setReplacementAccount] = useState("");
  const [inspectionOutcome, setInspectionOutcome] = useState<"pass" | "fail">(
    "pass"
  );
  const [inspectionEvidence, setInspectionEvidence] = useState("");

  const tradeId = safeTradeId(trade.tradeId);

  const refreshLifecycle = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getTradeLifecycle(trade.tradeId);
      setLifecycle(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load this trade's lifecycle."
      );
    } finally {
      setLoading(false);
    }
  }, [trade.tradeId]);

  useEffect(() => {
    void refreshLifecycle();
  }, [refreshLifecycle]);

  async function execute(
    methodName: string,
    args: Record<string, unknown>,
    gas = CONTRACT_GAS
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await onWalletCall(methodName, args, gas, "0");
      setMessage(
        "Transaction submitted. Refresh the lifecycle to see its indexed on-chain result."
      );
      await refreshLifecycle();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be submitted."
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function registerSupplierTokenStorage() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await onTokenWalletCall(
        "storage_deposit",
        {
          account_id: trade.supplierAccount,
          registration_only: true,
        },
        CONTRACT_GAS,
        "1250000000000000000000"
      );

      setMessage(
        "Supplier storage-registration transaction submitted. Verify its on-chain storage balance before retrying payout."
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Supplier token registration could not be submitted."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitDocument() {
    if (!documentFile) {
      setError("Choose a document file first.");
      return;
    }

    try {
      const existingVersions =
        lifecycle?.documents
          .filter((item) => item.documentType === documentType)
          .map((item) => item.version) ?? [];

      const version = Math.max(0, ...existingVersions) + 1;

      if (version > 2) {
        throw new Error(
          "This document type has reached its two-version limit."
        );
      }

      const commitment = await sha256(await documentFile.arrayBuffer());

      const submitted = await execute("record_document_commitment", {
        trade_id: tradeId,
        document_type: documentType,
        version,
        commitment,
      });

      if (submitted) setDocumentFile(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Document submission failed."
      );
    }
  }

  async function submitInspection() {
    if (!inspectionEvidence.trim()) {
      setError("Enter the inspection evidence or report reference.");
      return;
    }

    const commitment = await sha256(
      new TextEncoder().encode(inspectionEvidence.trim())
    );

    const submitted = await execute("submit_inspection_attestation", {
      trade_id: tradeId,
      outcome: inspectionOutcome,
      evidence_commitment: commitment,
    });

    if (submitted) {
      setInspectionEvidence("");
    }
  }

  const documentsComplete = DOCUMENT_TYPES.every(({ value }) =>
    lifecycle?.documents.some(
      (document) => document.documentType === value && document.version >= 1
    )
  );

  const inspection = lifecycle?.inspection ?? null;
  const isBuyer = accountId === trade.buyerAccount;
  const policySnapshot = lifecycle?.policySnapshot ?? null;

  // No snapshot means a buyer-created trade: the buyer authorizes settlement.
  // A snapshot with the relevant flag enabled delegates authorization to its agent.
  const releaseDelegated = policySnapshot?.allowReleaseAfterPass === true;
  const refundDelegated = policySnapshot?.allowRefundAfterFail === true;

  const releaseAuthority = releaseDelegated
    ? policySnapshot!.agent
    : trade.buyerAccount;
  const refundAuthority = refundDelegated
    ? policySnapshot!.agent
    : trade.buyerAccount;

  const canAuthorizeRelease = accountId === releaseAuthority;
  const canAuthorizeRefund = accountId === refundAuthority;
  const isAssignedInspector =
    accountId !== "" && accountId === inspection?.assignedInspector;
  const canSubmitDocuments =
    trade.supplierAccount === accountId &&
    (trade.state === "Funded" || trade.state === "DocumentReview");
  const canAssignInspector =
    isBuyer &&
    trade.state === "DocumentReview" &&
    documentsComplete &&
    !inspection;
  const canReplaceInspector =
    isBuyer &&
    trade.state === "InspectionPending" &&
    inspection !== null &&
    inspection.replacementCount < 1 &&
    inspection.outcome === null;
  const canAttest =
    isAssignedInspector &&
    trade.state === "InspectionPending" &&
    inspection?.outcome === null;

  return (
    <section className="workspace-empty-panel workspace-trade-panel">
      <span className="workspace-empty-index">TRADE LIFECYCLE</span>
      <h3>Documents, inspection and settlement</h3>

      <button
        className="workspace-secondary-button"
        type="button"
        onClick={() => void refreshLifecycle()}
        disabled={loading || busy}
      >
        {loading ? "Refreshing lifecycle..." : "Refresh lifecycle"}
      </button>

      {error && (
        <p className="workspace-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="workspace-form-hint" role="status">
          {message}
        </p>
      )}

      {loading && !lifecycle && <p>Loading lifecycle records...</p>}

      {lifecycle && (
        <>
          <div className="workspace-session-details">
            <div>
              <span>DOCUMENT COMMITMENTS</span>
              <strong>{lifecycle.documents.length}</strong>
            </div>
            <div>
              <span>INSPECTOR</span>
              <strong>{inspection?.assignedInspector ?? "Not assigned"}</strong>
            </div>
            <div>
              <span>INSPECTION RESULT</span>
              <strong>{display(inspection?.outcome)}</strong>
            </div>
          </div>

          <h4>Supplier documents</h4>
          {lifecycle.documents.length === 0 ? (
            <p>No document commitments have been recorded.</p>
          ) : (
            lifecycle.documents.map((document) => (
              <div
                className="workspace-session-details"
                key={`${document.documentType}-${document.version}`}
              >
                <div>
                  <span>DOCUMENT</span>
                  <strong>{display(document.documentType)}</strong>
                </div>
                <div>
                  <span>VERSION</span>
                  <strong>{document.version}</strong>
                </div>
                <div>
                  <span>SUBMITTED BY</span>
                  <strong>{document.submittedBy}</strong>
                </div>
                <div>
                  <span>SHA-256 COMMITMENT</span>
                  <strong>{document.commitment}</strong>
                </div>
              </div>
            ))
          )}

          {canSubmitDocuments && (
            <div className="workspace-trade-form">
              <h4>Submit a document commitment</h4>
              <p>
                The browser hashes the selected file and submits only its
                SHA-256 commitment. The file itself is not uploaded or stored by
                this action. Retain the original document securely.
              </p>
              <label>
                DOCUMENT TYPE
                <select
                  value={documentType}
                  onChange={(event) =>
                    setDocumentType(event.target.value as DocumentType)
                  }
                  disabled={busy || parentBusy}
                >
                  {DOCUMENT_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                DOCUMENT FILE
                <input
                  type="file"
                  onChange={(event) =>
                    setDocumentFile(event.target.files?.[0] ?? null)
                  }
                  disabled={busy || parentBusy}
                />
              </label>
              <button
                className="workspace-secondary-button"
                type="button"
                onClick={() => void submitDocument()}
                disabled={
                  !walletConnected || busy || parentBusy || !documentFile
                }
              >
                Submit document commitment
              </button>
            </div>
          )}

          {canAssignInspector && (
            <div className="workspace-trade-form">
              <h4>Assign independent inspector</h4>
              <p>
                The inspector must already be registered and active in the
                contract.
              </p>
              <label>
                INSPECTOR NEAR ACCOUNT
                <input
                  value={inspectorAccount}
                  onChange={(event) => setInspectorAccount(event.target.value)}
                  placeholder="inspector.testnet"
                  disabled={busy || parentBusy}
                />
              </label>
              <button
                className="workspace-secondary-button"
                type="button"
                onClick={() =>
                  void execute("assign_inspector", {
                    trade_id: tradeId,
                    inspector_account: inspectorAccount.trim(),
                  })
                }
                disabled={
                  !walletConnected ||
                  busy ||
                  parentBusy ||
                  !inspectorAccount.trim()
                }
              >
                Assign inspector
              </button>
            </div>
          )}

          {canReplaceInspector && (
            <div className="workspace-trade-form">
              <h4>Replace inspector</h4>
              <p>
                One replacement is permitted before an attestation is submitted.
              </p>
              <label>
                REPLACEMENT NEAR ACCOUNT
                <input
                  value={replacementAccount}
                  onChange={(event) =>
                    setReplacementAccount(event.target.value)
                  }
                  placeholder="replacement.testnet"
                  disabled={busy || parentBusy}
                />
              </label>
              <button
                className="workspace-secondary-button"
                type="button"
                onClick={() =>
                  void execute("replace_inspector", {
                    trade_id: tradeId,
                    replacement: replacementAccount.trim(),
                  })
                }
                disabled={
                  !walletConnected ||
                  busy ||
                  parentBusy ||
                  !replacementAccount.trim()
                }
              >
                Replace inspector
              </button>
            </div>
          )}

          {canAttest && (
            <div className="workspace-trade-form">
              <h4>Submit inspection attestation</h4>
              <label>
                INSPECTION OUTCOME
                <select
                  value={inspectionOutcome}
                  onChange={(event) =>
                    setInspectionOutcome(event.target.value as "pass" | "fail")
                  }
                  disabled={busy || parentBusy}
                >
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </select>
              </label>
              <label>
                EVIDENCE REPORT OR REFERENCE
                <textarea
                  value={inspectionEvidence}
                  onChange={(event) =>
                    setInspectionEvidence(event.target.value)
                  }
                  rows={4}
                  placeholder="Enter the inspection report or a stable reference to the off-chain evidence."
                  disabled={busy || parentBusy}
                />
              </label>
              <p>
                Only the SHA-256 commitment is submitted on-chain. Keep the
                underlying evidence available to the authorized parties.
              </p>
              <button
                className="workspace-secondary-button"
                type="button"
                onClick={() => void submitInspection()}
                disabled={
                  !walletConnected ||
                  busy ||
                  parentBusy ||
                  !inspectionEvidence.trim()
                }
              >
                Submit final attestation
              </button>
            </div>
          )}

          {inspection && (
            <div className="workspace-session-details">
              <div>
                <span>REPLACEMENTS USED</span>
                <strong>{inspection.replacementCount} / 1</strong>
              </div>
              <div>
                <span>ATTESTING INSPECTOR</span>
                <strong>
                  {inspection.attestingInspector ?? "Not submitted"}
                </strong>
              </div>
              <div>
                <span>EVIDENCE COMMITMENT</span>
                <strong>
                  {inspection.evidenceCommitment ?? "Not submitted"}
                </strong>
              </div>
            </div>
          )}

          <h4>Settlement</h4>
          {lifecycle.settlements.length === 0 ? (
            <p>No settlement authorization or transfer has been indexed.</p>
          ) : (
            lifecycle.settlements.map((settlement) => (
              <div
                className="workspace-session-details"
                key={settlement.projectionId}
              >
                <div>
                  <span>TYPE</span>
                  <strong>{display(settlement.kind)}</strong>
                </div>
                <div>
                  <span>STATUS</span>
                  <strong>{display(settlement.status)}</strong>
                </div>
                <div>
                  <span>AUTHORIZATION</span>
                  <strong>{display(settlement.authorizationSource)}</strong>
                </div>
                <div>
                  <span>SETTLEMENT ID</span>
                  <strong>{settlement.settlementId ?? "Not initiated"}</strong>
                </div>
                <div>
                  <span>RECIPIENT</span>
                  <strong>
                    {settlement.recipientAccount ?? "Not recorded"}
                  </strong>
                </div>
                <div>
                  <span>AMOUNT (RAW)</span>
                  <strong>{settlement.amountRaw ?? "Not recorded"}</strong>
                </div>
                <div>
                  <span>TRANSFER RESULT</span>
                  <strong>{display(settlement.transferResult)}</strong>
                </div>
              </div>
            ))
          )}

          {trade.state === "InspectionPassed" && (
            <>
              <p className="workspace-form-hint">
                Payout authorization required from{" "}
                {releaseDelegated ? "mandate agent" : "buyer"}:{" "}
                {releaseAuthority}
              </p>
              {canAuthorizeRelease && (
                <button
                  className="workspace-secondary-button"
                  type="button"
                  onClick={() =>
                    void execute(
                      releaseDelegated
                        ? "authorize_mandated_release"
                        : "confirm_release",
                      { trade_id: tradeId }
                    )
                  }
                  disabled={!walletConnected || busy || parentBusy}
                >
                  {releaseDelegated
                    ? "Authorize mandated payout"
                    : "Confirm supplier payout"}
                </button>
              )}
            </>
          )}

          {trade.state === "InspectionFailed" && (
            <>
              <p className="workspace-form-hint">
                Refund authorization required from{" "}
                {refundDelegated ? "mandate agent" : "buyer"}: {refundAuthority}
              </p>
              {canAuthorizeRefund && (
                <button
                  className="workspace-secondary-button"
                  type="button"
                  onClick={() =>
                    void execute(
                      refundDelegated
                        ? "authorize_mandated_refund"
                        : "choose_refund",
                      { trade_id: tradeId }
                    )
                  }
                  disabled={!walletConnected || busy || parentBusy}
                >
                  {refundDelegated
                    ? "Authorize mandated refund"
                    : "Authorize buyer refund"}
                </button>
              )}
            </>
          )}

          {trade.state === "ReleaseAuthorized" && (
            <>
              {accountId === trade.buyerAccount && (
                <button
                  className="workspace-secondary-button"
                  type="button"
                  onClick={() => void registerSupplierTokenStorage()}
                  disabled={!walletConnected || busy || parentBusy}
                >
                  Register supplier to receive SDD (0.00125 NEAR)
                </button>
              )}
              <button
                className="workspace-secondary-button"
                type="button"
                onClick={() =>
                  void execute(
                    "release_payment",
                    { trade_id: tradeId },
                    SETTLEMENT_GAS
                  )
                }
                disabled={!walletConnected || busy || parentBusy}
              >
                Trigger authorized payout
              </button>
            </>
          )}

          {trade.state === "RefundAuthorized" && (
            <button
              className="workspace-secondary-button"
              type="button"
              onClick={() =>
                void execute(
                  "refund_escrow",
                  { trade_id: tradeId },
                  SETTLEMENT_GAS
                )
              }
              disabled={!walletConnected || busy || parentBusy}
            >
              Trigger authorized refund
            </button>
          )}

          <p className="workspace-form-hint">
            A successful wallet prompt confirms submission, not settlement.
            NEP-141 transfers are asynchronous; use Refresh lifecycle to verify
            the indexed settlement status and final trade state.
          </p>
        </>
      )}
    </section>
  );
}
