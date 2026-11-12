import {
  findVisibleTrade,
  listVisibleTrades,
  type TradeCursor,
  type TradeRecord,
  type TradeScope,
  type TradeState
} from "./trade-repository.js";

const MAX_U64 = 18_446_744_073_709_551_615n;

const TRADE_STATES = new Set<TradeState>([
  "AwaitingAcceptance",
  "Accepted",
  "Funded",
  "DocumentReview",
  "InspectionPending",
  "InspectionPassed",
  "InspectionFailed",
  "Disputed",
  "ReleaseAuthorized",
  "RefundAuthorized",
  "PayoutPending",
  "RefundPending",
  "Completed",
  "Refunded",
  "Cancelled"
]);

export interface ListTradesInput {
  scope: TradeScope;
  state?: string;
  limit?: number;
  cursor?: TradeCursor;
}

export interface TradePage {
  items: TradeRecord[];
  nextCursor: TradeCursor | null;
}

export class InvalidTradeQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTradeQueryError";
  }
}

function requireNonEmptyString(
  value: string,
  field: string,
  maxLength: number
): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new InvalidTradeQueryError(`${field} is invalid.`);
  }
}

function requireU64(value: string, field: string): void {
  if (!/^(0|[1-9]\d{0,19})$/.test(value)) {
    throw new InvalidTradeQueryError(`${field} must be a decimal u64 string.`);
  }

  if (BigInt(value) > MAX_U64) {
    throw new InvalidTradeQueryError(`${field} exceeds the u64 range.`);
  }
}

function validateScope(scope: TradeScope): void {
  requireNonEmptyString(scope.network, "network", 64);
  requireNonEmptyString(scope.contractId, "contractId", 64);
  requireNonEmptyString(scope.accountId, "accountId", 64);
}

function validateCursor(cursor: TradeCursor): void {
  requireU64(cursor.createdAtNs, "cursor.createdAtNs");
  requireU64(cursor.tradeId, "cursor.tradeId");
}

export function validateTradeId(tradeId: string): void {
  requireU64(tradeId, "tradeId");
}

export function validateTradeListParameters(input: {
  state?: string;
  limit?: number;
  cursor?: TradeCursor;
}): void {
  const limit = input.limit ?? 20;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidTradeQueryError(
      "limit must be an integer between 1 and 50."
    );
  }

  if (
    input.state !== undefined &&
    !TRADE_STATES.has(input.state as TradeState)
  ) {
    throw new InvalidTradeQueryError("Trade state is invalid.");
  }

  if (input.cursor !== undefined) {
    validateCursor(input.cursor);
  }
}

export async function getTrades(
  input: ListTradesInput
): Promise<TradePage> {
  validateTradeListParameters(input);

  const limit = input.limit ?? 20;
  const state = input.state as TradeState | undefined;

  validateScope(input.scope);

  const result = await listVisibleTrades(input.scope, {
    state,
    limit,
    cursor: input.cursor
  });

  const lastItem = result.items.at(-1);

  return {
    items: result.items,
    nextCursor:
      result.hasMore && lastItem
        ? {
            createdAtNs: lastItem.createdAtNs,
            tradeId: lastItem.tradeId
          }
        : null
  };
}

export async function getTrade(
  scope: TradeScope,
  tradeId: string
): Promise<TradeRecord | null> {
  requireU64(tradeId, "tradeId");
  validateScope(scope);

  return findVisibleTrade(scope, tradeId);
}
