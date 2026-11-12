import { createHash, createPublicKey, verify } from "node:crypto";

import { postNearRpc } from "../near/rpc-client.js";

const NEP413_TAG = 2_147_484_061;

// DER SubjectPublicKeyInfo prefix for an Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string): Buffer {
  if (!value) {
    throw new Error("INVALID_PUBLIC_KEY");
  }

  let decoded = 0n;

  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);

    if (digit < 0) {
      throw new Error("INVALID_PUBLIC_KEY");
    }

    decoded = decoded * 58n + BigInt(digit);
  }

  const hex =
    decoded === 0n
      ? ""
      : decoded
          .toString(16)
          .padStart(Math.ceil(decoded.toString(16).length / 2) * 2, "0");

  const body = hex ? Buffer.from(hex, "hex") : Buffer.alloc(0);

  let leadingZeroes = 0;

  while (leadingZeroes < value.length && value[leadingZeroes] === "1") {
    leadingZeroes++;
  }

  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

function encodeBorshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);

  length.writeUInt32LE(bytes.length, 0);

  return Buffer.concat([length, bytes]);
}

export interface Nep413Payload {
  message: string;
  nonce: Buffer;
  recipient: string;
}

export function hashNep413Payload(payload: Nep413Payload): Buffer {
  if (payload.nonce.length !== 32) {
    throw new Error("INVALID_NONCE");
  }

  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG, 0);

  // NEP-413 Borsh payload:
  // message: String
  // nonce: [u8; 32]
  // recipient: String
  // callback_url: Option<String> = None
  const serialized = Buffer.concat([
    tag,
    encodeBorshString(payload.message),
    payload.nonce,
    encodeBorshString(payload.recipient),
    Buffer.from([0]),
  ]);

  return createHash("sha256").update(serialized).digest();
}

export function verifyNep413Signature(input: {
  message: string;
  nonce: Buffer;
  recipient: string;
  publicKey: string;
  signature: string;
}): boolean {
  if (!input.publicKey.startsWith("ed25519:")) {
    return false;
  }

  const rawPublicKey = decodeBase58(input.publicKey.slice("ed25519:".length));

  if (rawPublicKey.length !== 32) {
    return false;
  }

  const signature = Buffer.from(input.signature, "base64");

  if (
    signature.length !== 64 ||
    signature.toString("base64") !== input.signature
  ) {
    return false;
  }

  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: "der",
    type: "spki",
  });

  const digest = hashNep413Payload({
    message: input.message,
    nonce: input.nonce,
    recipient: input.recipient,
  });

  return verify(null, digest, publicKey, signature);
}

interface NearRpcAccessKeyResponse {
  permission?: "FullAccess" | Record<string, unknown>;
}

interface NearRpcResponse {
  error?: unknown;
  result?: NearRpcAccessKeyResponse;
}

export async function assertFullAccessKey(input: {
  rpcUrl: string;
  accountId: string;
  publicKey: string;
}): Promise<void> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "riventa-auth",
    method: "query",
    params: {
      request_type: "view_access_key",
      finality: "final",
      account_id: input.accountId,
      public_key: input.publicKey,
    },
  });

  let responseBody: string;

  try {
    responseBody = await postNearRpc(input.rpcUrl, body);
  } catch {
    throw new Error("NEAR_RPC_UNAVAILABLE");
  }

  let result: NearRpcResponse;

  try {
    result = JSON.parse(responseBody) as NearRpcResponse;
  } catch {
    throw new Error("NEAR_RPC_UNAVAILABLE");
  }

  if (result.error || !result.result?.permission) {
    throw new Error("NEAR_ACCESS_KEY_NOT_FOUND");
  }

  if (result.result.permission !== "FullAccess") {
    throw new Error("FULL_ACCESS_KEY_REQUIRED");
  }
}
