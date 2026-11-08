// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const assert = require("assert");
const test = require("node:test");
const { createImpactAnalysisService } = require("../impact-analysis-service.cjs");
const { buildCapabilityRegistry } = require("../../../shared/relation-capability-selector.cjs");
const { withAssertionPolicies } = require("../../../shared/__tests__/assertion-policy-fixture.cjs");

// Minimal capability ontology for impact analysis tests
const testRegistry = buildCapabilityRegistry({ relation_types: withAssertionPolicies({
  DEPENDS_ON:  { direction: "A → B", weight_default: 1,   semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: true,  impact_propagation: "reverse",     legacy_policy: "keep" },
  STORES_IN:   { direction: "A → B", weight_default: 0.8, semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: true,  impact_propagation: "reverse",     legacy_policy: "migrate" },
  CONNECTS_TO: { direction: "A → B", weight_default: 0.7, semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: true,  impact_propagation: "forward_stop", legacy_policy: "migrate" },
  BACKS_UP:    { direction: "A → B", weight_default: 0.7, semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: true,  impact_propagation: "reverse",     legacy_policy: "migrate" },
  INDEXES:     { direction: "A → B", weight_default: 0.8, semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: true,  impact_propagation: "reverse",     legacy_policy: "migrate" },
  ENCRYPTS:    { direction: "A → B", weight_default: 0.8, semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: true,  impact_propagation: "reverse",     legacy_policy: "migrate" },
  DOCUMENTS:   { direction: "A → B", weight_default: 0.8, semantic_role: "article_attachment",   candidate_enabled: true,  fact_encoding: "article_association", projected: true, versionable: false, impact_propagation: "none", legacy_policy: "migrate" },
  REFERENCES:  { direction: "双向", weight_default: 0.8, semantic_role: "weak_semantic",        candidate_enabled: false, fact_encoding: "wikilink", projected: true, versionable: false, impact_propagation: "none", legacy_policy: "keep" },
  RELATED:     { direction: "A → B", weight_default: 0.3, semantic_role: "weak_semantic",        candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true, versionable: false, impact_propagation: "none", legacy_policy: "keep" },
})});

function graph() {
  return {
    nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id.toUpperCase(), properties: {} })),
    connections: [
      { from: "a", to: "b", relationType: "DEPENDS_ON", confidence: 0.9, reviewStatus: "approved" },
      { from: "a", to: "c", relationType: "DEPENDS_ON", properties: { confidence: 0.8 } },
      { from: "b", to: "d", relationType: "STORES_IN", confidence: 0.7 },
      { from: "c", to: "d", relationType: "CONNECTS_TO" },
      { from: "d", to: "a", relationType: "DEPENDS_ON", confidence: 0.9 },
      { from: "b", to: "e", relationType: "RELATES_TO", confidence: 1 },
      { from: "c", to: "e", relationType: "DEPENDS_ON", confidence: 0.2 },
      { from: "d", to: "e", relationType: "DEPENDS_ON", confidence: 0.9, reviewStatus: "rejected" },
    ],
  };
}

test("traverses downstream with confidence, whitelist and rejection filtering", () => {
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graph });
  const result = service.analyze({ seedNodeIds: ["a"], maxHops: 3, minConfidence: 0.5 });
  assert.deepStrictEqual(result.downstream.byHop.map((group) => group.nodes.map((node) => node.nodeId)), [["b", "c"], ["d"]]);
  assert.strictEqual(result.downstream.byHop[1].nodes[0].risk, "MEDIUM");
  assert.strictEqual(result.downstream.byHop[1].nodes[0].paths.length, 2);
  assert(result.filteredEdges.some((item) => item.reason === "EDGE_TYPE"));
  assert(result.filteredEdges.some((item) => item.reason === "LOW_CONFIDENCE"));
  assert(result.filteredEdges.some((item) => item.reason === "REJECTED"));
});

test("supports upstream and both directions", () => {
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graph });
  const upstream = service.analyze({ seedNodeIds: ["d"], direction: "upstream", maxHops: 1 });
  assert.deepStrictEqual(upstream.upstream.byHop[0].nodes.map((node) => node.nodeId), ["b", "c"]);
  const both = service.analyze({ seedNodeIds: ["b"], direction: "both", maxHops: 1 });
  assert.strictEqual(both.downstream.byHop[0].nodes[0].nodeId, "d");
  assert.strictEqual(both.upstream.byHop[0].nodes[0].nodeId, "a");
});

