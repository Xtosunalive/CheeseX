const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeRelationCandidate } = require("../governance/relation-candidate-contract.cjs");

const HASH_A = `sha256:${"a".repeat(64)}`;

function evidence(overrides = {}) {
  return {
    sourceKind: "typed_wikilink",
    producer: "extract_graph.entity_typed_wikilink",
    coordinate: "line:4",
    sourcePath: "知识库/wiki/entities/api.md",
    snippet: "依赖::[[database]]",
    contentHash: HASH_A,
    sourceRevision: `sha256:${"b".repeat(64)}`,
    ruleRevision: "B04",
    modelRevision: null,
    policyRevision: "assertion-policy-registry",
    ...overrides,
  };
}

function triple(overrides = {}) {
  return {
    sourceNodeId: "api",
    relationType: "DEPENDS_ON",
    targetNodeId: "database",
    direction: "outgoing",
    relationTypeStatus: "known",
    sourceEndpointStatus: "known",
    targetEndpointStatus: "known",
    evidence: [evidence()],
    ...overrides,
  };
}

test("candidate identities are stable while directions, types and shared evidence are preserved", () => {
  const shared = evidence();
  const triples = [
    triple({ evidence: [shared] }),
    triple({ relationType: "BACKS_UP", direction: "incoming", evidence: [shared] }),
    triple({ relationType: "CONNECTS_TO", direction: "bidirectional", evidence: [evidence({ coordinate: "line:8", snippet: "连接::[[database]]" })] }),
  ];
  const first = normalizeRelationCandidate({ triples });
  const reversed = normalizeRelationCandidate({ triples: [...triples].reverse() });

  assert.equal(first.candidateId, reversed.candidateId);
  assert.equal(first.candidateHash, reversed.candidateHash);
  assert.equal(first.evidenceSetHash, reversed.evidenceSetHash);
  assert.equal(first.sourceSetHash, reversed.sourceSetHash);
  assert.deepEqual(first.triples.map((item) => item.direction), ["outgoing", "incoming", "bidirectional"]);
  assert.equal(first.triples.flatMap((item) => item.evidence).length, 3);
  assert.equal(first.candidateStatus, "review_required");
  assert.equal(first.triples.every((item) => item.assertionPolicyStatus === "unregistered"), true);
});

test("unknown relation text remains explicit and never falls back to RELATED", () => {
  const candidate = normalizeRelationCandidate({ triples: [triple({
    relationType: "自定义依赖",
    relationTypeStatus: "unknown",
    targetEndpointStatus: "unknown",
  })] });
  assert.equal(candidate.triples[0].relationType, "自定义依赖");
  assert.notEqual(candidate.triples[0].relationType, "RELATED");
  assert.equal(candidate.candidateStatus, "review_required");
  assert.equal(candidate.triples[0].assertionPolicyStatus, "unregistered");
});

test("the unique assertion registry marks only exact source and producer matches", () => {
  const registry = { relations: new Map([["DEPENDS_ON", { assertionPolicies: [{ sourceKind: "typed_wikilink", producer: "extract_graph.entity_typed_wikilink" }] }]]) };
  const matched = normalizeRelationCandidate({ triples: [triple()] }, { registry });
  assert.equal(matched.triples[0].assertionPolicyStatus, "matched");
  const unregistered = normalizeRelationCandidate({ triples: [triple({ evidence: [evidence({ producer: "wrong.producer" })] })] }, { registry });
  assert.equal(unregistered.triples[0].assertionPolicyStatus, "unregistered");
  assert.equal(unregistered.candidateStatus, "review_required");
});

test("candidate evidence fails closed when any required field is missing", () => {
  for (const field of ["sourceKind", "producer", "coordinate", "contentHash", "sourceRevision"]) {
    const invalidEvidence = evidence();
    delete invalidEvidence[field];
    assert.throws(
      () => normalizeRelationCandidate({ triples: [triple({ evidence: [invalidEvidence] })] }),
      (error) => error.code === "RELATION_CANDIDATE_INVALID",
      field,
    );
  }
  assert.throws(() => normalizeRelationCandidate({ triples: [triple({ evidence: [] })] }), { code: "RELATION_EVIDENCE_MISSING" });
});

test("candidate input cannot claim a winner, approval or Proposal-owned rejection", () => {
  assert.throws(() => normalizeRelationCandidate({ winnerTripleId: "winner", triples: [triple()] }), { code: "RELATION_CANDIDATE_AUTO_WINNER" });
  assert.throws(() => normalizeRelationCandidate({ triples: [triple({ approved: true })] }), { code: "RELATION_CANDIDATE_AUTO_APPROVAL" });
  assert.throws(() => normalizeRelationCandidate({ candidateStatus: "rejected", triples: [triple()] }), { code: "RELATION_CANDIDATE_AUTO_REJECTION" });
  assert.throws(() => normalizeRelationCandidate({ triples: [triple({ direction: "sideways" })] }), { code: "RELATION_CANDIDATE_INVALID" });
});

test("a candidate cannot combine unrelated node pairs into one conflict group", () => {
  assert.throws(() => normalizeRelationCandidate({ triples: [
    triple(),
    triple({ sourceNodeId: "other", targetNodeId: "third" }),
  ] }), { code: "RELATION_CONFLICT_GROUP_MISMATCH" });
});
