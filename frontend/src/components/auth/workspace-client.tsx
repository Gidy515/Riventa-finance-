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

import type {
  AuthSession,
  MandatePage,
  TradePage,
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

function formatStatus(value: string): string {
  return value.replaceAll("_", " ");
}

export function WorkspaceClient() {
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
  const [mandatePage, setMandatePage] = useState<MandatePage | null>(null);
  const [operationalDataState, setOperationalDataState] =
    useState<OperationalDataState>("blocked");
  const [operationalDataError, setOperationalDataError] = useState<
    string | null
  >(null);

  const connectorRef = useRef<NearConnector | null>(null);
  const walletRef = useRef<NearWalletBase | null>(null);
  const mountedRef = useRef(true);

  async function refreshOperationalData(status: WorkspaceStatus) {
    const infrastructure = status.infrastructure;

    const infrastructureReady =
      infrastructure.contract.accountId !== null &&
      infrastructure.indexer.status === "indexed" &&
      infrastructure.projections.status === "available";

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
      const [trades, mandates] = await Promise.all([
        listTrades({ limit: 10 }),
        listMandates({ limit: 10 }),
      ]);

      if (!mountedRef.current) return;

      setTradePage(trades);
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

  useEffect(() => {
    mountedRef.current = true;

    getCurrentSession()
      .then((result) => {
        if (!mountedRef.current) return;

        setSession(result.session);
        setView("signed-in");

        void refreshWorkspaceStatus();
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setView("signed-out");
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

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
        },
      });

      const wallet = await connector.connect({ walletId });

      walletRef.current = wallet;

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
          <span className="workspace-status-dot" />
          <p>Checking your Riventa session...</p>
        </div>
      </main>
    );
  }

  if (view === "signed-out") {
    return (
      <main className="workspace-screen">
        <div className="workspace-auth-layout">
          <a className="workspace-wordmark" href="/">
            <span className="workspace-wordmark-mark">R</span>
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
                <span>Testnet · Ed25519 full-access key</span>
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
                  {busy ? "Signing in..." : "Continue with selected account"}
                  {!busy && <span aria-hidden="true">↗</span>}
                </button>
              </>
            )}

            <p className="workspace-auth-note">
              Connect your wallet, select the NEAR testnet account you want
              to use, then sign a one-time authentication message. No
              transaction is submitted.
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
            PRIVATE TRADE INFRASTRUCTURE · SECURED BY NEAR
          </p>
        </div>
      </main>
    );
  }

  const infrastructure = workspaceStatus?.infrastructure;

  return (
    <main className="workspace-screen">
      <header className="workspace-topbar">
        <a className="workspace-wordmark" href="/">
          <span className="workspace-wordmark-mark">R</span>
          Riventa
          <span className="workspace-topbar-label">WORKSPACE</span>
        </a>

        <div className="workspace-account">
          <span className="workspace-status-dot" />
          <span>{session?.accountId}</span>
          <button type="button" onClick={handleLogout} disabled={busy}>
            {busy ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </header>

      <section className="workspace-content">
        <div className="workspace-heading-row">
          <div>
            <p className="workspace-eyebrow">OVERVIEW</p>
            <h1>Your trade workspace</h1>
            <p className="workspace-content-description">
              Monitor your trade infrastructure and workspace readiness.
            </p>
          </div>

          <button
            className="workspace-refresh-button"
            type="button"
            onClick={refreshWorkspaceStatus}
            disabled={statusLoading}
          >
            <span aria-hidden="true">↻</span>
            {statusLoading ? "Refreshing..." : "Refresh status"}
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
              <p className="workspace-empty-index">01 / INFRASTRUCTURE</p>
              <h2>System readiness</h2>
            </div>
            <span className="workspace-live-label">
              {statusLoading ? "CHECKING" : "BACKEND STATUS"}
            </span>
          </div>

          {!workspaceStatus ? (
            <div className="workspace-status-loading">
              {statusLoading
                ? "Loading infrastructure status..."
                : "Infrastructure status is unavailable. Refresh to retry."}
            </div>
          ) : (
            <div className="workspace-infrastructure-grid">
              <article className="workspace-infrastructure-card">
                <div className="workspace-card-topline">
                  <span className="workspace-card-label">SMART CONTRACT</span>
                  <span className="workspace-state state-pending">
                    {formatStatus(infrastructure!.contract.deploymentStatus)}
                  </span>
                </div>
                <h3>NEAR deployment</h3>
                <p>
                  {infrastructure!.contract.accountId
                    ? `Configured account: ${
                        infrastructure!.contract.accountId
                      }. Deployment has not yet been verified.`
                    : "No contract account is configured. The trade contract has not been deployed."}
                </p>
              </article>

              <article className="workspace-infrastructure-card">
                <div className="workspace-card-topline">
                  <span className="workspace-card-label">EVENT PIPELINE</span>
                  <span className="workspace-state state-pending">
                    {formatStatus(infrastructure!.indexer.status)}
                  </span>
                </div>
                <h3>Chain indexer</h3>
                <p>
                  On-chain events are not being indexed into the workspace yet.
                </p>
              </article>

              <article className="workspace-infrastructure-card">
                <div className="workspace-card-topline">
                  <span className="workspace-card-label">TRADE DATA</span>
                  <span className="workspace-state state-pending">
                    {formatStatus(infrastructure!.projections.status)}
                  </span>
                </div>
                <h3>Data projections</h3>
                <p>
                  Trade, mandate, inspection, and settlement projections are not
                  populated yet.
                </p>
              </article>
            </div>
          )}
        </section>

        <section className="workspace-empty-panel workspace-trade-panel">
          <span className="workspace-empty-index">02 / TRADE OPERATIONS</span>
          <h2>Trade activity</h2>

          {operationalDataState === "blocked" && (
            <p>
              Trade records will appear here after the contract is verified,
              chain events are indexed, and workspace projections are populated.
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
                  : `${tradePage.items.length} trade records loaded.`}
              </p>

              {tradePage.items.map((trade) => (
                <div className="workspace-session-details" key={trade.tradeId}>
                  <div>
                    <span>TRADE ID</span>
                    <strong>{trade.tradeId}</strong>
                  </div>
                  <div>
                    <span>STATUS</span>
                    <strong>{formatStatus(trade.state)}</strong>
                  </div>
                  <div>
                    <span>COUNTERPARTY</span>
                    <strong>
                      {trade.buyerAccount === session?.accountId
                        ? trade.supplierAccount
                        : trade.buyerAccount}
                    </strong>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="workspace-empty-panel workspace-trade-panel">
          <span className="workspace-empty-index">03 / AUTHORIZATION</span>
          <h2>Agent mandates</h2>

          {operationalDataState === "blocked" && (
            <p>
              Mandate records will appear here when the contract and indexing
              infrastructure are ready.
            </p>
          )}

          {operationalDataState === "loading" && (
            <p>Loading your agent mandates...</p>
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
                  ? "No mandates are associated with this account yet."
                  : `${mandatePage.items.length} mandate records loaded.`}
              </p>

              {mandatePage.items.map((mandate) => (
                <div
                  className="workspace-session-details"
                  key={mandate.mandateId}
                >
                  <div>
                    <span>MANDATE ID</span>
                    <strong>{mandate.mandateId}</strong>
                  </div>
                  <div>
                    <span>AGENT</span>
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
          <span className="workspace-empty-index">04 / SESSION</span>
          <h2>Authenticated account</h2>

          <div className="workspace-session-details">
            <div>
              <span>CONNECTED ACCOUNT</span>
              <strong>{session?.accountId}</strong>
            </div>
            <div>
              <span>NETWORK</span>
              <strong>{session?.network}</strong>
            </div>
            <div>
              <span>SESSION EXPIRES</span>
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
      </section>
    </main>
  );
}
