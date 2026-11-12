import test from "node:test";
import assert from "node:assert/strict";

import {
  InvalidTradeQueryError,
  validateTradeId,
  validateTradeListParameters
} from "./trade-service.js";

test("trade list accepts default and maximum limits", () => {
  assert.doesNotThrow(() => validateTradeListParameters({}));
  assert.doesNotThrow(() => validateTradeListParameters({ limit: 1 }));
  assert.doesNotThrow(() => validateTradeListParameters({ limit: 50 }));
});

test("trade list rejects limits outside 1–50", () => {
  for (const limit of [0, 51, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => validateTradeListParameters({ limit }),
      InvalidTradeQueryError
    );
  }
});

test("trade list rejects unknown trade states", () => {
  assert.throws(
    () => validateTradeListParameters({ state: "InvalidState" }),
    InvalidTradeQueryError
  );
});

test("trade list accepts valid cursor values", () => {
  assert.doesNotThrow(() =>
    validateTradeListParameters({
      cursor: {
        createdAtNs: "1000000000",
        tradeId: "42"
      }
    })
  );
});

test("trade list rejects malformed cursor values", () => {
  assert.throws(
    () =>
      validateTradeListParameters({
        cursor: {
          createdAtNs: "not-a-number",
          tradeId: "42"
        }
      }),
    InvalidTradeQueryError
  );
});

test("trade IDs accept valid u64 values", () => {
  assert.doesNotThrow(() => validateTradeId("0"));
  assert.doesNotThrow(() => validateTradeId("42"));
  assert.doesNotThrow(() =>
    validateTradeId("18446744073709551615")
  );
});

test("trade IDs reject malformed and overflowing u64 values", () => {
  for (const id of [
    "",
    "-1",
    "01",
    "1.5",
    "abc",
    "18446744073709551616"
  ]) {
    assert.throws(() => validateTradeId(id), InvalidTradeQueryError);
  }
});
