import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import type { NearBlock } from "./indexer-rpc.js";

interface DataServerExecutionOutcome {
  id: string;
  block_hash: string;
  outcome: {
    executor_id: string;
    logs: string[];
  };
}

interface DataServerTransaction {
  hash: string;
}

interface DataServerTransactionEntry {
  transaction: DataServerTransaction;
  outcome: {
    execution_outcome: DataServerExecutionOutcome;
  };
}

interface DataServerReceiptEntry {
  tx_hash: string;
  execution_outcome: DataServerExecutionOutcome;
}

interface DataServerChunk {
  header: {
    height_included: number;
  };
  transactions: DataServerTransactionEntry[];
}

interface DataServerShard {
  shard_id: number;
  chunk: DataServerChunk | null;
  receipt_execution_outcomes: DataServerReceiptEntry[];
}

export interface DataServerBlock {
  block: NearBlock;
  shards: DataServerShard[];
}

export interface IndexedContractEvent {
  blockHeight: number;
  blockHash: string;
  blockTimestampNs: string;
  transactionHash: string;
  executionId: string;
  executionType: "transaction" | "receipt";
  logIndex: number;
  standard: string;
  eventVersion: string;
  eventName: string;
  eventData: unknown;
  rawLog: string;
}

const DATA_SERVER_BASE_URL = "https://testnet.neardata.xyz/v0";
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 3;
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
  "EPIPE"
]);

class DataServerHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly retryAfterMs?: number
  ) {
    super(`NEAR_DATA_SERVER_HTTP_${statusCode}`);
    this.name = "DataServerHttpError";
  }
}

function parseDataServerRetryAfter(
  value: string | string[] | undefined
): number | undefined {
  if (value === undefined) return undefined;

  const header = Array.isArray(value) ? value[0] : value;
  if (!header?.trim()) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_AFTER_MS);
  }

  const timestamp = Date.parse(header);
  if (!Number.isFinite(timestamp)) return undefined;

  return Math.min(
    Math.max(0, timestamp - Date.now()),
    MAX_RETRY_AFTER_MS
  );
}

function dataServerBackoffMs(attempt: number): number {
  return (
    Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) +
    Math.floor(Math.random() * (MAX_JITTER_MS + 1))
  );
}

function isRetryableDataServerError(error: unknown): boolean {
  if (error instanceof DataServerHttpError) {
    return RETRYABLE_HTTP_STATUSES.has(error.statusCode);
  }

  if (!(error instanceof Error)) return false;
  if (error.message === "NEAR_DATA_SERVER_TIMEOUT") return true;

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code);
}

function sleepDataServer(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getHttpsOnce(
  url: URL,
  redirectsRemaining = MAX_REDIRECTS
): Promise<string> {
  if (url.protocol !== "https:") {
    throw new Error("NEAR_DATA_SERVER_INVALID_PROTOCOL");
  }

  const addresses = await dnsLookup(url.hostname, {
    all: true,
    family: 4,
    verbatim: true
  });

  if (addresses.length === 0) {
    throw new Error("NEAR_DATA_SERVER_UNAVAILABLE");
  }

  let lastError: unknown;

  for (const address of addresses) {
    try {
      const result = await new Promise<{
        body?: string;
        redirect?: string;
      }>((resolve, reject) => {
        const request = httpsRequest(
          {
            hostname: url.hostname,
            port: url.port ? Number(url.port) : 443,
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: {
              accept: "application/json"
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
                    family: address.family
                  }
                ]);
              } else {
                callback(
                  null,
                  address.address,
                  address.family
                );
              }
            },
            timeout: 20000
          },
          response => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;

            if (
              [301, 302, 303, 307, 308].includes(status) &&
              location
            ) {
              response.resume();
              resolve({
                redirect: new URL(location, url).toString()
              });
              return;
            }

            if (status < 200 || status >= 300) {
              response.resume();
              reject(
                new DataServerHttpError(
                  status,
                  parseDataServerRetryAfter(response.headers["retry-after"])
                )
              );
              return;
            }

            let body = "";
            let receivedBytes = 0;

            response.setEncoding("utf8");

            response.on("data", (chunk: string) => {
              receivedBytes += Buffer.byteLength(chunk);

              if (receivedBytes > MAX_RESPONSE_BYTES) {
                request.destroy(
                  new Error("NEAR_DATA_SERVER_RESPONSE_TOO_LARGE")
                );
                return;
              }

              body += chunk;
            });

            response.on("end", () => {
              resolve({ body });
            });

            response.on("error", reject);
          }
        );

        request.setTimeout(20000, () => {
          request.destroy(
            new Error("NEAR_DATA_SERVER_TIMEOUT")
          );
        });

        request.on("error", reject);
        request.end();
      });

      if (result.redirect) {
        if (redirectsRemaining <= 0) {
          throw new Error("NEAR_DATA_SERVER_TOO_MANY_REDIRECTS");
        }

        return getHttps(
          new URL(result.redirect),
          redirectsRemaining - 1
        );
      }

      if (result.body === undefined) {
        throw new Error("NEAR_DATA_SERVER_EMPTY_RESPONSE");
      }

      return result.body;
    } catch (error) {
      lastError = error;

      if (
        error instanceof Error &&
        error.message.startsWith("NEAR_DATA_SERVER_HTTP_")
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("NEAR_DATA_SERVER_UNAVAILABLE");
}

async function getHttps(
  url: URL,
  redirectsRemaining = MAX_REDIRECTS
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await getHttpsOnce(url, redirectsRemaining);
    } catch (error) {
      lastError = error;

      if (
        !isRetryableDataServerError(error) ||
        attempt === MAX_ATTEMPTS - 1
      ) {
        throw error;
      }

      const retryAfter =
        error instanceof DataServerHttpError
          ? error.retryAfterMs
          : undefined;

      await sleepDataServer(retryAfter ?? dataServerBackoffMs(attempt));
    }
  }

  throw lastError ?? new Error("NEAR_DATA_SERVER_UNAVAILABLE");
}

