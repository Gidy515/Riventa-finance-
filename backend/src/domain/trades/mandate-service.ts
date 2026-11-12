import {
  findVisibleMandate,
  listVisibleMandates,
  type MandateRecord
} from "./mandate-repository.js";
import {
  findVisiblePolicySnapshot,
  type TradePolicySnapshotRecord
} from "./policy-snapshot-repository.js";
import type { TradeScope } from "./trade-repository.js";
import { InvalidTradeQueryError } from "./trade-service.js";

const MAX_U64 = 18_446_744_073_709_551_615n;
const MAX_U128 = 340_282_366_920_938_463_463_374_607_431_768_211_455n;

export interface ListMandatesInput {
  scope: TradeScope;
  limit?: number;
  beforeMandateId?: string;
}

export interface MandatePage {
  items: MandateRecord[];
  nextCursor: string | null;
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

function requireUnsignedInteger(
  value: string,
  field: string,
  maximum: bigint
): void {
  if (!/^(0|[1-9]\d{0,38})$/.test(value)) {
    throw new InvalidTradeQueryError(
      `${field} must be a non-negative decimal integer string.`
    );
  }

  if (BigInt(value) > maximum) {
    throw new InvalidTradeQueryError(`${field} exceeds its allowed range.`);
  }
}

function validateScope(scope: TradeScope): void {
  requireNonEmptyString(scope.network, "network", 64);
  requireNonEmptyString(scope.contractId, "contractId", 64);
  requireNonEmptyString(scope.accountId, "accountId", 64);
}

export function validateMandateId(mandateId: string): void {
  requireUnsignedInteger(mandateId, "mandateId", MAX_U64);
}

export function validateMandateListParameters(input: {
  limit?: number;
  beforeMandateId?: string;
}): void {
  const limit = input.limit ?? 20;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new InvalidTradeQueryError(
      "limit must be an integer between 1 and 50."
    );
  }

  if (input.beforeMandateId !== undefined) {
    requireUnsignedInteger(
      input.beforeMandateId,
      "beforeMandateId",
      MAX_U64
    );
  }
}

export async function getMandates(
  input: ListMandatesInput
): Promise<MandatePage> {
  validateMandateListParameters(input);

  const limit = input.limit ?? 20;

  validateScope(input.scope);

  const result = await listVisibleMandates(input.scope, {
    limit,
    beforeMandateId: input.beforeMandateId
  });

  const lastItem = result.items.at(-1);

  return {
    items: result.items,
    nextCursor:
      result.hasMore && lastItem ? lastItem.mandateId : null
  };
}

export async function getMandate(
  scope: TradeScope,
  mandateId: string
): Promise<MandateRecord | null> {
  requireUnsignedInteger(mandateId, "mandateId", MAX_U64);
  validateScope(scope);

  return findVisibleMandate(scope, mandateId);
}

export async function getTradePolicySnapshot(
  scope: TradeScope,
  tradeId: string
): Promise<TradePolicySnapshotRecord | null> {
  requireUnsignedInteger(tradeId, "tradeId", MAX_U64);
  validateScope(scope);

  return findVisiblePolicySnapshot(scope, tradeId);
}

// Exported for validation and future write-service use.
export const blockchainIntegerLimits = {
  u64: MAX_U64,
  u128: MAX_U128
} as const;
