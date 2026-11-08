// Phase 4: Governance contract tests — ADR005 governance protocol
// Verifies: stable issue_id, revision-gated preview, fact-source-only write-back,
// global diagnostic reconciliation, and backend-determined closure.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { createAnomalyWorkbenchService } = require("../anomaly-workbench-service.cjs");
const { createEntityRepairService } = require("../../entity-compliance/entity-repair-service.cjs");

// ─── 4.1 Stable issue_id persists through the lifecycle ───

test("issueId is stable across open, preview, confirm, rerun, and verify", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-issue-id-stable-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  let active = true;
  const issueId = "gov-001-stable-id";

  const service = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => active ? [{
      issueId, issueKind: "missing_field", title: "治理测试",
      evidence: [{ path: "知识库/wiki/entities/gov.md" }],
      expectedRevisions: { sourceHash: "sha256:gov-src" },
    }] : [],
    executeAction: () => ({ accepted: true }),
    rerunPipeline: () => { active = false; return { state: "succeeded" }; },
    verifyIssue: () => ({ verified: true }),
  });

  // Verify issueId is consistent through each transition
  let current = service.get(issueId);
  assert.equal(current.issueId, issueId);
  assert.equal(current.status, "open");

  current = service.preview(issueId);
  assert.equal(current.issueId, issueId);
  assert.equal(current.status, "previewed");
  assert.ok(current.previewId, "must have previewId");

  current = service.confirm(issueId, { previewId: current.previewId });
  assert.equal(current.issueId, issueId);
  assert.equal(current.status, "confirmed");

  current = service.rerun(issueId);
  assert.equal(current.issueId, issueId);
  assert.equal(current.status, "executed");

  current = service.verify(issueId);
  assert.equal(current.issueId, issueId);
  assert.equal(current.status, "verified");
  assert.equal(current.sourceActive, false);
});

// ─── 4.2 Verified issues exit the active work queue ───

test("verified issues are excluded from the active queue", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-queue-exit-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  // Use reconcileDiagnostic to create and verify in one cycle
  const service1 = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => [{ issueId: "queue-item", issueKind: "missing_field", title: "待验证", evidence: [{ path: "x.md" }], expectedRevisions: { sourceHash: "sha256:a" } }],
  });
  const first = service1.reconcileDiagnostic({ state: "succeeded", jobId: "job-1" });
  assert.equal(first.blockerCount, 1);
  assert.equal(service1.list().total, 1);
  assert.equal(service1.list().issues[0].status, "open");

  // Silence collector → verified on next diagnosis
  const service2 = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => [],
  });
  const second = service2.reconcileDiagnostic({ state: "succeeded", jobId: "job-2" });
  assert.equal(second.blockerCount, 0);
  assert.equal(second.verifiedCount, 1);

  // Active queue must be empty
  assert.equal(service2.list().total, 0);

  // Resolved audit still accessible
  const audit = service2.list({ includeResolved: true });
  assert.equal(audit.total, 1);
  assert.equal(audit.issues[0].status, "verified");
  assert.equal(audit.issues[0].sourceActive, false);
});

// ─── 4.3 Revision check before confirmation rejects stale previews ───

test("confirmation is rejected when source revision changed after preview", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-revision-reject-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  let revision = { sourceHash: "sha256:v1" };
  const service = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => [{
      issueId: "revision-test", issueKind: "stale_source", title: "版本变化",
      evidence: [{ path: "a.md" }],
      expectedRevisions: revision,
    }],
    executeAction: () => ({ accepted: true }),
  });

  const preview = service.preview("revision-test");
  assert.equal(preview.status, "previewed");

  // Simulate source change after preview
  revision = { sourceHash: "sha256:v2" };
  const afterChange = service.get("revision-test");
  // Source revision changed → preview should be invalidated
  assert.equal(afterChange.status, "open",
    `Expected open after revision change, got ${afterChange.status}`);
  assert.equal(afterChange.actionPreview, undefined,
    "actionPreview must be cleared when revision changes");
  assert.ok(afterChange.previousResolution,
    "must preserve previous resolution for audit");
});

// ─── 4.4 Closure is determined by backend re-check ───

test("issue stays open when backend re-check detects it still exists", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-recheck-active-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  const issue = { issueId: "persistent-bug", issueKind: "missing_field", title: "持续问题", evidence: [{ path: "b.md" }], expectedRevisions: { sourceHash: "sha256:live" } };
  let pipelineStatus = { state: "idle", jobId: null };

  const service = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => [issue], // issue persists even after "fix"
    executeAction: () => ({ accepted: true }),
    rerunPipeline: () => { pipelineStatus = { state: "running", jobId: "p-job" }; return pipelineStatus; },
    getPipelineStatus: () => pipelineStatus,
    verifyIssue: () => ({ verified: false, reason: "问题仍然存在於最新來源掃描中" }),
  });

  const preview = service.preview(issue.issueId);
  service.confirm(issue.issueId, { previewId: preview.previewId });
  service.rerun(issue.issueId);
  pipelineStatus = { state: "succeeded", jobId: "p-job" };
  assert.equal(service.get(issue.issueId).status, "executed");

  const verification = service.verify(issue.issueId);
  // Backend re-check found the issue still active → stale, not verified
  assert.equal(verification.status, "stale",
    `Expected stale when backend recheck detects issue, got ${verification.status}`);
  assert.equal(verification.verificationResult.verified, false);
});

