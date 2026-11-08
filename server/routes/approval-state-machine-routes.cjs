// Component: Approval-State-Machine-Routes
// @responsible: Plan-B 状态机 API——暴露审批状态机（切片 2 服务）为 HTTP 端点（ADR043 阶段 B→C 衔接）
// @inputs: articleId + operation（standardize/confirm/reject/resubmit/publish）
// @outputs: 状态转移结果 + 审计
// 请求体由传输层按契约解析与校验（PR-085 第 1 步），handler 直接读 req.body。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-B：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function sendError(res, error) {
  return sendJSON(res, error.status || 500, { error_code: error.code || "INTERNAL_ERROR", message: error.message, details: error.details });
}

function register(registerRoute, dependencies) {
  const approvalService = dependencies.approvalStateMachine;

  // 查状态
  registerRoute("GET", "/api/approval/status/:articleId", function (req, res) {
    try {
      const status = approvalService.getStatus(req.params.articleId);
      return sendJSON(res, 200, status);
    } catch (error) { return sendError(res, error); }
  });

  // ── WP-048 W1-B 执行器：既有 handler 逻辑原样迁入 ──
  const __exec_approval_state_machine_transition = async function (ctx) {
    try {
      const body = ctx.body;
      const operation = typeof body.operation === "string" ? body.operation : "";
      return await approvalService.transition(ctx.request.params.articleId, operation, body.input || {}); // PR-056
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("approval-state-machine.transition", __exec_approval_state_machine_transition);;

  // 执行转移（approve 与 publish 分离；WP-048 W1-B 动作化：approval.transition——载荷敏感
  // 角色升级行 action_types payload_role_overrides 声明式承载）
  registerRoute("POST", "/api/approval/:articleId/transition", function (req, res) {
    return executeAction({ actionId: "approval.transition", executor: __exec_approval_state_machine_transition, request: req, reply: res });
  });
}

module.exports = { register };
