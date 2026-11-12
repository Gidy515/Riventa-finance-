import { postNearRpc } from "./rpc-client.js";

interface JsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: JsonRpcError;
}

export interface NearBlock {
  header: {
    height: number;
    hash: string;
    prev_hash: string;
    timestamp_nanosec: string;
  };
  chunks: Array<{
    chunk_hash: string;
    height_included: number;
    shard_id: number;
  }>;
}

export interface NearChunk {
  header: {
    chunk_hash: string;
    height_included: number;
    shard_id: number;
  };
  transactions: Array<{
    hash: string;
    signer_id: string;
    receiver_id: string;
  }>;
}

export interface NearExecutionOutcome {
  id: string;
  block_hash: string;
  outcome: {
    executor_id: string;
    logs: string[];
    receipt_ids: string[];
    status: Record<string, unknown>;
  };
}

export interface NearTransactionStatus {
  transaction: {
    hash: string;
    signer_id: string;
    receiver_id: string;
  };
  transaction_outcome: NearExecutionOutcome;
  receipts_outcome: NearExecutionOutcome[];
}

async function callNearRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown,
  timeoutMs = 5000
): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `riventa-indexer-${method}`,
    method,
    params
  });

  const responseBody = await postNearRpc(rpcUrl, body, timeoutMs);

  let response: JsonRpcResponse<T>;

  try {
    response = JSON.parse(responseBody) as JsonRpcResponse<T>;
  } catch {
    throw new Error(`NEAR_RPC_INVALID_JSON:${method}`);
  }

  if (response.error) {
    throw new Error(
      `NEAR_RPC_ERROR:${method}:${response.error.code ?? "unknown"}`
    );
  }

  if (response.result === undefined || response.result === null) {
    throw new Error(`NEAR_RPC_MISSING_RESULT:${method}`);
  }

  return response.result;
}


export interface NearViewBlockReference {
  height: number;
  hash: string;
}

interface NearCallFunctionResult {
  result: number[];
  block_height: number;
  block_hash: string;
  logs?: string[];
}

/**
 * Encodes canonical decimal u64 IDs as exact JSON integer arguments.
 * Avoids JavaScript Number precision loss for NEAR u64 values.
 */
export function nearU64Args(ids: readonly string[]): string {
  const maxU64 = 18446744073709551615n;

  const encoded = ids.map((id) => {
    if (
      typeof id !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(id)
    ) {
      throw new Error("INVALID_NEAR_U64_ARGUMENT");
    }

    const value = BigInt(id);

    if (value > maxU64) {
      throw new Error("NEAR_U64_ARGUMENT_OVERFLOW");
    }

    return id;
  });

  return `[${encoded.join(",")}]`;
}

/**
 * Decodes a NEAR call_function response and verifies its block identity.
 * JSON null is valid for contract views returning Option<T>::None.
 */
export function decodeNearViewResult<T>(
  response: unknown,
  expectedBlock: NearViewBlockReference
): T {
  if (
    !Number.isSafeInteger(expectedBlock.height) ||
    expectedBlock.height < 0 ||
    typeof expectedBlock.hash !== "string" ||
    !expectedBlock.hash.trim()
  ) {
    throw new Error("INVALID_NEAR_VIEW_BLOCK_REFERENCE");
  }

  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    throw new Error("NEAR_RPC_INVALID_VIEW_RESPONSE");
  }

  const result = response as Partial<NearCallFunctionResult>;

  if (
    !Number.isSafeInteger(result.block_height) ||
    typeof result.block_hash !== "string" ||
    !Array.isArray(result.result)
  ) {
    throw new Error("NEAR_RPC_INVALID_VIEW_RESPONSE");
  }

  if (result.block_height !== expectedBlock.height) {
    throw new Error("NEAR_RPC_VIEW_BLOCK_HEIGHT_MISMATCH");
  }

  if (result.block_hash !== expectedBlock.hash) {
    throw new Error("NEAR_RPC_VIEW_BLOCK_HASH_MISMATCH");
  }

  if (
    !result.result.every(
      (byte) =>
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255
    )
  ) {
    throw new Error("NEAR_RPC_INVALID_VIEW_RESULT_BYTES");
  }

  let decoded: string;

  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(result.result)
    );
  } catch {
    throw new Error("NEAR_RPC_INVALID_VIEW_RESULT_UTF8");
  }

  try {
    return JSON.parse(decoded) as T;
  } catch {
    throw new Error("NEAR_RPC_INVALID_VIEW_RESULT_JSON");
  }
}

/**
 * Calls a contract view at an explicit block height.
 * Pass nearU64Args() output for methods accepting u64 IDs.
 */
export async function callNearView<T>(
  rpcUrl: string,
  contractId: string,
  methodName: string,
  argsJson: string,
  block: NearViewBlockReference
): Promise<T> {
  if (typeof contractId !== "string" || !contractId.trim()) {
    throw new Error("INVALID_NEAR_VIEW_CONTRACT_ID");
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(methodName)) {
    throw new Error("INVALID_NEAR_VIEW_METHOD_NAME");
  }

  if (
    !Number.isSafeInteger(block.height) ||
    block.height < 0 ||
    typeof block.hash !== "string" ||
    !block.hash.trim()
  ) {
    throw new Error("INVALID_NEAR_VIEW_BLOCK_REFERENCE");
  }

  let parsedArgs: unknown;

  try {
    parsedArgs = JSON.parse(argsJson);
  } catch {
    throw new Error("INVALID_NEAR_VIEW_ARGUMENTS_JSON");
  }

  if (!Array.isArray(parsedArgs)) {
    throw new Error("NEAR_VIEW_ARGUMENTS_MUST_BE_ARRAY");
  }

  const response = await callNearRpc<NearCallFunctionResult>(
    rpcUrl,
    "query",
    {
      request_type: "call_function",
      account_id: contractId,
      method_name: methodName,
      args_base64: Buffer.from(argsJson, "utf8").toString("base64"),
      block_id: block.height
    }
  );

  return decodeNearViewResult<T>(response, block);
}

