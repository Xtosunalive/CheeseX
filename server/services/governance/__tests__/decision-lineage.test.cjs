const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeLineage, stableDecisionId } = require("../../../shared/decision-lineage.cjs");
const { createDecisionEvidenceService } = require("../decision-evidence-service.cjs");

const base = {
  source: { kind: "relation", path: "知识库/wiki/entities/a.md", contentHash: "sha256:a", lineNumber: 12, coordinate: "relation:a|依赖|b" },
  rule: { ruleId: "typed-wikilink", ruleRevision: "sha256:rules", reasonCode: "RELATION_SOURCE" },
  scope: { product: "AnyShare", version: "7.0.6.8" },
  decision: { decisionId: "decision-1", operatorId: "local-architect", kind: "automatic", decidedAt: "2026-07-19T00:00:00.000Z" },
  freshness: { status: "fresh", checkedAt: "2026-07-19T00:00:00.000Z" },
};

test("normalizes source, rule, scope, decision, and freshness", () => {
  const result = normalizeLineage(base);
  assert.equal(result.source.lineNumber, 12);
  assert.equal(result.rule.reasonCode, "RELATION_SOURCE");
  assert.equal(result.scope.version, "7.0.6.8");
  assert.equal(result.decision.operatorId, "local-architect");
});

test("rejects serialized literal artifacts and malformed coordinates", () => {
  assert.throws(() => normalizeLineage({ ...base, source: { ...base.source, contentHash: "['bad']" } }), /serialized literal/);
  assert.throws(() => normalizeLineage({ ...base, source: { ...base.source, lineNumber: 0 } }), /positive integer/);
});

test("builds deterministic automatic decision evidence", () => {
  const service = createDecisionEvidenceService({ now: () => new Date("2026-07-19T00:00:00.000Z") });
  const generatedInput = { ...base, decision: { ...base.decision, decisionId: undefined } };
  const first = service.build(generatedInput);
  const second = service.build(generatedInput);
  assert.equal(first.decision.decisionId, second.decision.decisionId);
  assert.equal(first.decision.decisionId, stableDecisionId(["relation:a|依赖|b", "typed-wikilink", "AnyShare", "7.0.6.8"]));
});
