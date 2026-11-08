// @responsible: 根据受影响版本状态与证据生成架构变更处置推理候选。
const EFFECTS = new Set(["ASSERT", "WAIVE", "BLOCK", "SUSPEND"]);
const CHANGE_DISPOSITION_RULES = [
  "CHANGE_REQUIRED_RELEASED_USAGE",
  "CHANGE_WAIVED_DRAFT_ONLY",
  "CHANGE_BLOCKED_STALE_SOURCE",
  "CHANGE_SUSPENDED_PENDING_REVIEW",
].map((id) => ({ id, scope: "reasoning" }));

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be non-empty`);
  return value.trim();
}

function evidence(...values) { return values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()).sort(); }

function createChangeDispositionCandidateService() {
  function produce(input = {}) {
    const candidates = [];
    for (const version of Array.isArray(input.affectedVersions) ? input.affectedVersions : []) {
      const product = requiredText(version.product, "product");
      const versionId = requiredText(version.version, "version");
      const components = Array.isArray(version.componentIds) ? version.componentIds.filter((item) => typeof item === "string" && item.trim()) : [];
      for (const subjectNodeId of components) {
        const base = { conclusionKey: "architecture-change-disposition", subjectNodeId, scope: { product, version: versionId } };
        const relationEvidence = (version.removed || []).map((item) => `relation:${item.source}|${item.type}|${item.target}`);
        const pathEvidence = (version.paths || []).map((item) => `path:${(item.nodeIds || []).join(">")}`);
        if (version.stale || input.staleSources === true) candidates.push({ ...base, ruleId: "CHANGE_BLOCKED_STALE_SOURCE", effect: "BLOCK", priority: 100, evidence: evidence(`version:${product}:${versionId}`, ...relationEvidence, ...pathEvidence) });
        else if (version.status === "draft" && relationEvidence.length === 0 && pathEvidence.length === 0 && (version.documents || []).length === 0) candidates.push({ ...base, ruleId: "CHANGE_WAIVED_DRAFT_ONLY", effect: "WAIVE", priority: 30, evidence: evidence(`version:${product}:${versionId}`) });
        else if ((version.pendingReview || false) === true) candidates.push({ ...base, ruleId: "CHANGE_SUSPENDED_PENDING_REVIEW", effect: "SUSPEND", priority: 60, evidence: evidence(`version:${product}:${versionId}`, ...relationEvidence, ...pathEvidence) });
        else if (relationEvidence.length > 0 || pathEvidence.length > 0 || (version.documents || []).length > 0) candidates.push({ ...base, ruleId: "CHANGE_REQUIRED_RELEASED_USAGE", effect: "ASSERT", priority: 80, evidence: evidence(`version:${product}:${versionId}`, ...relationEvidence, ...pathEvidence, ...(version.documents || []).map((item) => `article:${item.articleId || item.documentId || item.sourcePath}:${item.sourceHash || "unknown-hash"}`)) });
      }
    }
    return candidates.sort((left, right) => `${left.subjectNodeId}:${left.ruleId}`.localeCompare(`${right.subjectNodeId}:${right.ruleId}`));
  }
  return { produce };
}

module.exports = { createChangeDispositionCandidateService, EFFECTS, CHANGE_DISPOSITION_RULES };
