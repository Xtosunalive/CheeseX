// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Component: review-status-projection（F3 / seq156，ADR054 D2）
// @responsible: 消费端读图时从 review_actions 账本合并 reviewStatus——裁决不再写派生图本体，
//               重建投影零损耗（extract「审批态 lineage 回补」需求消失，回补值降级为无害 fallback）。
// @inputs: master_graph 形状对象 + review_actions 数组
// @outputs: mergeReviewStatus(graph, reviewActions) → 同形状 graph（connections[].reviewStatus 就绪）
// 合并语义：每 edgeId 取 decidedAt 最新 action；账本优先，图内存量值（回补/历史直写）fallback；默认 pending。

// SPEC-012 WP-A：review_actions 账本迁 runtime-state.db——shared 只读单源随迁（读取经 store，不再读 vault 文件）
const { getRuntimeStateStore } = require("./persistence/runtime-state-store.cjs");

// 读取 review_actions 账本（shared 层只读；写入单源仍是 governance 语境的 review-action-store）
function readReviewActionsFile(vaultPath) {
  try { return getRuntimeStateStore(vaultPath).review.list(); } catch (_error) { return []; }
}

function mergeReviewStatus(graph, reviewActions) {
  // PR-095：派生章白名单——产线按断言政策盖的两种非人裁状态（详见 extract_graph._policy_review_status）
  const DERIVED_STAMP_STATUSES = new Set(["deterministic", "inherited_approved"]);
  const latest = new Map();
  for (const action of Array.isArray(reviewActions) ? reviewActions : []) {
    if (!action || typeof action.edgeId !== "string") continue;
    const prev = latest.get(action.edgeId);
    if (!prev || String(action.decidedAt || "") >= String(prev.decidedAt || "")) latest.set(action.edgeId, action);
  }
  if (graph && Array.isArray(graph.connections)) {
    for (const connection of graph.connections) {
      const fromLedger = latest.get(connection.edgeId);
      // K-P1-1：账本缺记录时 fail-closed，回退 "pending"，不再继承图内被管道污染的
      // reviewStatus（存量 Release = 0，ADR057 第 3 点「不 fail-closed」的兼容理由已失效）。
      // PR-095 例外白名单：产线按断言政策盖的派生章（deterministic/inherited_approved）
      // 无账本记录时保留——只认这两个白名单值，其余图内存量值仍一律 pending（防污染回潮）；
      // 人裁账本永远优先（approved/rejected 覆盖派生章）。
      connection.reviewStatus = fromLedger
        ? fromLedger.action
        : (DERIVED_STAMP_STATUSES.has(connection.reviewStatus) ? connection.reviewStatus : "pending");
      // K-P1-2：人工身份随账本传播到边顶层（闸门 assertionActorType 的读取链
      // [assertion, properties, relation] 已含顶层，无需改 formal-relation-selector）。
      // 无账本记录时必须 delete——残留上一轮合并的 assertedBy 等于给机器章留身份通道。
      if (fromLedger?.assertedBy) connection.assertedBy = fromLedger.assertedBy;
      else delete connection.assertedBy;
    }
  }
  return graph;
}

module.exports = { mergeReviewStatus, readReviewActionsFile };
