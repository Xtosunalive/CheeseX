const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createChangeDispositionService } = require("../../governance/change-disposition-service.cjs");
const { createInferenceConflictStore } = require("../inference-conflict-store.cjs");
const { detectRuleConflicts } = require("../inference-rule-conflicts.cjs");
const { createInferenceDecisionConsumer } = require("../inference-decision-consumer.cjs");

function fixture() {
  return { affectedVersions: [
    { product: "AnyShare", version: "7.0.6.8", status: "released", componentIds: ["gateway"], removed: [{ source: "gateway", type: "DEPENDS_ON", target: "auth" }], paths: [{ nodeIds: ["gateway", "auth"] }], documents: [{ articleId: "ART-1", sourceHash: "sha256:article" }] },
    { product: "AnyShare", version: "7.0.6.9", status: "draft", componentIds: ["gateway"], removed: [], paths: [], documents: [], stale: true },
  ] };
}

function setup() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "change-disposition-"));
  const conflictStore = createInferenceConflictStore({ vaultPath });
  return { vaultPath, conflictStore, service: createChangeDispositionService({ conflictStore, conflictDetector: detectRuleConflicts, decisionConsumer: createInferenceDecisionConsumer() }) };
}

test("persists an opposing production conflict and blocks unresolved writes", (t) => {
  const env = setup(); t.after(() => fs.rmSync(env.vaultPath, { recursive: true, force: true }));
  const evaluation = env.service.evaluate(fixture());
  assert.equal(evaluation.candidates.length, 2);
  assert.equal(evaluation.conflicts.length, 1);
  assert.equal(evaluation.status, "conflicted");
  assert.equal(evaluation.writeAllowed, false);
  assert.throws(() => env.service.assertWriteAllowed(evaluation), (error) => error.code === "REASONING_CONFLICT_UNRESOLVED" && error.status === 409);
  assert.equal(env.conflictStore.list()[0].sourceRevision, evaluation.sourceRevision);
});

test("keeps historical resolved decisions audit-only and blocks writes", (t) => {
  const env = setup(); t.after(() => fs.rmSync(env.vaultPath, { recursive: true, force: true }));
  const initial = env.service.evaluate(fixture());
  const conflict = env.conflictStore.list()[0];
  env.conflictStore.review(conflict.conflictId, {
    action: "resolve", reviewer: "local-architect", operatorId: "local-architect", reason: "允许进入变更处置",
    decision: { decision: "select_effect", selectedEffect: "ASSERT", selectedRuleIds: ["CHANGE_REQUIRED_RELEASED_USAGE"], reasonCode: "MANUAL_CHANGE_APPROVAL", sourceRevision: initial.sourceRevision },
  });
  const blocked = env.service.evaluate(fixture());
  assert.notEqual(blocked.status, "change_required");
  assert.equal(blocked.writeAllowed, false);
  assert.throws(() => env.service.assertWriteAllowed(blocked), (error) => error.code === "REASONING_CONFLICT_UNRESOLVED");

  const changed = fixture();
  changed.affectedVersions[0].documents.push({ articleId: "ART-2", sourceHash: "sha256:new" });
  const stale = env.service.evaluate(changed);
  assert.equal(stale.status, "stale");
  assert.equal(stale.writeAllowed, false);
  assert.throws(() => env.service.assertWriteAllowed(stale), (error) => error.code === "REASONING_CONFLICT_UNRESOLVED");
});

test("allows empty and uncontested safe evaluations without manual conflict", (t) => {
  const env = setup(); t.after(() => fs.rmSync(env.vaultPath, { recursive: true, force: true }));
  assert.equal(env.service.evaluate({ affectedVersions: [] }).writeAllowed, true);
  const waived = env.service.evaluate({ affectedVersions: [{ product: "AnyShare", version: "8.0", status: "draft", componentIds: ["gateway"], removed: [], paths: [], documents: [] }] });
  assert.equal(waived.status, "waived");
  assert.equal(waived.writeAllowed, true);
});
