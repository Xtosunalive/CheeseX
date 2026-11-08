const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createTraceId,
  getTraceId,
  resolveTraceId,
  runWithRequestContext,
} = require("../request-context.cjs");

test("request context generates and validates trace ids", () => {
  assert.match(createTraceId(), /^tr_[0-9a-f-]{36}$/);
  assert.equal(resolveTraceId("tr_client-12345678"), "tr_client-12345678");
  assert.match(resolveTraceId("invalid trace id"), /^tr_[0-9a-f-]{36}$/);
  assert.match(resolveTraceId("x".repeat(300)), /^tr_[0-9a-f-]{36}$/);
});

test("request context propagates through async work and isolates concurrent requests", async () => {
  const seen = await Promise.all([
    runWithRequestContext({ traceId: "tr_request-aaaaaaaa" }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return getTraceId();
    }),
    runWithRequestContext({ traceId: "tr_request-bbbbbbbb" }, async () => {
      await Promise.resolve();
      return getTraceId();
    }),
  ]);

  assert.deepEqual(seen, ["tr_request-aaaaaaaa", "tr_request-bbbbbbbb"]);
  assert.equal(getTraceId(), null);
});
