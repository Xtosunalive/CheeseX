// @tests: server/shared/edge-query.cjs（EDGE-RELATION-GOV-001 阶段 3／SPEC-026 §十一）
// 层级：纯单元＋Adapter 契约（内存库真 SQL——含 EXPLAIN QUERY PLAN 索引证据＝立案 §9「反链走索引」验收面；
//   有向语义对照旧 graph-neighborhood 无向 BFS 的修正＝立案 §3.3/§9「邻域有向可分 A→B 与 B→A」）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { createDerivedIndexStore } = require("../persistence/derived-index-store.cjs");
const { createEdgeQuery } = require("../edge-query.cjs");

function seedDirectedGraph(store) {
  // 有向图：a→b（BELONGS_TO）、b→c（BELONGS_TO）、a→c（HAS_VERSION）、d→a（BELONGS_TO）
  store.graphProjection.replaceAll(
    ["a", "b", "c", "d"].map((id) => ({ nodeId: id, label: `N-${id}`, category: "Entity", labels: ["Module"], degree: 1, properties: {} })),
    [
      { edgeId: "a|b|BELONGS_TO", sourceId: "a", targetId: "b", relationType: "BELONGS_TO", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: "approved", properties: {} },
      { edgeId: "b|c|BELONGS_TO", sourceId: "b", targetId: "c", relationType: "BELONGS_TO", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: "approved", properties: {} },
      { edgeId: "a|c|HAS_VERSION", sourceId: "a", targetId: "c", relationType: "HAS_VERSION", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: "pending", properties: {} },
      { edgeId: "d|a|BELONGS_TO", sourceId: "d", targetId: "a", relationType: "BELONGS_TO", sourceFile: null, lineNumber: null, evidenceHash: null, reviewStatus: "approved", properties: {} },
    ],
  );
}

function makeQuery() {
  const db = openPersistenceDb();
  const store = createDerivedIndexStore(db);
  seedDirectedGraph(store);
  return { db, store, query: createEdgeQuery({ store }) };
}

test("出链/反链/双向：方向语义正确、relationType 过滤、both 并集去重、limit 截断", () => {
  const { query } = makeQuery();
  const out = query.edgesForNode("a", { direction: "out" });
  assert.deepEqual(out.map((e) => e.edgeId), ["a|b|BELONGS_TO", "a|c|HAS_VERSION"], "a 的出链");
  const inn = query.edgesForNode("a", { direction: "in" });
  assert.deepEqual(inn.map((e) => e.edgeId), ["d|a|BELONGS_TO"], "a 的反链（谁指向我）");
  const both = query.edgesForNode("a", { direction: "both" });
  assert.equal(both.length, 3, "both＝并集去重");
  const typed = query.edgesForNode("a", { direction: "out", relationType: "BELONGS_TO" });
  assert.deepEqual(typed.map((e) => e.edgeId), ["a|b|BELONGS_TO"], "relationType 过滤");
  const limited = query.edgesForNode("a", { direction: "out", limit: 1 });
  assert.equal(limited.length, 1, "limit 截断");
  assert.equal(query.getEdge("a|b|BELONGS_TO").targetId, "b");
  assert.equal(query.getEdge("不存在"), undefined);
});

test("有向邻域：沿出/入两向扩展但保留每条边真实方向（可区分 A→B 与 B→A），hops 分层正确", () => {
  const { query } = makeQuery();
  const n1 = query.neighborhood("a", { hops: 1 });
  assert.equal(n1.centerFound, true);
  assert.equal(n1.directed, true);
  assert.deepEqual(n1.nodes.map((x) => x.nodeId).sort(), ["a", "b", "c", "d"], "1 跳邻域含出链端点 b/c 与反链端点 d");
  const edgeById = new Map(n1.edges.map((e) => [e.edgeId, e]));
  assert.equal(edgeById.get("a|b|BELONGS_TO").sourceId, "a", "方向保留：a→b");
  assert.equal(edgeById.get("d|a|BELONGS_TO").sourceId, "d", "方向保留：d→a（反链方向不翻转）");
  assert.deepEqual(n1.hopsByNodeId, { a: 0, b: 1, c: 1, d: 1 });
  // 2 跳：a→b→c（c 已在 1 跳经 HAS_VERSION 到达，min 跳数语义）
  const n2 = query.neighborhood("a", { hops: 2 });
  assert.deepEqual(n2.nodes.map((x) => x.nodeId).sort(), ["a", "b", "c", "d"]);
  assert.equal(n2.truncated, false);
  // relationType 过滤：仅 BELONGS_TO 时 HAS_VERSION 边不入域
  const typed = query.neighborhood("a", { hops: 1, relationType: "HAS_VERSION" });
  assert.deepEqual(typed.edges.map((e) => e.edgeId), ["a|c|HAS_VERSION"]);
  assert.deepEqual(typed.nodes.map((x) => x.nodeId), ["a", "c"], "无 BELONGS_TO 扩展则 b/d 不入域");
  // 中心不存在：真实零值（PR-084 口径不 404）
  const missing = query.neighborhood("ghost", { hops: 1 });
  assert.equal(missing.centerFound, false);
  assert.deepEqual(missing.nodes, []);
  assert.deepEqual(missing.edges, []);
});

test("邻域规模上限：maxNodes/maxEdges 触发 truncated", () => {
  const { query } = makeQuery();
  const capped = query.neighborhood("a", { hops: 2, maxNodes: 2, maxEdges: 2 });
  assert.equal(capped.truncated, true);
  assert.ok(capped.nodes.length <= 2 || capped.edges.length <= 2);
});

test("索引证据（立案 §9 验收面）：出链/反链谓词走 idx_edges_source/idx_edges_target，非全表扫描", () => {
  const { db } = makeQuery();
  const outPlan = db.prepare("EXPLAIN QUERY PLAN SELECT edge_id FROM edges WHERE source_id = ? AND relation_type = ?").all("a", "BELONGS_TO");
  const inPlan = db.prepare("EXPLAIN QUERY PLAN SELECT edge_id FROM edges WHERE target_id = ? AND relation_type = ?").all("a", "BELONGS_TO");
  const planText = (rows) => rows.map((r) => r.detail).join(" | ");
  assert.match(planText(outPlan), /idx_edges_source/, `出链须走索引：${planText(outPlan)}`);
  assert.match(planText(inPlan), /idx_edges_target/, `反链须走索引：${planText(inPlan)}`);
});
