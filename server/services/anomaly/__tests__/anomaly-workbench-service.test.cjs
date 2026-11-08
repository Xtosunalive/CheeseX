const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAnomalyWorkbenchService } = require("../anomaly-workbench-service.cjs");

// SPEC-012 wave-2：台账种子/断言经 runtime-state store（旧 json 文件形态退役）
const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");
function seedAnomaly(vaultPath, ledger) { getRuntimeStateStore(vaultPath).anomaly.replaceAll(ledger); }
function readAnomaly(vaultPath) { return getRuntimeStateStore(vaultPath).anomaly.all(); }

test("list performs one structured collection and carries working revisions", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-working-revisions-"));
  let collections = 0;
  try {
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues() {
        collections += 1;
        return {
          issues: [{ issueId: "missing-working-1", issueKind: "missing_field", title: "缺少字段", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" } }],
          workingRevisions: { masterGraph: `sha256:${"a".repeat(64)}` },
        };
      },
    });
    const result = service.list();
    assert.equal(collections, 1);
    assert.equal(result.total, 1);
    assert.deepEqual(result.workingRevisions, { masterGraph: `sha256:${"a".repeat(64)}` });
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("array collectors remain supported for isolated test injection", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-array-collector-"));
  try {
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [] });
    assert.deepEqual(service.list().workingRevisions, {});
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("runs evidence, preview, confirm, rerun, and verify lifecycle", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-workbench-"));
  let active = true;
  try {
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues: () => active ? [{ issueId: "missing-1", issueKind: "missing_field", title: "缺少模块", evidence: [{ path: "wiki/entities/a.md", lineNumber: 2 }], expectedRevisions: { sourceHash: "sha256:a" }, proposedAction: { type: "repair" } }] : [],
      executeAction: () => ({ accepted: true, previewApplied: true }),
      rerunPipeline: () => { active = false; return { state: "succeeded" }; },
      verifyIssue: () => ({ verified: true }),
    });
    assert.equal(service.list().issues[0].status, "open");
    const preview = service.preview("missing-1");
    assert.equal(preview.status, "previewed");
    const confirmed = service.confirm("missing-1", { previewId: preview.previewId });
    assert.equal(confirmed.status, "confirmed");
    assert.equal(service.rerun("missing-1").status, "executed");
    assert.equal(service.verify("missing-1").status, "verified");
    assert.equal(service.list().issues.length, 0);
    const auditIssue = service.list({ includeResolved: true }).issues[0];
    assert.equal(auditIssue.status, "verified");
    assert.equal(auditIssue.sourceActive, false);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("global diagnosis reconciles all issues without per-item rerun", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-diagnostic-reconcile-"));
  let active = true;
  try {
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues: () => active ? [{ issueId: "missing-global", issueKind: "missing_field", title: "缺少字段", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" } }] : [],
    });
    const first = service.reconcileDiagnostic({ state: "succeeded", jobId: "job-1" });
    assert.equal(first.blockerCount, 1);
    assert.deepEqual(first.issueIds, ["missing-global"]);
    assert.deepEqual(service.get("missing-global").blockedActions, ["publish_graph"]); // #1403：approve_article 已退役（ADR019）

    active = false;
    const second = service.reconcileDiagnostic({ state: "succeeded", jobId: "job-2" });
    assert.equal(second.blockerCount, 0);
    assert.equal(second.verifiedCount, 1);
    assert.equal(service.list().total, 0);
    assert.equal(service.list({ includeResolved: true }).issues[0].status, "verified");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("hides a source issue after confirmed write and verifies it on the next global diagnosis", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-local-resolution-"));
  let active = true;
  try {
    const issue = { issueId: "relation-local", issueKind: "unrecognized_entity", title: "旧链接", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" }, proposedAction: { type: "entity-relation-repair", unresolvedTargets: ["ghost"] } };
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues: () => active ? [issue] : [],
      actionAdapter: {
        supports: () => true,
        preview: () => ({ accepted: true, token: { previewId: "source-preview" }, summary: { bodyPatch: { before: ["关联::[[ghost]]"], after: [] } } }),
        execute: () => { active = false; return { accepted: true }; },
      },
    });
    service.reconcileDiagnostic({ state: "succeeded", jobId: "job-before" });
    const preview = service.preview(issue.issueId);
    const confirmed = service.confirm(issue.issueId, { previewId: preview.previewId });
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.sourceActive, false);
    assert.equal(service.list().total, 0, "normal reload hides an issue no longer detected at source");
    const diagnostic = service.reconcileDiagnostic({ state: "succeeded", jobId: "job-after" });
    assert.equal(diagnostic.verifiedCount, 1);
    assert.equal(service.list({ includeResolved: true }).issues[0].status, "verified");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("failed global diagnosis becomes an active pipeline issue", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-diagnostic-failure-"));
  try {
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [] });
    const summary = service.reconcileDiagnostic({ state: "failed", jobId: "job-failed", stage: "1", message: "抽取校验失败" });
    assert.equal(summary.status, "failed");
    assert.equal(summary.blockerCount, 1);
    const issue = service.list().issues[0];
    assert.equal(issue.issueKind, "pipeline_failure");
    assert.deepEqual(issue.blockedActions, ["complete_global_diagnostic"]);
    assert.equal(issue.evidence[0].coordinate, "pipeline-stage:1");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("blocks confirmation when no write adapter is configured", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-no-adapter-"));
  try {
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues: () => [{ issueId: "missing-2", issueKind: "missing_field", title: "缺少模块", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" } }],
    });
    const preview = service.preview("missing-2");
    const blocked = service.confirm("missing-2", { previewId: preview.previewId });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.executionResult.accepted, false);
    assert.equal(blocked.executionError, "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("relation rejection writes review_actions audit and marks the candidate rejected without proposalService", () => {
  // D3（seq150）：拒绝=纯审计（09:139 真实记录器=review_actions.json），生产装配（main.cjs）不注入 proposalService，
  // 本测试即按生产装配构造（无 proposalService 键）——红灯=PROPOSAL_SERVICE_NOT_CONFIGURED（503）证明机制破损。
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-relation-reject-audit-"));
  const candidate = {
    triples: [{
      sourceNodeId: "api",
      relationType: "DEPENDS_ON",
      targetNodeId: "database",
      direction: "outgoing",
      relationTypeStatus: "known",
      sourceEndpointStatus: "known",
      targetEndpointStatus: "unknown",
      evidence: [{
        sourceKind: "typed_wikilink",
        producer: "extract_graph.entity_typed_wikilink",
        coordinate: "line:4",
        sourcePath: "知识库/wiki/entities/api.md",
        snippet: "依赖::[[database]]",
        contentHash: `sha256:${"1".repeat(64)}`,
        sourceRevision: `sha256:${"2".repeat(64)}`,
        ruleRevision: "B04",
        modelRevision: null,
        policyRevision: "assertion-policy-registry",
      }],
    }],
  };
  try {
    const service = createAnomalyWorkbenchService({
      vaultPath,
      operatorContext: { getOperatorId: () => "server-architect" },
      collectIssues: () => [{ issueId: "candidate-1", issueKind: "relation_conflict", title: "candidate", evidence: [{ path: "api.md" }], expectedRevisions: { sourceRevision: "r1" }, relationCandidate: candidate }],
    });
    assert.throws(() => service.reject("candidate-1", { reason: " " }), { code: "RELATION_REJECTION_REASON_REQUIRED" });
    const result = service.reject("candidate-1", { actor: "client-impostor", reason: " unsupported " });
    assert.equal(result.relationCandidate.candidateStatus, "rejected");
    assert.equal(result.relationCandidate.rejection.actor, "server-architect");
    assert.equal(result.relationCandidate.rejection.reason, "unsupported");
    assert.ok(result.relationCandidate.rejection.rejectedAt);
    assert.equal(result.relationCandidate.rejection.proposalId, undefined);
    assert.equal(result.relationCandidate.rejection.proposalCommit, undefined);
    const actions = getRuntimeStateStore(vaultPath).review.list(); // SPEC-012 WP-A：人裁账本迁 runtime-state store
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, "rejected");
    assert.equal(actions[0].reviewer, "server-architect");
    assert.equal(actions[0].candidateId, result.relationCandidate.candidateId);
    assert.equal(actions[0].reason, "unsupported");
    // PR-104：显式键——裁决载荷带 issueId 且落 issue_id 列（issueIds 读面走索引）
    assert.equal(actions[0].issueId, "candidate-1");
    assert.deepEqual(getRuntimeStateStore(vaultPath).review.issueIds(), ["candidate-1"]);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("PR-104 读时对账：裁决引用的 issue 不在账本 → warn review-actions-issue-dangling（count＋样本）；全在册不触发", () => {
  const liveIssue = { issueId: "live-1", issueKind: "missing_field", title: "缺少字段", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" } };
  const stamp = new Date().toISOString();
  // 场景 A：账本里只有 live-1，裁决账却引用 ghost-issue → 对账 warn 一次
  const vaultA = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-dangling-a-"));
  const warnsA = [];
  try {
    getRuntimeStateStore(vaultA).review.append({ action: "rejected", kind: "relation_candidate", issueId: "ghost-issue", candidateId: "c-ghost", reviewer: "r", decidedAt: stamp }, stamp);
    const service = createAnomalyWorkbenchService({ vaultPath: vaultA, logger: { info() {}, error() {}, warn: (e) => warnsA.push(e) }, collectIssues: () => [liveIssue] });
    service.list(); // 首见 live-1 → 账本变化 → 写账 → 对账
    const dangling = warnsA.filter((w) => w.event === "review-actions-issue-dangling");
    assert.equal(dangling.length, 1, "悬空裁决触发一次 warn");
    assert.equal(dangling[0].count, 1);
    assert.deepEqual(dangling[0].issueIds, ["ghost-issue"]);
  } finally { fs.rmSync(vaultA, { recursive: true, force: true }); }
  // 场景 B：裁决引用的 issue 在账本内 → 不触发
  const vaultB = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-dangling-b-"));
  const warnsB = [];
  try {
    getRuntimeStateStore(vaultB).review.append({ action: "rejected", kind: "relation_candidate", issueId: "live-1", candidateId: "c-live", reviewer: "r", decidedAt: stamp }, stamp);
    const service = createAnomalyWorkbenchService({ vaultPath: vaultB, logger: { info() {}, error() {}, warn: (e) => warnsB.push(e) }, collectIssues: () => [liveIssue] });
    service.list();
    assert.equal(warnsB.filter((w) => w.event === "review-actions-issue-dangling").length, 0, "全在册不告警（观测面零误报）");
  } finally { fs.rmSync(vaultB, { recursive: true, force: true }); }
});

test("reject fails closed without server-side operator identity and writes no audit", () => {
  // D3（seq150）：真实授权=服务端操作者上下文（local-operator-context 单用户模式即架构师，09 GOAL-5）；
  // 旧测试经注入 proposalService.assertArchitectIdentity 假件虚构授权（生产从未注入）——按真实机制重写。
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-relation-unauthorized-"));
  try {
    const service = createAnomalyWorkbenchService({
      vaultPath,
      operatorContext: null,
      collectIssues: () => [{
        issueId: "candidate-unauthorized",
        issueKind: "relation_conflict",
        title: "candidate",
        evidence: [{ path: "api.md" }],
        expectedRevisions: { sourceRevision: "r1" },
        relationCandidate: {
          triples: [{
            sourceNodeId: "api", relationType: "custom", targetNodeId: "db", direction: "outgoing",
            relationTypeStatus: "unknown", sourceEndpointStatus: "known", targetEndpointStatus: "unknown",
            evidence: [{ sourceKind: "derived", producer: "extract_graph.derived_mentions", coordinate: "rule:r1", sourcePath: null, snippet: "candidate", contentHash: `sha256:${"3".repeat(64)}`, sourceRevision: "r1", ruleRevision: "r1", modelRevision: null, policyRevision: null }],
          }],
        },
      }],
    });
    assert.throws(() => service.reject("candidate-unauthorized", { reason: "unsupported" }), { code: "OPERATOR_CONTEXT_NOT_CONFIGURED" });
    assert.equal(fs.existsSync(path.join(vaultPath, ".ledger", "review_actions.json")), false);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("hides inactive unfinished ledger snapshots from the active queue", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-inactive-preview-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, {
      "inactive-preview": {
        status: "previewed",
        issueSnapshot: {
          issueId: "inactive-preview",
          issueKind: "missing_field",
          title: "old preview",
          evidence: [{ path: "removed.md" }],
          expectedRevisions: { sourceHash: "sha256:old" },
        },
      },
    });
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [] });
    assert.equal(service.list().total, 0);
    const auditIssue = service.list({ includeResolved: true }).issues[0];
    assert.equal(auditIssue.issueId, "inactive-preview");
    assert.equal(auditIssue.sourceActive, false);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("invalidates a preview immediately when source revisions change", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-stale-"));
  let revision = "sha256:old";
  try {
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [{ issueId: "stale-1", issueKind: "stale_source", title: "来源过期", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: revision } }] });
    service.preview("stale-1");
    revision = "sha256:new";
    const reopened = service.get("stale-1");
    assert.equal(reopened.status, "open");
    assert.equal(reopened.actionPreview, undefined);
    assert.equal(reopened.previousResolution.status, "previewed");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("each supported issue kind completes preview, confirm, rerun, and source-backed verification", () => {
  for (const issueKind of ["missing_field", "unrecognized_entity", "relation_conflict", "article_association", "version_scope", "stale_source"]) {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), `anomaly-${issueKind}-`));
    let active = true;
    let pipelineStatus = { state: "idle", jobId: null };
    try {
      const issue = { issueId: `${issueKind}-fixture`, issueKind, title: issueKind, evidence: [{ path: "知识库/wiki/entities/a.md" }], expectedRevisions: { sourceHash: "sha256:source" }, proposedAction: { type: "fixture" } };
      const actionAdapter = {
        supports: () => true,
        preview: () => ({ accepted: true, adapter: "fixture", token: { id: issue.issueId } }),
        execute: () => ({ accepted: true, adapter: "fixture" }),
      };
      const service = createAnomalyWorkbenchService({
        vaultPath,
        collectIssues: () => active ? [issue] : [],
        actionAdapter,
        rerunPipeline: () => { active = false; pipelineStatus = { state: "running", jobId: "job-1", message: "running" }; return pipelineStatus; },
        getPipelineStatus: () => pipelineStatus,
      });
      const preview = service.preview(issue.issueId, { decision: "fixture" });
      assert.equal(preview.executionReady, true);
      assert.equal(service.confirm(issue.issueId, { previewId: preview.previewId }).status, "confirmed");
      assert.equal(service.rerun(issue.issueId).status, "rerunning");
      assert.throws(() => service.verify(issue.issueId), (error) => error.code === "ANOMALY_RERUN_REQUIRED");
      pipelineStatus = { state: "succeeded", jobId: "job-1", message: "done", finishedAt: "2026-07-20T00:00:00.000Z" };
      assert.equal(service.get(issue.issueId).status, "executed");
      const verified = service.verify(issue.issueId);
      assert.equal(verified.status, "verified");
      assert.equal(verified.sourceActive, false);
    } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
  }
});

test("does not verify an issue that remains active after pipeline rerun", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-still-active-"));
  try {
    const issue = { issueId: "active-1", issueKind: "missing_field", title: "still active", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:source" } };
    let pipelineStatus = { state: "idle", jobId: null };
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues: () => [issue],
      executeAction: () => ({ accepted: true }),
      rerunPipeline: () => { pipelineStatus = { state: "running", jobId: "job-active" }; return pipelineStatus; },
      getPipelineStatus: () => pipelineStatus,
      verifyIssue: () => ({ verified: false, reason: "still detected" }),
    });
    const preview = service.preview(issue.issueId);
    service.confirm(issue.issueId, { previewId: preview.previewId });
    service.rerun(issue.issueId);
    pipelineStatus = { state: "succeeded", jobId: "job-active", message: "done" };
    assert.equal(service.get(issue.issueId).status, "executed");
    assert.equal(service.verify(issue.issueId).status, "stale");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("blocks verification when the tracked pipeline run fails", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-pipeline-failed-"));
  let pipelineStatus = { state: "idle", jobId: null };
  try {
    const issue = { issueId: "pipeline-failed-1", issueKind: "missing_field", title: "pipeline failure", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:source" }, proposedAction: { type: "fixture" } };
    const service = createAnomalyWorkbenchService({
      vaultPath,
      collectIssues: () => [issue],
      actionAdapter: { supports: () => true, preview: () => ({ accepted: true, token: { id: "preview" } }), execute: () => ({ accepted: true }) },
      rerunPipeline: () => { pipelineStatus = { state: "running", jobId: "job-failed", message: "running" }; return pipelineStatus; },
      getPipelineStatus: () => pipelineStatus,
    });
    const preview = service.preview(issue.issueId);
    service.confirm(issue.issueId, { previewId: preview.previewId });
    assert.equal(service.rerun(issue.issueId).status, "rerunning");
    pipelineStatus = { state: "failed", jobId: "job-failed", message: "抽取阶段失败" };
    const failed = service.get(issue.issueId);
    assert.equal(failed.status, "blocked");
    assert.equal(failed.executionError, "抽取阶段失败");
    assert.throws(() => service.verify(issue.issueId), (error) => error.code === "ANOMALY_RERUN_REQUIRED");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("downgrades legacy previews without a business preview token", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-legacy-preview-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, { "legacy-1": { status: "previewed", previewId: "legacy-preview", previewRevisions: { sourceHash: "sha256:old" } } });
    const issue = { issueId: "legacy-1", issueKind: "missing_field", title: "legacy", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:new" }, proposedAction: { type: "fixture" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [issue], actionAdapter: { supports: () => true, preview: () => ({ accepted: true, token: { id: "new" } }), execute: () => ({ accepted: true }) } });
    const current = service.get(issue.issueId);
    assert.equal(current.status, "open");
    assert.equal(current.previewId, undefined);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("downgrades field previews that do not expose the confirmed value", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-incomplete-preview-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, { "field-1": { status: "previewed", previewId: "legacy-preview", actionPreview: { accepted: true, token: { previewId: "write-1" }, summary: { changedFields: ["arch_layer"] } } } });
    const issue = { issueId: "field-1", issueKind: "missing_field", title: "legacy", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:new" }, proposedAction: { type: "entity-repair", sourceKey: "a.md", field: "arch_layer" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [issue], actionAdapter: { supports: () => true } });
    const current = service.get(issue.issueId);
    assert.equal(current.status, "open");
    assert.equal(current.actionPreview, undefined);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("reopens a verified issue when the source checker detects it again", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-reopened-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, {
      "field-reopened": {
        status: "verified",
        issueSnapshot: { issueId: "field-reopened", issueKind: "missing_field", title: "old", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:old" }, proposedAction: { type: "entity-repair", field: "arch_subdomain" } },
        actionPreview: { accepted: true, token: { previewId: "old" }, summary: { beforeValues: { arch_subdomain: null }, afterValues: { arch_subdomain: "test" } } },
        verificationResult: { verified: true },
        verifiedAt: "2026-07-19T00:00:00.000Z",
      },
    });
    const currentIssue = { issueId: "field-reopened", issueKind: "missing_field", title: "current", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:new" }, proposedAction: { type: "entity-repair", field: "arch_subdomain", currentValue: "test1", allowedValues: ["test1修改"] } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [currentIssue], actionAdapter: { supports: () => true } });
    const reopened = service.get(currentIssue.issueId);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.sourceActive, true);
    assert.equal(reopened.actionPreview, undefined);
    assert.equal(reopened.previousResolution.status, "verified");
    assert.equal(reopened.previousResolution.reason, "已复核问题被来源检查器重新检出");
    const listed = service.list().issues[0];
    assert.equal(listed.status, "open");
    assert.equal(listed.proposedAction.currentValue, "test1");
    assert.deepEqual(listed.proposedAction.allowedValues, ["test1修改"]);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("invalidates a preview when its source revision changes", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-preview-source-changed-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, {
      "relation-changed": {
        status: "previewed",
        issueSnapshot: { issueId: "relation-changed", issueKind: "unrecognized_entity", title: "old", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:old" }, proposedAction: { type: "entity-relation-repair" } },
        previewId: "preview-old",
        previewRevisions: { sourceHash: "sha256:old" },
        actionPreview: { accepted: true, token: { previewId: "write-old" }, summary: { bodyPatch: { before: "", after: "依赖::[[a]]" } } },
      },
    });
    const currentIssue = { issueId: "relation-changed", issueKind: "unrecognized_entity", title: "current", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:new" }, proposedAction: { type: "entity-relation-repair" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [currentIssue], actionAdapter: { supports: () => true } });
    const reopened = service.get(currentIssue.issueId);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.actionPreview, undefined);
    assert.equal(reopened.previousResolution.status, "previewed");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("allows a stale active issue to generate a new preview from current evidence", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-stale-retry-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, { "relation-stale": { status: "stale", staleReason: "上一轮处理未解决当前问题" } });
    const issue = { issueId: "relation-stale", issueKind: "unrecognized_entity", title: "current", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:current" }, proposedAction: { type: "entity-relation-repair" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [issue], actionAdapter: { supports: () => true, preview: () => ({ accepted: true, token: { previewId: "write-new" }, summary: { bodyPatch: { before: "[[ghost]]", after: "" } } }) } });
    const previewed = service.preview(issue.issueId, { relationPatch: { operation: "remove-target", originalTarget: "ghost" } });
    assert.equal(previewed.status, "previewed");
    assert.equal(previewed.expectedRevisions.sourceHash, "sha256:current");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("allows an active blocked issue to recover with a new preview", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-blocked-retry-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, { "field-blocked": { status: "blocked", executionError: "previous failure" } });
    const issue = { issueId: "field-blocked", issueKind: "missing_field", title: "current", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:current" }, proposedAction: { type: "entity-repair", field: "arch_subdomain" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [issue], actionAdapter: { supports: () => true, preview: () => ({ accepted: true, token: { previewId: "write-new" }, summary: { beforeValues: { arch_subdomain: null }, afterValues: { arch_subdomain: "architecture" } } }) } });
    const previewed = service.preview(issue.issueId, { changes: { arch_subdomain: "architecture" } });
    assert.equal(previewed.status, "previewed");
    assert.equal(previewed.executionError, undefined);
    assert.equal(previewed.actionPreview.token.previewId, "write-new");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("集中转移表：合法操作前置通过，非法转移 fail-closed（OPERATION_PRECONDITIONS）", (t) => {
  const { OPERATION_PRECONDITIONS, assertOperationPrecondition } = require("../anomaly-workbench-service.cjs");
  // 合法：每个操作在其允许的起始状态不抛
  for (const [op, froms] of Object.entries(OPERATION_PRECONDITIONS)) {
    for (const from of froms) assert.doesNotThrow(() => assertOperationPrecondition(op, from), `${op} from ${from}`);
  }
  // 非法：confirm 不能从 open、verify 不能从 confirmed、reopen 不能从 open
  assert.throws(() => assertOperationPrecondition("confirm", "open", "ANOMALY_PREVIEW_REQUIRED"), (e) => e.code === "ANOMALY_PREVIEW_REQUIRED");
  assert.throws(() => assertOperationPrecondition("verify", "confirmed", "ANOMALY_RERUN_REQUIRED"), (e) => e.code === "ANOMALY_RERUN_REQUIRED");
  assert.throws(() => assertOperationPrecondition("reopen", "open", "ISSUE_NOT_CLOSED"), (e) => e.code === "ISSUE_NOT_CLOSED");
  // 未知操作（reject）不受转移表约束
  assert.doesNotThrow(() => assertOperationPrecondition("reject", "open"));
});

test("#1403 默认阻止动作不得含 ADR019 退役动作 approve_article（加一删一·浅清）", () => {
  const vaultPath = "/tmp/anomaly-blocked-1403";
  const service = createAnomalyWorkbenchService({
    vaultPath,
    collectIssues: () => [{ issueId: "i-m", issueKind: "missing_field", title: "t", evidence: [{ kind: "vault-document", path: "p" }], handling: "fix" }],
    getPipelineStatus: () => null,
  });
  const item = service.list().issues[0];
  assert.equal(item.blockedActions.includes("approve_article"), false, "approve_article 已退役（ADR019），默认塞入属残留");
  assert.equal(item.blockedActions.includes("publish_graph"), true, "publish_graph 提示保留");
});

test("closes a tracked open issue at read time when the source no longer detects it (ADR063)", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-read-close-"));
  let active = true;
  try {
    const issue = { issueId: "gone-1", issueKind: "missing_field", title: "消失的问题", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => (active ? [issue] : []) });
    service.reconcileDiagnostic({ state: "succeeded", jobId: "job-1" });
    assert.equal(service.list().total, 1);
    active = false;
    assert.equal(service.list().total, 0, "问题消失读时即关闭，默认清单立即为空");
    const closed = service.list({ includeResolved: true }).issues[0];
    assert.equal(closed.status, "verified");
    assert.equal(closed.verificationResult.reason, "最新来源扫描未再检出该问题");
    assert.equal(closed.verifiedAt != null, true, "自动关闭必须携带时间戳留审计");
    const before = JSON.stringify(readAnomaly(vaultPath));
    service.list();
    assert.equal(JSON.stringify(readAnomaly(vaultPath)), before, "已收敛后重复读取零写放大");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("a failed scan never closes tracked issues (fail-closed, ADR063)", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-failclosed-"));
  let healthy = true;
  try {
    const issue = { issueId: "f-1", issueKind: "missing_field", title: "待办", evidence: [{ path: "a.md" }], expectedRevisions: { sourceHash: "sha256:a" } };
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => { if (!healthy) throw new Error("scan boom"); return [issue]; } });
    service.reconcileDiagnostic({ state: "succeeded", jobId: "job-1" });
    healthy = false;
    assert.throws(() => service.list(), /scan boom/);
    const ledger = readAnomaly(vaultPath);
    assert.equal(ledger["f-1"].status, "open", "扫描失败不得落账关闭（空清单≠没有问题）");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

// ── 整改5：展示序号 ANOM-N（发号单调递增、重启稳定、prior 状态不被覆盖） ──
test("assigns stable monotonic displaySeq on first sight and keeps it across reloads", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-seq-"));
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    const mk = (id, createdAt) => ({ issueId: id, issueKind: "missing_field", title: id, evidence: [{ path: "a.md" }], expectedRevisions: {}, proposedAction: { type: "entity-repair", sourceKey: "a.md", field: "x" }, createdAt });
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [mk("b-late", "2026-10-07T02:00:00.000Z"), mk("a-early", "2026-10-07T01:00:00.000Z")] });
    const first = service.list().issues;
    const early = first.find((item) => item.issueId === "a-early");
    const late = first.find((item) => item.issueId === "b-late");
    assert.ok(Number.isInteger(early.displaySeq) && Number.isInteger(late.displaySeq), "两条都拿到序号");
    assert.ok(early.displaySeq < late.displaySeq, "createdAt 早者序号小（存量补号按时间排序）");
    // 重启（新实例同账本）序号不变
    const service2 = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [mk("b-late", "2026-10-07T02:00:00.000Z"), mk("a-early", "2026-10-07T01:00:00.000Z")] });
    const second = service2.list().issues;
    assert.equal(second.find((item) => item.issueId === "a-early").displaySeq, early.displaySeq, "重启后序号稳定");
    // 新问题接续递增不复用
    const service3 = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [mk("c-new", "2026-10-07T03:00:00.000Z"), mk("a-early", "2026-10-07T01:00:00.000Z")] });
    const third = service3.list().issues;
    assert.ok(third.find((item) => item.issueId === "c-new").displaySeq > late.displaySeq, "新问题号接续递增");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

// PR-036（2026-10-08）：evidence 源文件已删除的账本条目，reconcileDiagnostic 直接销账——
// 根因：历史条目无 diagnosticTracked 门票，applyLedgerTransitions「不再检出→verified」循环
// 永远跳过它们（62 僵尸实证）。修复语义：源消失=问题不可能再检出，closed 留审计原因；幂等。
test("PR-036 reconcile closes entries whose evidence source file is deleted", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-pr036-"));
  try {
    // 台账预置：一条 evidence 指向已删除文件（僵尸），一条指向存在文件（活）
    const alive = path.join(vaultPath, "知识库", "wiki", "entities", "alive.md");
    fs.mkdirSync(path.dirname(alive), { recursive: true });
    fs.writeFileSync(alive, "---\ntitle: alive\n---\n");
    const ledger = {
      "zombie-gone": {
        issueSnapshot: { issueId: "zombie-gone", issueKind: "missing_field", title: "僵尸", status: "open",
          evidence: [{ path: "知识库/wiki/entities/deleted.md" }], expectedRevisions: { sourceHash: "sha256:x" } },
        status: "verified", // 2026-09 时代形态：无 diagnosticTracked
      },
      "alive-issue": {
        issueSnapshot: { issueId: "alive-issue", issueKind: "missing_field", title: "活问题", status: "open",
          evidence: [{ path: "知识库/wiki/entities/alive.md" }], expectedRevisions: { sourceHash: "sha256:y" } },
        status: "open", diagnosticTracked: true, diagnosticActive: true,
      },
    };
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, ledger);

    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [] });
    const result = service.reconcileDiagnostic({ state: "succeeded", jobId: "job-pr036" });
    assert.equal(result.sourceDeletedCount, 1, "僵尸条目被销账计数");
    const after = readAnomaly(vaultPath);
    assert.equal(after["zombie-gone"].issueSnapshot.status, "closed", "僵尸 closed");
    assert.match(after["zombie-gone"].closure.reason, /PR-036/, "留审计原因");
    assert.equal(after["alive-issue"].issueSnapshot.status !== "closed" || after["alive-issue"].status === "verified", true, "活文件条目不走 sourceDeleted 路径");
    // 幂等：再跑一遍不重复计数
    const again = service.reconcileDiagnostic({ state: "succeeded", jobId: "job-pr036-2" });
    assert.equal(again.sourceDeletedCount, 0, "已 closed 不重写（幂等）");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

// ── 三能力归位（Master 裁 2026-10-14）：①源删除销账②stuck-rerunning 重置③verified 托管
//    下沉到读时对账——「刷新并重检」按钮退役，拉列表即完整对账。──

test("① read path closes entries whose evidence source file is deleted (no reconcileDiagnostic)", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-pr036-read-"));
  try {
    const ledger = {
      "zombie-read": {
        issueSnapshot: { issueId: "zombie-read", issueKind: "missing_field", title: "读路径僵尸", status: "open",
          evidence: [{ path: "知识库/wiki/entities/gone.md" }], expectedRevisions: {} },
        status: "verified", // 2026-09 时代形态：无 diagnosticTracked 门票
      },
    };
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, ledger);
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [] });
    service.list(); // 纯读路径（不调 reconcileDiagnostic）
    const after = readAnomaly(vaultPath);
    assert.equal(after["zombie-read"].issueSnapshot.status, "closed", "读时即销账，不等全局诊断");
    assert.equal(after["zombie-read"].closure.mechanism, "reconcileDiagnostic.sourceDeleted", "销账机制留审计");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("② read path resets stuck rerunning and keeps in-flight rerunning intact", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-stuck-rerunning-"));
  const issue = { issueId: "stuck-1", issueKind: "missing_field", title: "滞留重跑", evidence: [{ path: "a.md" }], expectedRevisions: {}, proposedAction: { type: "repair" } };
  try {
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    seedAnomaly(vaultPath, {
      "stuck-1": { issueSnapshot: { ...issue }, status: "rerunning", pipelineResult: { jobId: "job-gone" }, diagnosticTracked: true },
    });
    // 管道 jobId 已失配（无 live status）→ stuck → 读时回 open（转移表无任何操作可从 rerunning 出发）
    const stuck = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [issue], getPipelineStatus: () => null });
    assert.equal(stuck.list().issues.find((item) => item.issueId === "stuck-1").status, "open", "stuck-rerunning 读时回待办");
    // 在途管道（jobId 匹配 running）→ 保持 rerunning，页面读取不得打断在途翻转
    seedAnomaly(vaultPath, {
      "stuck-1": { issueSnapshot: { ...issue }, status: "rerunning", pipelineResult: { jobId: "job-live" }, diagnosticTracked: true },
    });
    const inflight = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => [issue], getPipelineStatus: () => ({ state: "running", jobId: "job-live" }) });
    assert.equal(inflight.list().issues.find((item) => item.issueId === "stuck-1").status, "rerunning", "在途 rerunning 不被读时重置");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("③ read-time verification hosts source document status online", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "anomaly-read-hosting-"));
  const docPath = path.join(vaultPath, "知识库", "wiki", "entities", "doc.md");
  let active = true;
  const issue = { issueId: "host-1", issueKind: "missing_field", title: "托管", evidence: [{ path: "知识库/wiki/entities/doc.md" }], expectedRevisions: {}, proposedAction: { type: "repair" } };
  try {
    fs.mkdirSync(path.dirname(docPath), { recursive: true });
    fs.writeFileSync(docPath, "---\nstatus: 灰度\ntitle: doc\n---\n正文\n");
    fs.mkdirSync(path.join(vaultPath, ".ledger"), { recursive: true });
    const service = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => active ? [issue] : [] });
    service.list(); // 首读：检出＋补追踪门票
    active = false; // 外部修复，问题不再检出
    service.list(); // 读时销账 → verified → 托管写回
    assert.equal(readAnomaly(vaultPath)["host-1"].status, "verified", "读时盖 verified 印章");
    assert.match(fs.readFileSync(docPath, "utf8"), /status: 在线/, "源文档被读时销账托管置在线");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});
