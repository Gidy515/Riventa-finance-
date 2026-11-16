"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Account,
  NearConnector,
  NearWalletBase,
} from "@hot-labs/near-connect";

import {
  createChallenge,
  getCurrentSession,
  getWorkspaceStatus,
  listMandates,
  listTrades,
  logout,
  verifyChallenge,
} from "@/lib/auth-client";

import { TradeLifecyclePanel } from "@/components/auth/trade-lifecycle-panel";

import type {
  AuthSession,
  MandatePage,
  TradeCursor,
  TradePage,
  TradeRecord,
  WorkspaceStatus,
} from "@/lib/auth-client";

type ViewState = "loading" | "signed-out" | "signed-in";
type OperationalDataState = "blocked" | "loading" | "ready" | "error";

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    NEAR_RPC_UNAVAILABLE:
      "NEAR testnet could not be reached. Please try again.",
    NEAR_ACCESS_KEY_NOT_FOUND:
      "The signing key could not be verified on NEAR testnet.",
    FULL_ACCESS_KEY_REQUIRED:
      "This account must sign with a full-access Ed25519 key.",
    CHALLENGE_ALREADY_USED_OR_EXPIRED:
      "Your sign-in challenge expired or was already used. Please try again.",
    INVALID_SIGNATURE: "The wallet signature could not be verified.",
    INVALID_STATE:
      "The sign-in request could not be validated. Please try again.",
    UNAUTHENTICATED: "Your session has expired. Please sign in again.",
  };

  if (messages[error.message]) {
    return messages[error.message];
  }

  if (
    error.message.toLowerCase().includes("user rejected") ||
    error.message.toLowerCase().includes("user cancelled") ||
    error.message.toLowerCase().includes("user canceled")
  ) {
    return "Wallet connection was cancelled.";
  }

  if (error.message === "REQUEST_FAILED") {
    return "The request could not be completed. Please try again.";
  }

  return error.message;
}

const USDC_DECIMALS = 6;
const USDC_SCALE = BigInt(10) ** BigInt(USDC_DECIMALS);
const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);

function parseUsdcAmountToRaw(value: string): string {
  const normalized = value.trim();

  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error(
      "Enter a valid USDC amount with no more than 6 decimal places."
    );
  }

  const [whole, fraction = ""] = normalized.split(".");
  const raw =
    BigInt(whole) * USDC_SCALE +
    BigInt(fraction.padEnd(USDC_DECIMALS, "0") || "0");

  if (raw <= BigInt(0)) {
    throw new Error("The trade amount must be greater than zero.");
  }

  if (raw > U128_MAX) {
    throw new Error("The trade amount exceeds the supported maximum.");
  }

  return raw.toString();
}

function formatRawUsdcAmount(value: string): string {
  if (!/^\d+$/.test(value)) return "Invalid amount";

  const raw = BigInt(value);
  const whole = (raw / USDC_SCALE).toString();
  const fraction = (raw % USDC_SCALE)
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");

  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

function formatTradeDate(value: string): string {
  try {
    const milliseconds = Number(BigInt(value) / BigInt(1_000_000));
    if (!Number.isFinite(milliseconds)) return "—";
    return new Date(milliseconds).toLocaleString();
  } catch {
    return "—";
  }
}

function formatStatus(value: string): string {
  const labels: Record<string, string> = {
    deployment_unverified: "Deployment not verified",
    not_deployed: "Not deployed",
    not_started: "Not started",
    waiting_for_indexer: "Waiting for trade updates",
    indexed: "Trade updates available",
    available: "Available",
  };

  return labels[value] ?? value.replaceAll("_", " ");
}

const SDD_TOKEN_CONTRACT = "sdd.gidy515.testnet";
const CONTRACT_GAS = "50000000000000";
const ACCEPT_GAS = "30000000000000";
const FT_TRANSFER_GAS = "100000000000000";

async function hashCommitment(value: string): Promise<number[]> {
  const bytes = new TextEncoder().encode(value.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest));
}

function toNearU64(value: string): number {
  const parsed = BigInt(value);

  if (parsed < BigInt(0) || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      "This trade ID cannot safely be submitted by this browser."
    );
  }

  return Number(parsed);
}

