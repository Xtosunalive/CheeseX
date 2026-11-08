const assert = require("assert");
const test = require("node:test");
const kgRoutes = require("../kg-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");

const ROUTE = "POST /api/kg/impact-analysis";

function harnessFor(service, extra = {}) {
  const h = createRouteHarness();
  kgRoutes.register(h.registerRoute, { readSemanticArchitecture: () => null, readMasterGraph: () => null, impactAnalysisService: service, ...extra });
  assert(h.routes.has(ROUTE));
  return h;
}

test("returns analysis through the standard envelope", async () => {
  let received;
  const expected = { downstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], meta: { totalNodesAffected: 0, maxDepth: 0, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] } };
  const response = await harnessFor({ analyze(payload) { received = payload; return expected; } }).call(ROUTE, undefined, { seedNodeIds: ["a"] });
  assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body)); assert.deepStrictEqual(received, { seedNodeIds: ["a"] });
  // B4 修复：fallback（无 formalConsumer）响应附加 dataSource="worktree"（E3 来源显式化）
  assert.deepStrictEqual(response.body.data, { ...expected, dataSource: "worktree" });
});

test("maps invalid json and typed service errors", async () => {
  // PR-085 第 1 步：非法 JSON 由传输层拒绝（统一 400 VALIDATION_ERROR）；INVALID_QUERY 保留给语义层查询错误
  const invalid = await harnessFor({ analyze() {} }).request(ROUTE, { rawBody: "{" });
  assert.strictEqual(invalid.statusCode, 400); assert.strictEqual(invalid.body.error_code, "VALIDATION_ERROR");
  for (const [code, status] of [["INVALID_QUERY", 400], ["SEED_NOT_FOUND", 404], ["GRAPH_UNAVAILABLE", 503]]) {
    const response = await harnessFor({ analyze() { throw Object.assign(new Error(code), { code }); } }).call(ROUTE, undefined, { seedNodeIds: ["a"] });
    assert.strictEqual(response.statusCode, status, code + " → " + JSON.stringify(response.body));
    assert.strictEqual(response.body.error_code, code);
  }
});

// ── Task 6: Route inference parameter tests ──────────────────────

test("passes enableInference and maxInferenceDepth to service", async () => {
  let received;
  const h = harnessFor({ analyze(payload) { received = payload; return { downstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], meta: { totalNodesAffected: 0, maxDepth: 0, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] } }; } });
  const response = await h.call(ROUTE, undefined, { seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 2 });
  assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));
  assert.strictEqual(received.enableInference, true);
  assert.strictEqual(received.maxInferenceDepth, 2);
});

test("rejects invalid maxInferenceDepth values", async () => {
  function validatingAnalyze(payload) {
    if (payload.enableInference === true && (!Number.isInteger(payload.maxInferenceDepth) || payload.maxInferenceDepth < 1 || payload.maxInferenceDepth > 3)) {
      throw Object.assign(new Error("maxInferenceDepth 必须是 1..3 的整数"), { code: "INVALID_QUERY" });
    }
    return {};
  }
  const h = harnessFor({ analyze: validatingAnalyze });
  const tooLow = await h.call(ROUTE, undefined, { seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 0 });
  assert.strictEqual(tooLow.statusCode, 400);
  const tooHigh = await h.call(ROUTE, undefined, { seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 10 });
  assert.strictEqual(tooHigh.statusCode, 400);
});

test("maps INFERENCE_UNAVAILABLE service error", async () => {
  const h = harnessFor({ analyze() { throw Object.assign(new Error("推理引擎未初始化"), { code: "INFERENCE_UNAVAILABLE" }); } });
  const response = await h.call(ROUTE, undefined, { seedNodeIds: ["a"], enableInference: true });
  assert.strictEqual(response.statusCode, 503);
});

test("formal impact route pins once and returns the same Release identity", async () => {
  let pins = 0;
  let vaultCalls = 0;
  const releaseId = `release-${"e".repeat(64)}`;
  const sourceCommit = "f".repeat(40);
  const formalContext = { releaseId, sourceCommit, marker: "release" };
  const h = harnessFor({ analyze() { vaultCalls += 1; } }, {
    formalConsumer: { withPinnedRelease(callback) { pins += 1; return callback(formalContext); } },
    impactAnalysisFactory(context) {
      assert.strictEqual(context, formalContext);
      return { analyze: () => ({ downstream: {}, upstream: {}, filteredEdges: [], meta: {} }) };
    },
  });
  const response = await h.call(ROUTE, undefined, { seedNodeIds: ["a"], enableInference: true });
  assert.strictEqual(response.statusCode, 200, JSON.stringify(response.body));
  const data = response.body.data;
  assert.strictEqual(data.releaseId, releaseId);
  assert.strictEqual(data.sourceCommit, sourceCommit);
  assert.strictEqual(pins, 1);
  assert.strictEqual(vaultCalls, 0);
});

test("formal impact route propagates current failure without calling Vault service", async () => {
  let vaultCalls = 0;
  const h = harnessFor({ analyze() { vaultCalls += 1; } }, {
    formalConsumer: { withPinnedRelease() { throw Object.assign(new Error("missing"), { code: "NO_CURRENT_RELEASE", status: 404 }); } },
    impactAnalysisFactory() { throw new Error("must not build"); },
  });
  const response = await h.call(ROUTE, undefined, { seedNodeIds: ["a"] });
  assert.strictEqual(response.statusCode, 404);
  assert.strictEqual(response.body.error_code, "NO_CURRENT_RELEASE");
  assert.strictEqual(vaultCalls, 0);
});
