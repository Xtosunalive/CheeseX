const assert = require("node:assert/strict");
const test = require("node:test");

const { createJsonLogger } = require("../json-logger.cjs");
const { observeOperation } = require("../operation-observer.cjs");
const { runWithRequestContext } = require("../request-context.cjs");

function capture() {
  const lines = [];
  return {
    lines,
    logger: createJsonLogger({ sink: (line) => lines.push(JSON.parse(line)) }),
  };
}

test("operation observer emits correlated start and completion without changing the result", () => {
  const { lines, logger } = capture();
  const result = runWithRequestContext({ traceId: "tr_operation-12345678" }, () => observeOperation({
    logger,
    name: "proposal.checks",
    fields: { proposal_id: "proposal-123456789abc" },
    resultFields: (value) => ({ checks_id: value.checksId }),
  }, () => ({ checksId: "checks-1" })));

  assert.deepEqual(result, { checksId: "checks-1" });
  assert.deepEqual(lines.map((entry) => entry.event), ["proposal.checks.started", "proposal.checks.completed"]);
  assert.ok(lines.every((entry) => entry.trace_id === "tr_operation-12345678"));
  assert.equal(lines[1].checks_id, "checks-1");
  assert.equal(typeof lines[1].duration_ms, "number");
});

test("operation observer logs failure and rethrows the original error", () => {
  const { lines, logger } = capture();
  const failure = Object.assign(new Error("blocked"), { code: "CHECKS_BLOCKED" });

  assert.throws(() => observeOperation({ logger, name: "proposal.merge" }, () => { throw failure; }), (error) => error === failure);
  assert.deepEqual(lines.map((entry) => entry.event), ["proposal.merge.started", "proposal.merge.failed"]);
  assert.equal(lines[1].error_code, "CHECKS_BLOCKED");
  assert.equal(lines[1].error, "blocked");
});

test("operation observer preserves asynchronous results and failures", async () => {
  const { lines, logger } = capture();
  assert.equal(await observeOperation({ logger, name: "pipeline.hook" }, async () => "done"), "done");
  await assert.rejects(
    observeOperation({ logger, name: "pipeline.failure" }, async () => { throw new Error("async failure"); }),
    /async failure/,
  );
  assert.deepEqual(lines.map((entry) => entry.event), [
    "pipeline.hook.started", "pipeline.hook.completed",
    "pipeline.failure.started", "pipeline.failure.failed",
  ]);
});
