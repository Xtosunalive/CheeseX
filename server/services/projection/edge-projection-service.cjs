// Component: Edge-Projection-Service
// @responsible: EDGE-RELATION-GOV-001（ADR-012／SPEC-026 §四-§五）②类 edge 投影——master_graph →
//   normalizeTopology（复用，不改）→ graph_nodes/edges 行级落位。boot／图族摄取钩重建
//   （main.cjs ingestGraphStaging 包装三点共用）；只做持久化 normalizeTopology 输出，
//   不另起转换逻辑（立案 R2：与既有图族服务不重叠）。
// @inputs: readGraph（图读取注入——生产＝master-graph-service readMasterGraph，含审批账本合并视图）、
//   store（derived-index-store）
// @outputs: createEdgeProjectionService({ store, readGraph, logger }) → { rebuild() }；
//   rebuild() → { rebuilt, nodes, edges, contentHash, durationMs }；readGraph null → 空投影
//   （真实零值，非跳过）；readGraph 抛错 → { rebuilt:false, error }（不写库，保留旧投影）。
// @context: ②类可丢弃——删库零损失，boot/摄取钩重建即恢复；contentHash 落 derived_kv
//   （派生层自治状态，随库可丢弃）；不混入 sync_state（该账本属 enums 同步器，lastSync 无 kind 过滤）。
"use strict";

const { createHash } = require("node:crypto");
const { normalizeTopology } = require("./master-graph-service.cjs");

const CONTENT_HASH_KV_KEY = "edge-projection:content-hash";

// 行稳定序列化（node_id/edge_id 排序后拼接）——「同一输入快照下连续两遍一致」的验收口径（SPEC-026 C4）。
// 生产例外见 SPEC-026：两次重建之间审批账本合法变化（mergeReviewStatus）会使 hash 合法不等。
function stableContentHash(nodeRows, edgeRows) {
  const nodePart = [...nodeRows]
    .sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1))
    .map((n) => JSON.stringify(n)).join("\n");
  const edgePart = [...edgeRows]
    .sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1))
    .map((e) => JSON.stringify(e)).join("\n");
  return createHash("sha256").update(`${nodePart}\n===\n${edgePart}`).digest("hex");
}

// normalizeTopology 输出（camelCase topo 形态）→ 行形态（与 store.graphProjection 落列一致，§6.4 映射）
function topoToRows(topo) {
  const nodes = (topo.nodes || []).map((n) => ({
    nodeId: n.id,
    label: n.label,
    category: n.category,
    labels: Array.isArray(n.labels) ? n.labels : [],
    degree: n.degree ?? 0,
    properties: n.properties || {},
  }));
  const edges = (topo.edges || []).map((e) => ({
    edgeId: e.edgeId,
    sourceId: e.source,
    targetId: e.target,
    relationType: e.type,
    sourceFile: e.sourceFile ?? null,
    lineNumber: e.lineNumber ?? null,
    evidenceHash: e.evidenceHash ?? null,
    reviewStatus: e.reviewStatus ?? null,
    properties: e.properties || {},
  }));
  return { nodes, edges };
}

