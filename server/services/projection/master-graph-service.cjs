// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// @responsible: 读取主图并构建拓扑、子图、分类树及待复核关系摘要。
// WP-005：旧 graph-neighborhood.cjs（Canvas 时代无向 BFS）零外部消费者后整模块退役——
// 两函数原语义原样内联（本服务多种子邻域并集＋种子对隐式最短路仍需无向语义，行为零变化）
function computeGraphNeighborhood(graph, centerId, maxHops, opts = {}) {
  const maxNodes = opts.maxNodes ?? 200;
  const maxEdges = opts.maxEdges ?? 400;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const connections = Array.isArray(graph?.connections) ? graph.connections : [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (!centerId || !nodeById.has(centerId)) {
    return { centerId, maxHops, nodes: [], connections: [], centerFound: false, truncated: false, hopsByNodeId: {} };
  }
  const adj = new Map();
  function link(a, b) { if (!a || !b) return; if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
  for (const c of connections) { link(c.from, c.to); link(c.to, c.from); }
  const depth = new Map([[centerId, 0]]);
  const queue = [centerId];
  let truncated = false;
  while (queue.length > 0) {
    const u = queue.shift(); const d = depth.get(u);
    if (d >= maxHops) continue;
    for (const v of adj.get(u) || []) {
      if (!depth.has(v)) {
        if (depth.size >= maxNodes) { truncated = true; queue.length = 0; break; }
        depth.set(v, d + 1); queue.push(v);
      }
    }
  }
  const included = new Set(depth.keys());
  const outConns = []; const seenUndirected = new Set();
  for (const c of connections) {
    if (!included.has(c.from) || !included.has(c.to)) continue;
    const a = c.from < c.to ? c.from : c.to, b = c.from < c.to ? c.to : c.from;
    const key = a + "\0" + b;
    if (seenUndirected.has(key)) continue;
    seenUndirected.add(key); outConns.push(c);
    if (outConns.length >= maxEdges) { truncated = true; break; }
  }
  return { centerId, maxHops, nodes: nodes.filter((n) => included.has(n.id)), connections: outConns, centerFound: true, truncated, hopsByNodeId: Object.fromEntries(depth) };
}

// BFS shortest path A→B (undirected), maxHops limit.
function bfsShortestPath(graph, nodeA, nodeB, maxHops = 2) {
  const connections = Array.isArray(graph?.connections) ? graph.connections : [];
  const nodeById = new Map((Array.isArray(graph?.nodes) ? graph.nodes : []).map(n => [n.id, n]));
  if (!nodeById.has(nodeA) || !nodeById.has(nodeB)) return { path: null, notFound: true };
  if (nodeA === nodeB) return { path: [nodeA], ambiguous: false, notFound: false };
  const adj = new Map();
  for (const c of connections) { if (!adj.has(c.from)) adj.set(c.from, []); if (!adj.has(c.to)) adj.set(c.to, []); adj.get(c.from).push(c.to); adj.get(c.to).push(c.from); }
  const parent = new Map([[nodeA, null]]); const depth = new Map([[nodeA, 0]]); const queue = [nodeA]; let found = false;
  while (queue.length > 0 && !found) {
    const u = queue.shift(); const d = depth.get(u);
    if (d >= maxHops) continue;
    for (const v of adj.get(u) || []) {
      if (!depth.has(v)) { depth.set(v, d + 1); parent.set(v, u); if (v === nodeB) { found = true; break; } if (d + 1 < maxHops) queue.push(v); }
    }
  }
  if (!found) return { path: null, notFound: true };
  const path = []; let cur = nodeB; while (cur) { path.unshift(cur); cur = parent.get(cur); }
  const targetLen = path.length - 1; let altCount = 0;
  const visited2 = new Set([nodeA]); const q2 = [nodeA]; const depth2 = new Map([[nodeA, 0]]);
  while (q2.length > 0) {
    const u = q2.shift(); const d = depth2.get(u);
    if (d >= targetLen) continue;
    for (const v of adj.get(u) || []) { if (v === nodeB && d + 1 === targetLen) { altCount++; continue; } if (!visited2.has(v)) { visited2.add(v); depth2.set(v, d + 1); q2.push(v); } }
  }
  return { path, ambiguous: altCount > 1, alternateCount: altCount, notFound: false };
}

const { logger } = require("../../shared/json-logger.cjs");
const { decorateEdge } = require("../../shared/edge-identity.cjs");
// WP-138 R5b：frontmatter 派生属性键（properties 袋内拼写＝frontmatter 字段名逐字）经文档键源单点；
// 图工件自身结构键（nodes/connections/from/to/...）属生产者工件 schema，不在键源族
const DK = require("../../shared/document-keys.cjs");
const { mergeReviewStatus, readReviewActionsFile } = require("../../shared/review-status-projection.cjs");
// SPEC-012 wave-2 图族：主图真身迁 derived-index.db——原文行读取（vault .ledger 图投影停读）
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
const { readGraphArtifactText } = require("../../shared/persistence/graph-artifact-ingest.cjs");

/** Schema format version expected by this consumer. Producer (extract_graph.py) should emit this. */
const EXPECTED_FORMAT_VERSION = "1.0";

let _vaultPath = null;
function setVaultPath(p) { _vaultPath = p; }

function readMasterGraph() {
  if (!_vaultPath) throw new Error("vaultPath not configured");
  // SPEC-012 wave-2：原文行读库（无图 null）；版本校验/账本合并语义与文件时代一致
  const raw = readGraphArtifactText(getDerivedIndexStore(_vaultPath));
  if (raw === null) return null;
  try {
    const graph = JSON.parse(raw);
    validateFormatVersion(graph, "master_graph.json", EXPECTED_FORMAT_VERSION);
    // F3（seq156，ADR054 D2）：裁决状态经账本合并读取（账本优先/图内 fallback）——纯内存投影，不写盘
    try { return mergeReviewStatus(graph, readReviewActionsFile(_vaultPath)); }
    catch (_ledgerError) { return graph; }
  }
  catch (e) {
    if (e.code === "FORMAT_VERSION_MISMATCH") throw e;
    logger.error({ event: "master-graph-parse-failed", error: e.message }); return null;
  }
}

/**
 * Validate _format_version field in a Vault artifact.
 * Missing = warn + proceed (backward compat). Incompatible major = throw.
 */
function validateFormatVersion(artifact, artifactName, expectedVersion) {
  var actualVersion = artifact._format_version;
  if (!actualVersion) {
    logger.warn({
      event: "format-version-missing",
      artifact: artifactName,
      message: "Artifact missing _format_version. Assuming backward compatible. Producer should add _format_version.",
    });
    return;
  }
  var expectedMajor = String(expectedVersion).split(".")[0];
  var actualMajor = String(actualVersion).split(".")[0];
  if (expectedMajor !== actualMajor) {
    var err = new Error(
      "Format version mismatch: " + artifactName +
      " expected major " + expectedMajor + " (full: " + expectedVersion +
      "), got " + actualVersion +
      ". The Vault data pipeline may need to be rerun."
    );
    err.code = "FORMAT_VERSION_MISMATCH";
    throw err;
  }
}

function computeDegrees(nodes, connections) {
  const deg = {};
  for (const n of nodes) deg[n.id] = 0;
  for (const c of connections) {
    if (deg[c.from] !== undefined) deg[c.from]++;
    if (deg[c.to] !== undefined) deg[c.to]++;
  }
  return deg;
}

// Normalize master_graph edge → TopoEdge {source, target, type, reviewStatus, properties}
// Missing status is never treated as a governed fact.
function edgeToTopo(c) {
  var identity = decorateEdge(c);
  var nestedStatus = c.properties && c.properties.reviewStatus;
  var reviewStatus = c.reviewStatus || nestedStatus || "pending";
  var properties = Object.assign({}, c.properties || {}, { reviewStatus: reviewStatus });
  return {
    edgeId: identity.edgeId,
    source: c.from,
    target: c.to,
    type: c.relationType || c.type || "RELATES_TO",
    sourceFile: identity.sourceFile,
    lineNumber: identity.lineNumber,
    evidenceHash: identity.evidenceHash,
    reviewStatus: reviewStatus,
    properties: properties,
  };
}

function buildPendingReviewSummary(graph) {
  var topology = normalizeTopology(graph);
  var labels = new Map(topology.nodes.map(function (node) { return [node.id, node.label || "未命名实体"]; }));
  // PR-045：端点节点类型透传（labels 数组，如 ["Document"]）——读侧不做语义美化，
  // 前端据 labels 渲染类型徽章（文档节点此前被抹成与普通实体无异，审批者无法分辨）
  var nodeLabels = new Map(topology.nodes.map(function (node) { return [node.id, Array.isArray(node.labels) ? node.labels : []]; }));
  var edges = topology.edges.map(function (edge) {
    return Object.assign({}, edge, {
      sourceLabel: labels.get(edge.source) || "未命名实体",
      targetLabel: labels.get(edge.target) || "未命名实体",
      sourceLabels: nodeLabels.get(edge.source) || [],
      targetLabels: nodeLabels.get(edge.target) || [],
    });
  });
  var pendingEdges = edges.filter(function (edge) { return edge.reviewStatus === "pending"; });
  return {
    total: edges.length,
    pending: pendingEdges.length,
    approved: edges.filter(function (edge) { return edge.reviewStatus === "approved"; }).length,
    edges: pendingEdges,
  };
}

// Topology entity admission labels — 单源 contracts/graph-admission.json（WP-030/PR-145）：
// only nodes carrying at least one of these are considered "renderable entities".
// BusinessDomain / Subdomain / Team / Document nodes are excluded.
var GRAPH_ADMISSION = { entityLabels: ["ArchitectureComponent", "Module"] };
try { GRAPH_ADMISSION = require("../../../contracts/graph-admission.json"); } catch (_e) { /* 契约缺失回退内置缺省 */ }
const ENTITY_LABELS = GRAPH_ADMISSION.entityLabels;

// Normalize master_graph node → TopoNode {id, label, category, degree, labels, properties}
function nodeToTopo(n, deg) {
  return {
    id: n.id,
    label: n.label || n.id,
    category: n.category || "未分类",
    degree: deg || 0,
    labels: n.labels || [],
    properties: n.properties || {},
  };
}

function isEntityNode(n) {
  return (n.labels || []).some(function (l) { return ENTITY_LABELS.indexOf(l) >= 0; });
}

// Filter topology to entity nodes only, keeping only edges whose both endpoints are entities.
function filterTopologyEntities(nodes, edges) {
  var entityNodes = nodes.filter(isEntityNode);
  var entityIds = Object.create(null); // WP-050 D1：内容键（节点 id）直取不可表达
  for (var i = 0; i < entityNodes.length; i++) entityIds[entityNodes[i].id] = true;
  // WP-116 批1：内容键读改显式 own 分支（WP-050 执法形态，同 schema-discovery-routes aliases 取值先例）——
  // 对象非文档不套 docField；表已 null 原型，此处把「隐式取值＋truthy」收敛为显式 own 判定
  var entityEdges = edges.filter(function (e) {
    return Object.hasOwn(entityIds, e.source) && Object.hasOwn(entityIds, e.target);
  });
  return { nodes: entityNodes, edges: entityEdges };
}

// Rule 10: schema assertion — validate topology output structure
function assertTopologySchema(topo, label) {
  label = label || "topology";
  const errors = [];
  if (!topo || typeof topo !== "object") { errors.push(label + ": not an object"); return errors; }
  const nodes = topo.nodes;
  const edges = topo.edges;
  if (!Array.isArray(nodes)) errors.push(label + ".nodes: not an array");
  if (!Array.isArray(edges)) errors.push(label + ".edges: not an array");
  if (errors.length > 0) return errors;

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (!n.id || typeof n.id !== "string") errors.push(label + ".nodes[" + i + "].id: missing or non-string");
    if (!n.label || typeof n.label !== "string") errors.push(label + ".nodes[" + i + "].label: missing or non-string");
    if (!n.category || typeof n.category !== "string") errors.push(label + ".nodes[" + i + "].category: missing or non-string");
    if (typeof n.degree !== "number") errors.push(label + ".nodes[" + i + "].degree: missing or non-number");
    if (!Array.isArray(n.labels)) errors.push(label + ".nodes[" + i + "].labels: missing or non-array");
    if (typeof n.properties !== "object" || n.properties === null) errors.push(label + ".nodes[" + i + "].properties: missing or non-object");
    // Rule 10: check for Python/JS literal artifacts in string fields
    var fields = ["id", "label", "category"];
    for (var fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      var v = n[f];
      if (typeof v === "string" && (v.indexOf("[") === 0 || v.indexOf("{") === 0)) {
        errors.push(label + ".nodes[" + i + "]." + f + ": serialized literal artifact: \"" + v.slice(0, 30) + "\"");
      }
    }
  }
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    if (!e.source || typeof e.source !== "string") errors.push(label + ".edges[" + i + "].source: missing or non-string");
    if (!e.target || typeof e.target !== "string") errors.push(label + ".edges[" + i + "].target: missing or non-string");
    if (!e.type || typeof e.type !== "string") errors.push(label + ".edges[" + i + "].type: missing or non-string");
    if (!e.edgeId || typeof e.edgeId !== "string") errors.push(label + ".edges[" + i + "].edgeId: missing or non-string");
    // reviewStatus is optional — schema allows undefined
    if (typeof e.properties !== "object" || e.properties === null) errors.push(label + ".edges[" + i + "].properties: missing or non-object");
  }
  return errors;
}