export async function getDataServerBlock(
  height: number
): Promise<DataServerBlock> {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error("INVALID_BLOCK_HEIGHT");
  }

  const url = new URL(`${DATA_SERVER_BASE_URL}/block/${height}`);
  const body = await getHttps(url);

  let data: DataServerBlock;

  try {
    data = JSON.parse(body) as DataServerBlock;
  } catch {
    throw new Error("NEAR_DATA_SERVER_INVALID_JSON");
  }

  if (
    !data ||
    !data.block ||
    !data.block.header ||
    data.block.header.height !== height ||
    typeof data.block.header.hash !== "string" ||
    typeof data.block.header.timestamp_nanosec !== "string" ||
    !Array.isArray(data.shards)
  ) {
    throw new Error("NEAR_DATA_SERVER_INVALID_BLOCK");
  }

  return data;
}

function parseRiventaEvent(
  rawLog: string
): {
  standard: string;
  version: string;
  event: string;
  data: unknown[];
} | null {
  if (!rawLog.startsWith("EVENT_JSON:")) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawLog.slice("EVENT_JSON:".length));
  } catch {
    throw new Error("RIVENTA_INDEXER_INVALID_EVENT_JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("standard" in parsed) ||
    parsed.standard !== "riventa"
  ) {
    return null;
  }

  if (
    !("version" in parsed) ||
    parsed.version !== "1.0.0" ||
    !("event" in parsed) ||
    typeof parsed.event !== "string" ||
    parsed.event.length === 0 ||
    !("data" in parsed) ||
    !Array.isArray(parsed.data)
  ) {
    throw new Error("RIVENTA_INDEXER_INVALID_EVENT_ENVELOPE");
  }

  return {
    standard: parsed.standard,
    version: parsed.version,
    event: parsed.event,
    data: parsed.data
  };
}

export function extractRiventaEvents(
  data: DataServerBlock,
  contractId: string
): IndexedContractEvent[] {
  if (!contractId.trim()) {
    throw new Error("INVALID_INDEXER_CONTRACT_ID");
  }

  const { block } = data;
  const events: IndexedContractEvent[] = [];

  function processExecution(
    execution: DataServerExecutionOutcome,
    transactionHash: string,
    executionType: "transaction" | "receipt"
  ): void {
    if (execution.outcome.executor_id !== contractId) {
      return;
    }

    if (!Array.isArray(execution.outcome.logs)) {
      throw new Error("RIVENTA_INDEXER_INVALID_EXECUTION_LOGS");
    }

    execution.outcome.logs.forEach((rawLog, logIndex) => {
      const event = parseRiventaEvent(rawLog);

      if (!event) {
        return;
      }

      events.push({
        blockHeight: block.header.height,
        blockHash: execution.block_hash,
        blockTimestampNs: block.header.timestamp_nanosec,
        transactionHash,
        executionId: execution.id,
        executionType,
        logIndex,
        standard: event.standard,
        eventVersion: event.version,
        eventName: event.event,
        eventData: event.data,
        rawLog
      });
    });
  }

  for (const shard of data.shards) {
    const chunk = shard.chunk;

    if (
      chunk &&
      chunk.header.height_included === block.header.height
    ) {
      for (const entry of chunk.transactions) {
        processExecution(
          entry.outcome.execution_outcome,
          entry.transaction.hash,
          "transaction"
        );
      }
    }

    for (const entry of shard.receipt_execution_outcomes) {
      processExecution(
        entry.execution_outcome,
        entry.tx_hash,
        "receipt"
      );
    }
  }

  return events;
}
