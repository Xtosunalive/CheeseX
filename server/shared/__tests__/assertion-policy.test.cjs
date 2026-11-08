const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateAssertionPolicies,
  resolveAssertionPolicy,
  buildCapabilityRegistry,
  KNOWN_ASSERTION_PRODUCERS,
  ALLOWED_DECISION_MODES,
  ALLOWED_WORKING_PROJECTIONS,
  ALLOWED_SOURCE_KINDS,
} = require("../relation-capability-selector.cjs");

// Helper: build a minimal valid ontology with one relation type
function minimalOntology(relationOverrides = {}) {
  return {
    relation_types: {
      TEST_REL: {
        description: "Test relation",
        source_types: ["System"],
        target_types: ["System"],
        semantic_role: "architecture_skeleton",
        candidate_enabled: true,
        fact_encoding: "typed_wikilink",
        projected: true,
        versionable: false,
        impact_propagation: "reverse",
        legacy_policy: "keep",
        direction: "单向",
        weight_default: 1,
        assertion_policies: [
          {
            source_kind: "typed_wikilink",
            producer: "extract_graph.entity_typed_wikilink",
            decision_mode: "reviewed",
            required_evidence: ["source_revision", "source_coordinate", "target_identity"],
            working_projection: "approved_only",
            formal_consumers: ["topology", "relation_search"],
          },
        ],
        ...relationOverrides,
      },
    },
  };
}