// Full normalize: nodes with degree, edges with source/target
function normalizeTopology(graph) {
  const nodes = (graph.nodes || []);
  const conns = (graph.connections || []);
  const deg = computeDegrees(nodes, conns);
  const result = {
    nodes: nodes.map(n => nodeToTopo(n, deg[n.id] || 0)),
    edges: conns.map(edgeToTopo),
  };
  const schemaErrors = assertTopologySchema(result, "normalizeTopology");
  if (schemaErrors.length > 0) {
    logger.error({ event: "topology-schema-assertion-failed", errors: schemaErrors });
    throw new Error("Topology schema assertion failed: " + schemaErrors.join("; "));
  }
  return result;
}

// BFS subgraph from seedNodeIds
function pruneToSubgraph(seedNodeIds, maxHops = 2, inputGraph = null) {
  const graph = inputGraph || readMasterGraph();
  if (!graph) return { nodes: [], edges: [], implicitPaths: [], unresolvedPairs: [], missingSeeds: [] };
  const rawNodes = (graph.nodes || []);
  const rawConns = (graph.connections || []);
  const { nodes: normNodes } = normalizeTopology(graph);
  // Graph structure for BFS (still uses from/to internally)
  const nodeById = new Map(normNodes.map(n => [n.id, n]));
  const valid = seedNodeIds.filter(id => nodeById.has(id));
  const missingSeeds = seedNodeIds.filter(id => !nodeById.has(id));

  const allNodes = new Map();
  const allConns = [];
  const seenConn = new Set();

  for (const seed of valid) {
    const nh = computeGraphNeighborhood({ nodes: normNodes, connections: rawConns }, seed, maxHops, { maxNodes: 500, maxEdges: 1000 });
    for (const n of nh.nodes) allNodes.set(n.id, n);
    for (const c of nh.connections) {
      const key = c.from + "\0" + c.to;
      if (!seenConn.has(key)) { seenConn.add(key); allConns.push(c); }
    }
  }

  // Implicit paths for seed pairs without direct edge
  const implicitPaths = [];
  const unresolvedPairs = [];
  const directEdges = new Set();
  for (const c of allConns) { directEdges.add(c.from + "\0" + c.to); directEdges.add(c.to + "\0" + c.from); }

  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i], b = valid[j];
      if (directEdges.has(a + "\0" + b)) continue;
      const result = bfsShortestPath({ nodes: normNodes, connections: rawConns }, a, b, maxHops);
      if (result.notFound) {
        unresolvedPairs.push({ nodeA: a, nodeB: b });
      } else {
        implicitPaths.push({ seedA: a, seedB: b, path: result.path, ambiguous: result.ambiguous, alternateCount: result.alternateCount || 1 });
        for (const nid of result.path) {
          if (nodeById.has(nid) && !allNodes.has(nid)) allNodes.set(nid, nodeById.get(nid));
        }
      }
    }
  }

  var resultNodes = Array.from(allNodes.values());
  var resultEdges = Array.from(allConns).map(edgeToTopo);
  // Cut 1: filter to entity nodes only
  var filtered = filterTopologyEntities(resultNodes, resultEdges);
  return {
    nodes: filtered.nodes,
    edges: filtered.edges,
    implicitPaths: implicitPaths.length > 0 ? implicitPaths : undefined,
    unresolvedPairs: unresolvedPairs.length > 0 ? unresolvedPairs : undefined,
    missingSeeds: missingSeeds.length > 0 ? missingSeeds : [],
    seedCount: valid.length,
  };
}