test("uses default confidence 0.5 and resolves seed aliases", () => {
  const data = graph();
  data.nodes[0].properties.architecture_node_id = "seed-main";
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: () => data });
  const result = service.analyze({ seedNodeIds: ["seed-main"], minConfidence: 0.5 });
  const d = result.downstream.byHop[1].nodes.find((node) => node.nodeId === "d");
  assert(d.paths.some((path) => path.confidence === 0.4));
  assert.deepStrictEqual(result.meta.resolvedSeedNodeIds, ["a"]);
});

test("resolves punctuation-tolerant unique fuzzy seed names", () => {
  const data = graph();
  data.nodes.push({ id: "test-pipeline-verification", label: "管线端到端验证节点", properties: {} });
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: () => data });
  const result = service.analyze({ seedNodeIds: ["test.."] });
  assert.deepStrictEqual(result.meta.resolvedSeedNodeIds, ["test-pipeline-verification"]);
});

test("collects Phase 0 documents without failing on missing bindings", () => {
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graph, getNodeDocuments: (id) => id === "b" ? { result: { documents: [{ title: "B", relativePath: "b.md", arch_component: true, arch_status: "", status: "", arch_layer: "", arch_category: "", arch_subdomain: "", module: "", tags: [], relations: [] }] } } : (() => { throw new Error("missing"); })() });
  const result = service.analyze({ seedNodeIds: ["a"], maxHops: 1, includeDocuments: true });
  assert.strictEqual(result.downstream.documentRefs[0].relativePath, "b.md");
});

test("collects all canonical documents through graphNodeIds", () => {
  const service = createImpactAnalysisService({
    capabilityRegistry: testRegistry,
    getGraph: graph,
    getDocumentsByGraphNodeIds: (nodeIds) => nodeIds.includes("b") ? [
      { documentId: "entity:b", sourcePath: "知识库/wiki/entities/b.md", title: "B" },
      { documentId: "article:ART-001", sourcePath: "知识库/raw/precleaned/b.md", title: "B Guide" },
    ] : [],
  });
  const result = service.analyze({ seedNodeIds: ["a"], direction: "downstream", includeDocuments: true });
  assert.deepStrictEqual(result.downstream.documentRefs.map((item) => item.documentId), ["entity:b", "article:ART-001"]);
  assert.strictEqual(result.downstream.documentRefs[1].relativePath, "知识库/raw/precleaned/b.md");
});

test("returns typed errors for missing graph, invalid input and missing seed", () => {
  assert.throws(() => createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: () => null }).analyze({ seedNodeIds: ["a"] }), (error) => error.code === "GRAPH_UNAVAILABLE");
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graph });
  assert.throws(() => service.analyze({ seedNodeIds: [], maxHops: 9 }), (error) => error.code === "INVALID_QUERY");
  assert.throws(
    () => service.analyze({ seedNodeIds: ["missing"] }),
    (error) => error.code === "SEED_NOT_FOUND" && error.message.includes("missing"),
  );
});

// ── Task 6: Inference integration tests ──────────────────────────

function mockInferenceEngine() {
  let called = 0;
  const infer = () => { called++; return { affected: [], inferredEdges: [], filteredEdges: [], suspended: [], conflicts: [], meta: { maxInferenceDepth: 3, truncated: false, inferredEdgeCount: 0 } }; };
  return { infer, getCalled: () => called };
}

function graphWithInferenceChain() {
  return {
    nodes: ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase(), properties: {} })),
    connections: [
      { from: "a", to: "b", relationType: "DEPENDS_ON", confidence: 0.9, reviewStatus: "approved" },
      { from: "b", to: "c", relationType: "DEPENDS_ON", confidence: 0.8, reviewStatus: "approved" },
      { from: "a", to: "d", relationType: "DEPENDS_ON", confidence: 0.7, reviewStatus: "approved" },
    ],
  };
}

