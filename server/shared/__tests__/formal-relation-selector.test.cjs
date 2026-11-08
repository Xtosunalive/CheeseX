// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCapabilityRegistry } = require("../relation-capability-selector.cjs");
const {
  inspectFormalRelation,
  selectFormalRelations,
} = require("../formal-relation-selector.cjs");

function relationDefinition(overrides = {}) {
  return {
    direction: "A -> B",
    weight_default: 1,
    semantic_role: "architecture_skeleton",
    candidate_enabled: true,
    fact_encoding: "typed_wikilink",
    projected: true,
    versionable: true,
    impact_propagation: "reverse",
    legacy_policy: "keep",
    assertion_policies: [{
      source_kind: "typed_wikilink",
      producer: "extract_graph.entity_typed_wikilink",
      decision_mode: "reviewed",
      required_evidence: ["source_revision", "source_coordinate", "target_identity"],
      working_projection: "approved_only",
      formal_consumers: ["topology", "relation_search", "impact_analysis"],
    }],
    ...overrides,
  };
}

function registry() {
  return buildCapabilityRegistry({
    relation_types: {
      DEPENDS_ON: relationDefinition(),
      REFERENCES: relationDefinition({
        semantic_role: "weak_semantic",
        candidate_enabled: false,
        fact_encoding: "wikilink",
        versionable: false,
        impact_propagation: "none",
        assertion_policies: [{
          source_kind: "wikilink",
          producer: "extract_graph.plain_wikilink",
          decision_mode: "inherit_source_approval",
          required_evidence: ["source_revision", "source_coordinate"],
          working_projection: "approved_only",
          formal_consumers: ["topology", "relation_search"],
        }],
      }),
      BELONGS_TO: relationDefinition({
        semantic_role: "category_navigation",
        candidate_enabled: false,
        fact_encoding: "category_path",
        versionable: false,
        impact_propagation: "none",
        assertion_policies: [{
          source_kind: "category_path",
          producer: "category-path-projection.classification",
          decision_mode: "deterministic",
          required_evidence: ["source_revision", "category_path"],
          working_projection: "approved_only",
          formal_consumers: ["navigation"],
        }],
      }),
    },
  });
}

function approved(overrides = {}) {
  return {
    edgeId: "edge-a",
    from: "a",
    to: "b",
    relationType: "DEPENDS_ON",
    reviewStatus: "approved",
    // K-P0-4（2026-09-10）：reviewed 决策模式下 approved 必须携带人类归属，
    // 否则闸门以 APPROVAL_NOT_HUMAN 拒绝（负例见文件尾「机器自盖 approved」用例）。
    assertedBy: { actorId: "local-architect", actorType: "human" },
    freshness: { status: "fresh" },
    assertion: {
      sourceKind: "typed_wikilink",
      producer: "extract_graph.entity_typed_wikilink",
      evidence: {
        sourceRevision: "sha256:source",
        sourceCoordinate: "path:a.md#line:4",
        targetIdentity: "b",
      },
    },
    ...overrides,
  };
}

