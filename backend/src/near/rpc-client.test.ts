import test from "node:test";
import assert from "node:assert/strict";

import { parseRetryAfterMs, isRetryableHttpStatus } from "./rpc-client.js";

test("parses Retry-After seconds", () => {
  assert.equal(parseRetryAfterMs("2"), 2000);
});

test("parses Retry-After HTTP date", () => {
  const now = Date.parse("2026-11-13T00:00:00.000Z");
  const retryAt = "Fri, 13 Nov 2026 00:00:05 GMT";

  assert.equal(parseRetryAfterMs(retryAt, now), 5000);
});

test("returns zero for an elapsed Retry-After date", () => {
  const now = Date.parse("2026-11-13T00:00:10.000Z");
  const retryAt = "Fri, 13 Nov 2026 00:00:05 GMT";

  assert.equal(parseRetryAfterMs(retryAt, now), 0);
});

test("caps Retry-After seconds at 30 seconds", () => {
  assert.equal(parseRetryAfterMs("3600"), 30_000);
});

test("caps Retry-After HTTP dates at 30 seconds", () => {
  const now = Date.parse("2026-11-13T00:00:00.000Z");
  const retryAt = "Fri, 13 Nov 2026 01:00:00 GMT";

  assert.equal(parseRetryAfterMs(retryAt, now), 30_000);
});

test("returns undefined for an invalid Retry-After header", () => {
  assert.equal(parseRetryAfterMs("not-a-date"), undefined);
  assert.equal(parseRetryAfterMs(undefined), undefined);
});

test("classifies transient HTTP statuses as retryable", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableHttpStatus(status), true);
  }
});

test("does not retry permanent HTTP errors", () => {
  for (const status of [400, 401, 403, 404, 405, 422]) {
    assert.equal(isRetryableHttpStatus(status), false);
  }
});
