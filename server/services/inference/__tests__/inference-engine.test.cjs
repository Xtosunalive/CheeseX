// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const test = require("node:test");
const assert = require("node:assert/strict");
const { createInferenceEngine } = require("../inference-engine.cjs");
const { buildCapabilityRegistry } = require("../../../shared/relation-capability-selector.cjs");
const { detectRuleConflicts } = require("../inference-rule-conflicts.cjs");
const { withAssertionPolicies } = require("../../../shared/__tests__/assertion-policy-fixture.cjs");

// ── Capability-driven test ontology builder ─────────────────────────────

const CAPABILITY_DEFAULTS = withAssertionPolicies({
  DEPENDS_ON:    { direction: "A → B", weight_default: 1,    semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "keep" },
  DOCUMENTS:     { direction: "A → B", weight_default: 1,    semantic_role: "article_attachment",   candidate_enabled: true,  fact_encoding: "article_association", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
  REFERENCES:    { direction: "双向", weight_default: 0.4,  semantic_role: "weak_semantic",        candidate_enabled: false, fact_encoding: "wikilink", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
  MENTIONS:      { direction: "A → B", weight_default: 0.2,  semantic_role: "weak_semantic",        candidate_enabled: false, fact_encoding: "derived",  projected: false, versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
  BELONGS_TO:    { direction: "A → B", weight_default: 1,    semantic_role: "category_navigation",  candidate_enabled: false, fact_encoding: "category_path", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
  APPLIES_TO:    { direction: "A → B", weight_default: 1,    semantic_role: "article_attachment",   candidate_enabled: true,  fact_encoding: "article_association", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
  HAS_VERSION:   { direction: "A → B", weight_default: 1,    semantic_role: "category_navigation",  candidate_enabled: false, fact_encoding: "version_registry", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
  HAS_SYMPTOM:   { direction: "A → B", weight_default: 1,    semantic_role: "article_attachment",   candidate_enabled: false, fact_encoding: "structured_property", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
  USES:          { direction: "A → B", weight_default: 0.8,  semantic_role: "historical_compat",    candidate_enabled: false, fact_encoding: "none",     projected: false, versionable: false, impact_propagation: "none",         legacy_policy: "delete" },
  RELATED:       { direction: "A → B", weight_default: 0.3,  semantic_role: "weak_semantic",        candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "keep" },
  BACKS_UP:      { direction: "A → B", weight_default: 0.7,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
  STORES_IN:     { direction: "A → B", weight_default: 1,    semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
  CONNECTS_TO:   { direction: "A → B", weight_default: 0.7,  semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "forward_stop",  legacy_policy: "migrate" },
  INDEXES:       { direction: "A → B", weight_default: 1,    semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
  ENCRYPTS:      { direction: "A → B", weight_default: 1,    semantic_role: "architecture_skeleton", candidate_enabled: true,  fact_encoding: "typed_wikilink", projected: true,  versionable: true,  impact_propagation: "reverse",      legacy_policy: "migrate" },
  ASSOCIATED_WITH:{ direction: "A → B", weight_default: 1,   semantic_role: "category_navigation",  candidate_enabled: false, fact_encoding: "derived",  projected: true,  versionable: false, impact_propagation: "none",         legacy_policy: "migrate" },
});

function capabilityRegistry() {
  return buildCapabilityRegistry({ relation_types: CAPABILITY_DEFAULTS, inference_rules: [] });
}

function ontology() {
  const registry = capabilityRegistry();
  const relations = new Map();
  for (const [type, entry] of registry.relations) {
    relations.set(type, {
      type,
      semanticRole: entry.semanticRole,
      impactPropagation: entry.impactPropagation,
      direction: entry.direction,
      weight: entry.weight,
      bidirectional: entry.bidirectional,
      requiresReview: entry.requiresReview,
      legacy: entry.legacyPolicy !== "keep",
      registeredForInference: entry.registeredForInference,
      candidateEnabled: entry.candidateEnabled,
      legacyPolicy: entry.legacyPolicy,
      mode: null,
    });
  }
  return {
    relations,
    rules: [
      { id: "transitive_dependency", scope: "reasoning", pattern: "A -[DEPENDS_ON]-> B -[DEPENDS_ON]-> C", output: "A -[DEPENDS_ON]-> C (inferred)" },
      { id: "document_covers_related", scope: "reasoning", pattern: "D -[DOCUMENTS]-> A -[REFERENCES]-> B", output: "D -[REFERENCES]-> B (inferred)" },
    ],
  };
}

function graph(edges, ids = ["a", "b", "c", "d"]) {
  return { nodes: ids.map((id) => ({ id, label: id.toUpperCase() })), connections: edges };
}

function edge(from, to, type, confidence = 1, extra = {}) {
  return { from, to, relationType: type, confidence, reviewStatus: "approved", sourceFile: `${from}.md`, lineNumber: 1, ...extra };
}

function engine(extra = {}) {
  return createInferenceEngine({ ontology: ontology(), conflictDetector: detectRuleConflicts, ...extra });
}

// ── Slice 1: Fixed target behavior tests ────────────────────────────────

test("USES is not registered for inference (legacy_policy=delete)", () => {
  const result = engine().infer({ graph: graph([edge("a", "b", "USES")]), seedNodeIds: ["a"], minConfidence: 0, maxInferenceDepth: 3 });
  assert.equal(result.affected.length, 0);
  assert.ok(result.filteredEdges.some((item) => item.reason === "UNREGISTERED_RELATION"));
});

test("RELATED does not propagate (impact_propagation=none, candidate-enabled → suspend)", () => {
  const result = engine().infer({ graph: graph([edge("a", "b", "RELATED")]), seedNodeIds: ["a"], minConfidence: 0, maxInferenceDepth: 3 });
  assert.equal(result.suspended.length, 1);
  assert.equal(result.affected.length, 0);
});

test("CONNECTS_TO propagates forward once then stops (forward_stop)", () => {
  const connected = engine().infer({ graph: graph([edge("a", "b", "CONNECTS_TO"), edge("b", "c", "CONNECTS_TO")]), seedNodeIds: ["a"], minConfidence: 0, maxInferenceDepth: 3 });
  assert.deepEqual(connected.affected.map((item) => item.nodeId), ["b"]);
});

test("risk classification: STORES_IN=data, BACKS_UP=recovery, INDEXES=searchability, ENCRYPTS=confidentiality", () => {
  const reg = capabilityRegistry();
  assert.equal(reg.relations.get("STORES_IN").riskKind, "data");
  assert.equal(reg.relations.get("BACKS_UP").riskKind, "recovery");
  assert.equal(reg.relations.get("INDEXES").riskKind, "searchability");
  assert.equal(reg.relations.get("ENCRYPTS").riskKind, "confidentiality");
});

// ── Existing tests adapted to capability-driven ontology ────────────────

test("implements capability-driven propagation (replacing 16-relation four-mode matrix)", () => {
  const allTypes = [...ontology().relations.keys()];
  for (const type of allTypes) {
    const rel = ontology().relations.get(type);
    if (!rel || !rel.registeredForInference || type === "USES") continue;
    // For reverse propagation: start from target
    // For forward/forward_stop: start from source
    // For none (no propagation): skip traversal test
    if (rel.impactPropagation === "none") continue;

    const seedFromTarget = rel.impactPropagation === "reverse" || type === "BACKS_UP";
    const seed = seedFromTarget ? "b" : "a";
    const result = engine().infer({ graph: graph([edge("a", "b", type)]), seedNodeIds: [seed], minConfidence: 0, maxInferenceDepth: 3 });

    if (type === "RELATED") {
      assert.equal(result.suspended.length, 1, type);
      assert.equal(result.affected.length, 0, type);
    } else {
      const expectedTarget = seedFromTarget || type === "BACKS_UP" ? "a" : "b";
      const found = result.affected.find((item) => item.nodeId === expectedTarget);
      assert.ok(found, `${type}: expected to reach ${expectedTarget}, affected=[${result.affected.map((item) => item.nodeId).join(",")}]`);
    }
  }
});

test("BACKS_UP forward blocked per ADR009 R11 (only reverse propagation)", () => {
  const forwardBackup = engine().infer({ graph: graph([edge("a", "b", "BACKS_UP")]), seedNodeIds: ["a"], minConfidence: 0 });
  assert.equal(forwardBackup.affected.length, 0);
  assert.ok(forwardBackup.filteredEdges.some((item) => item.reason === "BACKUP_FORWARD_BLOCKED"));

  // Reverse should work (b is backed up by a, starting from b finds a)
  const reverseBackup = engine().infer({ graph: graph([edge("a", "b", "BACKS_UP")]), seedNodeIds: ["b"], minConfidence: 0 });
  assert.equal(reverseBackup.affected[0]?.nodeId, "a");
});

test("MENTIONS never propagates when impact_propagation=none", () => {
  const mention = engine().infer({ graph: graph([edge("a", "b", "MENTIONS")]), seedNodeIds: ["a"], minConfidence: 0.3 });
  assert.equal(mention.affected.length, 0);
  assert.ok(mention.filteredEdges.some((item) => item.reason === "NO_IMPACT_PROPAGATION"));
});

test("generates both declared inferred edge rules with immutable graph and full traces", () => {
  const input = graph([
    edge("a", "b", "DEPENDS_ON", 0.9), edge("b", "c", "DEPENDS_ON", 0.8),
    edge("d", "a", "DOCUMENTS", 1), edge("a", "c", "REFERENCES", 1),
  ]);
  const before = JSON.stringify(input);
  const result = engine().infer({ graph: input, seedNodeIds: ["a"], minConfidence: 0, maxInferenceDepth: 3 });
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.inferredEdges.map((item) => item.inferenceRule), ["transitive_dependency", "document_covers_related"]);
  const transitive = result.inferredEdges[0];
  assert.equal(transitive.inferred, true);
  assert.deepEqual(transitive.inferenceChain, ["a", "b", "c"]);
  assert.equal(transitive.confidence, 0.72);
  assert.equal(transitive.confidenceBand, "MEDIUM");
  assert.equal(transitive.trace.hops.length, 2);
  assert.equal(transitive.trace.hops[0].edgeSource, "a.md");
});

test("filters rejected and unregistered edges, suppresses cycles, and sorts deterministically", () => {
  const customOntology = ontology();
  customOntology.relations.set("CUSTOM", { type: "CUSTOM", semanticRole: "weak_semantic", impactPropagation: "none", registeredForInference: false, weight: 1, legacyPolicy: "keep" });
  const service = createInferenceEngine({ ontology: customOntology, conflictDetector: detectRuleConflicts });
  const result = service.infer({ graph: graph([
    edge("a", "c", "CONNECTS_TO"), edge("a", "b", "CONNECTS_TO"), edge("b", "a", "CONNECTS_TO"),
    edge("a", "d", "CUSTOM"), edge("a", "d", "CONNECTS_TO", 1, { reviewStatus: "rejected" }),
  ]), seedNodeIds: ["a"], minConfidence: 0, maxInferenceDepth: 3 });
  assert.deepEqual(result.affected.map((item) => item.nodeId), ["b", "c"]);
  assert.ok(result.filteredEdges.some((item) => item.reason === "REJECTED"));
  assert.ok(result.filteredEdges.some((item) => item.reason === "UNREGISTERED_RELATION"));
});

test("enforces depth/target/trace caps and reports truncation", () => {
  const many = Array.from({ length: 510 }, (_, index) => edge("a", `n${String(index).padStart(3, "0")}`, "CONNECTS_TO"));
  const ids = ["a", ...many.map((item) => item.to)];
  const result = engine().infer({ graph: graph(many, ids), seedNodeIds: ["a"], minConfidence: 0, maxInferenceDepth: 9 });
  assert.equal(result.affected.length, 500);
  assert.equal(result.meta.maxInferenceDepth, 3);
  assert.equal(result.meta.truncated, true);
});

test("consumes structured decision status when candidate conclusions are supplied", () => {
  const consumer = require("../inference-decision-consumer.cjs").createInferenceDecisionConsumer();
  const result = createInferenceEngine({ ontology: ontology(), conflictDetector: detectRuleConflicts, decisionConsumer: consumer }).infer({
    graph: graph([edge("a", "b", "DEPENDS_ON")]), seedNodeIds: ["a"], minConfidence: 0,
    candidateConclusions: [{ ruleId: "transitive_dependency", subjectNodeId: "a", conclusionKey: "architecture-change-disposition", effect: "BLOCK", evidence: ["version:AnyShare:7.0"] }],
    decision: { decision: "select_effect", selectedEffect: "BLOCK", selectedRuleIds: ["transitive_dependency"], sourceRevision: "sha256:source" }, sourceRevision: "sha256:source",
  });
  assert.equal(result.meta.decisionStatus, "blocked");
  assert.equal(result.meta.writeAllowed, false);
});

// ── DEPENDS_ON replaced USES test cases per ADR009 R9 ───────────────────

test("DEPENDS_ON propagates reverse from target to source", () => {
  const result = engine().infer({ graph: graph([edge("a", "b", "DEPENDS_ON")]), seedNodeIds: ["b"], minConfidence: 0, maxInferenceDepth: 3 });
  assert.equal(result.affected[0]?.nodeId, "a");
});

test("DEPENDS_ON transitive closure infers indirect edges", () => {
  const result = engine().infer({
    graph: graph([edge("a", "b", "DEPENDS_ON", 0.9), edge("b", "c", "DEPENDS_ON", 0.9)]),
    seedNodeIds: ["c"], minConfidence: 0, maxInferenceDepth: 3,
  });
  // From c, reverse to b (hop 1), then reverse to a (hop 2)
  const affectedIds = result.affected.map((item) => item.nodeId);
  assert.ok(affectedIds.includes("b"));
  assert.ok(affectedIds.includes("a"));
});