test("does NOT call inference engine when enableInference is absent", () => {
  const engine = mockInferenceEngine();
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain, inferenceEngine: engine });
  service.analyze({ seedNodeIds: ["a"] });
  assert.strictEqual(engine.getCalled(), 0);
});

test("does NOT call inference engine when enableInference is false", () => {
  const engine = mockInferenceEngine();
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain, inferenceEngine: engine });
  service.analyze({ seedNodeIds: ["a"], enableInference: false });
  assert.strictEqual(engine.getCalled(), 0);
});

test("calls inference engine when enableInference is true", () => {
  const engine = mockInferenceEngine();
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain, inferenceEngine: engine });
  service.analyze({ seedNodeIds: ["a"], enableInference: true });
  assert.strictEqual(engine.getCalled(), 1);
});

test("returns production change-disposition candidates and persisted decision state", () => {
  let received = null;
  const service = createImpactAnalysisService({
    capabilityRegistry: testRegistry,
    getGraph: graphWithInferenceChain,
    inferenceEngine: mockInferenceEngine(),
    getVersionStatus: () => "released",
    changeDispositionService: {
      evaluate(input) { received = input; return { sourceRevision: "sha256:reasoning", candidates: [{ ruleId: "CHANGE_REQUIRED_RELEASED_USAGE", effect: "ASSERT" }], conflicts: [], results: [{ subjectNodeId: "a", status: "change_required", writeAllowed: true }], status: "change_required", writeAllowed: true }; },
    },
  });
  const result = service.analyze({ seedNodeIds: ["a"], enableInference: true, product: "AnyShare", version: "7.0.6.8" });
  assert.equal(result.reasoning.status, "change_required");
  assert.equal(received.affectedVersions[0].status, "released");
  assert(received.affectedVersions[0].paths.length > 0);
  assert(received.affectedVersions[0].componentIds.includes("a"));
});

test("validates maxInferenceDepth bounds (1..3)", () => {
  const engine = mockInferenceEngine();
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain, inferenceEngine: engine });
  assert.throws(() => service.analyze({ seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 0 }), (error) => error.code === "INVALID_QUERY");
  assert.throws(() => service.analyze({ seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 5 }), (error) => error.code === "INVALID_QUERY");
  assert.throws(() => service.analyze({ seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: "deep" }), (error) => error.code === "INVALID_QUERY");
  const result = service.analyze({ seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 2 });
  assert.ok(result);
});

test("merges inference meta without corrupting direct BFS output", () => {
  const engine = {
    infer() {
      return {
        affected: [{ nodeId: "c", hop: 1, confidence: 0.72, confidenceBand: "MEDIUM", traces: [] }],
        inferredEdges: [{ source: "a", target: "c", type: "DEPENDS_ON", confidence: 0.72, reviewStatus: "pending", sourceFile: "", lineNumber: null, inferred: true, inferenceRule: "transitive_dependency", inferenceChain: ["a", "b", "c"], confidenceBand: "MEDIUM", trace: { conclusion: "a -[DEPENDS_ON]-> c", pathConfidence: 0.72, confidenceBand: "MEDIUM", hops: [] } }],
        filteredEdges: [],
        suspended: [],
        conflicts: [],
        meta: { maxInferenceDepth: 3, truncated: false, inferredEdgeCount: 1 },
      };
    },
  };
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain, inferenceEngine: engine });
  const result = service.analyze({ seedNodeIds: ["a"], enableInference: true, maxInferenceDepth: 3 });
  assert.ok(result.downstream);
  assert.ok(result.meta);
  assert.strictEqual(result.meta.inferredEdgeCount, 1);
  assert.strictEqual(result.meta.maxInferenceDepth, 3);
  assert.strictEqual(result.inferredEdges.length, 1);
  assert.strictEqual(result.inferredEdges[0].inferred, true);
  assert.strictEqual(result.inferredEdges[0].inferenceRule, "transitive_dependency");
});

test("inference errors do NOT corrupt direct BFS output", () => {
  const engine = {
    infer() { throw new Error("inference exploded"); },
  };
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain, inferenceEngine: engine });
  const result = service.analyze({ seedNodeIds: ["a"], enableInference: true });
  assert.ok(result.downstream);
  assert.ok(result.meta);
  assert.strictEqual(result.meta.totalNodesAffected, 3);
  assert.strictEqual(result.meta.inferenceError, "inference exploded");
});

