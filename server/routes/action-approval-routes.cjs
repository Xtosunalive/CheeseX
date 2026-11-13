"use strict";

// Component: Action-Approval-Routes（WP-172 / SPEC-095 §3.5 首批）
// @responsible: 动作审批两动作端点——立单与裁决，均经统一执行工厂（吃自己狗粮：审批动作
//   本身也是动作，审计/角色/封包走八步编排）。
// @inputs: action-approval-store（账本单源）
// @outputs: POST /api/action-approvals（立单，任何已认证角色）；POST /api/action-approvals/:id/decision
//   （裁决，required_roles=[review]——本体 action_types 立法面）
// @context: 单级审批最小能力；不自动立单；追加账本只增不减。
const path = require("node:path");
const { sendJSON } = require("../shared/api-envelope.cjs");
const { bindErrorFactory } = require("../shared/error-factory.cjs");
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const {
  createActionApproval, decideActionApproval, foldActionApprovals, stableInputHash,
} = require("../services/governance/action-approval-store.cjs");
const approvalError = bindErrorFactory({ status: 400 });

function register(registerRoute, deps) {
  const vaultPath = path.resolve(deps.vaultPath);

  // 立单：请求体 {action_id, input, requested_by}——input 为拟执行动作的完整请求体（哈希在服务层算）
  const __exec_action_approvals_create = function (ctx) {
    try {
      return createActionApproval(vaultPath, {
        actionId: ctx.body.action_id,
        input: ctx.body.input,
        requestedBy: ctx.body.requested_by,
        riskId: ctx.body.risk_id || null,
      });
    } catch (e) { return rethrowApproval(e); }
  };
  registerActionExecutor("action-approvals.create", __exec_action_approvals_create);
  registerRoute("POST", "/api/action-approvals", function (req, res) {
    return executeAction({ actionId: "action-approvals.create", executor: __exec_action_approvals_create, request: req, reply: res });
  });

  // 裁决：请求体 {decision: approved|rejected, decided_by, reason?}——角色=review（本体立法）
  const __exec_action_approvals_decide = function (ctx) {
    try {
      return decideActionApproval(vaultPath, ctx.request.params.id, {
        decision: ctx.body.decision,
        decidedBy: ctx.body.decided_by,
        reason: ctx.body.reason,
      });
    } catch (e) { return rethrowApproval(e); }
  };
  registerActionExecutor("action-approvals.decide", __exec_action_approvals_decide);
  registerRoute("POST", "/api/action-approvals/:id/decision", function (req, res) {
    return executeAction({ actionId: "action-approvals.decide", executor: __exec_action_approvals_decide, request: req, reply: res });
  });

  // 读面：审批单清单（折叠当前态）——治理对账/页面用（只读；封包同 sendJSON 单一出口）
  registerRoute("GET", "/api/action-approvals", function (_req, res) {
    const folded = [...foldActionApprovals(vaultPath).values()];
    return sendJSON(res, 200, { items: folded, total: folded.length });
  });
  void stableInputHash; void approvalError;
}

function rethrowApproval(error) {
  if (error && error.code) throw error;
  throw approvalError("ACTION_APPROVAL_ERROR", (error && error.message) || "审批请求失败", 500, error && error.details);
}

module.exports = { register };
