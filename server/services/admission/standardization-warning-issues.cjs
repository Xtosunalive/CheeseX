// @responsible: 将文章标准化警告收集为不阻断业务的异常工作台问题。
const fs = require("fs");
const path = require("path");
const { readWorkflowState } = require("../article-workflow/article-workflow-store.cjs");

// 标准化校验 WARNING 收集器：标准化通过的文章保留 WARNING 记录，
// 这些 WARNING 不阻断标准化（文章已可检索阅读），仅作为待处理问题进入异常工作台。
// 图事实准入是独立轨道，因此此类问题不阻断任何业务动作。
function collectStandardizationWarningIssues(vaultPath) {
  const issues = [];
  let state;
  try { state = readWorkflowState(vaultPath); } catch (_error) { return issues; }
  const articles = state.articles || [];
  for (const record of articles) {
    const warnings = Array.isArray(record.standardizationWarnings) ? record.standardizationWarnings : [];
    if (!warnings.length) continue;
    // 源文件已不存在 → 警告卡随源退场（#1393 收尾；SPEC-030 机②值域收敛：原
    // record.status === "source_deleted_pending_retirement" 判断随幽灵第四态删除——
    // 该值自始无写方且 record 无 status 键，存在性检查才是唯一生效语义）。
    if (typeof record.sourcePath === "string" && record.sourcePath && !fs.existsSync(path.join(vaultPath, ...record.sourcePath.split("/")))) continue;
    const versionHash = record.currentStandardVersion ? record.currentStandardVersion.contentHash : record.contentHash || "unknown";
    const articleLabel = record.articleId || record.candidateId;
    for (const warning of warnings) {
      issues.push({
        issueId: `standardization-check-${warning.proposalId || articleLabel}-${(warning.proposalCommit || versionHash).slice(0, 12)}-${warning.ruleId || warning.code}`,
        issueKind: "standardization_warning",
        title: `标准化 WARNING Check：${record.currentStandardVersion?.title || articleLabel}`,
        evidence: [{ kind: "proposal-check", path: record.sourcePath, coordinate: warning.sourceCoordinate || record.sourcePath, ruleId: warning.ruleId || warning.code, message: warning.message, proposalId: warning.proposalId, proposalCommit: warning.proposalCommit, checksId: warning.checksId }],
        expectedRevisions: { contentHash: versionHash, proposalId: warning.proposalId, proposalCommit: warning.proposalCommit, checksId: warning.checksId },
        proposedAction: null,
      });
    }
  }
  // promote 上报通道已退役（2026-09-05 重构）：字段缺口卡统一由扫描通道读时派生
  // （scanCandidateArticleSources → checkArticleCompliance，PRD 红线"不建立第二套状态"）。
  return issues;
}

module.exports = { collectStandardizationWarningIssues };
