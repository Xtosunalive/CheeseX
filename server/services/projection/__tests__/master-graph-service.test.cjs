// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// master-graph-service.test.cjs — comprehensive test for 300-line core graph service
// Pattern: node --test runner, passed++/failed++ counters
// Note: computeDegrees/nodeToTopo/edgeToTopo/assertTopologySchema are internal —
// tested indirectly through normalizeTopology, topNodesByDegree, pruneToSubgraph.
const fs = require("fs");
const os = require("os");
const path = require("path");
// SPEC-012 wave-2 图族：主图真身迁 derived-index.db——种子经 store（测试懒建形态）
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");

var passed = 0, failed = 0;
function assertEq(a, e, l) { if (a === e) passed++; else { console.error("FAIL: " + l + " — expected " + JSON.stringify(e) + ", got " + JSON.stringify(a)); failed++; } }
function assert(c, l) { if (c) passed++; else { console.error("FAIL: " + l); failed++; } }
function assertGt(a, b, l) { if (a > b) passed++; else { console.error("FAIL: " + l + " — expected > " + b + ", got " + a); failed++; } }
function assertDeepEq(a, e, l) { var sa = JSON.stringify(a), se = JSON.stringify(e); if (sa === se) passed++; else { console.error("FAIL: " + l + " — expected " + se + ", got " + sa); failed++; } }

// Test fixture — 6 nodes, 4 connections covering all entity types
var FULL_GRAPH = {
  nodes: [
    { id: "comp-a", label: "Component A", category: "应用组件", labels: ["ArchitectureComponent"], properties: { file_path: "wiki/entities/comp-a.md", subdomain_id: "sub-a", domain_id: "domain-1" } },
    { id: "comp-b", label: "Component B", category: "应用组件", labels: ["ArchitectureComponent"], properties: {} },
    { id: "module-x", label: "Module X", category: "模块", labels: ["Module"], properties: {} },
    { id: "domain-1", label: "业务域1", category: "业务域", labels: ["BusinessDomain"], properties: { name: "核心域" } },
    { id: "sub-a", label: "子域A", category: "子域", labels: ["Subdomain"], properties: { name: "子域A", domain_id: "domain-1" } },
    { id: "plain-node", label: "普通节点", category: "其他", labels: ["Document"], properties: {} },
  ],
  connections: [
    { from: "comp-a", to: "comp-b", relationType: "DEPENDS_ON", sourceFile: "wiki/entities/comp-a.md", lineNumber: 5, evidenceHash: "abc", properties: {} },
    { from: "comp-b", to: "module-x", relationType: "DEPENDS_ON", sourceFile: "", properties: {} },
    { from: "comp-a", to: "sub-a", relationType: "BELONGS_TO", sourceFile: "wiki/entities/comp-a.md", lineNumber: 8, evidenceHash: "def", properties: {} },
    { from: "plain-node", to: "comp-a", relationType: "RELATES_TO", sourceFile: "", properties: {} },
  ],
};

var mgs = require("../master-graph-service.cjs");

// ===== isEntityNode =====
(function testIsEntityNode() {
  assert(mgs.isEntityNode({ labels: ["ArchitectureComponent"] }), "isEntityNode: ArchitectureComponent → true");
  assert(mgs.isEntityNode({ labels: ["Module"] }), "isEntityNode: Module → true");
  assert(mgs.isEntityNode({ labels: ["ArchitectureComponent", "Module"] }), "isEntityNode: both entity labels → true");
  assert(!mgs.isEntityNode({ labels: ["Document"] }), "isEntityNode: Document → false");
  assert(!mgs.isEntityNode({ labels: [] }), "isEntityNode: empty labels → false");
  assert(!mgs.isEntityNode({}), "isEntityNode: missing labels → false");
  assert(!mgs.isEntityNode({ labels: ["BusinessDomain"] }), "isEntityNode: BusinessDomain → false");
  assert(!mgs.isEntityNode({ labels: ["Subdomain"] }), "isEntityNode: Subdomain → false");
})();