test("selects explicitly approved relations; stale 过滤，缺失/unknown freshness 放行（管道不打 freshness）", () => {
  const relations = [
    approved(),
    approved({ edgeId: "pending", reviewStatus: "pending" }),
    approved({ edgeId: "rejected", reviewStatus: "rejected" }),
    approved({ edgeId: "stale", freshness: { status: "stale" } }),
    approved({ edgeId: "unknown-freshness", freshness: { status: "unknown" } }),
    approved({ edgeId: "missing-freshness", freshness: undefined }),
    approved({ edgeId: "missing-status", reviewStatus: undefined }),
    approved({ edgeId: "missing-evidence", assertion: { sourceKind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", evidence: {} } }),
    approved({ edgeId: "unknown-producer", assertion: { ...approved().assertion, producer: "unregistered.default" } }),
    approved({ edgeId: "unknown-policy", relationType: "UNKNOWN" }),
  ];

  // edge-a（fresh）、unknown-freshness、missing-freshness 都放行（仅 stale 被过滤）
  assert.deepEqual(
    selectFormalRelations(registry(), relations, "topology").map((edge) => edge.edgeId),
    ["edge-a", "unknown-freshness", "missing-freshness"],
  );
  assert.equal(inspectFormalRelation(registry(), relations[3], "topology").reason, "RELATION_NOT_FRESH");
  assert.equal(inspectFormalRelation(registry(), relations[6], "topology").reason, "APPROVAL_STATUS_NOT_ALLOWED");
  assert.equal(inspectFormalRelation(registry(), relations[7], "topology").reason, "REQUIRED_EVIDENCE_MISSING");
  assert.equal(inspectFormalRelation(registry(), relations[8], "topology").reason, "ASSERTION_POLICY_UNRESOLVED");
});

test("policy consumer list controls visibility and never infers impact eligibility", () => {
  const reference = approved({
    edgeId: "reference",
    relationType: "REFERENCES",
    assertion: {
      sourceKind: "wikilink",
      producer: "extract_graph.plain_wikilink",
      evidence: { sourceRevision: "sha256:source", sourceCoordinate: "path:a.md#line:8" },
    },
  });
  assert.deepEqual(selectFormalRelations(registry(), [reference], "topology"), [reference]);
  assert.deepEqual(selectFormalRelations(registry(), [reference], "impact_analysis"), []);
});

test("preserves parallel approved assertions and unique entity identity without synthesizing containment relations", () => {
  const first = approved({ edgeId: "edge-a", assertion: { ...approved().assertion, evidence: { ...approved().assertion.evidence, sourceCoordinate: "path:a.md#line:4" } } });
  const second = approved({ edgeId: "edge-b", assertion: { ...approved().assertion, evidence: { ...approved().assertion.evidence, sourceCoordinate: "path:a.md#line:9" } } });
  const entities = [{ id: "shared", parent_id: "root" }];

  assert.deepEqual(selectFormalRelations(registry(), [first, second], "topology"), [first, second]);
  assert.equal(entities.length, 1);
  assert.deepEqual(selectFormalRelations(registry(), [], "navigation"), []);
});

test("deterministic policy still requires an explicit status, fresh evidence and registered producer", () => {
  const base = {
    edgeId: "category",
    from: "article",
    to: "domain",
    relationType: "BELONGS_TO",
    assertionStatus: "deterministic",
    freshness: "fresh",
    assertion: {
      sourceKind: "category_path",
      producer: "category-path-projection.classification",
      evidence: { sourceRevision: "sha256:source", categoryPath: "ops.maintain" },
    },
  };
  assert.deepEqual(selectFormalRelations(registry(), [base], "navigation"), [base]);
  assert.deepEqual(selectFormalRelations(registry(), [{ ...base, assertionStatus: undefined }], "navigation"), []);
  assert.deepEqual(selectFormalRelations(registry(), [{ ...base, assertion: { ...base.assertion, sourceKind: "parent_id" } }], "navigation"), []);
});

test("accepts normalized top-level pipeline metadata with a path and line coordinate", () => {
  const edge = {
    from: "a", to: "b", relationType: "DEPENDS_ON", reviewStatus: "approved",
    assertedBy: { actorId: "local-architect", actorType: "human" }, // K-P0-4：reviewed 模式需人类归属
    freshness: { status: "fresh" }, sourceKind: "typed_wikilink",
    producer: "extract_graph.entity_typed_wikilink", sourceRevision: "sha256:source",
    sourceFile: "知识库/wiki/entities/a.md", lineNumber: 4,
  };
  assert.deepEqual(selectFormalRelations(registry(), [edge], "impact_analysis"), [edge]);
});

// ── 真实管道字段布局（字段层 + 白名单层修复的红灯→绿灯测试）─────────────
// 真实 extract_graph 边：source_kind 写在 properties.source、producer 写在
// properties.ruleId（部分边无 ruleId），证据用 sourceHash / inputCoordinates /
// sources[].file——全部不是 selector 原本认的 sourceKind / producer /
// sourceRevision / sourceCoordinate。修复前（字段层未回退 + 白名单零交集）
// 该测试必须失败（红灯）；修复后全部放行（绿灯）。
function pipelineRegistry() {
  return buildCapabilityRegistry({
    relation_types: {
      DEPENDS_ON: relationDefinition({
        assertion_policies: [
          {
            source_kind: "auto-discovered",
            producer: "extract_graph.auto-discovered",
            decision_mode: "reviewed",
            required_evidence: ["source_revision", "source_coordinate", "target_identity"],
            working_projection: "approved_only",
            formal_consumers: ["topology", "relation_search", "impact_analysis"],
          },
          {
            source_kind: "entity-wikilink",
            producer: "extract_graph.entity_typed_wikilink",
            decision_mode: "reviewed",
            required_evidence: ["source_revision", "source_coordinate", "target_identity"],
            working_projection: "approved_only",
            formal_consumers: ["topology", "relation_search", "impact_analysis"],
          },
          {
            source_kind: "multi-source-inference",
            producer: "extract_graph.multi-source-inference",
            decision_mode: "reviewed",
            required_evidence: ["source_revision", "source_coordinate", "target_identity"],
            working_projection: "approved_only",
            formal_consumers: ["topology", "relation_search", "impact_analysis"],
          },
          {
            source_kind: "document-body",
            producer: "extract_graph.plain_wikilink",
            decision_mode: "inherit_source_approval",
            required_evidence: ["source_revision", "source_coordinate"],
            working_projection: "approved_only",
            formal_consumers: ["topology", "relation_search"],
          },
        ],
      }),
    },
  });
}

test("真实管道字段布局：properties.source/ruleId + sourceHash/inputCoordinates 放行，无 ruleId 三类边显式兜底", () => {
  const registry = pipelineRegistry();
  const edges = [
    // 1. auto-discovered：ruleId 存在（extract_graph.auto-discovered），坐标走 inputCoordinates 的 #line 项
    {
      edgeId: "pipeline-auto", from: "a", to: "b", relationType: "DEPENDS_ON", reviewStatus: "approved",
      assertedBy: { actorId: "local-architect", actorType: "human" }, // K-P0-4：reviewed 模式需人类归属
      properties: {
        source: "auto-discovered",
        ruleId: "extract_graph.auto-discovered",
        reviewStatus: "approved",
        inputCoordinates: ["vault:知识库/wiki/entities/a.md#line:4", "vault:知识库/wiki/entities/b.md#node:b"],
      },
      sourceHash: "sha256:source",
    },
    // 2. entity-wikilink：无 ruleId → 兜底 extract_graph.entity_typed_wikilink，坐标走 sources[].file
    {
      edgeId: "pipeline-wikilink", from: "a", to: "b", relationType: "DEPENDS_ON",
      assertedBy: { actorId: "local-architect", actorType: "human" }, // K-P0-4：reviewed 模式需人类归属
      properties: {
        source: "entity-wikilink",
        reviewStatus: "approved",
        sources: [{ file: "知识库/wiki/entities/a.md", source_hash: "sha256:source", method: "entity_wikilink", line_number: 4 }],
      },
      sourceHash: "sha256:source",
    },
    // 3. multi-source-inference：无 ruleId → 兜底 extract_graph.multi-source-inference
    {
      edgeId: "pipeline-multi", from: "a", to: "b", relationType: "DEPENDS_ON",
      assertedBy: { actorId: "local-architect", actorType: "human" }, // K-P0-4：reviewed 模式需人类归属
      properties: {
        source: "multi-source-inference",
        reviewStatus: "approved",
        sources: [{ file: "知识库/wiki/entities/a.md", source_hash: "sha256:source" }],
      },
      sourceHash: "sha256:source",
    },
    // 4. document-body：无 ruleId → 兜底 extract_graph.plain_wikilink（对齐 ontology REFERENCES wikilink 政策）
    {
      edgeId: "pipeline-docbody", from: "a", to: "b", relationType: "DEPENDS_ON",
      assertedBy: { actorId: "local-architect", actorType: "human" },
      properties: {
        source: "document-body",
        reviewStatus: "approved",
        sources: [{ file: "知识库/wiki/entities/a.md", source_hash: "sha256:source" }],
      },
      sourceHash: "sha256:source",
    },
  ];

  assert.deepEqual(
    selectFormalRelations(registry, edges, "topology").map((edge) => edge.edgeId),
    ["pipeline-auto", "pipeline-wikilink", "pipeline-multi", "pipeline-docbody"],
  );

  // fail-closed：未知 source_kind 且无 ruleId → 无 wildcard 兜底，仍被滤（规则 32）
  const unknown = {
    edgeId: "pipeline-unknown", from: "a", to: "b", relationType: "DEPENDS_ON", reviewStatus: "approved",
    properties: {
      source: "mystery-source",
      reviewStatus: "approved",
      sources: [{ file: "知识库/wiki/entities/a.md", source_hash: "sha256:source" }],
    },
    sourceHash: "sha256:source",
  };
  assert.deepEqual(selectFormalRelations(registry, [unknown], "topology"), []);
  assert.equal(inspectFormalRelation(registry, unknown, "topology").reason, "ASSERTION_POLICY_UNRESOLVED");
});

// ── K-P0-4（2026-09-10）：reviewed 决策模式下机器自盖 approved 不再等同人审 ─────────────
// 负例（失败路径，规则 28）：status=approved 但缺失/非 human 归属 → APPROVAL_NOT_HUMAN 拒绝。
// 背景 ADR054 D2：管道曾给 30 条边自盖 approved 谎报人审；闸门必须只认 actorType==="human"。
test("K-P0-4 负例：reviewed 模式下机器 approved（无归属/actorType=rule）被 APPROVAL_NOT_HUMAN 拒绝", () => {
  const machineApprovedNoActor = approved({ edgeId: "machine-no-actor" });
  delete machineApprovedNoActor.assertedBy;
  const machineApprovedByRule = approved({ edgeId: "machine-rule", assertedBy: { actorId: "extract_graph", actorType: "rule" } });

  assert.deepEqual(selectFormalRelations(registry(), [machineApprovedNoActor, machineApprovedByRule], "topology"), []);
  assert.equal(inspectFormalRelation(registry(), machineApprovedNoActor, "topology").reason, "APPROVAL_NOT_HUMAN");
  assert.equal(inspectFormalRelation(registry(), machineApprovedByRule, "topology").reason, "APPROVAL_NOT_HUMAN");
  assert.equal(inspectFormalRelation(registry(), machineApprovedByRule, "topology").actorType, "rule");

  // deterministic 模式不受影响：approved 无需人类归属（该模式本就不依赖人审语义）
  const deterministicApproved = {
    edgeId: "category", from: "article", to: "domain", relationType: "BELONGS_TO",
    assertionStatus: "deterministic", freshness: "fresh",
    assertion: {
      sourceKind: "category_path", producer: "category-path-projection.classification",
      evidence: { sourceRevision: "sha256:source", categoryPath: "ops.maintain" },
    },
  };
  assert.deepEqual(selectFormalRelations(registry(), [deterministicApproved], "navigation"), [deterministicApproved]);
});
