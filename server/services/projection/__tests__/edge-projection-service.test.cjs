// @tests: server/services/projection/edge-projection-service.cjs（EDGE-RELATION-GOV-001／SPEC-026 C3/C4/C5）
// 层级：纯单元＋Adapter 契约（内存库/临时目录库；normalizeTopology 为真实依赖非替身——
//   映射一致性即对其输出验收；readGraph 注入＝同一输入快照钉死，验收口径见 SPEC-026 C4）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../../../shared/persistence/sqlite-adapter.cjs");
const { createDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
const {
  createEdgeProjectionService,
  CONTENT_HASH_KV_KEY,
} = require("../edge-projection-service.cjs");
const { normalizeTopology } = require("../master-graph-service.cjs");

const logger = { info() {}, warn() {}, error() {} };

function sampleGraph() {
  return {
    _format_version: "1.0",
    nodes: [
      { id: "wiki/entities/A.md", label: "A", category: "Document", labels: ["Document"], properties: { owner: "x" } },
      { id: "subdomain/sd1", label: "SD1", category: "Subdomain", labels: ["Subdomain"], properties: {} },
    ],
    connections: [
      { from: "wiki/entities/A.md", to: "subdomain/sd1", relationType: "BELONGS_TO", sourceFile: "知识库/wiki/entities/A.md", lineNumber: 2, evidenceHash: "abc123", reviewStatus: "approved" },
      { from: "wiki/entities/A.md", to: "subdomain/sd1", type: "HAS_VERSION", reviewStatus: "pending" },
    ],
  };
}

function makeService(readGraph) {
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({ store, readGraph, logger });
  return { store, service };
}

test("C3 映射一致性：两表行集与 normalizeTopology 输出逐字段一致（拓扑 schema 断言真实跑过）", () => {
  const graph = sampleGraph();
  const { store, service } = makeService(() => graph);
  const result = service.rebuild();
  assert.equal(result.rebuilt, true);
  const topo = normalizeTopology(graph); // 真实依赖直接对照（非替身）
  assert.equal(result.nodes, topo.nodes.length);
  assert.equal(result.edges, topo.edges.length);
  assert.equal(store.graphProjection.countNodes(), topo.nodes.length);
  assert.equal(store.graphProjection.countEdges(), topo.edges.length);

  const byNodeId = new Map(store.graphProjection.listNodes().map((n) => [n.nodeId, n]));
  for (const n of topo.nodes) {
    const row = byNodeId.get(n.id);
    assert.ok(row, `节点 ${n.id} 落行`);
    assert.equal(row.label, n.label);
    assert.equal(row.category, n.category);
    assert.equal(row.degree, n.degree);
    assert.deepEqual(row.labels, n.labels);
    assert.deepEqual(row.properties, n.properties);
  }
  const topoEdgeBySource = new Map(topo.edges.map((e) => [`${e.source}|${e.type}`, e]));
  for (const row of store.graphProjection.listEdges()) {
    const e = topoEdgeBySource.get(`${row.sourceId}|${row.relationType}`);
    assert.ok(e, `边 ${row.edgeId} 在拓扑输出中有对应`);
    assert.equal(row.targetId, e.target);
    assert.equal(row.edgeId, e.edgeId, "edge_id＝normalizeTopology 的稳定身份（stableEdgeId 口径）");
    assert.equal(row.sourceFile ?? null, e.sourceFile ?? null);
    assert.equal(row.lineNumber ?? null, e.lineNumber ?? null);
    assert.equal(row.evidenceHash ?? null, e.evidenceHash ?? null);
    assert.equal(row.reviewStatus ?? null, e.reviewStatus ?? null);
    assert.deepEqual(row.properties, e.properties);
  }
});

test("C4 幂等（同一输入快照）：连续两遍重建 contentHash 相等、行集一致、kv 可观测", () => {
  const graph = sampleGraph();
  const { store, service } = makeService(() => graph); // readGraph 钉死输入快照
  const first = service.rebuild();
  const rowsAfterFirst = { nodes: store.graphProjection.listNodes(), edges: store.graphProjection.listEdges() };
  const second = service.rebuild();
  assert.equal(second.rebuilt, true);
  assert.equal(second.contentHash, first.contentHash, "同一输入快照两遍 contentHash 相等");
  assert.deepEqual(store.graphProjection.listNodes(), rowsAfterFirst.nodes);
  assert.deepEqual(store.graphProjection.listEdges(), rowsAfterFirst.edges);
  assert.equal(store.kv.get(CONTENT_HASH_KV_KEY), second.contentHash, "contentHash 落 derived_kv 可观测");
  // 输入变化（如审批账本合并改变 reviewStatus）→ hash 合法变化（生产例外口径，非红）
  const graph2 = sampleGraph();
  graph2.connections[1].reviewStatus = "approved";
  const { service: svc2 } = makeService(() => graph2);
  const third = svc2.rebuild();
  assert.notEqual(third.contentHash, first.contentHash, "快照变化 → hash 合法不等（SPEC-026 C4 例外）");
});

test("C4 真实零值：readGraph 返回 null → 空投影（非跳过），hash 稳定", () => {
  const { store, service } = makeService(() => null);
  const first = service.rebuild();
  assert.equal(first.rebuilt, true);
  assert.equal(first.nodes, 0);
  assert.equal(first.edges, 0);
  assert.equal(store.graphProjection.countEdges(), 0);
  const second = service.rebuild();
  assert.equal(second.contentHash, first.contentHash);
});

test("C5 fail-open 读面：readGraph 抛错 → {rebuilt:false} 不写库（保留旧投影）", () => {
  let graph = sampleGraph();
  const { store, service } = makeService(() => {
    if (!graph) throw new Error("boom");
    return graph;
  });
  assert.equal(service.rebuild().rebuilt, true);
  const before = store.graphProjection.countEdges();
  graph = null; // 下次读取抛错
  const failed = service.rebuild();
  assert.equal(failed.rebuilt, false);
  assert.equal(failed.error, "boom");
  assert.equal(store.graphProjection.countEdges(), before, "失败不写库——旧投影保留");
});

test("C4 删库零损失演练：删库文件重开＋重建完整恢复（行集与 contentHash 复原）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-projection-drill-"));
  const dbPath = path.join(dir, "derived-index.db");
  try {
    const db1 = openPersistenceDb({ path: dbPath });
    const store1 = createDerivedIndexStore(db1);
    const service1 = createEdgeProjectionService({ store: store1, readGraph: () => sampleGraph(), logger });
    const first = service1.rebuild();
    const rowsBefore = { nodes: store1.graphProjection.listNodes(), edges: store1.graphProjection.listEdges() };
    db1.close();
    // 删库（②类可丢弃语义＝删整个库文件，非单表 DROP）
    fs.rmSync(dbPath);
    assert.equal(fs.existsSync(dbPath), false);
    // 重开：迁移全新应用，重建后完整恢复
    const db2 = openPersistenceDb({ path: dbPath });
    const store2 = createDerivedIndexStore(db2);
    const service2 = createEdgeProjectionService({ store: store2, readGraph: () => sampleGraph(), logger });
    const recovered = service2.rebuild();
    assert.equal(recovered.rebuilt, true);
    assert.equal(recovered.contentHash, first.contentHash, "恢复后 contentHash 与灾前一致");
    assert.deepEqual(store2.graphProjection.listNodes(), rowsBefore.nodes);
    assert.deepEqual(store2.graphProjection.listEdges(), rowsBefore.edges);
    db2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 对象本体批（ADR-012 D1）：治理关系并源 ──

const GOV_SOURCE = () => ({
  objects: [
    { objectId: "uuid-a", canonicalName: "字段字典", objectKind: "business_object", subtype: null },
    { objectId: "uuid-b", canonicalName: "标签词表", objectKind: "business_object", subtype: "value_domain" },
  ],
  relations: [
    { source: "字段字典", target: "标签词表", type: "reference", note: "值域引用", assertedBy: "human", assertedAt: "2026-10-24" },
  ],
});

test("对象本体并源：字典对象入图节点（含 subtype 标签）、治理边 approved/证据空/身份拼接、与机器边合并", () => {
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({
    store,
    readGraph: () => sampleGraph(),
    readRelations: GOV_SOURCE,
    logger,
  });
  const machineOnly = createEdgeProjectionService({ store: createDerivedIndexStore(openPersistenceDb()), readGraph: () => sampleGraph(), logger });
  const base = machineOnly.rebuild();

  const result = service.rebuild();
  assert.equal(result.governanceEdges, 1);
  assert.equal(result.edges, base.edges + 1, "机器边＋治理边");
  assert.equal(result.nodes, base.nodes + 2, "master_graph 节点＋两张字典卡节点");

  const govNode = store.graphProjection.listNodes().find((n) => n.nodeId === "uuid-b");
  assert.equal(govNode.label, "标签词表");
  assert.equal(govNode.category, "business_object");
  assert.deepEqual(govNode.labels, ["value_domain"], "subtype 入 labels");
  assert.equal(govNode.degree, 1, "治理度数＝治理边关联计数");

  // WP-051 I-C：边身份经身份入口（长度前缀编码）——期望键动态构造（禁手抄编码）
  const govEdge = store.graphProjection.listEdges().find((e) => e.edgeId === require("../../../shared/identity-port.cjs").makeId("edge", ["字段字典", "标签词表", "reference"]));
  assert.equal(govEdge.sourceId, "uuid-a");
  assert.equal(govEdge.targetId, "uuid-b");
  assert.equal(govEdge.reviewStatus, "approved", "治理边经授权通道写入即批准");
  assert.equal(govEdge.sourceFile, null);
  assert.equal(govEdge.properties.origin, "governance");
  assert.equal(govEdge.properties.asserted_by, "human");

  // 治理源变化 → hash 合法变化（并源参与 contentHash）
  const changed = createEdgeProjectionService({
    store: createDerivedIndexStore(openPersistenceDb()),
    readGraph: () => sampleGraph(),
    readRelations: () => ({ ...GOV_SOURCE(), relations: [] }),
    logger,
  }).rebuild();
  assert.notEqual(changed.contentHash, result.contentHash);
});

test("并源容错：readRelations 缺省＝行为与阶段 2 一致；抛错/悬空端点＝机器边照常、不炸重建", () => {
  const without = createEdgeProjectionService({ store: createDerivedIndexStore(openPersistenceDb()), readGraph: () => sampleGraph(), logger });
  const r1 = without.rebuild();
  assert.equal(r1.governanceEdges, 0);
  assert.equal(r1.edges, 2, "仅机器边（sampleGraph 两条）");

  const store = createDerivedIndexStore(openPersistenceDb());
  const throwing = createEdgeProjectionService({ store, readGraph: () => sampleGraph(), readRelations: () => { throw new Error("boom"); }, logger });
  const r2 = throwing.rebuild();
  assert.equal(r2.rebuilt, true);
  assert.equal(r2.governanceEdges, 0, "读源失败降级机器边-only（fail-open）");

  const dangling = createEdgeProjectionService({
    store: createDerivedIndexStore(openPersistenceDb()),
    readGraph: () => sampleGraph(),
    readRelations: () => ({ objects: GOV_SOURCE().objects, relations: [{ source: "不存在", target: "标签词表", type: "reference", assertedBy: "human", assertedAt: "2026-10-24" }] }),
    logger,
  });
  const r3 = dangling.rebuild();
  assert.equal(r3.governanceEdges, 0, "悬空端点行被装载器语义过滤（防御）");
});

// ── PR-100（WP-008）：投影层断链单边跳过（对齐 relations-source fail-open 先例）──

test("PR-100 断链单边跳过：机器边端点缺失 → 该边不入库＋warn(source/target/type)，其余边与节点照常", () => {
  const graph = sampleGraph();
  graph.connections.push({ from: "wiki/entities/A.md", to: "ghost-node", relationType: "RELATES_TO" });
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({ store, readGraph: () => graph, logger: capturing });
  const result = service.rebuild();
  assert.equal(result.rebuilt, true);
  assert.equal(result.nodes, 2, "节点不受断链边影响");
  assert.equal(result.edges, 2, "合法两条入库，断链一条跳过");
  assert.equal(store.graphProjection.countEdges(), 2);
  assert.equal(store.graphProjection.listEdges().some((e) => e.targetId === "ghost-node"), false, "断链边不入库");
  assert.equal(warns.length, 1);
  assert.equal(warns[0].event, "edge-projection-endpoint-dangling-skipped");
  assert.equal(warns[0].source, "wiki/entities/A.md");
  assert.equal(warns[0].target, "ghost-node");
  assert.equal(warns[0].type, "RELATES_TO");
  // 过滤确定性：同一断链输入两遍重建 hash 相等（跳过集合稳定）
  const second = service.rebuild();
  assert.equal(second.contentHash, result.contentHash, "断链跳过确定性——两遍 hash 相等");
});

// ── PR-109（WP-016）：relation_type 值域对账——两路（master_graph 机器边＋relations.yaml 治理边）
//   合并后逐边检查；不在册只 warn 不阻断写入（值域执法在写网关，投影是镜像——对账告警语义）──

test("PR-109 机器边不在册：warn(source/target/type) 三字段＋边照常入库，在册边零告警", () => {
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  // sampleGraph 两条机器边：BELONGS_TO（在册）＋HAS_VERSION（不在册）
  const service = createEdgeProjectionService({
    store,
    readGraph: () => sampleGraph(),
    listRelationTypes: () => new Set(["BELONGS_TO"]),
    logger: capturing,
  });
  const result = service.rebuild();
  assert.equal(result.rebuilt, true);
  assert.equal(result.edges, 2, "不在册边照常写入（不阻断）");
  assert.equal(store.graphProjection.listEdges().some((e) => e.relationType === "HAS_VERSION"), true, "不在册边已入库");
  const typeWarns = warns.filter((w) => w.event === "edge-projection-type-unregistered");
  assert.equal(typeWarns.length, 1);
  assert.equal(typeWarns[0].source, "wiki/entities/A.md");
  assert.equal(typeWarns[0].target, "subdomain/sd1");
  assert.equal(typeWarns[0].type, "HAS_VERSION");
});

test("PR-109 治理边不在册：同样 warn 三字段＋入库（relations.yaml 外部手改窗口的可见化）", () => {
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({
    store,
    readGraph: () => sampleGraph(),
    readRelations: GOV_SOURCE, // 治理边 type="reference" 不在册
    listRelationTypes: () => new Set(["BELONGS_TO", "HAS_VERSION"]),
    logger: capturing,
  });
  const result = service.rebuild();
  assert.equal(result.governanceEdges, 1);
  assert.equal(store.graphProjection.listEdges().some((e) => e.relationType === "reference"), true, "治理边照常入库");
  const typeWarns = warns.filter((w) => w.event === "edge-projection-type-unregistered");
  assert.equal(typeWarns.length, 1);
  assert.equal(typeWarns[0].source, "uuid-a");
  assert.equal(typeWarns[0].target, "uuid-b");
  assert.equal(typeWarns[0].type, "reference");
});

test("PR-109 全在册：零类型告警（对账静默）", () => {
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({
    store,
    readGraph: () => sampleGraph(),
    listRelationTypes: () => new Set(["BELONGS_TO", "HAS_VERSION"]),
    logger: capturing,
  });
  service.rebuild();
  assert.equal(warns.filter((w) => w.event === "edge-projection-type-unregistered").length, 0);
});

test("PR-109 空注册表：零对账零行为变化（skip 惯例——ontology 缺席不产生批量假告警）", () => {
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({
    store,
    readGraph: () => sampleGraph(),
    listRelationTypes: () => new Set(),
    logger: capturing,
  });
  const result = service.rebuild();
  assert.equal(result.edges, 2);
  assert.equal(warns.length, 0);
});

test("PR-109 未注入：向后兼容零行为变化（旧装配/旧测试形态）", () => {
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({ store, readGraph: () => sampleGraph(), logger: capturing });
  service.rebuild();
  assert.equal(warns.length, 0);
});

test("PR-109 读注册表抛错：告警降级（edge-projection-type-registry-unavailable）不断链，边照常入库", () => {
  const warns = [];
  const capturing = { info() {}, error() {}, warn: (e) => warns.push(e) };
  const store = createDerivedIndexStore(openPersistenceDb());
  const service = createEdgeProjectionService({
    store,
    readGraph: () => sampleGraph(),
    listRelationTypes: () => { throw new Error("registry down"); },
    logger: capturing,
  });
  const result = service.rebuild();
  assert.equal(result.rebuilt, true);
  assert.equal(result.edges, 2, "注册表不可用不阻断投影");
  assert.equal(warns.filter((w) => w.event === "edge-projection-type-registry-unavailable").length, 1);
  assert.equal(warns.filter((w) => w.event === "edge-projection-type-unregistered").length, 0, "降级后不逐边误报");
});