// ===== filterTopologyEntities =====
(function testFilterTopologyEntities() {
  var nodes = [
    { id: "ent-a", label: "Entity A", category: "服务", labels: ["ArchitectureComponent"] },
    { id: "ent-b", label: "Entity B", category: "服务", labels: ["Module"] },
    { id: "doc-1", label: "Doc 1", category: "文档", labels: ["Document"] },
  ];
  var edges = [
    { source: "ent-a", target: "ent-b", type: "DEPENDS_ON" },
    { source: "ent-a", target: "doc-1", type: "RELATES_TO" },
    { source: "doc-1", target: "ent-b", type: "RELATES_TO" },
  ];
  var filtered = mgs.filterTopologyEntities(nodes, edges);
  assertEq(filtered.nodes.length, 2, "filterTopologyEntities: only 2 entity nodes kept");
  assertEq(filtered.edges.length, 1, "filterTopologyEntities: only ent-a→ent-b kept (both endpoints entities)");

  var empty = mgs.filterTopologyEntities([], []);
  assertEq(empty.nodes.length, 0, "filterTopologyEntities: empty input → empty nodes");
  assertEq(empty.edges.length, 0, "filterTopologyEntities: empty input → empty edges");

  var allDoc = [{ id: "d1", labels: ["Document"] }, { id: "d2", labels: ["Document"] }];
  var noEntity = mgs.filterTopologyEntities(allDoc, [{ source: "d1", target: "d2", type: "RELATES_TO" }]);
  assertEq(noEntity.nodes.length, 0, "filterTopologyEntities: no entity nodes → all filtered");
  assertEq(noEntity.edges.length, 0, "filterTopologyEntities: no entity nodes → all edges filtered");
})();

