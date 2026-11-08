// WP-006 第1项：candidate_enabled 接线——候选合同对「禁候选类型」422 拒收（API 边界结构闸）。
// 层级：纯单元（最小注册表直喂 normalizeRelationCandidate）。
const test = require("node:test");
const assert = require("node:assert");
const { normalizeRelationCandidate } = require("../relation-candidate-contract.cjs");
const { buildCapabilityRegistry } = require("../../../shared/relation-capability-selector.cjs");

function registry() {
  return buildCapabilityRegistry({
    relation_types: {
      DEPENDS_ON: {
        description: "", label_cn: "", direction: "directed", weight_default: 1, weight_range: [0, 1],
        versionable: true, candidate_enabled: true, fact_encoding: "typed_wikilink", projected: true, semantic_role: "architecture_skeleton",
        impact_propagation: "reverse", legacy_policy: "keep", source_types: [], target_types: [],
        assertion_policies: [{ source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", required_evidence: ["source_revision", "source_coordinate", "target_identity"], working_projection: "approved_only", formal_consumers: ["topology"] }],
      },
      BELONGS_TO: {
        description: "", label_cn: "", direction: "directed", weight_default: 1, weight_range: [0, 1],
        versionable: false, candidate_enabled: false, fact_encoding: "category_path", projected: true, semantic_role: "category_navigation",
        impact_propagation: "none", legacy_policy: "keep", source_types: [], target_types: [],
        assertion_policies: [{ source_kind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink", decision_mode: "reviewed", required_evidence: ["source_revision", "source_coordinate", "target_identity"], working_projection: "approved_only", formal_consumers: ["topology"] }],
      },
    },
  });
}

function rawCandidate(relationType) {
  return {
    triples: [{
      sourceNodeId: "node-a",
      relationType,
      targetNodeId: "node-b",
      direction: "outgoing",
      evidence: [{
        sourcePath: "知识库/wiki/entities/a.md",
        sourceRevision: "sha256:" + "a".repeat(64),
        sourceKind: "typed_wikilink",
        producer: "extract_graph.entity_typed_wikilink",
        coordinate: "a.md#L3",
        contentHash: "sha256:" + "b".repeat(64),
        snippet: "[[依赖:b]]",
      }],
    }],
  };
}

test("禁候选类型（candidate_enabled=false）→ 422 RELATION_CANDIDATE_TYPE_DISABLED", () => {
  assert.throws(
    () => normalizeRelationCandidate(rawCandidate("BELONGS_TO"), { registry: registry() }),
    (error) => error.code === "RELATION_CANDIDATE_TYPE_DISABLED" && error.status === 422,
  );
});

test("可候选类型（candidate_enabled=true）照常入合同", () => {
  const candidate = normalizeRelationCandidate(rawCandidate("DEPENDS_ON"), { registry: registry() });
  assert.equal(candidate.triples[0].relationType, "DEPENDS_ON");
  assert.ok(candidate.candidateId.startsWith("relcand"));
});

test("无注册表时闸不咬（既有 null 行为不变——fail-open 限于无声明场景）", () => {
  const candidate = normalizeRelationCandidate(rawCandidate("BELONGS_TO"), { registry: null });
  assert.equal(candidate.triples[0].relationType, "BELONGS_TO");
});
