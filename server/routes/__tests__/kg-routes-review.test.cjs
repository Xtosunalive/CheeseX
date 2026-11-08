const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const kgRoutes = require("../kg-routes.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：kg/review 已动作化

async function run() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "kg-review-"));
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });

  const edgeA = {
    from: "api-gateway",
    to: "auth-service",
    relationType: "DEPENDS_ON",
    sourceFile: "wiki/entities/api-gateway.md",
    properties: { sources: [{ line_number: 9, evidence_text: "依赖::[[auth-service]]" }] },
  };
  const edgeB = {
    from: "api-gateway",
    to: "auth-service",
    relationType: "CONNECTS_TO",
    sourceFile: "wiki/entities/api-gateway.md",
    properties: { sources: [{ line_number: 10, evidence_text: "连接::[[auth-service]]" }] },
  };
  const masterPath = path.join(vault, ".ledger", "master_graph.json");
  const graph = { nodes: [{ id: "api-gateway", label: "API 网关" }, { id: "auth-service", label: "认证服务" }], connections: [edgeA, edgeB] };
  fs.writeFileSync(masterPath, JSON.stringify(graph, null, 2), "utf-8");

  setupActionRuntime({ vaultPath: vault }); // WP-048 W1-B：kg.review 已动作化（审计落本夹具库）
  const h = createRouteHarness();
  kgRoutes.setVaultPath(vault);
  kgRoutes.register(h.registerRoute, {
    readSemanticArchitecture: () => null,
    readMasterGraph: () => graph,
  });
  assert.strictEqual(h.routes.has("POST /api/review/log"), false, "legacy derived-graph review write route must stay retired");
  assert(h.routes.has("GET /api/kg/review-history"), "review history route should register");

  const history = await h.call("GET /api/kg/review-history");
  assert.strictEqual(history.statusCode, 200);
  assert.deepStrictEqual(history.body.data.records, []);

  // SPEC-012 WP-A：经 runtime-state store 直种两种合法形态（原文件种法随迁出失效）
  getRuntimeStateStore(vault).review.append(
    // 边级记录（完整）
    { action: "approved", source: "api-gateway", target: "auth-service", reviewer: "r", decidedAt: "2026-10-11T01:00:00Z", edgeId: "e1" },
    "2026-10-11T01:00:00Z",
  );
  getRuntimeStateStore(vault).review.append(
    // 候选级记录（PR-042 真库实测形态：无 source/target）
    { action: "rejected", kind: "relation_candidate", candidateId: "c1", candidateHash: "h1", evidenceSetHash: "h2", sourceSetHash: "h3", reviewer: "r", reason: "x", decidedAt: "2026-10-11T02:00:00Z" },
    "2026-10-11T02:00:00Z",
  );
  const mixedHistory = await h.call("GET /api/kg/review-history");
  assert.strictEqual(mixedHistory.statusCode, 200);
  const mixed = mixedHistory.body.data;
  assert.strictEqual(mixed.records.length, 1); // 边级只含完整记录
  assert.strictEqual(mixed.candidateRecords.length, 1); // 候选分列
  assert.strictEqual(mixed.total, 2);
  assert.strictEqual(mixed.candidateRecords[0].candidateId, "c1");

  // 旧「整账本非数组（{legacy:true}）读侧 fail-safe」子句随 SPEC-012 WP-A 退役：store 账本恒为数组，
  // 非数组整体形态不可表示（损坏/异形面移交事务层与写侧校验）。此处锚定迁出语义：vault 内不再落账本文件。
  assert.strictEqual(fs.existsSync(path.join(vault, ".ledger", "review_actions.json")), false, "人裁账本已迁 runtime-state store，vault 不得残留该文件");
  const stillFine = await h.call("GET /api/kg/review-history");
  assert.strictEqual(stillFine.statusCode, 200);
  assert.strictEqual(stillFine.body.data.total, 2, "读侧不受影响");

  // PR-042 写侧分形态校验：异形拒（边缺 source / 候选缺 candidateId）、合法候选收
  const { appendReviewAction } = require("../../services/governance/review-action-store.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ras-pr042-"));
  assert.throws(
    () => appendReviewAction(tmp, { action: "approved", target: "b", reviewer: "r", decidedAt: "2026-10-11T00:00:00Z" }),
    /REVIEW_ACTION_INVALID_SHAPE.*source/,
  );
  assert.throws(
    () => appendReviewAction(tmp, { action: "rejected", kind: "relation_candidate", reviewer: "r", decidedAt: "2026-10-11T00:00:00Z" }),
    /REVIEW_ACTION_INVALID_SHAPE.*candidateId/,
  );
  appendReviewAction(tmp, { action: "rejected", kind: "relation_candidate", candidateId: "c1", reviewer: "r", decidedAt: "2026-10-11T00:00:00Z" });
  const ledger = getRuntimeStateStore(tmp).review.list(); // SPEC-012 WP-A：断言经 store 读（不落 vault 文件）
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(ledger[0].kind, "relation_candidate");

  await h.close();
  fs.rmSync(vault, { recursive: true, force: true });
  console.log("KG review route tests passed: 5 passed, 0 failed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