// ===== normalizeTopology (indirectly tests computeDegrees + nodeToTopo + edgeToTopo + assertTopologySchema) =====
(function testNormalizeTopology() {
  // 1. Normal graph
  var result = mgs.normalizeTopology(FULL_GRAPH);
  assertGt(result.nodes.length, 0, "normalizeTopology: nodes populated");
  assertGt(result.edges.length, 0, "normalizeTopology: edges populated");

  // 2. Degree computation (computeDegrees via node degree in normalizeTopology)
  // comp-a: connected to comp-b + sub-a = deg 2; comp-b: from comp-a + to module-x = deg 2
  // module-x: from comp-b = deg 1; sub-a: from comp-a = deg 1; plain-node: to comp-a = deg 1
  var degMap = {};
  for (var i = 0; i < result.nodes.length; i++) degMap[result.nodes[i].id] = result.nodes[i].degree;
  assertEq(degMap["comp-a"] || 0, 3, "normalizeTopology: comp-a degree=3 (→comp-b + →sub-a + plain-node→comp-a)");
  assertEq(degMap["comp-b"] || 0, 2, "normalizeTopology: comp-b degree=2 (from comp-a + to module-x)");
  assertEq(degMap["module-x"] || 0, 1, "normalizeTopology: module-x degree=1");
  assertEq(degMap["plain-node"] || 0, 1, "normalizeTopology: plain-node degree=1 (RELATES_TO→comp-a)");

  // 3. nodeToTopo: verify default values
  // Find node by id
  var nodeA = result.nodes.filter(function (n) { return n.id === "comp-a"; })[0];
  assert(nodeA !== undefined, "normalizeTopology: comp-a found in result");
  assertEq(nodeA.label, "Component A", "normalizeTopology: label preserved");
  assertEq(nodeA.category, "应用组件", "normalizeTopology: category preserved");
  assertDeepEq(nodeA.labels, ["ArchitectureComponent"], "normalizeTopology: labels array preserved");

  // nodeToTopo: missing label → fallback to id (use node with no explicit label from empty fixture)
  var emptyResult = mgs.normalizeTopology({ nodes: [{ id: "x1" }], connections: [] });
  assertEq(emptyResult.nodes[0].label, "x1", "normalizeTopology: missing label → fallback to id");
  assertEq(emptyResult.nodes[0].category, "未分类", "normalizeTopology: missing category → '未分类'");
  assertEq(emptyResult.nodes[0].degree, 0, "normalizeTopology: missing connections → degree 0");
  assertDeepEq(emptyResult.nodes[0].labels, [], "normalizeTopology: missing labels → []");

  // 4. edgeToTopo: review policy — human edge (sourceFile non-empty) → pending
  var humanEdge = result.edges.filter(function (e) { return e.source === "comp-a" && e.target === "comp-b"; })[0];
  assert(humanEdge !== undefined, "normalizeTopology: human edge comp-a→comp-b found");
  assertEq(humanEdge.reviewStatus, "pending", "normalizeTopology: human edge (sourceFile non-empty) → pending");
  assertGt(humanEdge.edgeId.length, 0, "normalizeTopology: edgeId generated");
  assertEq(humanEdge.type, "DEPENDS_ON", "normalizeTopology: relationType preserved");

  // edgeToTopo: missing status never becomes an approved fact
  var pipeEdge = result.edges.filter(function (e) { return e.source === "comp-b" && e.target === "module-x"; })[0];
  assert(pipeEdge !== undefined, "normalizeTopology: pipeline edge comp-b→module-x found");
  assertEq(pipeEdge.reviewStatus, "pending", "normalizeTopology: pipeline edge without explicit status → pending");

  // edgeToTopo: an explicit producer status wins even without sourceFile
  var pendingPipelineGraph = {
    nodes: [{ id: "P1" }, { id: "P2" }],
    connections: [{
      from: "P1",
      to: "P2",
      sourceFile: "",
      properties: { reviewStatus: "pending" },
    }],
  };
  var pendingPipelineResult = mgs.normalizeTopology(pendingPipelineGraph);
  assertEq(pendingPipelineResult.edges[0].reviewStatus, "pending", "normalizeTopology: explicit pending status is not auto-approved");

  // Conflicting duplicate fields: top-level validation/human result is authoritative,
  // and the normalized DTO must not expose a contradictory nested status.
  var conflictingStatusGraph = {
    nodes: [{ id: "C1" }, { id: "C2" }],
    connections: [{
      from: "C1",
      to: "C2",
      reviewStatus: "pending",
      properties: { reviewStatus: "approved" },
    }],
  };
  var conflictingStatusResult = mgs.normalizeTopology(conflictingStatusGraph);
  assertEq(conflictingStatusResult.edges[0].reviewStatus, "pending", "normalizeTopology: top-level review status wins conflicts");
  assertEq(conflictingStatusResult.edges[0].properties.reviewStatus, "pending", "normalizeTopology: nested DTO status matches authoritative status");

  // edgeToTopo: missing relationType → "RELATES_TO"
  var newGraph = { nodes: [{ id: "A" }, { id: "B" }], connections: [{ from: "A", to: "B" }] };
  var newResult = mgs.normalizeTopology(newGraph);
  assertEq(newResult.edges[0].type, "RELATES_TO", "normalizeTopology: missing relationType → RELATES_TO");

  // 5. assertTopologySchema: violation → throws
  var threw = false;
  try {
    mgs.normalizeTopology({ nodes: [{ id: "", label: "", category: "", labels: [], properties: {} }], connections: [] });
  } catch (e) { threw = true; }
  assert(threw, "normalizeTopology: empty id → throws (assertTopologySchema)");

  // Schema: Python literal artifact detection
  var threw2 = false;
  try {
    mgs.normalizeTopology({ nodes: [{ id: "x", label: "['MVP Gateway']", category: "C", labels: [], properties: {} }], connections: [] });
  } catch (e) { threw2 = true; }
  assert(threw2, "normalizeTopology: Python literal '[' in label → throws");

  // Schema: JS literal artifact detection
  var threw3 = false;
  try {
    mgs.normalizeTopology({ nodes: [{ id: "x", label: "x", category: '{"key":"val"}', labels: [], properties: {} }], connections: [] });
  } catch (e) { threw3 = true; }
  assert(threw3, "normalizeTopology: JS object literal '{' in category → throws");

  // self-loop edge: A → A should compute correctly
  var selfGraph = { nodes: [{ id: "A" }], connections: [{ from: "A", to: "A" }] };
  var selfResult = mgs.normalizeTopology(selfGraph);
  assertEq(selfResult.nodes[0].degree, 2, "normalizeTopology: self-loop A→A → degree=2 (from + to both counted)");

  // empty graph
  var empty = mgs.normalizeTopology({ nodes: [], connections: [] });
  assertEq(empty.nodes.length, 0, "normalizeTopology: empty graph → empty nodes");
  assertEq(empty.edges.length, 0, "normalizeTopology: empty graph → empty edges");
})();