describe("validateAssertionPolicies", () => {
  it("accepts a valid single policy", () => {
    const policies = [
      {
        source_kind: "typed_wikilink",
        producer: "extract_graph.entity_typed_wikilink",
        decision_mode: "reviewed",
        required_evidence: ["source_revision"],
        working_projection: "approved_only",
        formal_consumers: ["topology"],
      },
    ];
    const result = validateAssertionPolicies("TEST", policies);
    assert.equal(result.length, 1);
    assert.equal(result[0].sourceKind, "typed_wikilink");
    assert.equal(result[0].decisionMode, "reviewed");
    assert.equal(result[0].workingProjection, "approved_only");
  });

  it("rejects empty array", () => {
    assert.throws(
      () => validateAssertionPolicies("TEST", []),
      (e) => e.code === "ASSERTION_POLICY_MISSING",
    );
  });

  it("rejects non-array", () => {
    assert.throws(
      () => validateAssertionPolicies("TEST", null),
      (e) => e.code === "ASSERTION_POLICY_MISSING",
    );
  });

  it("buildCapabilityRegistry fails closed when assertion_policies are missing", () => {
    const ontology = minimalOntology({ assertion_policies: undefined });
    assert.throws(
      () => buildCapabilityRegistry(ontology),
      (e) => e.code === "ASSERTION_POLICY_MISSING",
    );
  });

  it("rejects duplicate (source_kind, producer)", () => {
    const dup = [
      { source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", required_evidence: ["source_revision"], working_projection: "approved_only", formal_consumers: ["topology"] },
      { source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", required_evidence: ["source_revision"], working_projection: "approved_only", formal_consumers: ["topology"] },
    ];
    assert.throws(
      () => validateAssertionPolicies("TEST", dup),
      (e) => e.code === "ASSERTION_POLICY_DUPLICATE",
    );
  });

  it("rejects unknown producer", () => {
    const bad = [
      { source_kind: "typed_wikilink", producer: "unknown.producer", decision_mode: "reviewed", working_projection: "approved_only" },
    ];
    assert.throws(
      () => validateAssertionPolicies("TEST", bad),
      (e) => e.code === "ASSERTION_POLICY_UNKNOWN_PRODUCER",
    );
  });

  it("rejects invalid decision_mode", () => {
    const bad = [
      { source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "auto_approve", working_projection: "approved_only" },
    ];
    assert.throws(
      () => validateAssertionPolicies("TEST", bad),
      (e) => e.code === "ASSERTION_POLICY_INVALID_DECISION_MODE",
    );
  });

  it("WP-006 6a：working_projection 派生只读——手写值被忽略（不校验不抛错），非发布模式派生 never", () => {
    const reviewed = [{ source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", working_projection: "always", required_evidence: ["source_revision"], formal_consumers: ["topology"] }];
    const normalized = validateAssertionPolicies("TEST", reviewed);
    assert.equal(normalized[0].workingProjection, "approved_only", "reviewed 派生 approved_only（手写 always 被忽略）");
    const never = [{ source_kind: "derived", producer: "extract_graph.multi-source-inference", decision_mode: "derived_only", required_evidence: [], formal_consumers: [] }];
    const normalizedNever = validateAssertionPolicies("TEST", never);
    assert.equal(normalizedNever[0].workingProjection, "never", "derived_only 派生 never（产线拒产闸的依据）");
  });

  it("rejects invalid source_kind", () => {
    const bad = [
      { source_kind: "magic", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", working_projection: "approved_only" },
    ];
    assert.throws(
      () => validateAssertionPolicies("TEST", bad),
      (e) => e.code === "ASSERTION_POLICY_INVALID_SOURCE_KIND",
    );
  });

  it("rejects production wildcard source_kind", () => {
    const wildcard = [
      { source_kind: "*", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", working_projection: "approved_only" },
    ];
    assert.throws(
      () => validateAssertionPolicies("TEST", wildcard),
      (e) => e.code === "ASSERTION_POLICY_INVALID_SOURCE_KIND",
    );
  });

  it("rejects a publishing policy without evidence or formal consumers", () => {
    const incomplete = [
      { source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", working_projection: "approved_only" },
    ];
    assert.throws(
      () => validateAssertionPolicies("TEST", incomplete),
      (e) => e.code === "ASSERTION_POLICY_INVALID_EVIDENCE",
    );
  });

  it("accepts forbidden decision_mode for legacy USES", () => {
    const policies = [
      { source_kind: "legacy_graph", producer: "legacy.uses_emission", decision_mode: "forbidden", required_evidence: [], working_projection: "never", formal_consumers: [] },
    ];
    const result = validateAssertionPolicies("USES", policies);
    assert.equal(result[0].decisionMode, "forbidden");
    assert.equal(result[0].workingProjection, "never");
  });

  it("accepts deterministic decision_mode", () => {
    const policies = [
      { source_kind: "category_path", producer: "category-path-projection.classification", decision_mode: "deterministic", required_evidence: ["category_path"], working_projection: "approved_only", formal_consumers: ["navigation"] },
    ];
    const result = validateAssertionPolicies("BELONGS_TO", policies);
    assert.equal(result[0].decisionMode, "deterministic");
  });
});

describe("resolveAssertionPolicy", () => {
  it("resolves exact match by (type, sourceKind, producer)", () => {
    const reg = buildCapabilityRegistry(minimalOntology());
    const policy = resolveAssertionPolicy(reg, "TEST_REL", "typed_wikilink", "extract_graph.entity_typed_wikilink");
    assert.notEqual(policy, null);
    assert.equal(policy.decisionMode, "reviewed");
    assert.equal(policy.workingProjection, "approved_only");
  });

  it("throws for an unknown relation type", () => {
    const reg = buildCapabilityRegistry(minimalOntology());
    assert.throws(
      () => resolveAssertionPolicy(reg, "UNKNOWN", "typed_wikilink", "extract_graph.entity_typed_wikilink"),
      (e) => e.code === "RELATION_ASSERTION_POLICY_UNKNOWN",
    );
  });

  it("throws when the source kind does not match", () => {
    const reg = buildCapabilityRegistry(minimalOntology());
    assert.throws(
      () => resolveAssertionPolicy(reg, "TEST_REL", "article_association", "extract_graph.entity_typed_wikilink"),
      (e) => e.code === "RELATION_ASSERTION_POLICY_UNKNOWN",
    );
  });

  it("throws when the producer does not match", () => {
    const reg = buildCapabilityRegistry(minimalOntology());
    assert.throws(
      () => resolveAssertionPolicy(reg, "TEST_REL", "typed_wikilink", "some.other.producer"),
      (e) => e.code === "RELATION_ASSERTION_POLICY_UNKNOWN",
    );
  });

  it("typed_wikilink only produces candidate (reviewed), never auto-approved", () => {
    const reg = buildCapabilityRegistry(minimalOntology());
    const policy = resolveAssertionPolicy(reg, "TEST_REL", "typed_wikilink", "extract_graph.entity_typed_wikilink");
    assert.equal(policy.decisionMode, "reviewed");
    assert.notEqual(policy.decisionMode, "deterministic");
    assert.notEqual(policy.decisionMode, "inherit_source_approval");
  });

  it("legacy USES with forbidden never enters formal consumers", () => {
    const ontology = minimalOntology({
      assertion_policies: [
        { source_kind: "legacy_graph", producer: "legacy.uses_emission", decision_mode: "forbidden", required_evidence: [], working_projection: "never", formal_consumers: [] },
      ],
    });
    const reg = buildCapabilityRegistry(ontology);
    const policy = resolveAssertionPolicy(reg, "TEST_REL", "legacy_graph", "legacy.uses_emission");
    assert.equal(policy.decisionMode, "forbidden");
    assert.equal(policy.workingProjection, "never");
    assert.equal(policy.formalConsumers.length, 0);
  });
});

describe("legacy policy isolation", () => {
  it("does not infer review from legacy_policy=keep", () => {
    const registry = buildCapabilityRegistry(minimalOntology({
      candidate_enabled: true,
      legacy_policy: "keep",
      assertion_policies: [{
        source_kind: "category_path",
        producer: "category-path-projection.classification",
        decision_mode: "deterministic",
        required_evidence: ["category_path"],
        working_projection: "approved_only",
        formal_consumers: ["navigation"],
      }],
    }));
    assert.equal(registry.relations.get("TEST_REL").requiresReview, false);
  });

  it("derives review from a reviewed assertion policy", () => {
    const registry = buildCapabilityRegistry(minimalOntology({ legacy_policy: "migrate" }));
    assert.equal(registry.relations.get("TEST_REL").requiresReview, true);
  });
});

describe("exports", () => {
  it("KNOWN_ASSERTION_PRODUCERS is a non-empty Set", () => {
    assert.ok(KNOWN_ASSERTION_PRODUCERS instanceof Set);
    assert.ok(KNOWN_ASSERTION_PRODUCERS.size > 0);
  });

  it("ALLOWED_DECISION_MODES contains all 5 modes", () => {
    assert.ok(ALLOWED_DECISION_MODES.has("reviewed"));
    assert.ok(ALLOWED_DECISION_MODES.has("inherit_source_approval"));
    assert.ok(ALLOWED_DECISION_MODES.has("deterministic"));
    assert.ok(ALLOWED_DECISION_MODES.has("derived_only"));
    assert.ok(ALLOWED_DECISION_MODES.has("forbidden"));
    assert.equal(ALLOWED_DECISION_MODES.size, 5);
  });

  it("ALLOWED_WORKING_PROJECTIONS contains approved_only and never", () => {
    assert.ok(ALLOWED_WORKING_PROJECTIONS.has("approved_only"));
    assert.ok(ALLOWED_WORKING_PROJECTIONS.has("never"));
    assert.equal(ALLOWED_WORKING_PROJECTIONS.size, 2);
  });

  it("ALLOWED_SOURCE_KINDS contains expected values", () => {
    assert.ok(ALLOWED_SOURCE_KINDS.has("typed_wikilink"));
    assert.ok(ALLOWED_SOURCE_KINDS.has("legacy_graph"));
    assert.ok(ALLOWED_SOURCE_KINDS.size >= 8);
  });
});
