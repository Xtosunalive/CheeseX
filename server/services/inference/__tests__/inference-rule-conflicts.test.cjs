const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRuleConflicts } = require("../inference-rule-conflicts.cjs");

const rules = [
  { id: "require-change", scope: "reasoning" },
  { id: "waive-change", scope: "reasoning" },
];

function candidates() {
  return [
    { ruleId: "require-change", subjectNodeId: "svc-a", conclusionKey: "requires-change", effect: "ASSERT", evidence: ["a", "b"] },
    { ruleId: "waive-change", subjectNodeId: "svc-a", conclusionKey: "requires-change", effect: "WAIVE", evidence: ["policy-1"] },
  ];
}

test("detects opposing reasoning conclusions with a stable identity", () => {
  const first = detectRuleConflicts({ rules, candidateConclusions: candidates(), existing: [] });
  const reversed = detectRuleConflicts({ rules: [...rules].reverse(), candidateConclusions: [...candidates()].reverse(), existing: [] });
  assert.equal(first.length, 1);
  assert.equal(first[0].code, "RULES_CONFLICT");
  assert.equal(first[0].conflictId, reversed[0].conflictId);
  assert.deepEqual(first[0].ruleIds, ["require-change", "waive-change"]);
});

test("collapses duplicate conclusions and returns deterministic ordering", () => {
  const more = [
    ...candidates(), candidates()[0],
    { ruleId: "require-change", subjectNodeId: "svc-b", conclusionKey: "requires-change", effect: "ASSERT" },
    { ruleId: "waive-change", subjectNodeId: "svc-b", conclusionKey: "requires-change", effect: "BLOCK" },
  ];
  const result = detectRuleConflicts({ rules, candidateConclusions: more, existing: [] });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.subjectNodeId), ["svc-a", "svc-b"]);
  assert.equal(result[0].conclusions.length, 2);
});

test("preserves an existing human resolution while refreshing evidence", () => {
  const detected = detectRuleConflicts({ rules, candidateConclusions: candidates(), existing: [] })[0];
  const existing = [{ ...detected, status: "resolved", resolution: "waive", resolvedBy: "alice", resolvedAt: "2026-07-13T00:00:00.000Z" }];
  const refreshed = detectRuleConflicts({ rules, candidateConclusions: candidates(), existing })[0];
  assert.equal(refreshed.status, "resolved");
  assert.equal(refreshed.resolvedBy, "alice");
  assert.equal(refreshed.resolution, "waive");
});

test("rejects entity-compliance rules outside the reasoning boundary", () => {
  assert.throws(() => detectRuleConflicts({ rules: [{ id: "F01", scope: "entity-compliance" }], candidateConclusions: [], existing: [] }), /reasoning rules only/);
});
