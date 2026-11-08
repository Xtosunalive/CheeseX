// @responsible: 异常账本状态变迁的单一实现——读路径 / 管道对账 / N3 reconcile 端点三入口共用（ADR063 决策 4）。
// @inputs: 账本、实时检出、管道任务与状态、时间戳、模式（read=页面读取写即改 | reconcile=全局诊断/显式对账）
// @outputs: applyLedgerTransitions → { ledger, changed, verifiedCount, detectedIds }
// @context: Anomaly-Workbench；fail-closed 纪律：扫描失败由调用方抛错，绝不以空检出触发关闭。
const supersededReason = function (issue, prior) {
  if (!prior) return null;
  if (prior.status === "verified") return "已复核问题被来源检查器重新检出";
  if (prior.status === "previewed" && prior.previewRevisions && JSON.stringify(prior.previewRevisions) !== JSON.stringify(issue.expectedRevisions)) {
    return "生成预览后来源内容或规则已经变化";
  }
  return null;
};

const reopenSupersededIssue = function (issue, prior, reason, timestamp) {
  return {
    ...prior,
    issueSnapshot: issue,
    status: "open",
    previewId: undefined,
    actionPreview: undefined,
    previewRevisions: undefined,
    previewedAt: undefined,
    confirmedAt: undefined,
    pipelineResult: undefined,
    pipelineRerunAt: undefined,
    pipelineFinishedAt: undefined,
    verificationResult: undefined,
    verifiedAt: undefined,
    staleReason: reason,
    previousResolution: {
      status: prior.status,
      actionPreview: prior.actionPreview || null,
      executionResult: prior.executionResult || null,
      verificationResult: prior.verificationResult || null,
      expectedRevisions: prior.previewRevisions || prior.issueSnapshot?.expectedRevisions || {},
      reason,
      supersededAt: timestamp,
    },
    updatedAt: timestamp,
  };
};

/**
 * 统一账本变迁（幂等；只在真变化时置 changed，读路径写即改，对账路径恒写）。
 * 1. rerunning 翻转（两模式；reconcile 传 pipelineStatus=null 保持原行为）
 * 2. 检出处理：read=重开被取代＋stuck-rerunning 回 open＋补追踪门票（Master 裁 2026-10-14 归位）；
 *    reconcile=重置 confirmed/rerunning/executed/verified → open 并刷新追踪标记（诊断边界语义不变）
 * 3. 不再检出→关闭（两模式均读时生效，ADR063）：关闭带原因+时间戳留审计
 */
function applyLedgerTransitions({ ledger, detected, pipelineJob = {}, pipelineStatus = null, timestamp, mode }) {
  let changed = false;
  let verifiedCount = 0;
  const detectedIds = new Set(detected.map((issue) => issue.issueId));

  for (const [issueId, prior] of Object.entries(ledger)) {
    if (!prior || prior.status !== "rerunning" || !pipelineStatus || pipelineStatus.jobId !== prior.pipelineResult?.jobId) continue;
    if (pipelineStatus.state === "succeeded") {
      ledger[issueId] = { ...prior, status: "executed", pipelineResult: pipelineStatus, pipelineFinishedAt: pipelineStatus.finishedAt || timestamp, updatedAt: timestamp };
      changed = true;
    } else if (["failed", "cancelled"].includes(pipelineStatus.state)) {
      ledger[issueId] = { ...prior, status: "blocked", pipelineResult: pipelineStatus, executionError: pipelineStatus.message || "管道重跑失败", updatedAt: timestamp };
      changed = true;
    } else {
      ledger[issueId] = { ...prior, pipelineResult: pipelineStatus };
    }
  }

  for (const issue of detected) {
    const prior = ledger[issue.issueId];
    if (mode !== "reconcile") {
      const reason = supersededReason(issue, prior);
      if (reason) {
        ledger[issue.issueId] = reopenSupersededIssue(issue, prior, reason, timestamp);
        changed = true;
        continue;
      }
      // ②归位（Master 裁 2026-10-14）：读路径处置两类「无人工出口的滞留」——
      // stuck-rerunning（管道 jobId 已失配；转移表无任何操作可从 rerunning 出发，页面读取即回 open）
      // 与未落追踪门票的检出条目（补 diagnosticTracked/Active＋快照，使其消失时读时可销账——
      // PR-036 僵尸根因的结构性关闭）。confirmed/executed 有人工续路（rerun/verify 自它们出发），
      // 其终结仍归诊断边界（全局诊断/写后钩子），读时重置会打断 confirm→rerun→verify 生命周期。
      const priorStatus = prior ? prior.status : undefined;
      const stuckRerunning = priorStatus === "rerunning"
        && !(pipelineStatus && pipelineStatus.jobId === (prior.pipelineResult && prior.pipelineResult.jobId));
      const hasTicket = prior && prior.diagnosticTracked === true && prior.issueSnapshot;
      if (!stuckRerunning && hasTicket) continue;
      // 只补 diagnosticTracked（销账门票）；diagnosticActive 是诊断期活跃标志（display 分类用），
      // 读路径不盖——盖了会把后续不再检出的条目误分类为「诊断仍活跃」（sourceActive 错位，实测红）。
      ledger[issue.issueId] = {
        ...(prior || {}),
        issueSnapshot: issue,
        status: stuckRerunning ? "open" : (priorStatus || "open"),
        diagnosticTracked: true,
        updatedAt: timestamp,
      };
      changed = true;
      continue;
    }
    const reason = supersededReason(issue, prior);
    const base = reason ? reopenSupersededIssue(issue, prior, reason, timestamp) : { ...(prior || {}), issueSnapshot: issue };
    const resetAfterDiagnostic = ["confirmed", "rerunning", "executed", "verified"].includes(base.status);
    ledger[issue.issueId] = {
      ...base,
      issueSnapshot: issue,
      status: resetAfterDiagnostic ? "open" : (base.status || "open"),
      diagnosticTracked: true,
      diagnosticActive: true,
      lastDiagnosticJobId: pipelineJob.jobId || null,
      lastDetectedAt: timestamp,
      updatedAt: timestamp,
    };
    changed = true;
  }

  for (const [issueId, prior] of Object.entries(ledger)) {
    if (!prior || prior.diagnosticTracked !== true || detectedIds.has(issueId)) continue;
    if (mode !== "reconcile") {
      // 读模式只关「open」纯检出态（ADR063 决策 4：消失即活发现）；人工中间态
      // （previewed/confirmed/rerunning/executed/blocked）与 pipeline_failure（对账注入记录）
      // 的终结仍归下一次全局诊断——verified 印章语义由测试钉死，读时不得抢盖。
      if (prior.status !== "open" || prior.issueSnapshot?.issueKind === "pipeline_failure") continue;
    } else {
      const reopenedVerifiedIssue = prior.status === "open" && prior.diagnosticActive === false
        && typeof prior.staleReason === "string" && prior.previousResolution?.status === "verified";
      if (!(prior.diagnosticActive === true || prior.locallyResolvedAt || reopenedVerifiedIssue)) continue;
    }
    ledger[issueId] = {
      ...prior,
      status: "verified",
      diagnosticActive: false,
      verificationResult: { verified: true, reason: mode === "reconcile" ? "最新全局诊断未再检出该问题" : "最新来源扫描未再检出该问题", pipelineJobId: pipelineJob.jobId || null },
      verifiedAt: timestamp,
      updatedAt: timestamp,
    };
    verifiedCount += 1;
    changed = true;
  }

  return { ledger, changed, verifiedCount, detectedIds };
}

module.exports = { applyLedgerTransitions, reopenSupersededIssue, supersededReason };