function readNearReturnValue(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== "object") return null;

  const status = (
    outcome as {
      status?: { SuccessValue?: string };
    }
  ).status;

  if (typeof status?.SuccessValue !== "string") return null;

  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(window.atob(status.SuccessValue), (c) => c.charCodeAt(0))
    );

    return String(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export function WorkspaceClient({ page = "overview" }: { page?: "overview" | "activity" }) {
  const [view, setView] = useState<ViewState>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [workspaceStatus, setWorkspaceStatus] =
    useState<WorkspaceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tradePage, setTradePage] = useState<TradePage | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [mandatePage, setMandatePage] = useState<MandatePage | null>(null);
  const [operationalDataState, setOperationalDataState] =
    useState<OperationalDataState>("blocked");
  const [operationalDataError, setOperationalDataError] = useState<
    string | null
  >(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [transactionMessage, setTransactionMessage] = useState<string | null>(
    null
  );
  const [supplierAccount, setSupplierAccount] = useState("");
  const [tradeAmount, setTradeAmount] = useState("10000");
  const [resolverAccount, setResolverAccount] = useState("");
  const [inspectionTerms, setInspectionTerms] = useState("");
  const [refundTerms, setRefundTerms] = useState("");
  const [agreementTerms, setAgreementTerms] = useState("");

  const connectorRef = useRef<NearConnector | null>(null);
  const walletRef = useRef<NearWalletBase | null>(null);
  const mountedRef = useRef(true);

  async function refreshOperationalData(status: WorkspaceStatus) {
    const infrastructure = status.infrastructure;

    const infrastructureReady = infrastructure.contract.accountId !== null;

    if (!infrastructureReady) {
      setTradePage(null);
      setMandatePage(null);
      setOperationalDataError(null);
      setOperationalDataState("blocked");
      return;
    }

    setOperationalDataState("loading");
    setOperationalDataError(null);

    try {
      const [allTrades, mandates] = await Promise.all([
        (async () => {
          const items: TradeRecord[] = [];
          let cursor: TradeCursor | undefined;

          do {
            const page = await listTrades({ limit: 10, cursor });
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
          } while (cursor);

          return items;
        })(),
        listMandates({ limit: 10 }),
      ]);

      if (!mountedRef.current) return;

      setTradePage({ items: allTrades, nextCursor: null });
      setMandatePage(mandates);
      setOperationalDataState("ready");
    } catch (caught) {
      if (!mountedRef.current) return;

      setTradePage(null);
      setMandatePage(null);
      setOperationalDataError(describeError(caught));
      setOperationalDataState("error");
    }
  }

  async function refreshWorkspaceStatus() {
    if (!mountedRef.current) return;

    setStatusLoading(true);
    setStatusError(null);

    try {
      const result = await getWorkspaceStatus();

      if (!mountedRef.current) return;

      setWorkspaceStatus(result);
      await refreshOperationalData(result);

      if (!mountedRef.current) return;

      setSession({
        accountId: result.account.accountId,
        network: result.account.network,
        expiresAt: result.account.expiresAt,
        publicKey: session?.publicKey ?? "",
      });
    } catch (caught) {
      if (!mountedRef.current) return;
      setStatusError(describeError(caught));
    } finally {
      if (mountedRef.current) {
        setStatusLoading(false);
      }
    }
  }

  async function restoreWalletConnection(accountId: string) {
    try {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const connector = new NearConnector({
        network: "testnet",
        autoConnect: true,
      });

      connectorRef.current = connector;

      const wallet = await connector.wallet();
      const availableAccounts = await wallet.getAccounts({
        network: "testnet",
      });
      const authenticatedAccount = availableAccounts.find(
        (account) => account.accountId === accountId
      );

      if (!mountedRef.current) return;

      if (!authenticatedAccount) {
        walletRef.current = null;
        setWalletConnected(false);
        setAccounts([]);
        setSelectedAccountId("");
        return;
      }

      walletRef.current = wallet;
      setAccounts(availableAccounts);
      setSelectedAccountId(accountId);
      setWalletConnected(true);
    } catch {
      // A missing or expired wallet connection must not invalidate the
      // separate Riventa authentication session. Keep the reconnect action visible.
      if (!mountedRef.current) return;

      walletRef.current = null;
      setWalletConnected(false);
      setAccounts([]);
      setSelectedAccountId("");
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    getCurrentSession()
      .then((result) => {
        if (!mountedRef.current) return;

        setSession(result.session);
        setView("signed-in");

        void refreshWorkspaceStatus();
        void restoreWalletConnection(result.session.accountId);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setView("signed-out");
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!transactionMessage) return;

    const timeout = window.setTimeout(() => {
      setTransactionMessage(null);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [transactionMessage]);

  async function handleConnectWallet() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const { NearConnector } = await import("@hot-labs/near-connect");

      const connector = new NearConnector({
        network: "testnet",
        autoConnect: false,
      });

      connectorRef.current = connector;

      await connector.whenManifestLoaded;

      const walletId = await connector.selectWallet({
        features: {
          signMessage: true,
          signAndSendTransaction: true,
        },
      });

      const wallet = await connector.connect({ walletId });

      walletRef.current = wallet;
      setWalletConnected(true);

      const availableAccounts = await wallet.getAccounts({
        network: "testnet",
      });

      if (availableAccounts.length === 0) {
        throw new Error(
          "The connected wallet did not return any NEAR testnet accounts."
        );
      }

      if (!mountedRef.current) return;

      setAccounts(availableAccounts);
      setSelectedAccountId("");
    } catch (caught) {
      const failedConnector = connectorRef.current;
      const failedWallet = walletRef.current;

      connectorRef.current = null;
      walletRef.current = null;
      setWalletConnected(false);

      setAccounts([]);
      setSelectedAccountId("");

      await failedConnector
        ?.disconnect(failedWallet ?? undefined)
        .catch(() => undefined);

      if (mountedRef.current) {
        setError(describeError(caught));
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  async function handleSignIn() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const wallet = walletRef.current;

      const account = accounts.find(
        (candidate) => candidate.accountId === selectedAccountId
      );

      if (!wallet) {
        throw new Error("Connect your NEAR wallet before signing in.");
      }

      if (!account) {
        throw new Error("Select a valid NEAR account before signing in.");
      }

      const challenge = await createChallenge(account.accountId);

      const signedMessage = await wallet.signMessage({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: decodeBase64(challenge.nonce),
        network: "testnet",
        signerId: account.accountId,
      });

      if (signedMessage.accountId !== account.accountId) {
        throw new Error(
          "The wallet signed the challenge with a different account."
        );
      }

      const result = await verifyChallenge({
        challengeId: challenge.challengeId,
        accountId: account.accountId,
        publicKey: signedMessage.publicKey,
        signature: signedMessage.signature,
        state: challenge.state,
      });

      if (!mountedRef.current) return;

      setSession(result.session);
      setView("signed-in");

      void refreshWorkspaceStatus();
    } catch (caught) {
      if (mountedRef.current) {
        setError(describeError(caught));
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  async function submitWalletCall(
    receiverId: string,
    methodName: string,
    args: Record<string, unknown>,
    gas: string,
    deposit: string
  ): Promise<unknown> {
    if (!session) {
      throw new Error("Your authenticated session is unavailable.");
    }

    const wallet = walletRef.current;

    if (!wallet) {
      throw new Error(
        "Reconnect your NEAR wallet before submitting a transaction."
      );
    }

    const availableAccounts = await wallet.getAccounts({
      network: "testnet",
    });

    const matchingAccount = availableAccounts.find(
      (account) => account.accountId === session.accountId
    );

    if (!matchingAccount) {
      throw new Error(
        "The connected wallet does not contain your authenticated account. Reconnect the correct wallet."
      );
    }

    return wallet.signAndSendTransaction({
      network: "testnet",
      signerId: session.accountId,
      receiverId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName,
            args,
            gas,
            deposit,
          },
        },
      ],
    });
  }

  async function handleCreateTrade(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError(null);
    setTransactionMessage(null);

    try {
      if (!workspaceStatus?.infrastructure.contract.accountId) {
        throw new Error("The Riventa contract account is not configured.");
      }

      if (
        !supplierAccount.trim() ||
        !resolverAccount.trim() ||
        !inspectionTerms.trim() ||
        !refundTerms.trim() ||
        !agreementTerms.trim()
      ) {
        throw new Error("Complete all trade proposal fields.");
      }

      const amountRaw = parseUsdcAmountToRaw(tradeAmount);

      const commitments = await Promise.all([
        hashCommitment(inspectionTerms),
        hashCommitment(refundTerms),
        hashCommitment(agreementTerms),
      ]);

      const outcome = await submitWalletCall(
        workspaceStatus.infrastructure.contract.accountId,
        "create_trade",
        {
          supplier: supplierAccount.trim(),
          proposed_resolver: resolverAccount.trim(),
          amount: amountRaw,
          inspection_criteria_commitment: commitments[0],
          refund_terms_commitment: commitments[1],
          agreement_commitment: commitments[2],
        },
        CONTRACT_GAS,
        "0"
      );

      const tradeId = readNearReturnValue(outcome);

      setTransactionMessage(
        tradeId !== null
          ? `Trade created successfully · Trade ID ${tradeId}`
          : "Trade proposal submitted successfully. Refresh trade activity to confirm its status."
      );

      setSupplierAccount("");
      setTradeAmount("10000");
      setResolverAccount("");
      setInspectionTerms("");
      setRefundTerms("");
      setAgreementTerms("");

      await refreshWorkspaceStatus();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleAcceptTrade(tradeId: string) {
    if (busy) return;

    setBusy(true);
    setError(null);
    setTransactionMessage(null);

    try {
      const contractId = workspaceStatus?.infrastructure.contract.accountId;

      if (!contractId) {
        throw new Error("The Riventa contract account is not configured.");
      }

      await submitWalletCall(
        contractId,
        "accept_trade",
        { trade_id: toNearU64(tradeId) },
        ACCEPT_GAS,
        "0"
      );

      setTransactionMessage(`Trade ${tradeId} accepted successfully.`);
      await refreshWorkspaceStatus();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleFundTrade(tradeId: string) {
    if (busy) return;

    setBusy(true);
    setError(null);
    setTransactionMessage(null);

    try {
      const contractId = workspaceStatus?.infrastructure.contract.accountId;

      if (!contractId) {
        throw new Error("The Riventa contract account is not configured.");
      }

      const trade = tradePage?.items.find(
        (item) => item.tradeId === tradeId
      );

      if (!trade) {
        throw new Error(
          "Trade details are unavailable. Refresh trade activity and try again."
        );
      }

      if (!/^\d+$/.test(trade.amountRaw)) {
        throw new Error("The recorded trade amount is invalid.");
      }

      const fundingAmount = BigInt(trade.amountRaw);

      if (fundingAmount <= BigInt(0) || fundingAmount > U128_MAX) {
        throw new Error("The recorded trade amount is outside the supported range.");
      }

      await submitWalletCall(
        SDD_TOKEN_CONTRACT,
        "ft_transfer_call",
        {
          receiver_id: contractId,
          amount: trade.amountRaw,
          msg: JSON.stringify({ trade_id: toNearU64(tradeId) }),
        },
        FT_TRANSFER_GAS,
        "1"
      );

      setTransactionMessage(
        `Funding request for trade ${tradeId} submitted. Refresh trade activity to check its status.`
      );

      await refreshWorkspaceStatus();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleLogout() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await logout();

      if (connectorRef.current) {
        await connectorRef.current
          .disconnect(walletRef.current ?? undefined)
          .catch(() => undefined);

        connectorRef.current = null;
        walletRef.current = null;
        setWalletConnected(false);
      }

      if (!mountedRef.current) return;

      setSession(null);
      setAccounts([]);
      setSelectedAccountId("");
      setWorkspaceStatus(null);
      setStatusError(null);
      setTradePage(null);
      setMandatePage(null);
      setOperationalDataError(null);
      setOperationalDataState("blocked");
      setTransactionMessage(null);
      setView("signed-out");
    } catch (caught) {
      if (mountedRef.current) {
        setError(describeError(caught));
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  if (view === "loading") {
    return (
      <main className="workspace-screen">
        <div className="workspace-loading">
          <span className="workspace-loading-spinner" aria-hidden="true" />
          <p>Opening your workspace</p>
        </div>
      </main>
    );
  }

  if (view === "signed-out") {
    return (
      <main className="workspace-screen">
        <div className="workspace-auth-layout">
          <a className="workspace-wordmark" href="/">
            <img className="brand-mark" src="/riventa-mark.svg" alt="" />
            Riventa
          </a>

          <section className="workspace-auth-panel">
            <p className="workspace-eyebrow">RIVENTA WORKSPACE</p>

            <h1>Trade operations, under control.</h1>

            <p className="workspace-auth-description">
              Connect your NEAR wallet to access your trade workspace, review
              mandates, and manage verified trade activity.
            </p>

            <div className="workspace-auth-divider" />

            <div className="workspace-auth-method">
              <span className="workspace-method-icon">N</span>
              <div>
                <strong>NEAR Wallet</strong>
                <span>Secure wallet connection</span>
              </div>
            </div>

            {accounts.length === 0 ? (
              <button
                className="workspace-primary-button"
                type="button"
                onClick={handleConnectWallet}
                disabled={busy}
              >
                {busy ? "Connecting wallet..." : "Connect NEAR wallet"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            ) : (
              <>
                <div className="workspace-account-selector">
                  <label htmlFor="near-account-select">
                    SELECT NEAR ACCOUNT
                  </label>

                  <select
                    id="near-account-select"
                    value={selectedAccountId}
                    onChange={(event) =>
                      setSelectedAccountId(event.target.value)
                    }
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Choose an account
                    </option>

                    {accounts.map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.accountId}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="workspace-primary-button"
                  type="button"
                  onClick={handleSignIn}
                  disabled={busy || !selectedAccountId}
                >
                  {busy ? "Signing in..." : "Continue"}
                  {!busy && <span aria-hidden="true">↗</span>}
                </button>
              </>
            )}

            <p className="workspace-auth-note">
              Connect your wallet, select the NEAR testnet account you want to
              use, then sign a one-time authentication message. No transaction
              is submitted.
            </p>

            {error && (
              <p className="workspace-error" role="alert">
                {error}
              </p>
            )}

            <a className="workspace-back-link" href="/">
              ← Back to Riventa
            </a>
          </section>

          <p className="workspace-auth-footer">
            PRIVATE TRADE OPERATIONS · SECURE ACCESS
          </p>
        </div>
      </main>
    );
  }

  const infrastructure = workspaceStatus?.infrastructure;
  const selectedTrade =
    tradePage?.items.find((trade) => trade.tradeId === selectedTradeId) ?? null;

  return (
    <main className="workspace-screen">
      {transactionMessage && (
        <div className="workspace-toast" role="status" aria-live="polite">
          <span className="workspace-toast-icon" aria-hidden="true">✓</span>
          <span>{transactionMessage}</span>
          <button
            type="button"
            className="workspace-toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setTransactionMessage(null)}
          >
            ×
          </button>
        </div>
      )}
      <header className="workspace-topbar">
        <a className="workspace-wordmark" href="/">
          <img className="brand-mark" src="/riventa-mark.svg" alt="" />
          Riventa
          <span className="workspace-topbar-label">WORKSPACE</span>
        </a>

        <div className="workspace-account">
          <span className="workspace-status-dot" />
          <span>{session?.accountId}</span>
          {!walletConnected ? (
            <button type="button" onClick={handleConnectWallet} disabled={busy}>
              Reconnect wallet
            </button>
          ) : (
            <span className="workspace-wallet-connected">ACCOUNT CONNECTED</span>
          )}
          <button type="button" onClick={handleLogout} disabled={busy}>
            {busy ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>

      <section className="workspace-content">
        {page === "overview" ? (
          <>
        <div className="workspace-heading-row">
          <div>
            <p className="workspace-eyebrow">OVERVIEW</p>
            <h1>Your trade workspace</h1>
            <p className="workspace-content-description">
              Manage your transactions, authorizations and trade activity.
            </p>
          </div>

          <button
            className="workspace-refresh-button"
            type="button"
            onClick={refreshWorkspaceStatus}
            disabled={statusLoading}
          >
            <span aria-hidden="true">↻</span>
            {statusLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {statusError && (
          <p className="workspace-error" role="alert">
            {statusError}
          </p>
        )}

        <section className="workspace-infrastructure">
          <div className="workspace-section-heading">
            <div>
              <p className="workspace-empty-index">01 / WORKSPACE</p>
              <h2>Workspace availability</h2>
            </div>
            <span className="workspace-live-label">
              {statusLoading ? "CHECKING" : "SERVICE STATUS"}
            </span>
          </div>

          {!workspaceStatus ? (
            <div className="workspace-status-loading">
              {statusLoading
                ? "Checking workspace availability..."
                : "Workspace services are temporarily unavailable. Please refresh and try again."}
            </div>
          ) : (
            <div className="workspace-infrastructure-grid">
              <article className="workspace-infrastructure-card">
                <div className="workspace-card-topline">
                  <span className="workspace-card-label">TRADE SERVICES</span>
                </div>
                <h3>Trade service</h3>
                <p>
                  {infrastructure!.contract.accountId ? "The trade service account is configured, but its deployment has not been verified." : "The trade service has not been deployed or configured yet."}
                </p>
              </article>

              <article className="workspace-infrastructure-card">
                <div className="workspace-card-topline">
                  <span className="workspace-card-label">TRADE UPDATES</span>
                </div>
                <h3>Trade activity updates</h3>
                <p>
                  Trade activity updates are not available yet.
                </p>
              </article>

              <article className="workspace-infrastructure-card">
                <div className="workspace-card-topline">
                  <span className="workspace-card-label">TRADE DATA</span>
                </div>
                <h3>Trade records</h3>
                <p>
                  Trade records and related updates are not available yet. Please check back shortly.
                </p>
              </article>
            </div>
          )}
        </section>

        <section className="workspace-activity-entry">
          <div>
            <span className="workspace-empty-index">02 / TRADE ACTIVITY</span>
            <h2>Trade activity</h2>
            <p>
              Review trade records, respond to proposals, fund trades, and track each trade's progress.
            </p>
          </div>
          <a href="/workspace/activity" className="workspace-activity-link">
            View trade activity
            <span aria-hidden="true">↗</span>
          </a>
        </section>

        <section className="workspace-empty-panel workspace-trade-panel">
          <span className="workspace-empty-index">03 / NEW TRADE</span>
          <h2>Propose a trade</h2>
          <p>
            Create a trade proposal by entering the supplier, independent reviewer
            and agreed terms. The original agreement and supporting documents
            remain private. Set the agreed funding amount below. Amounts are
            displayed as USDC, with up to 6 decimal places.
          </p>

          <form className="workspace-trade-form" onSubmit={handleCreateTrade}>
            <label>
              TRADE AMOUNT (USDC)
              <input
                type="text"
                inputMode="decimal"
                value={tradeAmount}
                onChange={(event) => setTradeAmount(event.target.value)}
                placeholder="10000.00"
                required
                disabled={busy}
              />
            </label>

            <label>
              SUPPLIER ACCOUNT
              <input
                value={supplierAccount}
                onChange={(event) => setSupplierAccount(event.target.value)}
                placeholder="supplier.testnet"
                required
                disabled={busy}
              />
            </label>

            <label>
              INDEPENDENT REVIEWER ACCOUNT
              <input
                value={resolverAccount}
                onChange={(event) => setResolverAccount(event.target.value)}
                placeholder="resolver.testnet"
                required
                disabled={busy}
              />
            </label>

            <label>
              INSPECTION CRITERIA
              <textarea
                value={inspectionTerms}
                onChange={(event) => setInspectionTerms(event.target.value)}
                placeholder="Describe the inspection requirements and pass/fail criteria."
                required
                disabled={busy}
                rows={3}
              />
            </label>

            <label>
              REFUND TERMS
              <textarea
                value={refundTerms}
                onChange={(event) => setRefundTerms(event.target.value)}
                placeholder="Describe the agreed refund conditions."
                required
                disabled={busy}
                rows={3}
              />
            </label>

            <label>
              TRADE AGREEMENT
              <textarea
                value={agreementTerms}
                onChange={(event) => setAgreementTerms(event.target.value)}
                placeholder="Enter the trade agreement or a canonical summary of its terms."
                required
                disabled={busy}
                rows={4}
              />
            </label>

            <button
              className="workspace-primary-button"
              type="submit"
              disabled={
                busy ||
                !walletConnected ||
                !workspaceStatus?.infrastructure.contract.accountId
              }
            >
              {busy ? "Submitting..." : "Create trade proposal"}
              {!busy && <span aria-hidden="true">↗</span>}
            </button>

            {!walletConnected && (
              <p className="workspace-form-hint">
                Reconnect your account to continue.
              </p>
            )}
          </form>
        </section>

        <section className="workspace-empty-panel workspace-trade-panel">
          <span className="workspace-empty-index">04 / AUTHORIZATIONS</span>
          <h2>Agent authorizations</h2>

          {operationalDataState === "blocked" && (
            <p>
              Your agent authorizations will appear here when they are available.
            </p>
          )}

          {operationalDataState === "loading" && (
            <p>Loading your authorizations...</p>
          )}

          {operationalDataState === "error" && (
            <p className="workspace-error" role="alert">
              {operationalDataError}
            </p>
          )}

          {operationalDataState === "ready" && mandatePage && (
            <>
              <p>
                {mandatePage.items.length === 0
                  ? "No agent authorizations are associated with this account yet."
                  : `${mandatePage.items.length} authorizations found.`}
              </p>

              {mandatePage.items.map((mandate) => (
                <div
                  className="workspace-session-details"
                  key={mandate.mandateId}
                >
                  <div>
                    <span>AUTHORIZATION ID</span>
                    <strong>{mandate.mandateId}</strong>
                  </div>
                  <div>
                    <span>AUTHORIZED AGENT</span>
                    <strong>{mandate.agentAccount}</strong>
                  </div>
                  <div>
                    <span>STATUS</span>
                    <strong>{mandate.revoked ? "Revoked" : "Active"}</strong>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="workspace-empty-panel workspace-trade-panel">
          <span className="workspace-empty-index">05 / ACCOUNT</span>
          <h2>Your account</h2>

          <div className="workspace-session-details">
            <div>
              <span>ACCOUNT</span>
              <strong>{session?.accountId}</strong>
            </div>
            <div>
              <span>SESSION EXPIRY</span>
              <strong>
                {session?.expiresAt
                  ? new Date(session.expiresAt).toLocaleString()
                  : "—"}
              </strong>
            </div>
          </div>
        </section>

        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
          </>
        ) : (
          <>
        <div className="workspace-heading-row">
          <div>
            <p className="workspace-eyebrow">TRADE OPERATIONS</p>
            <h1>Trade activity</h1>
            <p className="workspace-content-description">
              Review trade records, take required actions, and manage each trade through to completion.
            </p>
          </div>
          <a className="workspace-back-link" href="/workspace">
            <span aria-hidden="true">←</span>
            Back to overview
          </a>
        </div>

        {statusError && (
          <p className="workspace-error" role="alert">
            {statusError}
          </p>
        )}

        <section className="workspace-empty-panel workspace-trade-panel">
          <span className="workspace-empty-index">02 / TRADE ACTIVITY</span>
          <h2>Trade activity</h2>

          {operationalDataState === "blocked" && (
            <p>
              Trade records will appear here once trade services are ready. Please check back shortly.
            </p>
          )}

          {operationalDataState === "loading" && (
            <p>Loading your trade activity...</p>
          )}

          {operationalDataState === "error" && (
            <p className="workspace-error" role="alert">
              {operationalDataError}
            </p>
          )}

          {operationalDataState === "ready" && tradePage && (
            <>
              <p>
                {tradePage.items.length === 0
                  ? "No trades are associated with this account yet."
                  : `${tradePage.items.length} trades found.`}
              </p>

              <div className="workspace-trade-grid">
                {tradePage.items.map((trade) => {
                  const counterparty =
                    trade.buyerAccount === session?.accountId
                      ? trade.supplierAccount
                      : trade.buyerAccount;
                  const isSelected = selectedTradeId === trade.tradeId;

                  return (
                    <button
                      className={`workspace-trade-card${isSelected ? " is-selected" : ""}`}
                      key={trade.tradeId}
                      type="button"
                      onClick={() => setSelectedTradeId(isSelected ? null : trade.tradeId)}
                      aria-expanded={isSelected}
                      aria-controls={isSelected ? "workspace-selected-trade" : undefined}
                    >
                      <span className="workspace-trade-card-topline">
                        <span>TRADE #{trade.tradeId}</span>
                        <span className="workspace-trade-card-arrow" aria-hidden="true">
                          {isSelected ? "−" : "↗"}
                        </span>
                      </span>
                      <strong className="workspace-trade-card-status">
                        {formatStatus(trade.state)}
                      </strong>
                      <span className="workspace-trade-card-counterparty">
                        With {counterparty}
                      </span>
                      <span className="workspace-trade-card-meta">
                        <span>{formatRawUsdcAmount(trade.amountRaw)} USDC</span>
                        <span>{formatTradeDate(trade.createdAtNs)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedTrade && (
                <section
                  className="workspace-selected-trade"
                  id="workspace-selected-trade"
                  aria-labelledby="workspace-selected-trade-title"
                >
                  <div className="workspace-selected-trade-heading">
                    <div>
                      <span className="workspace-empty-index">SELECTED TRADE</span>
                      <h3 id="workspace-selected-trade-title">
                        Trade #{selectedTrade.tradeId}
                      </h3>
                      <p>{formatStatus(selectedTrade.state)}</p>
                    </div>
                    <button
                      className="workspace-secondary-button"
                      type="button"
                      onClick={() => setSelectedTradeId(null)}
                    >
                      Close details
                    </button>
                  </div>

                  <div className="workspace-session-details workspace-selected-trade-summary">
                    <div>
                      <span>BUYER</span>
                      <strong>{selectedTrade.buyerAccount}</strong>
                    </div>
                    <div>
                      <span>SUPPLIER</span>
                      <strong>{selectedTrade.supplierAccount}</strong>
                    </div>
                    <div>
                      <span>INDEPENDENT REVIEWER</span>
                      <strong>{selectedTrade.resolverAccount}</strong>
                    </div>
                    <div>
                      <span>TRADE AMOUNT</span>
                      <strong>{formatRawUsdcAmount(selectedTrade.amountRaw)} USDC</strong>
                      <span>{selectedTrade.amountRaw} raw units</span>
                    </div>
                    <div>
                      <span>PAYMENT TOKEN</span>
                      <strong>{selectedTrade.paymentToken}</strong>
                    </div>
                    <div>
                      <span>CREATED</span>
                      <strong>{formatTradeDate(selectedTrade.createdAtNs)}</strong>
                    </div>
                    <div>
                      <span>ACCEPTANCE DEADLINE</span>
                      <strong>{formatTradeDate(selectedTrade.acceptByNs)}</strong>
                    </div>
                    <div>
                      <span>FUNDED AT</span>
                      <strong>{selectedTrade.fundedAtNs ? formatTradeDate(selectedTrade.fundedAtNs) : "Not funded"}</strong>
                    </div>
                  </div>

                  {selectedTrade.state === "AwaitingAcceptance" &&
                    selectedTrade.supplierAccount === session?.accountId && (
                      <button
                        className="workspace-secondary-button workspace-selected-trade-action"
                        type="button"
                        onClick={() => handleAcceptTrade(selectedTrade.tradeId)}
                        disabled={busy || !walletConnected}
                      >
                        {busy ? "Processing..." : "Accept trade"}
                      </button>
                    )}

                  {selectedTrade.state === "Accepted" &&
                    selectedTrade.buyerAccount === session?.accountId && (
                      <button
                        className="workspace-secondary-button workspace-selected-trade-action"
                        type="button"
                        onClick={() => handleFundTrade(selectedTrade.tradeId)}
                        disabled={busy || !walletConnected}
                      >
                        {busy
                          ? "Processing..."
                          : `Fund trade · ${formatRawUsdcAmount(selectedTrade.amountRaw)} USDC`}
                      </button>
                    )}
                </section>
              )}

              {selectedTrade && workspaceStatus?.infrastructure.contract.accountId && session && (
                <TradeLifecyclePanel
                  key={`lifecycle-${selectedTrade.tradeId}`}
                  trade={selectedTrade}
                  accountId={session.accountId}
                  walletConnected={walletConnected}
                  parentBusy={busy}
                  onSuccess={setTransactionMessage}
                  onWalletCall={(methodName, args, gas, deposit) =>
                    submitWalletCall(
                      workspaceStatus.infrastructure.contract.accountId!,
                      methodName,
                      args,
                      gas,
                      deposit
                    )
                  }
                  onTokenWalletCall={(methodName, args, gas, deposit) =>
                    submitWalletCall(
                      "sdd.gidy515.testnet",
                      methodName,
                      args,
                      gas,
                      deposit
                    )
                  }
                />
              )}
            </>
          )}
        </section>

        {error && (
          <p className="workspace-error" role="alert">
            {error}
          </p>
        )}
          </>
        )}
      </section>
    </main>
  );
}
