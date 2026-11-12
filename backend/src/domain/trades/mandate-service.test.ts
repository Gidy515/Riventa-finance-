import test from "node:test";
import assert from "node:assert/strict";

import {
  InvalidTradeQueryError
} from "./trade-service.js";

import {
  validateMandateId,
  validateMandateListParameters
} from "./mandate-service.js";

test("mandate list accepts default and maximum limits", () => {
  assert.doesNotThrow(() => validateMandateListParameters({}));
  assert.doesNotThrow(() => validateMandateListParameters({ limit: 1 }));
  assert.doesNotThrow(() => validateMandateListParameters({ limit: 50 }));
});

test("mandate list rejects limits outside 1–50", () => {
  for (const limit of [0, 51, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => validateMandateListParameters({ limit }),
      InvalidTradeQueryError
    );
  }
});

test("mandate pagination accepts valid u64 cursors", () => {
  assert.doesNotThrow(() =>
    validateMandateListParameters({
      beforeMandateId: "18446744073709551615"
    })
  );
});

test("mandate pagination rejects malformed cursors", () => {
  for (const id of ["", "-1", "01", "abc", "18446744073709551616"]) {
    assert.throws(
      () => validateMandateListParameters({ beforeMandateId: id }),
      InvalidTradeQueryError
    );
  }
});

test("mandate IDs accept valid u64 values", () => {
  assert.doesNotThrow(() => validateMandateId("0"));
  assert.doesNotThrow(() => validateMandateId("42"));
  assert.doesNotThrow(() =>
    validateMandateId("18446744073709551615")
  );
});

test("mandate IDs reject malformed and overflowing values", () => {
  for (const id of ["", "-1", "01", "1.5", "abc", "18446744073709551616"]) {
    assert.throws(() => validateMandateId(id), InvalidTradeQueryError);
  }
});