function assertBlock(block: NearBlock, expectedHeight?: number): void {
  if (
    !block ||
    !block.header ||
    !Number.isSafeInteger(block.header.height) ||
    typeof block.header.hash !== "string" ||
    typeof block.header.prev_hash !== "string" ||
    typeof block.header.timestamp_nanosec !== "string" ||
    !Array.isArray(block.chunks)
  ) {
    throw new Error("NEAR_RPC_INVALID_BLOCK");
  }

  if (
    expectedHeight !== undefined &&
    block.header.height !== expectedHeight
  ) {
    throw new Error("NEAR_RPC_BLOCK_HEIGHT_MISMATCH");
  }

  for (const chunk of block.chunks) {
    if (
      typeof chunk.chunk_hash !== "string" ||
      !Number.isSafeInteger(chunk.height_included) ||
      !Number.isSafeInteger(chunk.shard_id)
    ) {
      throw new Error("NEAR_RPC_INVALID_BLOCK_CHUNK");
    }
  }
}

export async function getFinalizedTip(
  rpcUrl: string
): Promise<NearBlock> {
  const block = await callNearRpc<NearBlock>(
    rpcUrl,
    "block",
    { finality: "final" }
  );

  assertBlock(block);

  return block;
}

export async function getBlockByHeight(
  rpcUrl: string,
  height: number
): Promise<NearBlock> {
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error("INVALID_BLOCK_HEIGHT");
  }

  const block = await callNearRpc<NearBlock>(
    rpcUrl,
    "block",
    { block_id: height }
  );

  assertBlock(block, height);

  return block;
}

export async function getChunkByHash(
  rpcUrl: string,
  chunkHash: string
): Promise<NearChunk> {
  if (!chunkHash.trim()) {
    throw new Error("INVALID_CHUNK_HASH");
  }

  const chunk = await callNearRpc<NearChunk>(
    rpcUrl,
    "chunk",
    { chunk_id: chunkHash }
  );

  if (
    !chunk ||
    !chunk.header ||
    chunk.header.chunk_hash !== chunkHash ||
    !Array.isArray(chunk.transactions)
  ) {
    throw new Error("NEAR_RPC_INVALID_CHUNK");
  }

  for (const transaction of chunk.transactions) {
    if (
      typeof transaction.hash !== "string" ||
      typeof transaction.signer_id !== "string" ||
      typeof transaction.receiver_id !== "string"
    ) {
      throw new Error("NEAR_RPC_INVALID_CHUNK_TRANSACTION");
    }
  }

  return chunk;
}

export async function getTransactionStatus(
  rpcUrl: string,
  transactionHash: string,
  signerAccountId: string
): Promise<NearTransactionStatus> {
  if (!transactionHash.trim() || !signerAccountId.trim()) {
    throw new Error("INVALID_TRANSACTION_REFERENCE");
  }

  const status = await callNearRpc<NearTransactionStatus>(
    rpcUrl,
    "EXPERIMENTAL_tx_status",
    {
      tx_hash: transactionHash,
      sender_account_id: signerAccountId,
      wait_until: "FINAL"
      },
      30000
  );

  if (
    !status ||
    !status.transaction ||
    status.transaction.hash !== transactionHash ||
    !status.transaction_outcome ||
    !Array.isArray(status.receipts_outcome)
  ) {
    throw new Error("NEAR_RPC_INVALID_TRANSACTION_STATUS");
  }

  for (const receipt of status.receipts_outcome) {
    if (
      typeof receipt.id !== "string" ||
      typeof receipt.block_hash !== "string" ||
      !receipt.outcome ||
      typeof receipt.outcome.executor_id !== "string" ||
      !Array.isArray(receipt.outcome.logs)
    ) {
      throw new Error("NEAR_RPC_INVALID_RECEIPT_OUTCOME");
    }
  }

  return status;
}

/**
 * Fetches transactions from chunks newly included in this block.
 * Chunks carried forward from earlier blocks are deliberately skipped.
 */
export async function getBlockTransactions(
  rpcUrl: string,
  block: NearBlock
): Promise<Array<{
  transactionHash: string;
  signerAccountId: string;
  receiverAccountId: string;
}>> {
  assertBlock(block);

  const includedChunks = block.chunks.filter(
    chunk => chunk.height_included === block.header.height
  );

  const chunks = await Promise.all(
    includedChunks.map(chunk =>
      getChunkByHash(rpcUrl, chunk.chunk_hash)
    )
  );

  return chunks.flatMap(chunk =>
    chunk.transactions.map(transaction => ({
      transactionHash: transaction.hash,
      signerAccountId: transaction.signer_id,
      receiverAccountId: transaction.receiver_id
    }))
  );
}
