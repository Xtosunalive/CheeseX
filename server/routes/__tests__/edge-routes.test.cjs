// @tests: server/routes/edge-routes.cjs（EDGE-RELATION-GOV-001 阶段 3／SPEC-026 §十一）
// 层级：Adapter 契约＋HTTP 端到端（route-harness 走完整传输层：契约推导校验/错误处理器真实经过）。
//   验证对象：门禁三答（relation_search 消费方传递／无 consumer 回落工作态＋freshness 标注／
//   邻域 runtime_view 现算）＋三端点契约形状（200 零值、400 INVALID_QUERY、404 EDGE_NOT_FOUND）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const edgeRoutes = require("../edge-routes.cjs");
const { createRouteHarness } = require("./helpers/route-harness.cjs");
const { openPersistenceDb } = require("../../shared/persistence/sqlite-adapter.cjs");
const { createDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
const { createEdgeQuery } = require("../../shared/edge-query.cjs");

const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "edge-routes-")); // 非 git 目录 → freshness unknown

function seedAndRegister(formalConsumer = null, graphOverride = null) {
  const store = createDerivedIndexStore(openPersistenceDb());
  store.graphProjection.replaceAll(
    ["a", "b", "d"].map((id) => ({ nodeId: id, label: `N-${id}`, category: "Entity", labels: ["Module"], degree: 1, properties: {} })),
    [
      { edgeId: "a|b|BELONGS_TO", sourceId: "a", targetId: "b", relationType: "BELONGS_TO", sourceFile: "f.md", lineNumber: 1, evidenceHash: "h", reviewStatus: "approved", properties: {} },
      { edgeId: "d|a|BELONGS_TO", sourceId: "d", targetId: "a", relationType: "BELONGS_TO", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: "pending", properties: {} },
    ],
  );
  const h = createRouteHarness();
  edgeRoutes.setVaultPath(vaultPath);
  edgeRoutes.register(h.registerRoute, { edgeQuery: createEdgeQuery({ store }), formalConsumer });
  return { h, store, graphOverride };
}

test("GET /api/edges（无正式消费方）：回落工作态投影，全量带 reviewStatus，freshness=null，方向与类型过滤可用", async () => {
  const { h } = seedAndRegister();
  const res = await h.request("GET /api/edges", { url: "/api/edges?node=a" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.count, 2, "both＝出链+反链");
  assert.equal(res.body.data.dataSource, "working-projection");
  assert.equal(res.body.data.freshness, null, "无 consumer → gate callback(null, null)");
  const pending = res.body.data.edges.find((e) => e.edgeId === "d|a|BELONGS_TO");
  assert.equal(pending.reviewStatus, "pending", "工作态全量带 review_status（门禁三答②工作态语义）");

  const out = await h.request("GET /api/edges", { url: "/api/edges?node=a&direction=out" });
  assert.deepEqual(out.body.data.edges.map((e) => e.edgeId), ["a|b|BELONGS_TO"]);
  const typed = await h.request("GET /api/edges", { url: "/api/edges?node=a&direction=in&relationType=BELONGS_TO" });
  assert.deepEqual(typed.body.data.edges.map((e) => e.edgeId), ["d|a|BELONGS_TO"]);
});

test("GET /api/edges 参数校验：缺 node／direction 非法／limit 越界 → 400 INVALID_QUERY", async () => {
  const { h } = seedAndRegister();
  for (const qs of ["", "?direction=out", "?node=a&direction=sideways", "?node=a&limit=0", "?node=a&limit=501"]) {
    const res = await h.request("GET /api/edges", { url: `/api/edges${qs}` });
    assert.equal(res.statusCode, 400, qs);
    assert.equal(res.body.error_code, "INVALID_QUERY", qs);
  }
});

test("GET /api/edges（正式路径，stub consumer）：消费方身份＝relation_search（门禁三答①），响应带 releaseId/sourceCommit", async () => {
  let capturedConsumer = null;
  const formalConsumer = {
    withPinnedRelease(callback) {
      return callback({
        releaseId: "rel-1",
        sourceCommit: "c".repeat(40),
        readMasterGraph(consumer) {
          capturedConsumer = consumer;
          // 已按断言政策过滤后的正式视图（selectFormalRelations 在 formal-knowledge-consumer 内部执行——此处 stub 其输出）
          return {
            nodes: [
              { id: "a", label: "A", category: "Entity", labels: ["Module"], properties: {} },
              { id: "b", label: "B", category: "Entity", labels: ["Module"], properties: {} },
            ],
            connections: [
              { from: "a", to: "b", relationType: "BELONGS_TO", reviewStatus: "approved" },
            ],
          };
        },
      });
    },
  };
  const { h } = seedAndRegister(formalConsumer);
  const res = await h.request("GET /api/edges", { url: "/api/edges?node=a&direction=out" });
  assert.equal(res.statusCode, 200);
  assert.equal(capturedConsumer, "relation_search", "消费方身份必须复用 relation_search，不得新造 token");
  assert.equal(res.body.data.releaseId, "rel-1");
  assert.equal(res.body.data.edges.length, 1, "正式边经 normalizeTopology＋topoToRows 归一（复用映射单源）");
  assert.equal(res.body.data.edges[0].relationType, "BELONGS_TO");
});

test("GET /api/edges/neighborhood：有向邻域现算；中心不存在→200 真实零值；hops 越界→400", async () => {
  const { h } = seedAndRegister();
  const ok = await h.request("GET /api/edges/neighborhood", { url: "/api/edges/neighborhood?node=a&hops=1" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.directed, true);
  assert.equal(ok.body.data.centerFound, true);
  assert.deepEqual(ok.body.data.nodes.map((n) => n.nodeId).sort(), ["a", "b", "d"]);
  const dToA = ok.body.data.edges.find((e) => e.edgeId === "d|a|BELONGS_TO");
  assert.equal(dToA.sourceId, "d", "方向保留（修正无向 BFS）");

  const zero = await h.request("GET /api/edges/neighborhood", { url: "/api/edges/neighborhood?node=ghost" });
  assert.equal(zero.statusCode, 200, "PR-084 口径：中心不存在不 404，真实零值");
  assert.equal(zero.body.data.centerFound, false);
  assert.deepEqual(zero.body.data.edges, []);

  const bad = await h.request("GET /api/edges/neighborhood", { url: "/api/edges/neighborhood?node=a&hops=9" });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error_code, "INVALID_QUERY");
});

test("GET /api/edges/:edgeId：在册 200 单边；不存在 404 EDGE_NOT_FOUND（复用既有错误码目录单元）", async () => {
  const { h } = seedAndRegister();
  const ok = await h.request("GET /api/edges/:edgeId", { params: { edgeId: "a|b|BELONGS_TO" }, url: "/api/edges/a%7Cb%7CBELONGS_TO" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.edge.edgeId, "a|b|BELONGS_TO");
  assert.equal(ok.body.data.edge.sourceFile, "f.md");

  const missing = await h.request("GET /api/edges/:edgeId", { params: { edgeId: "nope" }, url: "/api/edges/nope" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error_code, "EDGE_NOT_FOUND");
  assert.equal(missing.body.details.edgeId, "nope");
});

test("路由键与 openapi 三路径对齐（check:contract-route-parity 前置自证）", async () => {
  const { h } = seedAndRegister();
  assert.ok([...h.routes.keys()].includes("GET /api/edges"));
  assert.ok([...h.routes.keys()].includes("GET /api/edges/neighborhood"));
  assert.ok([...h.routes.keys()].includes("GET /api/edges/:edgeId"));
});
