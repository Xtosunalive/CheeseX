// 边阻断器（PR-045 抽取自 review-routes.cjs，单一事实源——写门 409 与读侧 pending-review 列表两处消费同一函数）
// S8（场景⑫）：approve 前检查边两端节点是否关联 open 的 missing_entity / unrecognized_entity
// blocker issue（复用 anomaly workbench 的既有 issue 采集，不自造第二套 blocker 查询）。
// missing_entity：issue.proposedAction.entityId = Document 节点 id；
// unrecognized_entity：issue.proposedAction.unresolvedTargets 含边端点（ghost 目标）。
// 已关闭/非 blocker 类 issue 不阻断；rejected 动作始终允许。
function openBlockersForEdge(issues, edge) {
  const endpoints = new Set([edge.from || edge.source, edge.to || edge.target].filter((value) => typeof value === "string" && value.trim()));
  const blockers = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue || typeof issue !== "object") continue;
    if (issue.status === "closed") continue;
    if (!["missing_entity", "unrecognized_entity"].includes(issue.issueKind)) continue;
    const action = issue.proposedAction && typeof issue.proposedAction === "object" && !Array.isArray(issue.proposedAction) ? issue.proposedAction : {};
    const touches = (typeof action.entityId === "string" && endpoints.has(action.entityId))
      || (Array.isArray(action.unresolvedTargets) && action.unresolvedTargets.some((id) => endpoints.has(id)));
    if (touches) blockers.push({ entityId: action.entityId || null, issueId: issue.issueId || null, issueKind: issue.issueKind });
  }
  return blockers;
}

module.exports = { openBlockersForEdge };