function topNodesByDegree(graph, limit = 199) {
  var normalized = normalizeTopology(graph);
  // Cut 1: filter to entity nodes only (ArchitectureComponent / Module)
  var filtered = filterTopologyEntities(normalized.nodes, normalized.edges);
  var sorted = filtered.nodes.sort(function (a, b) { return b.degree - a.degree || String(a.id).localeCompare(String(b.id)); }); // WP-052 T1：并列度数 id 次级键——top-N 不可复现债（P4-2）收敛
  var top = sorted.slice(0, limit);
  // WP-116 批1：内容键（节点 id）表 null 原型＋读走显式 own 分支（WP-050 D1 执法形态）——
  // 原 topIds 普通对象：保留名端点（constructor 族）可命中 Object.prototype 误纳边
  var topIds = Object.create(null); // WP-050 D1：内容键（节点 id）直取不可表达
  for (var i = 0; i < top.length; i++) topIds[top[i].id] = true;
  var topEdges = filtered.edges.filter(function (e) { return Object.hasOwn(topIds, e.source) && Object.hasOwn(topIds, e.target); });
  return {
    nodes: top,
    edges: topEdges,
    totalNodes: filtered.nodes.length,
    returnedNodes: top.length,
    // WP-071 同集合计数同口径：边与节点同走准入过滤集合，totalEdges＝准入实体之间的边总数
    totalEdges: filtered.edges.length,
    returnedEdges: topEdges.length,
  };
}

