"use strict";

// Component: Action-Approval-Store（WP-172 / SPEC-095 §3.5 首批）
// @responsible: 动作审批账本的事件读写与折叠——事件流 requested/decided/used 追加进
//   runtime-state 追加族（并发由自增 seq 构造性消解，B3 同款），读侧重放折叠出审批单当前态。
// @inputs: runtime-state store actionApprovals 族；稳定序列化（键排序——立单与执行两端
//   对同一输入必须得到同一哈希，禁依赖请求键序）
// @outputs: createActionApproval / decideActionApproval / foldActionApprovals /
//   consumeActionApproval / stableInputHash（工厂核验共用单源哈希）
// @context: 单级审批最小能力（SPEC 非目标6）；不自动立单；追加只增不减（账本纪律同 review_actions）。
const crypto = require("node:crypto");
const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");
const approvalError = bindErrorFactory({ status: 400 }); // 收敛：错误经统一工厂（禁本地工厂定义——EG-1b）

function store(vaultPath) {
  return getRuntimeStateStore(vaultPath).actionApprovals;
}

/** 稳定序列化（键排序递归）——审批输入哈希单源：立单与工厂执行核验共用本函数。 */
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

function stableInputHash(input) {
  return crypto.createHash("sha256").update(stableStringify(input)).digest("hex");
}

/** 重放折叠：事件流 → Map(approval_id → 当前态)。
 *  requested 建单（pending）；decided 置 approved|rejected（带裁决留痕）；used 置 used=true。
 *  幂等事件（同 approval_id 重复 decided/used）以后到者覆盖 status 字段但保留首见裁决字段——
 *  服务层已拒重复裁决（409），折叠侧容错不放大。 */
function foldActionApprovals(vaultPath) {
  const folded = new Map();
  for (const event of store(vaultPath).list()) {
    if (!event || typeof event.approval_id !== "string") continue;
    const current = folded.get(event.approval_id) || { approvalId: event.approval_id, status: "unknown" };
    if (event.type === "requested") {
      Object.assign(current, {
        status: "pending",
        actionId: event.action_id,
        inputHash: event.input_hash,
        riskId: event.risk_id || null,
        requestedBy: event.requested_by || null,
        requestedAt: event.requested_at || null,
      });
    } else if (event.type === "decided") {
      current.status = event.decision === "approved" ? "approved" : "rejected";
      current.decision = event.decision;
      current.decidedBy = event.decided_by || null;
      current.decidedAt = event.decided_at || null;
      current.decisionReason = event.reason || null;
    } else if (event.type === "used") {
      current.used = true;
      current.usedAt = event.used_at || null;
      current.usedTraceId = event.trace_id || null;
    }
    folded.set(event.approval_id, current);
  }
  return folded;
}

/** 立单：记录申请人/动作/输入哈希/风险——返回 {approvalId, status:"pending", inputHash}。 */
function createActionApproval(vaultPath, { actionId, input, requestedBy, riskId }) {
  if (typeof actionId !== "string" || !actionId.trim()) throw approvalError("VALIDATION_ERROR", "action_id 必填", 400);
  if (input === undefined || input === null || typeof input !== "object") throw approvalError("VALIDATION_ERROR", "input 必须是对象（动作请求体）", 400);
  if (typeof requestedBy !== "string" || !requestedBy.trim()) throw approvalError("VALIDATION_ERROR", "requested_by 必填", 400);
  const inputHash = stableInputHash(input);
  const approvalId = crypto.randomUUID();
  store(vaultPath).append({
    type: "requested",
    approval_id: approvalId,
    action_id: actionId,
    input_hash: inputHash,
    risk_id: riskId || null,
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
  });
  return { approvalId, status: "pending", actionId, inputHash };
}

/** 裁决：pending → approved|rejected；重复裁决 409；未知单 404。全程留痕（decided_by 必填）。 */
function decideActionApproval(vaultPath, approvalId, { decision, decidedBy, reason }) {
  if (decision !== "approved" && decision !== "rejected") throw approvalError("VALIDATION_ERROR", "decision 必须是 approved | rejected", 400);
  if (typeof decidedBy !== "string" || !decidedBy.trim()) throw approvalError("VALIDATION_ERROR", "decided_by 必填", 400);
  const current = foldActionApprovals(vaultPath).get(approvalId);
  if (!current || current.status === "unknown") throw approvalError("APPROVAL_NOT_FOUND", `审批单不存在: ${approvalId}`, 404, { approval_id: approvalId });
  if (current.status !== "pending") {
    throw approvalError("APPROVAL_ALREADY_DECIDED", `审批单已裁决（${current.status}${current.used ? " 且已使用" : ""}），不可重复裁决`, 409, { approval_id: approvalId, status: current.status });
  }
  store(vaultPath).append({
    type: "decided",
    approval_id: approvalId,
    decision,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    reason: reason || (decision === "approved" ? "人工审批通过" : "人工审批驳回"),
  });
  return { approvalId, status: decision, decidedBy };
}

/** 工厂放行后置 used（单次有效核销）——二次凭单执行由核验面拒（approval_reused）。 */
function consumeActionApproval(vaultPath, approvalId, traceId) {
  store(vaultPath).append({ type: "used", approval_id: approvalId, used_at: new Date().toISOString(), trace_id: traceId || null });
}

module.exports = { stableStringify, stableInputHash, foldActionApprovals, createActionApproval, decideActionApproval, consumeActionApproval };