function createEdgeProjectionService({ store, readGraph, readRelations, listRelationTypes, logger }) {
  if (!store || typeof store.graphProjection?.replaceAll !== "function") {
    throw new Error("edge-projection-service: store.graphProjection required");
  }
  if (typeof readGraph !== "function") {
    throw new Error("edge-projection-service: readGraph function required");
  }
  const log = logger || { info() {}, warn() {}, error() {} };

  // PR-109 缺口②：relation_type 值域对账——键集经注入（生产＝relations-write-service.relationTypeNames
  // 注册表读法单一事实源）。未注入/空集＝零对账零行为变化（skip 惯例，与 readRelations 缺省同构）；
  // 读失败＝告警降级不断链。不在册只 warn 不阻断写入：值域执法在写网关（relations-write-service
  // type 对账），投影是镜像——对账告警语义，与 PR-100 断链 warn 同口径。
  function resolveRelationTypes() {
    if (typeof listRelationTypes !== "function") return null;
    try {
      const names = listRelationTypes();
      return names && names.size > 0 ? names : null;
    } catch (error) {
      log.warn({ event: "edge-projection-type-registry-unavailable", error: error.message });
      return null;
    }
  }

  // 对象本体批（ADR-012 D1，Master 2026-10-24）：治理关系并源——字典对象投为图节点、
  // 治理边 approved/证据空，与机器边（master_graph 投影）合并落表。readRelations 缺省＝
  // 并源关闭（行为与阶段 2 一致，向后兼容）。
  function governanceRows() {
    if (typeof readRelations !== "function") return { nodes: [], edges: [] };
    let source = null;
    try {
      source = readRelations();
    } catch (error) {
      log.warn({ event: "edge-projection-relations-source-failed", error: error.message });
      return { nodes: [], edges: [] };
    }
    const byName = new Map((source.objects || []).map((o) => [o.canonicalName, o]));
    const degree = new Map();
    const edges = [];
    for (const row of source.relations || []) {
      const src = byName.get(row.source);
      const dst = byName.get(row.target);
      if (!src || !dst) continue; // 装载器已过滤悬空；此处防御
      edges.push({
        // WP-051 I-C：边身份经身份入口——含 | 的实体名不再撞键（同参等值语义不变）
        edgeId: require("../../shared/identity-port.cjs").makeId("edge", [row.source, row.target, row.type]),
        sourceId: src.objectId,
        targetId: dst.objectId,
        relationType: row.type,
        sourceFile: null,
        lineNumber: null,
        evidenceHash: null,
        reviewStatus: "approved", // 治理边经库主授权通道写入即批准（ADR-012 D1 形态）
        properties: { origin: "governance", note: row.note || "", asserted_by: row.assertedBy, asserted_at: row.assertedAt },
      });
      degree.set(src.objectId, (degree.get(src.objectId) || 0) + 1);
      degree.set(dst.objectId, (degree.get(dst.objectId) || 0) + 1);
    }
    const nodes = (source.objects || []).map((o) => ({
      nodeId: o.objectId,
      label: o.canonicalName,
      category: o.objectKind,
      labels: o.subtype ? [o.subtype] : [],
      degree: degree.get(o.objectId) || 0,
      properties: { origin: "governance", canonical_name: o.canonicalName },
    }));
    return { nodes, edges };
  }

  return {
    /** 全量重建（替换式单事务）；contentHash 落 derived_kv。 */
    rebuild() {
      const startedAt = Date.now();
      let graph = null;
      try {
        graph = readGraph();
      } catch (error) {
        log.error({ event: "edge-projection-read-graph-failed", error: error.message });
        return { rebuilt: false, error: error.message };
      }
      // 无图＝真实零值（空投影），与 readMasterGraph null 语义一致——不是跳过
      const topo = normalizeTopology(graph || {});
      const machine = topoToRows(topo);
      const gov = governanceRows();
      // 合并：节点按 nodeId 去重（碰撞时治理侧让位——两命名空间不重叠，防御性）、边按 edgeId 并集
      const nodeById = new Map(machine.nodes.map((n) => [n.nodeId, n]));
      for (const n of gov.nodes) if (!nodeById.has(n.nodeId)) nodeById.set(n.nodeId, n);
      const edgeById = new Map(machine.edges.map((e) => [e.edgeId, e]));
      for (const e of gov.edges) if (!edgeById.has(e.edgeId)) edgeById.set(e.edgeId, e);
      const nodes = [...nodeById.values()];
      // PR-100：端点存在性过滤——合并后节点全集上逐边校验，断链单边跳过＋warn
      // （对齐 relations-source 装载器 fail-open 先例）；FK（迁移 0006）为物理兜底，正常流量不触达
      const nodeIds = new Set(nodes.map((n) => n.nodeId));
      const relationTypes = resolveRelationTypes();
      const edges = [];
      for (const e of edgeById.values()) {
        if (!nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)) {
          log.warn({ event: "edge-projection-endpoint-dangling-skipped", source: e.sourceId, target: e.targetId, type: e.relationType });
          continue;
        }
        // PR-109：类型在册对账——master_graph 与 relations.yaml 两路合并后逐边检查（边照常写入）
        if (relationTypes && !relationTypes.has(e.relationType)) {
          log.warn({ event: "edge-projection-type-unregistered", source: e.sourceId, target: e.targetId, type: e.relationType });
        }
        edges.push(e);
      }
      store.graphProjection.replaceAll(nodes, edges);
      const contentHash = stableContentHash(nodes, edges);
      store.kv.put(CONTENT_HASH_KV_KEY, contentHash);
      const result = { rebuilt: true, nodes: nodes.length, edges: edges.length, governanceEdges: gov.edges.length, contentHash, durationMs: Date.now() - startedAt };
      log.info({ event: "edge-projection-rebuilt", ...result });
      return result;
    },
  };
}

module.exports = { createEdgeProjectionService, stableContentHash, topoToRows, CONTENT_HASH_KV_KEY };