// Build taxonomy tree from BusinessDomain / Subdomain nodes + node-attribute grouping (WP-005)
function buildTaxonomyTree(graph) {
  var nodes = graph.nodes || [];
  var conns = graph.connections || [];

  // WP-005：计数/悬停集改节点属性分组（结构走属性轴——原 BELONGS_TO 边统计随停发退役；
  // 实体/文档节点的 subdomain_id 属性由抽取器挂载属性化后写入）
  var subStats = Object.create(null); // WP-050 D1：内容键（subdomain_id）直取不可表达
  // WP-116 批1：entityLabels 原「普通对象」——内容标签（lbls[k]）保留名（constructor 族）可命中
  // Object.prototype 误判实体；改 null 原型＋读走显式 own 分支（WP-050 enums-loader 先例执法形态）。
  var entityLabels = Object.create(null);
  for (var i = 0; i < ENTITY_LABELS.length; i++) entityLabels[ENTITY_LABELS[i]] = true;

  var subEntityIds = Object.create(null); // WP-050 D1
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var sub = n.properties && n.properties[DK.GRAPH.subdomainId];
    if (!sub) continue;
    var lbls = n.labels || [];
    var isEntity = false;
    for (var k = 0; k < lbls.length; k++) {
      if (Object.hasOwn(entityLabels, lbls[k])) { isEntity = true; break; }
    }
    if (!Object.hasOwn(subStats, sub)) subStats[sub] = { entityCount: 0, docCount: 0 };
    if (isEntity) {
      subStats[sub].entityCount++;
      if (!subEntityIds[sub]) subEntityIds[sub] = [];
      subEntityIds[sub].push(n.id);
    } else if (lbls.indexOf("Document") >= 0) {
      subStats[sub].docCount++;
    }
  }

  // Build domain → children map
  // WP-116 批1：domains 原「普通对象」——parent（props.domain_id 内容键）保留名可命中 Object.prototype
  // 致 domains[parent].children.push 炸（TypeError→500）；改 null 原型＋读走显式 own 分支（WP-050 执法形态）。
  var domains = Object.create(null);
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var lbls = n.labels || [];
    if (lbls.indexOf("BusinessDomain") >= 0) {
      var props = n.properties || {};
      domains[n.id] = { id: n.id, label: props[DK.GRAPH.name] || n.id, children: [] };
    }
  }

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var lbls = n.labels || [];
    if (lbls.indexOf("Subdomain") >= 0) {
      var props = n.properties || {};
      var parent = props[DK.GRAPH.domainId] || "";
      if (Object.hasOwn(domains, parent)) {
        // WP-116 批1：内容键（n.id）读改显式 own 分支（WP-050 执法形态）——缺桶回落与原 `|| fallback` 同语义
        var stats = Object.hasOwn(subStats, n.id) ? subStats[n.id] : { entityCount: 0, docCount: 0 };
        domains[parent].children.push({
          id: n.id,
          label: props[DK.GRAPH.name] || n.id,
          entityCount: stats.entityCount,
          docCount: stats.docCount,
          entityIds: subEntityIds[n.id] || [],
        });
      }
    }
  }

  // Sort children, return as sorted array
  var result = [];
  var keys = Object.keys(domains).sort();
  for (var i = 0; i < keys.length; i++) {
    var d = domains[keys[i]];
    d.children.sort(function (a, b) { return a.label.localeCompare(b.label); });
    result.push(d);
  }
  return result;
}

// Full knowledge topology: all nodes (including Document) and all edges (including DOCUMENTS/REFERENCES).
// Used by relations overview; architecture canvas continues using filterTopologyEntities.
function buildKnowledgeTopology(graph) {
  return normalizeTopology(graph);
}

module.exports = { setVaultPath, readMasterGraph, pruneToSubgraph, topNodesByDegree, normalizeTopology, buildPendingReviewSummary, buildKnowledgeTopology, isEntityNode, filterTopologyEntities, buildTaxonomyTree, ENTITY_LABELS, EXPECTED_FORMAT_VERSION, validateFormatVersion };