test("returns INFERENCE_UNAVAILABLE meta when engine absent but inference requested", () => {
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graphWithInferenceChain });
  const result = service.analyze({ seedNodeIds: ["a"], enableInference: true });
  assert.strictEqual(result.meta.inferenceUnavailable, true);
  assert.ok(result.downstream);
});

test("returns evidence-backed relation lineage and aggregate freshness", () => {
  const graph = {
    nodes: [
      { id: "a", label: "A", properties: { file_path: "知识库/wiki/entities/a.md" } },
      { id: "b", label: "B", properties: { file_path: "知识库/wiki/entities/b.md" } },
    ],
    connections: [{
      edgeId: "edge-a-b",
      from: "a",
      to: "b",
      relationType: "DEPENDS_ON",
      sourceFile: "知识库/wiki/entities/a.md",
      sourceHash: "sha256:expected-source",
      lineNumber: 12,
      evidenceHash: "evidence-1",
      reviewStatus: "approved",
      properties: { source: "entity-wikilink+yaml", since: "7.0.6.7", until: "7.0.6.9", confidence: 1 },
    }],
  };
  const provenance = {
    inspectSource(sourcePath, expectedHash) {
      assert.equal(sourcePath, "知识库/wiki/entities/a.md");
      assert.equal(expectedHash, "sha256:expected-source");
      return { contentHash: expectedHash, freshness: { status: "fresh", checkedAt: "2026-07-19T00:00:00.000Z", changedFields: [] } };
    },
    inspectGraph(sourcePaths) {
      if (sourcePaths.length === 0) return { contentHash: "sha256:master", freshness: { status: "fresh", checkedAt: "2026-07-19T00:00:00.000Z", changedFields: [] } };
      assert.deepEqual(sourcePaths, ["知识库/wiki/entities/a.md", "知识库/wiki/entities/b.md"]);
      return { contentHash: "sha256:master", freshness: { status: "stale", checkedAt: "2026-07-19T00:00:00.000Z", changedFields: ["sourceRevision:知识库/wiki/entities/b.md"] } };
    },
  };
  const result = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: () => graph, graphProvenanceService: provenance }).analyze({ seedNodeIds: ["a"], product: "AnyShare", version: "7.0.6.8" });
  const edge = result.downstream.byHop[0].nodes[0].paths[0].edges[0];

  assert.equal(edge.edgeId, "edge-a-b");
  assert.equal(edge.sourceHash, "sha256:expected-source");
  assert.equal(edge.evidenceHash, "evidence-1");
  assert.equal(edge.since, "7.0.6.7");
  assert.equal(edge.until, "7.0.6.9");
  assert.equal(edge.lineage.source.contentHash, "sha256:expected-source");
  assert.equal(edge.lineage.rule.ruleId, "typed-wikilink.dependency-rule");
  assert.equal(edge.lineage.freshness.status, "fresh");
  assert.equal(result.lineage.source.contentHash, "sha256:master");
  assert.equal(result.lineage.freshness.status, "stale");
});

test("excludes approved relations with incomplete lineage from confirmed paths", () => {
  const data = {
    nodes: ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), properties: {} })),
    connections: [
      { edgeId: "missing-lineage", from: "a", to: "b", relationType: "DEPENDS_ON", confidence: 1, reviewStatus: "approved" },
      {
        edgeId: "complete-lineage", from: "a", to: "c", relationType: "DEPENDS_ON", confidence: 1, reviewStatus: "approved",
        sourceFile: "知识库/wiki/entities/a.md", sourceHash: "sha256:source", lineNumber: 4, evidenceHash: "sha256:evidence",
      },
    ],
  };
  const provenance = {
    inspectGraph: () => ({ contentHash: "sha256:master", freshness: { status: "fresh", checkedAt: "2026-07-23T00:00:00.000Z", changedFields: [] } }),
    inspectSource: (_path, expectedHash) => ({ contentHash: expectedHash, freshness: { status: "fresh", checkedAt: "2026-07-23T00:00:00.000Z", changedFields: [] } }),
    inspectRelationLineage(edge) {
      return edge.edgeId === "missing-lineage"
        ? { edgeId: edge.edgeId, trusted: true, valid: false, missingFields: ["ruleId"] }
        : { edgeId: edge.edgeId, trusted: true, valid: true, missingFields: [] };
    },
  };

  const result = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: () => data, graphProvenanceService: provenance }).analyze({ seedNodeIds: ["a"] });
  assert.deepStrictEqual(result.downstream.byHop[0].nodes.map((node) => node.nodeId), ["c"]);
  assert.equal(result.downstream.byHop.flatMap((group) => group.nodes).flatMap((node) => node.paths).some((path) => path.edges.some((edge) => edge.edgeId === "missing-lineage")), false);
  assert.equal(result.filteredEdges.find((item) => item.edge.edgeId === "missing-lineage").reason, "MISSING_LINEAGE");
});