// ===== buildPendingReviewSummary =====
(function testBuildPendingReviewSummary() {
  var graph = {
    nodes: [{ id: "A", label: "组件 A" }, { id: "B", label: "组件 B" }, { id: "C", label: "组件 C" }],
    connections: [
      { from: "A", to: "B", reviewStatus: "pending", properties: { reviewStatus: "approved" } },
      { from: "B", to: "C", reviewStatus: "approved", properties: {} },
      { from: "C", to: "A", reviewStatus: "rejected", properties: {} },
    ],
  };
  var summary = mgs.buildPendingReviewSummary(graph);
  assertEq(summary.total, 3, "buildPendingReviewSummary: total includes all relations");
  assertEq(summary.pending, 1, "buildPendingReviewSummary: pending counts only pending relations");
  assertEq(summary.approved, 1, "buildPendingReviewSummary: approved counts only approved relations");
  assertEq(summary.edges.length, 1, "buildPendingReviewSummary: list excludes rejected relations");
  assertEq(summary.edges[0].properties.reviewStatus, "pending", "buildPendingReviewSummary: listed DTO has one status value");
  assertEq(summary.edges[0].sourceLabel, "组件 A", "buildPendingReviewSummary: source label is enriched");
  assertEq(summary.edges[0].targetLabel, "组件 B", "buildPendingReviewSummary: target label is enriched");
})();

// ===== topNodesByDegree =====
(function testTopNodesByDegree() {
  var result = mgs.topNodesByDegree(FULL_GRAPH);
  assertGt(result.nodes.length, 0, "topNodesByDegree: returns nodes");
  assertEq(result.totalNodes, 3, "topNodesByDegree: 3 entity nodes total (ArchitectureComponent + Module only)");
  // WP-071 同集合计数同口径：边与节点同走准入过滤，4 条连接中仅 2 条两端都是实体
  assertEq(result.totalEdges, 2, "topNodesByDegree: 2 edges between admitted entities (non-entity endpoints filtered)");
  assertEq(result.returnedEdges, 2, "topNodesByDegree: returnedEdges counts admitted edges");
  assertEq(result.edges.length, result.returnedEdges, "topNodesByDegree: edges length matches returnedEdges");
  // Descending order
  for (var i = 1; i < result.nodes.length; i++) {
    assert(result.nodes[i-1].degree >= result.nodes[i].degree, "topNodesByDegree: descending order at position " + i);
  }

  var limited = mgs.topNodesByDegree(FULL_GRAPH, 2);
  assert(limited.returnedNodes <= 2, "topNodesByDegree: limit=2 → returnedNodes ≤ 2");

  var empty = mgs.topNodesByDegree({ nodes: [], connections: [] });
  assertEq(empty.nodes.length, 0, "topNodesByDegree: empty graph → empty nodes");
  assertEq(empty.totalNodes, 0, "topNodesByDegree: empty graph → totalNodes=0");
  assertEq(empty.returnedNodes, 0, "topNodesByDegree: empty graph → returnedNodes=0");
  assertEq(empty.totalEdges, 0, "topNodesByDegree: empty graph → totalEdges=0");
  assertEq(empty.returnedEdges, 0, "topNodesByDegree: empty graph → returnedEdges=0");
})();

// ===== buildTaxonomyTree =====
(function testBuildTaxonomyTree() {
  var tree = mgs.buildTaxonomyTree(FULL_GRAPH);
  assertGt(tree.length, 0, "buildTaxonomyTree: at least one domain found");
  var domain = tree[0];
  assertEq(domain.id, "domain-1", "buildTaxonomyTree: domain id correct");
  assertEq(domain.label, "核心域", "buildTaxonomyTree: domain label from properties.name");
  assertGt(domain.children.length, 0, "buildTaxonomyTree: domain has children (subdomains)");

  var child = domain.children[0];
  assertEq(child.id, "sub-a", "buildTaxonomyTree: subdomain id correct");
  assertEq(child.label, "子域A", "buildTaxonomyTree: subdomain label from properties.name");
  assertGt(child.entityCount, 0, "buildTaxonomyTree: entity count for sub-a > 0");

  // Subdomain without matching domain_id should not appear
  var orphanGraph = {
    nodes: [
      { id: "sub-orphan", label: "Orphan", labels: ["Subdomain"], properties: { name: "Orphan", domain_id: "no-such-domain" } },
    ],
    connections: [],
  };
  var orphanTree = mgs.buildTaxonomyTree(orphanGraph);
  // Should not crash, and orphan subdomain should not appear under any domain
  assertEq(orphanTree.length, 0, "buildTaxonomyTree: orphan subdomain → no domain in tree");

  var empty = mgs.buildTaxonomyTree({ nodes: [], connections: [] });
  assertEq(empty.length, 0, "buildTaxonomyTree: empty graph → []");
})();

