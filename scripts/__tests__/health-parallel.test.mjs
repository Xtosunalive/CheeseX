import { strict as assert } from "node:assert";
import test from "node:test";
import { runHealth, selectChecks } from "../health.mjs";

test("--api and --web select only the requested endpoint", () => {
  const checks = [["API", "api"], ["Web", "web"]];
  assert.deepEqual(selectChecks(["--api"], checks), [["API", "api"]]);
  assert.deepEqual(selectChecks(["--web"], checks), [["Web", "web"]]);
});

test("runs delayed health checks concurrently", async () => {
  let active = 0;
  let maxActive = 0;
  const delayedCheck = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 80));
    active -= 1;
    return false;
  };
  const started = Date.now();
  const result = await runHealth({
    allChecks: [["API", "api"], ["Web", "web"]],
    check: delayedCheck,
    logger: { log() {}, error() {} },
  });
  assert.equal(result.failed, 2);
  assert.equal(maxActive, 2, "both delayed checks must overlap");
  assert.ok(Date.now() - started < 140, "parallel checks should take about one delay");
});
