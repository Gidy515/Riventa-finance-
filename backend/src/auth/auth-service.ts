import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import { config } from "../config.js";
import {
  consumeChallengeAndCreateSession,
  findChallenge,
  findSession,
  insertChallenge,
  revokeSession,
  type AuthSessionRecord
} from "./auth-repository.js";

import {
  assertFullAccessKey,
  verifyNep413Signature
} from "./near-crypto.js";

const ACCOUNT_ID_PATTERN =
  /^(?=.{2,64}$)[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function validateAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new AuthError("INVALID_ACCOUNT_ID", 400);
  }
}

function hashToken(token: string): Buffer {
  return createHash("sha256")
    .update(token, "utf8")
    .digest();
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
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

export async function createLoginChallenge(
  accountId: string
): Promise<ChallengeResponse> {
  validateAccountId(accountId);

  const id = randomUUID();
  const nonce = randomBytes(32);
  const state = randomBytes(24).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() +
    config.auth.challengeTtlSeconds * 1000
  );

  const message = [
    "Sign in to Riventa",
    "",
    `Account: ${accountId}`,
    `Challenge: ${id}`,
    `Issued at: ${issuedAt.toISOString()}`
  ].join("\n");

  await insertChallenge({
    id,
    network: config.auth.network,
    accountId,
    message,
    nonce,
    recipient: config.auth.recipient,
    state,
    expiresAt
  });

  return {
    challengeId: id,
    accountId,
    message,
    nonce: nonce.toString("base64"),
    recipient: config.auth.recipient,
    state,
    expiresAt: expiresAt.toISOString()
  };
}

export async function verifyLoginChallenge(input: {
  challengeId: string;
  accountId: string;
  publicKey: string;
  signature: string;
  state: string;
}): Promise<{
  sessionToken: string;
  session: AuthSessionRecord;
}> {
  validateAccountId(input.accountId);

  if (
    typeof input.challengeId !== "string" ||
    typeof input.publicKey !== "string" ||
    typeof input.signature !== "string" ||
    typeof input.state !== "string"
  ) {
    throw new AuthError("INVALID_AUTH_REQUEST", 400);
  }

  const challenge = await findChallenge(
    input.challengeId,
    config.auth.network,
    input.accountId
  );

  if (!challenge) {
    throw new AuthError("CHALLENGE_INVALID_OR_EXPIRED", 401);
  }

  if (!safeEqual(input.state, challenge.state)) {
    throw new AuthError("CHALLENGE_STATE_MISMATCH", 401);
  }

  let signatureValid = false;

  try {
    signatureValid = verifyNep413Signature({
      message: challenge.message,
      nonce: challenge.nonce,
      recipient: challenge.recipient,
      publicKey: input.publicKey,
      signature: input.signature
    });
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    throw new AuthError("INVALID_SIGNATURE", 401);
  }

  try {
    await assertFullAccessKey({
      rpcUrl: config.auth.rpcUrl,
      accountId: input.accountId,
      publicKey: input.publicKey
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "NEAR_RPC_UNAVAILABLE"
    ) {
      throw new AuthError("NEAR_RPC_UNAVAILABLE", 503);
    }

    throw new AuthError("FULL_ACCESS_KEY_REQUIRED", 401);
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(sessionToken);
  const expiresAt = new Date(
    Date.now() + config.auth.sessionTtlSeconds * 1000
  );

  try {
    await consumeChallengeAndCreateSession({
      challengeId: challenge.id,
      network: config.auth.network,
      accountId: input.accountId,
      publicKey: input.publicKey,
      tokenHash,
      expiresAt
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "CHALLENGE_ALREADY_USED_OR_EXPIRED"
    ) {
      throw new AuthError("CHALLENGE_INVALID_OR_EXPIRED", 401);
    }

    throw error;
  }

  return {
    sessionToken,
    session: {
      network: config.auth.network,
      accountId: input.accountId,
      publicKey: input.publicKey,
      expiresAt
    }
  };
}

export async function getSession(
  sessionToken: string
): Promise<AuthSessionRecord | null> {
  if (
    typeof sessionToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)
  ) {
    return null;
  }

  return findSession(hashToken(sessionToken));
}

export async function logoutSession(
  sessionToken: string
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    return;
  }

  await revokeSession(hashToken(sessionToken));
}