// ===== readMasterGraph (requires temp dir + setVaultPath) =====
// SPEC-012 wave-2 图族：主图真身迁 derived-index.db——种子改种 store（scopeKey=vault，测试懒建形态）
(function testReadMasterGraph() {
  var vault = fs.mkdtempSync(path.join(os.tmpdir(), "mgs-read-"));
  var anyshare = path.join(vault, ".ledger");
  fs.mkdirSync(anyshare, { recursive: true });
  mgs.setVaultPath(vault);
  var { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
  var store = getDerivedIndexStore(vault);

  // 无图（库无行）→ null
  var nullResult = mgs.readMasterGraph();
  assertEq(nullResult, null, "readMasterGraph: missing artifact row → null");

  // Valid JSON
  var testGraph = { version: "1.0.0", nodes: [{ id: "n1", label: "N1" }], connections: [] };
  store.artifacts.put("master_graph", JSON.stringify(testGraph));
  var parsed = mgs.readMasterGraph();
  assert(parsed !== null, "readMasterGraph: valid JSON → non-null");
  assertEq(parsed.nodes[0].id, "n1", "readMasterGraph: parsed node id correct");

  // Invalid JSON → null
  store.artifacts.put("master_graph", "{broken json");
  var bad = mgs.readMasterGraph();
  assertEq(bad, null, "readMasterGraph: invalid JSON → null");

  fs.rmSync(vault, { recursive: true, force: true });
})();

// ===== pruneToSubgraph (requires temp dir) =====
// SPEC-012 wave-2 graph family: main graph ground truth migrated to derived-index.db — two-argument calls go through the
// readMasterGraph library-read chain, seeds are planted in store (bytes isomorphic to old file seeds)
(function testPruneToSubgraph() {
  var vault = fs.mkdtempSync(path.join(os.tmpdir(), "mgs-prune-"));

  var pruneGraph = {
    version: "1.0.0",
    nodes: [
      { id: "center", label: "Center", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
      { id: "neighbor-1", label: "N1", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
      { id: "neighbor-2", label: "N2", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
      { id: "far", label: "Far", category: "服务", labels: ["ArchitectureComponent"], properties: {} },
      { id: "doc-x", label: "Doc X", category: "文档", labels: ["Document"], properties: {} },
    ],
    connections: [
      { from: "center", to: "neighbor-1", relationType: "DEPENDS_ON", properties: {} },
      { from: "center", to: "neighbor-2", relationType: "DEPENDS_ON", properties: {} },
      { from: "neighbor-1", to: "far", relationType: "DEPENDS_ON", properties: {} },
      { from: "center", to: "doc-x", relationType: "RELATES_TO", properties: {} },
    ],
  };
  getDerivedIndexStore(vault).artifacts.put("master_graph", JSON.stringify(pruneGraph));
  mgs.setVaultPath(vault);

  // Single seed, maxHops=1
  var sub = mgs.pruneToSubgraph(["center"], 1);
  assertGt(sub.nodes.length, 0, "pruneToSubgraph: single seed returns nodes");
  var nids = sub.nodes.map(function (n) { return n.id; });
  assert(nids.indexOf("center") >= 0, "pruneToSubgraph: seed node 'center' present");
  assert(nids.indexOf("neighbor-1") >= 0, "pruneToSubgraph: direct neighbor 'neighbor-1' present");
  assert(nids.indexOf("neighbor-2") >= 0, "pruneToSubgraph: direct neighbor 'neighbor-2' present");
  assert(nids.indexOf("far") < 0, "pruneToSubgraph: 2-hop 'far' excluded at maxHops=1");
  assert(nids.indexOf("doc-x") < 0, "pruneToSubgraph: non-entity 'doc-x' filtered out");

  // maxHops=2 → far is included
  var sub2 = mgs.pruneToSubgraph(["center"], 2);
  var nids2 = sub2.nodes.map(function (n) { return n.id; });
  assert(nids2.indexOf("far") >= 0, "pruneToSubgraph: 'far' included at maxHops=2");

  // Nonexistent seed
  var missing = mgs.pruneToSubgraph(["nonexistent"], 2);
  assertEq(missing.nodes.length, 0, "pruneToSubgraph: nonexistent seed → empty nodes");
  assertEq(missing.seedCount, 0, "pruneToSubgraph: nonexistent seed → seedCount=0");

  // Multiple seeds
  var multi = mgs.pruneToSubgraph(["neighbor-1", "neighbor-2"], 1);
  assertGt(multi.nodes.length, 0, "pruneToSubgraph: multiple seeds return merged results");
  assertEq(multi.seedCount, 2, "pruneToSubgraph: multiple seeds → seedCount=2");

  // missingSeeds: seeds absent from nodeById should be reported
  var missingSeeds1 = mgs.pruneToSubgraph(["nonexistent"], 2);
  assert(Array.isArray(missingSeeds1.missingSeeds), "pruneToSubgraph: missingSeeds is an array");
  assertDeepEq(missingSeeds1.missingSeeds, ["nonexistent"], "pruneToSubgraph: nonexistent seed → missingSeeds contains it");
  assertEq(missingSeeds1.seedCount, 0, "pruneToSubgraph: nonexistent seed → seedCount=0");

  // missingSeeds: empty when all seeds exist
  var missingSeeds2 = mgs.pruneToSubgraph(["center"], 1);
  assert(Array.isArray(missingSeeds2.missingSeeds), "pruneToSubgraph: valid seed → missingSeeds is an array");
  assertEq(missingSeeds2.missingSeeds.length, 0, "pruneToSubgraph: valid seed → missingSeeds is empty");

  // missingSeeds: mixture of valid and missing seeds
  var missingSeeds3 = mgs.pruneToSubgraph(["center", "ghost-1", "neighbor-1", "ghost-2"], 1);
  assert(Array.isArray(missingSeeds3.missingSeeds), "pruneToSubgraph: mixed seeds → missingSeeds is an array");
  assertDeepEq(missingSeeds3.missingSeeds, ["ghost-1", "ghost-2"], "pruneToSubgraph: mixed seeds → only missing IDs reported, preserving input order");
  assertEq(missingSeeds3.seedCount, 2, "pruneToSubgraph: mixed seeds → seedCount counts only valid seeds");

  fs.rmSync(vault, { recursive: true, force: true });
})();

// ===== ENTITY_LABELS =====
(function testEntityLabels() {
  assert(Array.isArray(mgs.ENTITY_LABELS), "ENTITY_LABELS: is an array");
  assert(mgs.ENTITY_LABELS.indexOf("ArchitectureComponent") >= 0, "ENTITY_LABELS: contains ArchitectureComponent");
  assert(mgs.ENTITY_LABELS.indexOf("Module") >= 0, "ENTITY_LABELS: contains Module");
})();

// ===== buildKnowledgeTopology =====
(function testBuildKnowledgeTopology() {
  var graph = {
    nodes: [
      { id: "doc-1", label: "文章一", labels: ["Document"], properties: {} },
      { id: "comp-a", label: "组件 A", labels: ["ArchitectureComponent"], properties: {} },
      { id: "comp-b", label: "组件 B", labels: ["ArchitectureComponent"], properties: {} },
    ],
    connections: [
      { from: "doc-1", to: "comp-a", relationType: "DOCUMENTS", properties: { source: "article-association-override" } },
      { from: "doc-1", to: "comp-b", relationType: "REFERENCES", reviewStatus: "pending", properties: { source: "document-body" } },
      { from: "comp-a", to: "comp-b", relationType: "DEPENDS_ON", properties: {} },
    ],
  };
  var kt = mgs.buildKnowledgeTopology(graph);
  assertEq(kt.nodes.length, 3, "buildKnowledgeTopology: includes all nodes (Document + ArchitectureComponent)");
  assertEq(kt.edges.length, 3, "buildKnowledgeTopology: includes all edges (DOCUMENTS + REFERENCES + DEPENDS_ON)");
  var docNode = kt.nodes.find(function (n) { return n.id === "doc-1"; });
  assert(docNode, "buildKnowledgeTopology: Document node present");
  var docEdge = kt.edges.find(function (e) { return e.type === "DOCUMENTS"; });
  assert(docEdge, "buildKnowledgeTopology: DOCUMENTS edge present");
  assertEq(docEdge.source, "doc-1", "buildKnowledgeTopology: DOCUMENTS edge source correct");
  // Verify entity-only filter excludes Document edges
  var filtered = mgs.filterTopologyEntities(kt.nodes, kt.edges);
  assertEq(filtered.nodes.length, 2, "filterTopologyEntities: excludes Document node");
  assertEq(filtered.edges.length, 1, "filterTopologyEntities: excludes DOCUMENTS/REFERENCES edges");
  assertEq(filtered.edges[0].type, "DEPENDS_ON", "filterTopologyEntities: keeps only entity-entity edge");
})();

// ── WP-116 批1（八址键直取收敛）：越界键 → 显式分支非静默（own 分支，WP-050 执法形态） ──
(function(){
  // 分类树：保留名标签（曾命中 Object.prototype 误判实体计数）＋保留名 domain_id
  //（曾命中 Object.prototype 致 domains[parent].children.push TypeError）
  var graph = { nodes: [
    { id: "dom1", labels: ["BusinessDomain"], properties: { name: "域一" } },
    { id: "sd1", labels: ["Subdomain"], properties: { name: "子域一", domain_id: "dom1" } },
    { id: "e1", labels: ["Module"], properties: { subdomain_id: "sd1" } },
    { id: "d1", labels: ["Document"], properties: { subdomain_id: "sd1" } },
    { id: "bad1", labels: ["constructor"], properties: { subdomain_id: "sd1" } },
    { id: "bad2", labels: ["toString"], properties: { subdomain_id: "sd1" } },
    { id: "sub2", labels: ["Subdomain"], properties: { name: "越界子域一", domain_id: "constructor" } },
    { id: "sub3", labels: ["Subdomain"], properties: { name: "越界子域二", domain_id: "toString" } },
  ], connections: [] };
  var tree = mgs.buildTaxonomyTree(graph);
  var dom1 = tree.find(function (d) { return d.id === "dom1"; });
  assert(dom1, "WP-116 taxonomy: 合法域入树");
  var sd1 = dom1.children.find(function (c) { return c.id === "sd1"; });
  assertEq(sd1.entityCount, 1, "WP-116 taxonomy: Module 计实体 1（constructor/toString 标签不再误判实体）");
  assertEq(sd1.docCount, 1, "WP-116 taxonomy: Document 计文档 1（对照语义保持）");
  assertEq(dom1.children.length, 1, "WP-116 taxonomy: 保留名 domain_id 子域不入树（旧在此 TypeError）");
  assertEq(JSON.stringify(tree).indexOf("NaN"), -1, "WP-116 taxonomy: 无 NaN");
})();

(function(){
  // top-N：合法实体节点携带保留名 id（toString）——不在 top 集时其边不再经原型面误纳
  var graph = { nodes: [
    { id: "a", labels: ["Module"], properties: {} },
    { id: "toString", labels: ["Module"], properties: {} },
  ], connections: [
    { from: "a", to: "toString", relationType: "DEPENDS_ON", properties: {} },
  ] };
  var out = mgs.topNodesByDegree(graph, 1); // 并列度数 id 次级键：a < toString → top=[a]
  assertEq(out.returnedNodes, 1, "WP-116 topN: 只取 1 个顶节点");
  assertEq(out.returnedEdges, 0, "WP-116 topN: toString 不在 top 集 → 边不再经 Object.prototype 误纳（旧 returnedEdges=1）");
  assertEq(out.totalEdges, 1, "WP-116 topN: 准入实体间的边总数口径不变（对照）");
  // 对照：顶集内的边照常保留（own 分支不误伤）
  var all = mgs.topNodesByDegree(graph, 2);
  assertEq(all.returnedEdges, 1, "WP-116 topN: 两端均在 top 集 → 边保留（宿主化不误伤）");
})();

console.log("master-graph-service tests: " + passed + " passed, " + failed + " failed");
if (!process.env.VITEST) process.exit(failed > 0 ? 1 : 0);
