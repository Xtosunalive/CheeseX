const assert = require("assert");
const pipelineRoutes = require("../pipeline-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-C：run/rebuild/cancel 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "pipeline-actions-")) });

async function run() {
  const h = createRouteHarness();
  const job = { state: "running", jobId: "job-1", mode: "full", logs: [] };
  const startCalls = [];
  pipelineRoutes.register(h.registerRoute, {
    pipelineRunService: {
      start(mode, options) { startCalls.push({ mode, options }); return { ...job, mode }; },
      getStatus() { return job; },
    },
  });

  const runResponse = await h.call("POST /api/pipeline/run", "/api/pipeline/run?mode=full");
  assert.strictEqual(runResponse.statusCode, 202, JSON.stringify(runResponse.body));
  assert.strictEqual(runResponse.body.success, true);
  assert.strictEqual(runResponse.body.data.jobId, "job-1");

  const statusResponse = await h.call("GET /api/pipeline/status");
  assert.strictEqual(statusResponse.statusCode, 200);
  assert.strictEqual(statusResponse.body.data.state, "running");

  const rebuildResponse = await h.call("POST /api/pipeline/rebuild");
  assert.strictEqual(rebuildResponse.statusCode, 202, "重建入口 202");
  assert.strictEqual(rebuildResponse.body.success, true);
  assert.deepStrictEqual(startCalls[1], { mode: "full", options: { purpose: "article_graph", joinExisting: true } }, "重建=全量重建 purpose（ADR063）");

  // PR-085：契约无 requestBody 的写路由收到 body → 400（requestBody 缺席＝禁止 body）
  const withBody = await h.call("POST /api/pipeline/rebuild", undefined, { anything: 1 });
  assert.strictEqual(withBody.statusCode, 400);
  assert.strictEqual(withBody.body.error_code, "VALIDATION_ERROR");
  await h.close();
  console.log("Pipeline-Routes tests passed: 7 passed, 0 failed");
}

run().catch((error) => { console.error(error); process.exit(1); });
