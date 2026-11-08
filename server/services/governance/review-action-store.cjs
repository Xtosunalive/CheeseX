// Component: Review-Action-Store
// @responsible: 封装人裁账本的读写（SPEC-012 WP-A：③类迁 runtime-state.db——追加族，自增 seq 消解并发竞态）
// @inputs: runtimeState store（缺省取装配实例；node:test 环境懒建内存库）
// @outputs: readReviewActions(vaultPath) / appendReviewAction(vaultPath, decision)（签名不变，vaultPath 兼容保留）
//
// B3 原子化（2026-09-13）期「不引数据库（红线）」约束由 SPEC-012（Master 2026-10-14 签收）解除：
// 并发丢裁定窗口由自增主键事务性追加构造性消除（旧形态：读全量→push→写回）。
// 写侧分形态校验（PR-042）不变：边级/候选级两形态，源头拒第三种异形进账本。

const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

function store(vaultPath) {
  return getRuntimeStateStore(vaultPath).review;
}

function readReviewActions(vaultPath) {
  return store(vaultPath).list();
}

// PR-042 写侧分形态校验（Postel 发送端严格）：账本有两种合法形态——
// 边级（source/target 必填）与候选级（kind=relation_candidate，candidateId 必填）。
// 历史教训：anomaly-workbench 写候选记录、kg-routes 读侧只认边级 → 一条异形记录让
// enforce 一票否决整个 review-history 接口。读侧已分流（kg-routes），此处在源头
// 拒绝第三种异形进账本。
function validateDecisionShape(decision) {
  if (!decision || typeof decision !== "object") return "decision must be an object";
  if (typeof decision.action !== "string" || !decision.action) return "action is required";
  if (typeof decision.reviewer !== "string" || !decision.reviewer) return "reviewer is required";
  if (typeof decision.decidedAt !== "string" || !decision.decidedAt) return "decidedAt is required";
  if (decision.kind === "relation_candidate") {
    if (typeof decision.candidateId !== "string" || !decision.candidateId) {
      return "relation_candidate decision requires candidateId";
    }
    return null;
  }
  if (typeof decision.source !== "string" || !decision.source) return "edge decision requires source";
  if (typeof decision.target !== "string" || !decision.target) return "edge decision requires target";
  return null;
}

function appendReviewAction(vaultPath, decision) {
  const shapeError = validateDecisionShape(decision);
  if (shapeError) {
    throw new Error("REVIEW_ACTION_INVALID_SHAPE: " + shapeError);
  }
  store(vaultPath).append(decision, decision.decidedAt ?? null);
  return readReviewActions(vaultPath);
}

/** 已入账裁决引用过的 issue 键（PR-104 对账读面：走 issue_id 列索引，不扫 JSON）。 */
function listReviewIssueIds(vaultPath) {
  return store(vaultPath).issueIds();
}

module.exports = { readReviewActions, appendReviewAction, listReviewIssueIds };
