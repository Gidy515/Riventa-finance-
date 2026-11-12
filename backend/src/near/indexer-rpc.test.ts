import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeNearViewResult,
  nearU64Args
} from "./indexer-rpc.js";

const block = {
  height: 12345,
  hash: "finalized-block-hash"
};

function encodedResponse(value: unknown) {
  return {
    block_height: block.height,
    block_hash: block.hash,
    result: Array.from(
      Buffer.from(JSON.stringify(value), "utf8")
    )
  };
}

test("nearU64Args preserves exact u64 decimal values", () => {
  assert.equal(
    nearU64Args(["18446744073709551615"]),
    "[18446744073709551615]"
  );

  assert.equal(nearU64Args(["0", "42"]), "[0,42]");
  assert.equal(nearU64Args([]), "[]");
});

test("nearU64Args rejects non-canonical or invalid IDs", () => {
  for (const invalid of [
    "",
    "-1",
    "01",
    "+1",
    "1.5",
    "abc",
    "18446744073709551616"
  ]) {
    assert.throws(() => nearU64Args([invalid]));
  }
});

test("decodeNearViewResult decodes an object", () => {
  const decoded = decodeNearViewResult<{
    id: number;
    buyer: string;
  }>(
    encodedResponse({
      id: 7,
      buyer: "buyer.testnet"
    }),
    block
  );

  assert.deepEqual(decoded, {
    id: 7,
    buyer: "buyer.testnet"
  });
});

test("decodeNearViewResult accepts JSON null", () => {
  const decoded = decodeNearViewResult<null>(
    encodedResponse(null),
    block
  );

  assert.equal(decoded, null);
});

test("decodeNearViewResult rejects a different block height", () => {
  const response = {
    ...encodedResponse({ id: 1 }),
    block_height: block.height - 1
  };

  assert.throws(
    () => decodeNearViewResult(response, block),
    /NEAR_RPC_VIEW_BLOCK_HEIGHT_MISMATCH/
  );
});

test("decodeNearViewResult rejects a different block hash", () => {
  const response = {
    ...encodedResponse({ id: 1 }),
    block_hash: "different-block-hash"
  };

  assert.throws(
    () => decodeNearViewResult(response, block),
    /NEAR_RPC_VIEW_BLOCK_HASH_MISMATCH/
  );
});

test("decodeNearViewResult rejects invalid response bytes", () => {
  const response = {
    block_height: block.height,
    block_hash: block.hash,
    result: [123, 256, 125]
  };

  assert.throws(
    () => decodeNearViewResult(response, block),
    /NEAR_RPC_INVALID_VIEW_RESULT_BYTES/
  );
});

test("decodeNearViewResult rejects malformed JSON", () => {
  const response = {
    block_height: block.height,
    block_hash: block.hash,
    result: Array.from(Buffer.from("{invalid", "utf8"))
  };

  assert.throws(
    () => decodeNearViewResult(response, block),
    /NEAR_RPC_INVALID_VIEW_RESULT_JSON/
  );
});
