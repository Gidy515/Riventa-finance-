import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const MAX_JITTER_MS = 250;
const MAX_RETRY_AFTER_MS = 30_000;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
]);

interface RpcHttpResponse {
  statusCode: number;
  body: string;
  retryAfterMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Supports both Retry-After formats:
 * - delay in seconds
 * - HTTP date
 */
export function parseRetryAfterMs(
  value: string | string[] | undefined,
  now = Date.now()
): number | undefined {
  if (value === undefined) return undefined;

  const header = Array.isArray(value) ? value[0] : value;

  if (!header?.trim()) return undefined;

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      Math.ceil(seconds * 1000),
      MAX_RETRY_AFTER_MS
    );
  }

  const timestamp = Date.parse(header);

  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return Math.min(
    Math.max(0, timestamp - now),
    MAX_RETRY_AFTER_MS
  );
}

export function isRetryableHttpStatus(statusCode: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(statusCode);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (error.message === "NEAR_RPC_TIMEOUT") return true;

  const code = (error as NodeJS.ErrnoException).code;

  return typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code);
}

function getBackoffMs(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);

  return exponential + Math.floor(Math.random() * (MAX_JITTER_MS + 1));
}

function requestAddress(
  hostname: string,
  port: number,
  path: string,
  body: string,
  timeoutMs: number,
  address: { address: string; family: number }
): Promise<RpcHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname,
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        lookup: (_hostname, options, callback) => {
          if (
            typeof options === "object" &&
            options !== null &&
            "all" in options &&
            options.all
          ) {
            callback(null, [
              {
                address: address.address,
                family: address.family,
              },
            ]);
          } else {
            callback(null, address.address, address.family);
          }
        },
        timeout: timeoutMs,
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");

        response.on("data", (chunk: string) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: responseBody,
            retryAfterMs: parseRetryAfterMs(response.headers["retry-after"]),
          });
        });

        response.on("error", reject);
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("NEAR_RPC_TIMEOUT"));
    });

    request.on("error", reject);
    request.end(body);
  });
}

export async function postNearRpc(
  rpcUrl: string,
  body: string,
  timeoutMs = 5000
): Promise<string> {
  const url = new URL(rpcUrl);

  if (url.protocol !== "https:") {
    throw new Error("NEAR_RPC_UNAVAILABLE");
  }

  let addresses: Array<{ address: string; family: number }> = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      addresses = await dnsLookup(url.hostname, {
        all: true,
        family: 4,
        verbatim: true,
      });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EAI_AGAIN" || attempt === MAX_ATTEMPTS - 1) {
        throw new Error("NEAR_RPC_UNAVAILABLE");
      }
      await sleep(getBackoffMs(attempt));
    }
  }

  if (addresses.length === 0) {
    throw new Error("NEAR_RPC_UNAVAILABLE");
  }

  let addressIndex = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: RpcHttpResponse;

    try {
      response = await requestAddress(
        url.hostname,
        url.port ? Number(url.port) : 443,
        `${url.pathname}${url.search}`,
        body,
        timeoutMs,
        addresses[addressIndex]
      );
    } catch (error) {
      lastError = error;

      if (!isRetryableNetworkError(error)) {
        throw error;
      }

      if (attempt === MAX_ATTEMPTS - 1) {
        break;
      }

      // Only rotate IPs after a transport failure.
      addressIndex = (addressIndex + 1) % addresses.length;

      await sleep(getBackoffMs(attempt));
      continue;
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }

    lastError = new Error(
      `NEAR_RPC_HTTP_ERROR_${response.statusCode || "UNKNOWN"}`
    );

    if (
      !isRetryableHttpStatus(response.statusCode) ||
      attempt === MAX_ATTEMPTS - 1
    ) {
      throw lastError;
    }

    // A rate-limit response is a provider instruction, not an IP failure.
    // Keep using the same IP and honor Retry-After when supplied.
    await sleep(response.retryAfterMs ?? getBackoffMs(attempt));
  }

  throw lastError ?? new Error("NEAR_RPC_UNAVAILABLE");
}
