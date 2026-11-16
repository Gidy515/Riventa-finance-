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
  onSuccess: (message: string) => void;
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
  onSuccess,
}: Props) {
  const [lifecycle, setLifecycle] = useState<TradeLifecycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          : "Unable to load this trade's details."
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

    try {
      await onWalletCall(methodName, args, gas, "0");
      const successMessages: Record<string, string> = {
        record_document_commitment: "Document recorded successfully.",
        submit_inspection_attestation: "Inspection result submitted successfully.",
        assign_inspector: "Independent inspector assigned successfully.",
        replace_inspector: "Independent inspector replaced successfully.",
        authorize_mandated_release: "Payment authorization recorded successfully.",
        confirm_release: "Supplier payment approved successfully.",
        authorize_mandated_refund: "Refund authorization recorded successfully.",
        choose_refund: "Buyer refund approved successfully.",
        release_payment: "Supplier payment completed successfully.",
        refund_escrow: "Refund completed successfully.",
      };
      onSuccess(successMessages[methodName] ?? "Trade update completed successfully.");
      await refreshLifecycle();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your request could not be completed."
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function registerSupplierTokenStorage() {
    setBusy(true);
    setError(null);

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

      onSuccess("Supplier payment account setup completed successfully.");
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
      <span className="workspace-empty-index">TRADE PROGRESS</span>
      <h3>Documents, inspection and payment</h3>

      <button
        className="workspace-secondary-button"
        type="button"
        onClick={() => void refreshLifecycle()}
        disabled={loading || busy}
      >
        {loading ? "Refreshing trade..." : "Refresh trade"}
      </button>

      {error && (
        <p className="workspace-error" role="alert">
          {error}
        </p>
      )}
      {loading && !lifecycle && <p>Loading trade details...</p>}

      {lifecycle && (
        <>
          <div className="workspace-session-details">
            <div>
              <span>DOCUMENTS SUBMITTED</span>
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
            <p>No documents have been submitted yet.</p>
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
                  <span>DOCUMENT FINGERPRINT</span>
                  <strong>{document.commitment}</strong>
                </div>
              </div>
            ))
          )}

          {canSubmitDocuments && (
            <div className="workspace-trade-form">
              <h4>Submit a document</h4>
              <p>
                A secure digital fingerprint of the selected file is recorded with the trade. The file itself is not uploaded or stored by this action. Keep the original document securely.
              </p>
              <label>
                DOCUMENT CATEGORY
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
                SELECT DOCUMENT
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
                Submit document
              </button>
            </div>
          )}

          {canAssignInspector && (
            <div className="workspace-trade-form">
              <h4>Appoint independent inspector</h4>
              <p>
                The inspector must already be registered and active in the
                contract.
              </p>
              <label>
                INSPECTOR ACCOUNT
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
                REPLACEMENT INSPECTOR ACCOUNT
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
              <h4>Submit inspection result</h4>
              <label>
                INSPECTION RESULT
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
                INSPECTION REPORT OR EVIDENCE
                <textarea
                  value={inspectionEvidence}
                  onChange={(event) =>
                    setInspectionEvidence(event.target.value)
                  }
                  rows={4}
                  placeholder="Describe the inspection result or provide a reference to the supporting evidence."
                  disabled={busy || parentBusy}
                />
              </label>
              <p>
                A secure fingerprint of the inspection evidence is recorded with the trade. Keep the original evidence available to the authorized parties.
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
                Submit inspection result
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
                <span>INSPECTION SUBMITTED BY</span>
                <strong>
                  {inspection.attestingInspector ?? "Not submitted"}
                </strong>
              </div>
              <div>
                <span>EVIDENCE FINGERPRINT</span>
                <strong>
                  {inspection.evidenceCommitment ?? "Not submitted"}
                </strong>
              </div>
            </div>
          )}

          <h4>Settlement</h4>
          {lifecycle.settlements.length === 0 ? (
            <p>No payment or refund has been recorded yet.</p>
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
                  <span>APPROVED BY</span>
                  <strong>{display(settlement.authorizationSource)}</strong>
                </div>
                <div>
                  <span>PAYMENT REFERENCE</span>
                  <strong>{settlement.settlementId ?? "Not started"}</strong>
                </div>
                <div>
                  <span>RECIPIENT</span>
                  <strong>
                    {settlement.recipientAccount ?? "Not available"}
                  </strong>
                </div>
                <div>
                  <span>AMOUNT (TOKEN BASE UNITS)</span>
                  <strong>{settlement.amountRaw ?? "Not available"}</strong>
                </div>
                <div>
                  <span>TRANSFER STATUS</span>
                  <strong>{display(settlement.transferResult)}</strong>
                </div>
              </div>
            ))
          )}

          {trade.state === "InspectionPassed" && (
            <>
              <p className="workspace-form-hint">
                Payout authorization required from{" "}
                {releaseDelegated ? "authorized representative" : "buyer"}:{" "}
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
                    ? "Approve representative's payment"
                    : "Approve supplier payment"}
                </button>
              )}
            </>
          )}

          {trade.state === "InspectionFailed" && (
            <>
              <p className="workspace-form-hint">
                Refund authorization required from{" "}
                {refundDelegated ? "authorized representative" : "buyer"}: {refundAuthority}
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
                    ? "Approve representative's refund"
                    : "Approve buyer refund"}
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
                  Enable supplier to receive payment (network fee: 0.00125 NEAR)
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
                Complete approved payment
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
              Complete approved refund
            </button>
          )}

          <p className="workspace-form-hint">
            Approving the request submits the payment or refund; it does not confirm completion. Refresh this trade to check its final payment or refund status.
          </p>
        </>
      )}
    </section>
  );
}
