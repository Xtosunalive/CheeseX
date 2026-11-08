const assert = require("node:assert/strict");
const test = require("node:test");
const { createAnomalyActionAdapter } = require("../anomaly-action-adapter.cjs");

function entityIssue(issueKind = "missing_field") {
  return {
    issueId: `${issueKind}-1`, issueKind, expectedRevisions: { sourceRevision: { contentHash: "sha256:source", size: 10, mtimeMs: 1 } },
    proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/a.md", field: issueKind === "version_scope" ? "arch_since" : "arch_layer" },
  };
}

test("previews entity-backed missing and version issues and confirms through a direct formal-Vault apply", () => {
  const calls = [];
  let applyCalls = 0;
  const adapter = createAnomalyActionAdapter({
    entityRepairService: {
      preview: (input) => { calls.push(["preview", input]); return { previewId: "entity-preview", sourceKey: input.sourceKey, changedFields: Object.keys(input.changes), preCheck: { blockerCount: 1, warningCount: 2 }, postCheck: { blockerCount: 0, warningCount: 1 } }; },
      apply: (input) => { applyCalls += 1; calls.push(["apply", input]); return { writtenFields: ["arch_layer"], sourceRevision: { contentHash: "sha256:after" } }; },
    },
  });
  for (const issueKind of ["missing_field", "version_scope"]) {
    const issue = entityIssue(issueKind);
    const field = issue.proposedAction.field;
    const preview = adapter.preview(issue, { changes: { [field]: field === "arch_since" ? "7.0.6.8" : "service" } });
    assert.equal(preview.accepted, true);
    assert.equal(preview.summary.beforeValues[field], null);
    assert.equal(preview.summary.afterValues[field], field === "arch_since" ? "7.0.6.8" : "service");
    assert.equal(preview.summary.preCheck.blockerCount, 1);
    assert.equal(preview.adapter, "direct-apply");
    assert.equal(preview.token.previewId, "entity-preview");
    const confirmed = adapter.execute({ ...issue, actionPreview: preview });
    assert.equal(confirmed.accepted, true);
    assert.equal(confirmed.adapter, "direct-apply");
    assert.deepEqual(confirmed.result.writtenFields, ["arch_layer"]);
  }
  assert.equal(calls.filter(([operation]) => operation === "preview").length, 2);
  assert.equal(calls.filter(([operation]) => operation === "apply").length, 2);
  assert.equal(applyCalls, 2, "Entity confirmation must apply directly to the formal Vault (ADR043)");
});

test("previews a missing entity and confirms creation through a direct apply", () => {
  let received = null;
  let applyCalls = 0;
  const adapter = createAnomalyActionAdapter({
    entityRepairService: {
      preview: (input) => { received = input; return { previewId: "create-preview", sourceKey: input.sourceKey, changedFields: ["title"], preCheck: { blockerCount: 1 }, postCheck: { blockerCount: 0 } }; },
      apply: (input) => { applyCalls += 1; return { writtenFields: ["title"], creating: true }; },
    },
  });
  const issue = {
    issueId: "missing-entity-1",
    issueKind: "missing_entity",
    expectedRevisions: { sourceRevision: "MySQL" },
    proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/MySQL.md", field: "module_entity", expected: "MySQL" },
  };
  const preview = adapter.preview(issue, { changes: { module_entity: "MySQL" } });
  assert.deepEqual(received, { sourceKey: "知识库/wiki/entities/MySQL.md", createIfMissing: true, initialTitle: "MySQL", changes: { title: "MySQL" } });
  assert.equal(preview.accepted, true);
  assert.equal(preview.adapter, "direct-apply");
  assert.equal(preview.summary.beforeValues.title, null);
  assert.equal(preview.summary.afterValues.title, "MySQL");
  const confirmed = adapter.execute({ ...issue, actionPreview: preview });
  assert.equal(confirmed.accepted, true);
  assert.equal(confirmed.result.creating, true);
  assert.equal(applyCalls, 1, "missing Entity confirmation must apply to the formal Vault");
});

