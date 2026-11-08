// @responsible: 管理治理异常的收集、状态流转、处置预览、确认与复核。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeRelationCandidate } = require("../governance/relation-candidate-contract.cjs");
const { appendReviewAction, listReviewIssueIds } = require("../governance/review-action-store.cjs");
const { logger: jsonLogger } = require("../../shared/json-logger.cjs");
const { span } = require("../../shared/langfuse-tracer.cjs");
const { applyLedgerTransitions } = require("./anomaly-ledger-transitions.cjs");
// 2026-10-08 字段托管：问题状态机事件 → 源文档 status 迁移写回（verified→在线 / reject→退役 / reopen→灰度）
const { writeStatusByEvent } = require("./status-event-writer.cjs");

const ISSUE_KINDS = new Set(["missing_field", "unrecognized_entity", "relation_conflict", "article_association", "version_scope", "stale_source", "missing_entity", "missing_lineage", "pipeline_failure", "standardization_warning", "release_publication_failure", "wild_tag"]);

// ── 集中转移表（规则 8 单源：合法转移唯一定义于此，文档索引见 docs/design/anomaly-state-machine.md §三）──
// 操作 → 允许的起始状态；不属于 Anomaly 状态机的操作（reject）不在此约束。
const OPERATION_PRECONDITIONS = {
  preview: ["open", "stale", "blocked", "previewed"], // 生成/重新生成预览（verified 不可）
  confirm: ["previewed"],                              // 确认必须基于有效预览
  rerun: ["confirmed", "executed"],                    // 确认或重跑后可重跑管道
  verify: ["executed"],                                // 复核必须已重跑
  close: ["open", "reopened"],                         // 持久 Issue 显式关闭
  reopen: ["closed"],                                  // 仅已关闭可重开
};

// 转移合法性校验（错误码由调用方传入，保持既有语义；非法转移 fail-closed 409）
function assertOperationPrecondition(operation, status, code, message) {
  const allowed = OPERATION_PRECONDITIONS[operation];
  if (allowed && !allowed.includes(status)) {
    throw serviceError(code || "ANOMALY_STATE_TRANSITION_FORBIDDEN", message || `操作 ${operation} 不允许从状态 ${status} 执行`, 409, { operation, status, allowed });
  }
}

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const serviceError = bindErrorFactory({ status: 400 });

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw serviceError("INVALID_ANOMALY", `${field} must be non-empty`);
  return value.trim();
}

