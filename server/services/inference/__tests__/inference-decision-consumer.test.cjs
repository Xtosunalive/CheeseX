const assert = require("node:assert/strict");
const test = require("node:test");
const { createInferenceDecisionConsumer } = require("../inference-decision-consumer.cjs");

const candidates = [
  { ruleId: "CHANGE_REQUIRED_RELEASED_USAGE", effect: "ASSERT" },
  { ruleId: "CHANGE_BLOCKED_STALE_SOURCE", effect: "BLOCK" },
];

test("unresolved opposite conclusions block writes", () => {
  const consumer = createInferenceDecisionConsumer();
  const result = consumer.consume({ candidates });
  assert.deepEqual({ status: result.status, writeAllowed: result.writeAllowed }, { status: "conflicted", writeAllowed: false });
  assert.throws(() => consumer.assertWriteAllowed(result), /REASONING_CONFLICT_UNRESOLVED/);
});

test("structured BLOCK decision is consumed instead of only marked resolved", () => {
  const result = createInferenceDecisionConsumer().consume({ candidates, sourceRevision: "sha256:source", decision: { decision: "select_effect", selectedEffect: "BLOCK", selectedRuleIds: ["CHANGE_BLOCKED_STALE_SOURCE"], reasonCode: "SOURCE_NOT_FRESH", sourceRevision: "sha256:source" } });
  assert.deepEqual({ status: result.status, effect: result.effect, writeAllowed: result.writeAllowed }, { status: "blocked", effect: "BLOCK", writeAllowed: false });
});

test("stale structured decision cannot be reused", () => {
  const result = createInferenceDecisionConsumer().consume({ candidates: [{ ruleId: "r", effect: "ASSERT" }], sourceRevision: "sha256:new", decision: { decision: "select_effect", selectedEffect: "ASSERT", selectedRuleIds: ["r"], sourceRevision: "sha256:old" } });
  assert.equal(result.status, "stale");
});