test("previews relation repair with the entity service and executes through a direct apply", () => {
  let received = null;
  let applyCalls = 0;
  const adapter = createAnomalyActionAdapter({
    entityRepairService: {
      preview: (input) => { received = input; return { previewId: "relation-preview", sourceKey: input.sourceKey, changedFields: ["body:relation"], resolvedTarget: { title: "Auth" } }; },
      apply: () => { applyCalls += 1; return { writtenFields: ["body:relation"], expectedEdge: { source: "a", target: "auth" } }; },
    },
  });
  const issue = { issueId: "unknown-1", issueKind: "unrecognized_entity", expectedRevisions: { sourceRevision: { contentHash: "sha256:source" } }, proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/a.md", unresolvedTargets: ["ghost"] } };
  const preview = adapter.preview(issue, { relationPatch: { operation: "retarget", originalTarget: "ghost", targetId: "auth" } });
  assert.equal(received.relationPatch.targetId, "auth");
  assert.equal(received.relationPatch.originalTarget, "ghost");
  assert.equal(received.relationPatch.operation, "retarget");
  assert.equal(preview.token.previewId, "relation-preview");
  const confirmed = adapter.execute({ ...issue, actionPreview: preview });
  assert.equal(confirmed.accepted, true);
  assert.equal(confirmed.result.expectedEdge.target, "auth");
  const removal = adapter.preview(issue, { relationPatch: { operation: "remove-target", originalTarget: "ghost" } });
  assert.deepEqual(received.relationPatch, { operation: "remove-target", originalTarget: "ghost" });
  assert.equal(adapter.execute({ ...issue, actionPreview: removal }).accepted, true);
  assert.equal(applyCalls, 2, "relation confirmation must apply directly to the formal Vault");
  assert.throws(() => adapter.preview(issue, { relationPatch: { operation: "remove-target", originalTarget: "other" } }), (error) => error.code === "ANOMALY_ACTION_INPUT_REQUIRED");
});

test("does not mark a relation repair executable when there is no unresolved target", () => {
  const adapter = createAnomalyActionAdapter({
    entityRepairService: { preview: () => ({}), apply: () => ({}) },
  });
  const issue = {
    issueId: "typed-relation-1",
    issueKind: "unrecognized_entity",
    proposedAction: { type: "entity-relation-repair", unresolvedTargets: [] },
  };

  assert.equal(adapter.supports(issue), false);
});

test("previews article association and stale-source refresh and confirms through a direct save", () => {
  let saveCalls = 0;
  const saveArgs = [];
  const associationService = {
    list: () => ({ revision: "sha256:rules" }),
    preview: (payload) => ({ article: { articleId: payload.articleId, title: "Article", sourcePath: `知识库/raw/precleaned/${payload.articleId}.md` }, fileRevision: `sha256:${payload.articleId}`, action: payload.action, added: {}, removed: {} }),
    save: (revision, change) => { saveCalls += 1; saveArgs.push({ revision, change }); return { success: true }; },
  };
  const adapter = createAnomalyActionAdapter({
    articleAssociationService: associationService,
  });
  const manual = { issueId: "article-1", issueKind: "article_association", expectedRevisions: { factRevision: "sha256:rules" }, proposedAction: { type: "article-association", articleId: "ART-1" } };
  const manualPreview = adapter.preview(manual, { action: "add", componentIds: ["gateway"], versionIds: [] });
  assert.equal(manualPreview.token.expectedRevision, "sha256:ART-1");
  assert.deepEqual(manualPreview.token.change, { action: "add", articleId: "ART-1", componentIds: ["gateway"], versionIds: [] });
  assert.equal(adapter.execute({ ...manual, actionPreview: manualPreview }).accepted, true);
  const stale = { issueId: "stale-1", issueKind: "stale_source", expectedRevisions: { factRevision: "sha256:rules" }, proposedAction: { type: "article-association-reload", articleId: "ART-2", action: "replace", componentIds: ["audit"], versionIds: ["version-anyshare-7-0"] } };
  const stalePreview = adapter.preview(stale);
  assert.equal(adapter.execute({ ...stale, actionPreview: stalePreview }).accepted, true);
  assert.equal(saveCalls, 2, "article association confirmation must save directly to the formal Vault");
  assert.deepEqual(saveArgs.map((entry) => entry.change.action), ["add", "replace"]);
  assert.deepEqual(saveArgs.map((entry) => entry.revision), ["sha256:ART-1", "sha256:ART-2"]);
});

test("keeps inference conflict actions blocked until an owner-source Proposal contract exists", () => {
  let reviewCalls = 0;
  const conflict = {
    conflictId: "conflict-1", status: "unresolved", subjectNodeId: "gateway", conclusionKey: "change",
    sourceRevision: "sha256:conflict-source",
    conclusions: [
      { ruleId: "rule-assert", effect: "ASSERT" },
      { ruleId: "rule-block", effect: "BLOCK" },
    ],
  };
  const adapter = createAnomalyActionAdapter({
    conflictStore: { list: () => [conflict], review: () => { reviewCalls += 1; return { ...conflict, status: "resolved" }; } },
    operatorContext: { getOperatorId: () => "local-architect" },
  });
  const issue = { issueId: "relation-1", issueKind: "relation_conflict", expectedRevisions: { sourceRevision: conflict.sourceRevision }, proposedAction: { type: "inference-review", conflictId: conflict.conflictId } };
  const preview = adapter.preview(issue, { selectedEffect: "BLOCK", reason: "来源已失效" });
  assert.equal(adapter.supports(issue), false);
  assert.deepEqual(preview, { accepted: false, blocked: true, reason: "INFERENCE_DECISION_OWNER_SOURCE_REQUIRED" });
  assert.deepEqual(adapter.execute({ ...issue, actionPreview: { accepted: true, adapter: "inference-review", token: { conflictId: conflict.conflictId } } }), {
    accepted: false,
    blocked: true,
    reason: "INFERENCE_DECISION_OWNER_SOURCE_REQUIRED",
  });
  assert.equal(reviewCalls, 0, "legacy conflict review must remain audit-only");
});

test("legacy derived graph repair stays blocked without invoking the retired batch lifecycle", () => {
  const calls = { preview: 0, confirm: 0, create: 0 };
  const adapter = createAnomalyActionAdapter({
    articleGraphBatchService: {
      previewRepair: () => { calls.preview += 1; return {}; },
      confirmRepair: () => { calls.confirm += 1; return {}; },
      createRepairBatch: () => { calls.create += 1; return {}; },
    },
  });
  const issue = {
    issueId: "derived-repair-1",
    issueKind: "missing_lineage",
    expectedRevisions: { graphHash: "sha256:formal" },
    proposedAction: { type: "derived-graph-repair" },
  };

  assert.equal(adapter.supports(issue), false);
  const preview = adapter.preview(issue);
  assert.deepEqual(preview, { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" });
  const result = adapter.execute({
    ...issue,
    actionPreview: { accepted: true, adapter: "derived-graph-repair", token: { expectedFormalHash: "sha256:formal" } },
  });
  assert.deepEqual(result, { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" });
  assert.deepEqual(calls, { preview: 0, confirm: 0, create: 0 });
});

test("rejects mismatched fields and changed revisions before write", () => {
  const adapter = createAnomalyActionAdapter({
    entityRepairService: { preview: () => ({}), apply: () => ({}) },
  });
  assert.throws(() => adapter.preview(entityIssue(), { changes: { title: "wrong" } }), (error) => error.code === "ANOMALY_ACTION_INPUT_REQUIRED");
  const articleAdapter = createAnomalyActionAdapter({
    articleAssociationService: { list: () => ({ revision: "sha256:new" }), preview: () => ({}), save: () => ({}) },
  });
  assert.throws(() => articleAdapter.preview({ issueKind: "stale_source", expectedRevisions: { factRevision: "sha256:old" }, proposedAction: { type: "article-association-reload", articleId: "ART-1", action: "replace" } }), (error) => error.code === "ANOMALY_SOURCE_CHANGED");
});

test("relation preview fails closed when source contentHash is missing or malformed", () => {
  const adapter = createAnomalyActionAdapter({
    entityRepairService: { preview: (input) => ({ previewId: "relation-preview", sourceKey: input.sourceKey, changedFields: ["body:relation"] }), apply: () => ({}) },
  });
  const base = { issueId: "unknown-hash", issueKind: "unrecognized_entity", proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/a.md", unresolvedTargets: ["ghost"] } };
  const payload = { relationPatch: { operation: "remove-target", originalTarget: "ghost" } };
  for (const sourceRevision of [undefined, {}, { contentHash: "" }, { contentHash: 42 }]) {
    assert.throws(
      () => adapter.preview({ ...base, expectedRevisions: { sourceRevision } }, payload),
      (error) => error.code === "ANOMALY_SOURCE_CHANGED" && error.status === 409,
    );
  }
});