test("excludes approved relations whose source freshness is not verified", () => {
  const data = {
    nodes: ["a", "b"].map((id) => ({ id, label: id.toUpperCase(), properties: {} })),
    connections: [{ edgeId: "stale-edge", from: "a", to: "b", relationType: "DEPENDS_ON", confidence: 1, reviewStatus: "approved", sourceFile: "知识库/wiki/entities/a.md", sourceHash: "sha256:old", lineNumber: 2, evidenceHash: "sha256:evidence" }],
  };
  const provenance = {
    inspectGraph: () => ({ contentHash: "sha256:master", freshness: { status: "fresh", checkedAt: "2026-07-23T00:00:00.000Z", changedFields: [] } }),
    inspectSource: () => ({ contentHash: "sha256:new", freshness: { status: "stale", checkedAt: "2026-07-23T00:00:00.000Z", changedFields: ["sourceHash"] } }),
    inspectRelationLineage: () => ({ edgeId: "stale-edge", trusted: true, valid: true, missingFields: [] }),
  };
  const result = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: () => data, graphProvenanceService: provenance }).analyze({ seedNodeIds: ["a"] });
  assert.equal(result.meta.totalNodesAffected, 0);
  assert.equal(result.filteredEdges[0].reason, "STALE_SOURCE");
});

// WP-006 第2项：riskKind 随边输出＋影响面风险分类汇总
test("riskBreakdown aggregates traversed edges by riskKind (WP-006)", () => {
  const service = createImpactAnalysisService({ capabilityRegistry: testRegistry, getGraph: graph });
  const result = service.analyze({ seedNodeIds: ["a"], maxHops: 3, minConfidence: 0.5 });
  // 路径边带风险分类：DEPENDS_ON→dependency、STORES_IN→data
  const hop2 = result.downstream.byHop[1].nodes[0];
  for (const path of hop2.paths) {
    for (const edge of path.edges) {
      if (edge.type === "DEPENDS_ON") assert.strictEqual(edge.riskKind, "dependency");
      if (edge.type === "STORES_IN") assert.strictEqual(edge.riskKind, "data");
    }
  }
  assert.ok(result.riskBreakdown.dependency >= 2, "dependency 计数≥2");
  assert.ok(result.riskBreakdown.data >= 1, "data 计数≥1");
});

// ── WP-060（SPEC-054 P2）：lineage path 标注真实来源（derived-index 库）──
test('WP-060 lineage path：无 sourceFile 边的 fallback 标注 derived-index:master_graph（不再emit 文件时代路径）', () => {
  const svc = createImpactAnalysisService({ getGraph: () => ({
    nodes: [{ id: 'seed-1', labels: ['ArchitectureComponent'], properties: {} }, { id: 't1', labels: ['ArchitectureComponent'], properties: {} }],
    connections: [{ from: 'seed-1', to: 't1', relationType: 'DEPENDS_ON', properties: {} }],
  }) });
  const out = svc.analyze({ seedNodeIds: ['seed-1'], edgeTypes: ['DEPENDS_ON'], maxDepth: 1 });
  const s = JSON.stringify(out);
  assert.ok(!s.includes('.ledger/master_graph.json'), '不再产出文件时代遗留路径');
  assert.ok(s.includes('derived-index:master_graph'), '标注真实来源');
});