// ─── 4.5 Global diagnosis is the authoritative re-check mechanism ───

test("reconcileDiagnostic is the single authoritative re-check path", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-diagnostic-auth-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  let active = true;
  const service = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => active ? [{ issueId: "diag-auth", issueKind: "missing_field", title: "诊断权威", evidence: [{ path: "d.md" }], expectedRevisions: { sourceHash: "sha256:d" } }] : [],
    actionAdapter: {
      supports: () => true,
      preview: () => ({ accepted: true, token: { id: "tok" } }),
      execute: () => { active = false; return { accepted: true }; },
    },
  });

  // First diagnosis: detects issue
  service.reconcileDiagnostic({ state: "succeeded", jobId: "diag-1" });
  let issue = service.get("diag-auth");
  assert.equal(issue.status, "open");
  assert.equal(issue.diagnosticActive, true, "must be marked as diagnostically active");

  // Fix via preview → confirm (simulates local write)
  const preview = service.preview("diag-auth");
  service.confirm("diag-auth", { previewId: preview.previewId });
  // After local write, issue is hidden (no longer detected by collector)
  assert.equal(service.list().total, 0);

  // Second diagnosis: confirms the fix
  const result = service.reconcileDiagnostic({ state: "succeeded", jobId: "diag-2" });
  assert.equal(result.blockerCount, 0);
  assert.equal(result.verifiedCount, 1);

  issue = service.list({ includeResolved: true }).issues[0];
  assert.equal(issue.status, "verified");
  assert.equal(issue.diagnosticActive, false, "must be marked as diagnostically inactive after verification");
  assert.equal(issue.verifiedAt !== null, true);
});

// ─── 4.6 Write-back modifies fact source only, not derived data ───

test("entity-repair apply writes only to the fact source, never derived artifacts", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-fact-source-only-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  const rules = {
    archLayers: ["service"], archCategories: ["服务"], statuses: ["有效", "灰度", "在线", "退役", "已驳回"], moduleNames: ["Gateway"], // 2026-10-08 字段托管：四值+存量值（归一映射兼容）, articleTypes: [], docTypes: [], categoryPaths: [], products: [],
    versionsByProduct: {}, layerAliases: {}, categoryAliases: {}, wikilinkTypeLabels: {},
  };

  const dir = path.join(vaultPath, "知识库", "wiki", "entities");
  fs.mkdirSync(dir, { recursive: true });
  const raw = "---\ntitle: Test\narchitecture-node-id: test-node\narch_component: true\nstatus: 有效\ntags: [t]\n---\n\n# Test\n";
  const file = path.join(dir, "test.md");
  fs.writeFileSync(file, raw, "utf8");

  const svc = createEntityRepairService({ vaultPath, ruleSetProvider: () => rules });
  const sourceKey = "知识库/wiki/entities/test.md";
  const sourceRevision = { mtimeMs: fs.statSync(file).mtimeMs, size: fs.statSync(file).size, contentHash: "sha256:" + crypto.createHash("sha256").update(raw).digest("hex") };

  const preview = svc.preview({ sourceKey, sourceRevision, changes: { title: "Updated Title" } });
  const applied = svc.apply({ previewId: preview.previewId, confirmed: true });

  // Contract: fact source was written
  assert.ok(fs.readFileSync(file, "utf8").includes("title: Updated Title"));

  // Contract: NO derived data artifacts were written
  const anyshare = path.join(vaultPath, ".ledger");
  assert.ok(!fs.existsSync(path.join(anyshare, "master_graph.json")), "repair must not write master_graph.json");
  assert.ok(!fs.existsSync(path.join(anyshare, "master_graph.db")), "repair must not write master_graph.db");
  assert.ok(!fs.existsSync(path.join(anyshare, "semantic_architecture.json")), "repair must not write SA");
  assert.ok(!fs.existsSync(path.join(anyshare, "document_index.json")), "repair must not write document index");

  // Contract: backup was created
  assert.ok(applied.backupPath, "must create backup");

  // Contract: applied result includes what was changed
  assert.deepEqual(applied.writtenFields, ["title"]);
});

// ─── 4.7 Pipeline failure produces a stable, actionable issue ───

test("pipeline failure creates a stable issue_id that persists across diagnoses", function (t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "gov-pipeline-stable-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));

  const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [] });
  const first = service.reconcileDiagnostic({
    state: "failed", jobId: "pipe-1", stage: "抽取", message: "读取 master_graph 失败",
  });
  assert.equal(first.blockerCount, 1);
  const issue1 = service.list().issues[0];
  assert.equal(issue1.issueKind, "pipeline_failure");
  assert.match(issue1.issueId, /^pipeline-failure-/);
  const frozenId = issue1.issueId;

  // Second failure with same stage+message should produce same stable ID
  const second = service.reconcileDiagnostic({
    state: "failed", jobId: "pipe-2", stage: "抽取", message: "读取 master_graph 失败",
  });
  assert.equal(second.blockerCount, 1);
  const issue2 = service.list().issues[0];
  assert.equal(issue2.issueId, frozenId, "pipeline failure issue_id must be stable across diagnoses");

  // When pipeline succeeds, issue should be auto-verified
  const third = service.reconcileDiagnostic({ state: "succeeded", jobId: "pipe-3" });
  assert.equal(third.blockerCount, 0);
  assert.equal(third.verifiedCount, 1);
});