function blockedActions(raw, issueKind) {
  const values = Array.isArray(raw) ? raw : [];
  const normalized = values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
  if (normalized.length > 0) return [...new Set(normalized)];
  // 标准化校验 WARNING 不阻断任何业务动作：文章已可检索阅读，图事实准入是独立轨道。
  if (issueKind === "standardization_warning") return [];
  // 野生标签同立场（D5 裁决 2026-09-14）：待裁定的候选值不阻断发布，裁定通道是「待沉淀标签」。
  if (issueKind === "wild_tag") return [];
  if (issueKind === "pipeline_failure") return ["complete_global_diagnostic"];
  if (issueKind === "release_publication_failure") return ["publish_graph"];
  if (["article_association", "relation_conflict", "unrecognized_entity", "missing_entity", "missing_lineage"].includes(issueKind)) return ["publish_graph"];
  return ["publish_graph"]; // #1403：approve_article 已退役（ADR019），不默认塞入
}
const { deriveIssueHandling } = require("../governance/anomaly-handling-mode.cjs");
const { writeVault, writeVaultExclusive } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）
function normalizeIssue(raw, index = 0, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw serviceError("INVALID_ANOMALY", `issues[${index}] must be an object`);
  const issueKind = text(raw.issueKind, `issues[${index}].issueKind`);
  if (!ISSUE_KINDS.has(issueKind)) throw serviceError("INVALID_ANOMALY", `issues[${index}].issueKind is unsupported`);
  const evidence = Array.isArray(raw.evidence) ? raw.evidence : [];
  if (evidence.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw serviceError("INVALID_ANOMALY", `issues[${index}].evidence must contain objects`);
  let relationCandidate;
  if (raw.relationCandidate !== undefined) {
    // D3（seq150）：候选状态以账本持久化态为准（candidateStatus/rejection 随 issue 存取），
    // 旧 proposalService.resolveCandidateStatus 归一化钩子随 E4' 账本退役一并删除（09:146）。
    relationCandidate = normalizeRelationCandidate(raw.relationCandidate, { registry: options.relationRegistry });
  }
  return {
    issueId: text(raw.issueId || `${issueKind}-${index}`, `issues[${index}].issueId`),
    issueKind, handling: deriveIssueHandling(raw),
    title: text(raw.title || issueKind, `issues[${index}].title`),
    status: raw.status || "open",
    evidence: evidence.map((item) => ({ ...item })),
    expectedRevisions: raw.expectedRevisions && typeof raw.expectedRevisions === "object" && !Array.isArray(raw.expectedRevisions) ? { ...raw.expectedRevisions } : {},
    blockedActions: blockedActions(raw.blockedActions, issueKind),
    proposedAction: raw.proposedAction || null,
    ...(relationCandidate ? { relationCandidate } : {}),
    updatedAt: raw.updatedAt || null,
    // WP0（2026-10-07 Master 晨裁）：owner=上传账号/源责任人，createdAt=首次检出时间。
    // 产出源四域口径见 openapi AnomalyIssue.owner/createdAt description——持久类由 ledger
    // 兼容层补全（issueSnapshot 合并时首见落账），读时派生类从采集器 raw 直读，缺省 null。
    owner: typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : null,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : null,
    // 整改5：展示序号 ANOM-N——账本首见分配（normalize 只透传，分配在 list 的合并层）
    displaySeq: Number.isInteger(raw.displaySeq) ? raw.displaySeq : null,
  };
}

function pipelineFailureIssue(job, timestamp) {
  const stage = typeof job.stage === "string" && job.stage.trim() ? job.stage.trim() : "unknown";
  const message = typeof job.message === "string" && job.message.trim() ? job.message.trim() : "管道运行失败";
  const fingerprint = crypto.createHash("sha256").update(`${stage}\0${message}`).digest("hex").slice(0, 20);
  return normalizeIssue({
    issueId: `pipeline-failure-${fingerprint}`,
    issueKind: "pipeline_failure",
    title: `全局管道诊断在阶段 ${stage} 失败：${message}`,
    status: "open",
    evidence: [{
      kind: "pipeline-runner",
      path: "知识库/.claude/scripts/pipeline-runner.py",
      coordinate: `pipeline-stage:${stage}`,
      ruleId: "pipeline.global-diagnostic",
    }],
    expectedRevisions: { pipelineJobId: job.jobId || "unknown", pipelineStage: stage },
    blockedActions: ["complete_global_diagnostic"],
    proposedAction: null,
    updatedAt: timestamp,
  });
}

function hasDecisionCompletePreview(issue, prior) {
  if (!prior || prior.status !== "previewed") return true;
  const preview = prior.actionPreview;
  if (!preview || preview.accepted !== true || !preview.token) return false;
  const actionType = issue.proposedAction && issue.proposedAction.type;
  const summary = preview.summary || {};
  if (actionType === "entity-repair") return Boolean(summary.beforeValues && summary.afterValues);
  if (actionType === "entity-relation-repair") return Boolean(summary.bodyPatch);
  if (["article-association", "article-association-reload"].includes(actionType)) return typeof summary.articleTitle === "string";
  if (actionType === "inference-review") return typeof summary.selectedEffect === "string" && typeof summary.decisionReason === "string";
  return true;
}

// supersededReason / reopenSupersededIssue 已随统一账本变迁迁至 anomaly-ledger-transitions.cjs（ADR063 决策 4：变迁规则单一实现）

// ── 三能力归位（Master 裁 2026-10-14）：①源删除销账＋③verified 托管从显式 reconcile 下沉到
//    读时对账，读路径即完整对账——「刷新并重检」按钮随之退役（程序化入口保留给 B1 批量修复）。──

/** ①evidence 源文件已物理删除的账本条目直接销账（PR-036 语义原样；读路径/对账路径共用；幂等：已 closed 不重写）。
 *  只处理本轮未检出的条目——仍被检出的问题定义上源仍活跃，销账与其矛盾。 */
function closeDeletedSourceEntries(ledger, vaultPath, timestamp, detectedIds) {
  let closedCount = 0;
  for (const [issueId, prior] of Object.entries(ledger)) {
    if (!prior || !prior.issueSnapshot || prior.issueSnapshot.status === "closed") continue;
    if (detectedIds && detectedIds.has(issueId)) continue;
    const ev = (prior.issueSnapshot.evidence || [])[0];
    const evPath = ev && (ev.path || ev.sourcePath);
    if (!evPath || typeof evPath !== "string" || !evPath.startsWith("知识库/")) continue;
    if (fs.existsSync(path.join(vaultPath, evPath))) continue;
    prior.issueSnapshot.status = "closed";
    prior.closure = {
      reason: "PR-036：evidence 源文件已删除，问题不可能再检出——直接销账",
      closedAt: timestamp,
      mechanism: "reconcileDiagnostic.sourceDeleted",
    };
    prior.updatedAt = timestamp;
    closedCount += 1;
  }
  return closedCount;
}

/** ③字段托管：本轮新盖 verified 印章的条目 → 源文档 status 置在线（读时/对账两路径共用；守卫校验非法迁移静默不落盘） */
function hostVerifiedSourceStatus(vaultPath, ledger, timestamp) {
  for (const [, entry] of Object.entries(ledger)) {
    if (!entry || entry.status !== "verified" || entry.verifiedAt !== timestamp) continue;
    // snapshot.sourceKey 恒空（collector 不产该键）——同 reject 兜底：proposedAction.sourceKey → evidence[].path/sourcePath
    const snap = entry.issueSnapshot || {};
    const verifiedSourceKey = snap.sourceKey
      || (snap.proposedAction && snap.proposedAction.sourceKey)
      || (snap.evidence || []).map((e) => e && (e.path || e.sourcePath)).find((v) => typeof v === "string" && v.startsWith("知识库/"))
      || null;
    if (verifiedSourceKey) writeStatusByEvent(vaultPath, verifiedSourceKey, "confirm-verified");
  }
}

function createAnomalyWorkbenchService(options = {}) {
  const vaultPath = path.resolve(options.vaultPath || process.cwd());
  // SPEC-012 wave-2：台账迁 runtime-state.db anomaly 族（勘察实证②③混合体：快照可重派生、
  // 操作状态/令牌/审计/发号器不可重建——③类归宿；旧 447KB 全文件 parse/全量覆写随之退役）
  const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
  const anomalyStore = () => getRuntimeStateStore(vaultPath).anomaly;
  const now = options.now || (() => new Date());
  const log = options.logger || jsonLogger;
  const collectIssues = options.collectIssues || (() => []);
  const operatorContext = options.operatorContext || null;
  const relationRegistry = options.relationRegistry || null;
  const actionAdapter = options.actionAdapter || null;
  const executionReady = Boolean(actionAdapter) || typeof options.executeAction === "function";
  const executeAction = options.executeAction || (() => ({
    accepted: false,
    blocked: true,
    reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED",
  }));
  const rerunPipeline = options.rerunPipeline || (() => ({ accepted: false, reason: "PIPELINE_NOT_CONFIGURED" }));
  const getPipelineStatus = options.getPipelineStatus || (() => null);
  const verifyIssue = options.verifyIssue || (() => ({ verified: true }));

  function readLedger() {
    try {
      return anomalyStore().all();
    } catch (error) { throw serviceError("ANOMALY_LEDGER_CORRUPT", error.message, 503); }
  }
  function writeLedger(ledger) {
    try { anomalyStore().replaceAll(ledger); }
    catch (error) { throw serviceError("ANOMALY_LEDGER_WRITE_FAILED", error.message, 500); }
  }
  // PR-104：读时对账——裁决行引用的 issue 不在账本即 warn（观测不拦截；账本整表重写＋审计 append-only
  // 使 FK 不可物理化，此为替代执法面）
  function warnDanglingDecisions(ledger) {
    try {
      const present = ledger && typeof ledger === "object" ? ledger : {};
      const dangling = listReviewIssueIds(vaultPath).filter((id) => !Object.prototype.hasOwnProperty.call(present, id));
      if (dangling.length > 0) log.warn({ event: "review-actions-issue-dangling", count: dangling.length, issueIds: dangling.slice(0, 10) });
    } catch (error) {
      log.warn({ event: "review-actions-issue-reconcile-failed", error: error.message });
    }
  }
  function collectSource() {
    const raw = collectIssues();
    if (Array.isArray(raw)) return { issues: raw, workingRevisions: {} };
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.issues)) {
      throw serviceError("INVALID_ANOMALY_SOURCE", "collectIssues must return an array or { issues, workingRevisions }", 500);
    }
    const workingRevisions = raw.workingRevisions && typeof raw.workingRevisions === "object" && !Array.isArray(raw.workingRevisions)
      ? { ...raw.workingRevisions }
      : {};
    return { issues: raw.issues, workingRevisions };
  }
  function collectedIssues(source = collectSource()) {
    return source.issues.map((issue, index) => normalizeIssue(issue, index, { relationRegistry }));
  }
  function currentIssues(options = {}, source = collectSource()) {
    const collected = collectedIssues(source);
    // Stale source findings are historical audit records. They have no safe
    // write action and must not remain in the actionable queue by default.
    const actionableCollected = options.includeResolved === true
      ? collected
      : collected.filter((issue) => issue.issueKind !== "stale_source");
    const ledger = readLedger();
    const readTimestamp = now().toISOString();
    // ①源删除销账（Master 裁 2026-10-14 归位）：外部删文件的僵尸条目读时即销账，不再等全局诊断。
    const sourceDeletedCount = closeDeletedSourceEntries(ledger, vaultPath, readTimestamp, new Set(collected.map((issue) => issue.issueId)));
    const pipelineStatus = getPipelineStatus();
    // ADR063 决策 4：读时对账——rerunning 翻转 + 重开被取代 + 不再检出→关闭（写即改），单一变迁实现。
    const { changed: ledgerChanged, verifiedCount } = applyLedgerTransitions({
      ledger,
      detected: collected,
      pipelineJob: {},
      pipelineStatus,
      timestamp: readTimestamp,
      mode: "read",
    });
    if (ledgerChanged || sourceDeletedCount > 0) { writeLedger(ledger); warnDanglingDecisions(ledger); }
    // ③verified 托管（Master 裁 2026-10-14 归位）：读时销账的条目同样把源文档 status 置在线。
    if (verifiedCount > 0) hostVerifiedSourceStatus(vaultPath, ledger, readTimestamp);
    // 整改5：展示序号分配（ANOM-N 单调递增不复用）——首见（prior 无 displaySeq）即发号；
    // 存量历史按 createdAt 升序补号（无 createdAt 的排最后按 issueId 稳定序）。发号后写回
    // 账本持久化，重启/刷新序号稳定；两视图（列表/peek）取同一账本值天然一致。
    const needSeq = actionableCollected.filter((issue) => {
      const prior = ledger[issue.issueId];
      return !prior || !Number.isInteger(prior.displaySeq);
    });
    if (needSeq.length > 0) {
      needSeq.sort((a, b) => {
        const at = a.createdAt || "";
        const bt = b.createdAt || "";
        if (at !== bt) return at < bt ? -1 : 1;
        return a.issueId < b.issueId ? -1 : 1;
      });
      let nextSeq = Object.values(ledger).reduce((max, entry) => Math.max(max, Number.isInteger(entry && entry.displaySeq) ? entry.displaySeq : 0), 0);
      for (const issue of needSeq) {
        nextSeq += 1;
        // 只补 displaySeq 一个字段——绝不展开 issue 实时字段覆盖 prior（transitions 刚做的
        // 降级/reopen 状态与 actionPreview 会被冲掉，downgrades 测试实证过一次）
        const prior = ledger[issue.issueId] || {};
        ledger[issue.issueId] = { ...prior, displaySeq: nextSeq };
      }
      writeLedger(ledger);
    }
    const activeIds = new Set(actionableCollected.map((issue) => issue.issueId));
    const issues = actionableCollected.map((issue) => {
      const prior = ledger[issue.issueId];
      const ready = actionAdapter && typeof actionAdapter.supports === "function" ? actionAdapter.supports(issue) : executionReady;
      const compatiblePrior = prior && actionAdapter && !hasDecisionCompletePreview(issue, prior)
        ? { ...prior, status: "open", previewId: undefined, actionPreview: undefined, previewRevisions: undefined, previewedAt: undefined }
        : prior;
      // WP0：createdAt 首见落账（prior 首次检出时间不可考则当下）；owner 持久类以 prior 为准
      //（同 issue 跨会话责任人稳定），读时派生类以实时扫描为准（compatiblePrior 缺失时用 issue 值）。
      const firstSeenAt = (prior && prior.createdAt) || issue.createdAt || new Date().toISOString();
      const stableOwner = compatiblePrior ? (compatiblePrior.owner ?? issue.owner ?? null) : (issue.owner ?? null);
      const stableSeq = Number.isInteger(prior && prior.displaySeq) ? prior.displaySeq : issue.displaySeq;
      return compatiblePrior
        ? {
            ...issue,
            ...compatiblePrior,
            // proposedAction 以实时扫描为准：ledger 持久化的旧 proposedAction
            // （含修复前存入的 currentValue，如 wikilink [[主模块]]）不得覆盖实时结果，
            // 否则来源已修复后页面仍显示旧值（REQUIREMENTS #827 延伸）。
            proposedAction: issue.proposedAction !== undefined ? issue.proposedAction : compatiblePrior.proposedAction,
            issueSnapshot: undefined,
            evidence: issue.evidence,
            expectedRevisions: issue.expectedRevisions,
            executionReady: ready,
            sourceActive: true,
            owner: stableOwner,
            createdAt: firstSeenAt,
            displaySeq: stableSeq,
          }
        : { ...issue, executionReady: ready, sourceActive: true, owner: stableOwner, createdAt: firstSeenAt, displaySeq: stableSeq };
    });
    for (const [issueId, prior] of Object.entries(ledger)) {
      if (activeIds.has(issueId) || !prior || !prior.issueSnapshot) continue;
      if (options.includeResolved !== true && prior.issueSnapshot.issueKind === "stale_source") continue;
      // 契约 required 兜底：存量旧形态条目（如缺 handling 的历史快照）经单源派生补面——
      // 2026-10-14 真实 vault 实证 includeResolved 视图被 enforce 拦截（文件时代同样外泄的既有缺陷）
      const handlingFallback = (entry) => (entry.handling !== undefined ? entry : { ...entry, handling: deriveIssueHandling(entry) });
      if (prior.diagnosticActive === true) {
        const snapshot = prior.issueSnapshot;
        const ready = actionAdapter && typeof actionAdapter.supports === "function" ? actionAdapter.supports(snapshot) : executionReady;
        issues.push(handlingFallback({ ...snapshot, ...prior, issueSnapshot: undefined, evidence: snapshot.evidence, expectedRevisions: snapshot.expectedRevisions, executionReady: ready, sourceActive: true }));
        continue;
      }
      if (options.includeResolved !== true) continue;
      const snapshot = prior.issueSnapshot;
      const ready = actionAdapter && typeof actionAdapter.supports === "function" ? actionAdapter.supports(snapshot) : executionReady;
      issues.push(handlingFallback({ ...snapshot, ...prior, issueSnapshot: undefined, evidence: snapshot.evidence, expectedRevisions: snapshot.expectedRevisions, executionReady: ready, sourceActive: false }));
    }
    return options.includeResolved === true ? issues : issues.filter((issue) => issue.status !== "closed");
  }
  function list(options = {}) {
    const source = collectSource();
    const issues = currentIssues(options, source);
    return { generatedAt: now().toISOString(), issues, total: issues.length, workingRevisions: source.workingRevisions };
  }
  function get(issueId) {
    const issue = currentIssues({ includeResolved: true }).find((item) => item.issueId === issueId);
    if (!issue) throw serviceError("ANOMALY_NOT_FOUND", "异常问题不存在", 404, { issueId });
    return issue;
  }
  function update(issueId, patch) {
    const ledger = readLedger();
    ledger[issueId] = { ...(ledger[issueId] || {}), ...patch, updatedAt: now().toISOString() };
    writeLedger(ledger);
    return get(issueId);
  }
  function reconcileDiagnostic(pipelineJob = {}) {
    const timestamp = now().toISOString();
    const detected = collectedIssues(collectSource());
    if (["failed", "cancelled"].includes(pipelineJob.state)) detected.push(pipelineFailureIssue(pipelineJob, timestamp));
    const ledger = readLedger();
    // PR-036 修复（2026-10-08）：evidence 源文件已物理删除的条目直接销账——
    // Master 裁 2026-10-14 归位后与读路径共用 closeDeletedSourceEntries：
    // sourceDeleted 销账 ≠ verified（非复诊通过），closed 留审计原因；幂等（已 closed 不重写）。
    const sourceDeletedCount = closeDeletedSourceEntries(ledger, vaultPath, timestamp, new Set(detected.map((issue) => issue.issueId)));
    // ADR063 决策 4：与读路径共用单一变迁实现；reconcile 模式=重置+追踪标记+关闭，pipelineStatus=null 保持原行为（无 rerunning 翻转）。
    const { verifiedCount, detectedIds } = applyLedgerTransitions({
      ledger,
      detected,
      pipelineJob,
      pipelineStatus: null,
      timestamp,
      mode: "reconcile",
    });
    writeLedger(ledger);
    // 2026-10-08 字段托管：本轮新盖 verified 印章的条目 → 源文档 status 置在线
    //（Master 裁 2026-10-14 归位后与读路径共用 hostVerifiedSourceStatus；守卫校验「灰度→在线」
    // 合法性+幂等，非法迁移静默不落盘由哨兵诊断兜底）
    if (verifiedCount > 0) hostVerifiedSourceStatus(vaultPath, ledger, timestamp);
    // 状态语义：全局管道成功 → completed；显式 reconcile 端点（无 state）也是成功执行 → completed；
    // 仅管道显式失败/取消 → failed。修复前显式 reconcile 永远报 failed（#875 逆向核查）。
    const succeeded = pipelineJob.state === "succeeded" || (pipelineJob.state === undefined && pipelineJob.purpose === "reconcile");
    return {
      status: succeeded ? "completed" : "failed",
      generatedAt: timestamp,
      blockerCount: detected.length,
      verifiedCount,
      sourceDeletedCount,
      issueIds: [...detectedIds].sort(),
      message: detected.length > 0 ? `发现 ${detected.length} 项待处理问题` : "未发现待处理问题",
    };
  }
  function preview(issueId, payload = {}) {
    return span("anomaly-workbench.preview", {
      input: { issueId, actionType: payload.action ? payload.action.type : null },
      output: function (result) { return { status: result && result.status }; },
    }, function () { return previewInner(issueId, payload); });
  }

  function previewInner(issueId, payload = {}) {
    const issue = get(issueId);
    assertOperationPrecondition("preview", issue.status, "ANOMALY_NOT_ACTIONABLE", "该异常已经复核结束");
    if (issue.evidence.length === 0 || Object.keys(issue.expectedRevisions).length === 0) throw serviceError("ANOMALY_EVIDENCE_REQUIRED", "异常缺少来源证据或 revision，不能生成处理预览", 409);
    let actionPreview = null;
    if (actionAdapter && typeof actionAdapter.preview === "function") {
      const action = issue.proposedAction && typeof issue.proposedAction === "object" && !Array.isArray(issue.proposedAction) ? issue.proposedAction : {};
      const relatedIssues = action.type === "entity-repair" && typeof action.sourceKey === "string"
        ? collectedIssues().filter((candidate) => {
          const candidateAction = candidate.proposedAction && typeof candidate.proposedAction === "object" && !Array.isArray(candidate.proposedAction) ? candidate.proposedAction : {};
          return candidateAction.type === "entity-repair" && candidateAction.sourceKey === action.sourceKey;
        })
        : [issue];
      actionPreview = actionAdapter.preview(issue, payload, { relatedIssues }) || {};
    }
    const previewId = `preview-${crypto.randomUUID()}`;
    return update(issueId, {
      issueSnapshot: issue,
      status: "previewed",
      previewId,
      actionPreview,
      previewRevisions: issue.expectedRevisions,
      previewedAt: now().toISOString(),
      executionError: undefined,
      executionResult: undefined,
      pipelineResult: undefined,
    });
  }
  function confirm(issueId, payload = {}) {
    return span("anomaly-workbench.confirm", {
      input: { issueId, actionType: payload.action ? payload.action.type : null },
      output: function (result) { return { status: result && result.status }; },
    }, function () { return confirmInner(issueId, payload); });
  }

  function confirmInner(issueId, payload = {}) {
    const issue = get(issueId);
    assertOperationPrecondition("confirm", issue.status, "ANOMALY_PREVIEW_REQUIRED", "必须使用当前有效预览确认");
    if (payload.previewId !== issue.previewId) throw serviceError("ANOMALY_PREVIEW_REQUIRED", "必须使用当前有效预览确认", 409);
    const latest = get(issueId);
    const current = collectedIssues().find((item) => item.issueId === issueId);
    if (!current) return update(issueId, { status: "stale", staleReason: "预览对应的问题来源已变化或消失" });
    if (JSON.stringify(current.expectedRevisions) !== JSON.stringify(latest.expectedRevisions)) return update(issueId, { status: "stale", staleReason: "预览后的来源 revision 已变化" });
    if (JSON.stringify(latest.expectedRevisions) !== JSON.stringify(latest.previewRevisions)) return update(issueId, { status: "stale", staleReason: "预览后的来源 revision 已变化" });
    let result;
    try { result = actionAdapter && typeof actionAdapter.execute === "function" ? actionAdapter.execute(latest, payload) || {} : executeAction(latest, payload) || {}; }
    catch (error) { return update(issueId, { status: "blocked", executionError: error.message }); }
    if (result.accepted !== true) {
      return update(issueId, {
        status: "blocked",
        executionResult: result,
        executionError: result.reason || "异常动作未被写回适配器接受",
      });
    }
    const confirmedAt = now().toISOString();
    const remainsActive = collectedIssues().some((item) => item.issueId === issueId);
    return update(issueId, {
      status: "confirmed",
      executionResult: result,
      confirmedAt,
      ...(remainsActive ? {} : { diagnosticActive: false, locallyResolvedAt: confirmedAt }),
    });
  }
  function reject(issueId, payload = {}) {
    // D3（seq150）：拒绝=纯审计（09:139），真实记录器=review-action-store.appendReviewAction（与 kg/review 同源，09:146）。
    // 旧 git-proposal 路径（createProposal/commitInProposal/recordCandidateRejection）已随 E4' 账本退役删除；
    // 生产装配（main.cjs）从不注入 proposalService，旧守卫致拒绝必然 503——此处不再依赖 proposalService。
    const issue = get(issueId);
    if (!issue.relationCandidate) throw serviceError("RELATION_CANDIDATE_REQUIRED", "该问题不是关系候选", 409);
    if (issue.relationCandidate.candidateStatus === "rejected") return issue;
    if (!operatorContext || typeof operatorContext.getOperatorId !== "function") throw serviceError("OPERATOR_CONTEXT_NOT_CONFIGURED", "架构师身份服务未接入", 503);
    const actor = operatorContext.getOperatorId();
    if (typeof payload.reason !== "string" || !payload.reason.trim()) throw serviceError("RELATION_REJECTION_REASON_REQUIRED", "拒绝原因不能为空", 400);
    const reason = payload.reason.trim();
    const candidateId = issue.relationCandidate.candidateId;
    const rejectedAt = now().toISOString();
    // 1) 审计（append-only，与 kg/review 同一 review_actions.json；拒绝不写正式关系、不动 ref——09:139 原文）
    appendReviewAction(vaultPath, {
      action: "rejected",
      kind: "relation_candidate",
      issueId,
      candidateId,
      candidateHash: issue.relationCandidate.candidateHash,
      evidenceSetHash: issue.relationCandidate.evidenceSetHash,
      sourceSetHash: issue.relationCandidate.sourceSetHash,
      reviewer: actor,
      reason,
      decidedAt: rejectedAt,
    });
    // 2) 账本状态落 rejected + rejection 记录（无 proposal 痕迹字段，契约 DTO 同步收缩）
    return update(issueId, {
      relationCandidate: {
        ...issue.relationCandidate,
        candidateStatus: "rejected",
        rejection: {
          candidateId,
          candidateHash: issue.relationCandidate.candidateHash,
          evidenceSetHash: issue.relationCandidate.evidenceSetHash,
          sourceSetHash: issue.relationCandidate.sourceSetHash,
          actor,
          reason,
          rejectedAt,
        },
      },
    });
    // 2026-10-08 字段托管：审批驳回 → 源文档 status 置退役（守卫校验非法迁移不落盘）。
    // 候选类问题 issue.sourceKey 常为空——从 triples[].evidence 提取文章路径兜底。
    const rejectSourceKey = issue.sourceKey
      || ((issue.relationCandidate?.triples || [])[0]?.evidence || []).map((e) => e && (e.sourceKey || e.sourcePath || e.path)).find((v) => typeof v === "string" && v.startsWith("知识库/"))
      || null;
    if (rejectSourceKey) writeStatusByEvent(vaultPath, rejectSourceKey, "reject");
    return get(issueId);
  }
  function issueActor() {
    if (!operatorContext || typeof operatorContext.getOperatorId !== "function") {
      throw serviceError("OPERATOR_CONTEXT_NOT_CONFIGURED", "架构师身份服务未接入", 503);
    }
    return operatorContext.getOperatorId();
  }
  function close(issueId, payload = {}) {
    const issue = get(issueId);
    if (issue.issueKind !== "release_publication_failure") {
      throw serviceError("PERSISTENT_ISSUE_REQUIRED", "只有持久 Issue 支持显式关闭", 409);
    }
    if (issue.status === "closed") return issue;
    assertOperationPrecondition("close", issue.status, "ISSUE_NOT_CLOSABLE", `Issue 状态 ${issue.status} 不能关闭`);
    return update(issueId, {
      issueSnapshot: issue,
      status: "closed",
      closedBy: issueActor(),
      closeReason: typeof payload.reason === "string" ? payload.reason.trim() : "",
      closedAt: now().toISOString(),
    });
  }
  function reopen(issueId, payload = {}) {
    const issue = get(issueId);
    if (issue.issueKind !== "release_publication_failure") {
      throw serviceError("PERSISTENT_ISSUE_REQUIRED", "只有持久 Issue 支持显式重开", 409);
    }
    assertOperationPrecondition("reopen", issue.status, "ISSUE_NOT_CLOSED", "只有已关闭 Issue 可以重开");
    const reopened = update(issueId, {
      issueSnapshot: issue,
      status: "reopened",
      reopenedBy: issueActor(),
      reopenReason: typeof payload.reason === "string" ? payload.reason.trim() : "",
      reopenedAt: now().toISOString(),
    });
    // 2026-10-08 字段托管：重开=修复重新提交 → 源文档 status 回灰度（守卫校验非法迁移不落盘）
    writeStatusByEvent(vaultPath, issue.sourceKey, "reopen");
    return reopened;
  }
  function rerun(issueId) {
    const issue = get(issueId);
    assertOperationPrecondition("rerun", issue.status, "ANOMALY_CONFIRM_REQUIRED", "请先确认修复动作");
    let result;
    try { result = rerunPipeline(issue) || {}; }
    catch (error) { return update(issueId, { status: "blocked", pipelineResult: { accepted: false, reason: error.code || error.message }, executionError: error.message }); }
    if (["failed", "cancelled"].includes(result.state) || result.accepted === false) {
      return update(issueId, { status: "blocked", pipelineResult: result, executionError: result.message || result.reason || "管道重跑失败", pipelineRerunAt: now().toISOString() });
    }
    return update(issueId, { status: result.state === "succeeded" ? "executed" : "rerunning", pipelineResult: result, pipelineRerunAt: now().toISOString() });
  }
  function verify(issueId) {
    const issue = get(issueId);
    assertOperationPrecondition("verify", issue.status, "ANOMALY_RERUN_REQUIRED", "请先重跑管道");
    const activeIssue = collectedIssues().find((item) => item.issueId === issueId) || null;
    const result = activeIssue ? verifyIssue(issue, activeIssue) || {} : { verified: true, reason: "问题已不再由来源检查器检出" };
    return update(issueId, result.verified === false ? { status: "stale", verificationResult: result } : { status: "verified", verificationResult: result, verifiedAt: now().toISOString() });
  }
  return { list, get, preview, confirm, reject, close, reopen, rerun, verify, reconcileDiagnostic }; // filePath 随 SPEC-012 wave-2 迁库退役
}

module.exports = { createAnomalyWorkbenchService, normalizeIssue, deriveIssueHandling, pipelineFailureIssue, ISSUE_KINDS, OPERATION_PRECONDITIONS, assertOperationPrecondition };
