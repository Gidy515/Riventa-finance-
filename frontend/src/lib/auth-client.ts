const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

export interface AuthSession {
  network: string;
  accountId: string;
  publicKey: string;
  expiresAt: string;
}

export interface ChallengeResponse {
  challengeId: string;
  accountId: string;
  message: string;
  nonce: string;
  recipient: string;
  state: string;
  expiresAt: string;
}

interface ErrorResponse {
  error?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error("Unable to reach the Riventa API.");
  }

  if (!response.ok) {
    let errorCode = "REQUEST_FAILED";

    try {
      const body = (await response.json()) as ErrorResponse;
      errorCode = body.error ?? errorCode;
    } catch {
      // Keep the generic error when the response is not JSON.
    }

    throw new Error(errorCode);
  }

  return response.json() as Promise<T>;
}

export function createChallenge(accountId: string): Promise<ChallengeResponse> {
  return request<ChallengeResponse>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
}

export function verifyChallenge(input: {
  challengeId: string;
  accountId: string;
  publicKey: string;
  signature: string;
  state: string;
}): Promise<{
  authenticated: true;
  session: AuthSession;
}> {
  return request("/auth/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCurrentSession(): Promise<{
  authenticated: true;
  session: AuthSession;
}> {
  return request("/auth/me");
}

export function logout(): Promise<{
  authenticated: false;
}> {
  return request("/auth/logout", {
    method: "POST",
  });
}

export interface WorkspaceStatus {
  authenticated: true;
  account: {
    accountId: string;
    network: string;
    expiresAt: string;
  };
  infrastructure: {
    contract: {
      accountId: string | null;
      deploymentStatus: "not_deployed" | "deployment_unverified";
    };
    indexer: {
      status: "indexed" | "not_started";
      lastFinalizedBlockHeight: string | null;
    };
    projections: {
      status: "available" | "waiting_for_indexer";
    };
  };
}

export function getWorkspaceStatus(): Promise<WorkspaceStatus> {
  return request<WorkspaceStatus>("/workspace/status");
}

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

export interface TradeLifecycle {
  policySnapshot: {
    buyer: string;
    agent: string;
    allowReleaseAfterPass: boolean;
    allowRefundAfterFail: boolean;
  } | null;
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

export interface TradeCursor {
  createdAtNs: string;
  tradeId: string;
}

export interface TradePage {
  items: TradeRecord[];
  nextCursor: TradeCursor | null;
}

export interface TradeListParameters {
  state?: TradeState;
  limit?: number;
  cursor?: TradeCursor;
}

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

export interface MandatePage {
  items: MandateRecord[];
  nextCursor: string | null;
}

export interface MandateListParameters {
  limit?: number;
  beforeMandateId?: string;
}

function buildQueryString(
  parameters: Record<string, string | number | undefined>
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }

  const result = query.toString();
  return result ? `?${result}` : "";
}

export function listTrades(
  parameters: TradeListParameters = {}
): Promise<TradePage> {
  return request<TradePage>(
    `/workspace/trades${buildQueryString({
      state: parameters.state,
      limit: parameters.limit,
      cursorCreatedAtNs: parameters.cursor?.createdAtNs,
      cursorTradeId: parameters.cursor?.tradeId,
    })}`
  );
}

export async function getTradeById(tradeId: string): Promise<TradeRecord> {
  const result = await request<{ trade: TradeRecord }>(
    `/workspace/trades/${encodeURIComponent(tradeId)}`
  );

  return result.trade;
}

export async function getTradeLifecycle(
  tradeId: string
): Promise<TradeLifecycle> {
  const result = await request<{
    tradeId: string;
    lifecycle: TradeLifecycle;
  }>(`/workspace/trades/${encodeURIComponent(tradeId)}/lifecycle`);

  return result.lifecycle;
}

export function listMandates(
  parameters: MandateListParameters = {}
): Promise<MandatePage> {
  return request<MandatePage>(
    `/workspace/mandates${buildQueryString({
      limit: parameters.limit,
      beforeMandateId: parameters.beforeMandateId,
    })}`
  );
}

export async function getMandateById(
  mandateId: string
): Promise<MandateRecord> {
  const result = await request<{ mandate: MandateRecord }>(
    `/workspace/mandates/${encodeURIComponent(mandateId)}`
  );

  return result.mandate;
}
