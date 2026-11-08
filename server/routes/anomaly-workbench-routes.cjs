// @responsible: 注册异常工作台的查询、协调及处置操作接口。
// 请求体由传输层按契约解析与校验（PR-085 第 1 步），handler 直接读 req.body（可选体缺席时为 {}）。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-B：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function errorResponse(res, error) {
  return sendJSON(res, error.status || 500, { error_code: error.code || "INTERNAL_ERROR", message: error.message, details: error.details });
}

function register(registerRoute, { anomalyWorkbenchService }) {
  // ── WP-048 W1-B 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_anomaly_workbench_reconcile = function () {
    try {
      return anomalyWorkbenchService.reconcileDiagnostic({ purpose: "reconcile" }); // N3/#822
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("anomaly-workbench.reconcile", __exec_anomaly_workbench_reconcile);;

  const __exec_anomaly_workbench_operate = function (ctx) {
    const request = ctx.request;
    const payload = ctx.body;
    const operation = request.params.operation;
    if (!["preview", "confirm", "reject", "close", "reopen"].includes(operation)) throw createError("NOT_FOUND", "异常操作不存在", 404);
    const operationPayload = ["reject", "close", "reopen"].includes(operation) ? { reason: payload.reason } : payload;
    try {
      return anomalyWorkbenchService[operation](request.params.issueId, operationPayload);
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("anomaly-workbench.operate", __exec_anomaly_workbench_operate);;

  // N3/#822：显式触发 reconcile（WP-048 W1-B 动作化：anomalies.reconcile）
  registerRoute("POST", "/api/anomalies/reconcile", (_req, res) => {
    return executeAction({ actionId: "anomalies.reconcile", executor: __exec_anomaly_workbench_reconcile, request: _req, reply: res });
  });
  registerRoute("GET", "/api/anomalies", (req, res) => {
    try {
      const value = new URL(req.url, "http://127.0.0.1").searchParams.get("includeResolved");
      if (value !== null && !["true", "false"].includes(value)) return sendJSON(res, 400, { error_code: "VALIDATION_ERROR", message: "includeResolved 参数非法" });
      sendJSON(res, 200, anomalyWorkbenchService.list({ includeResolved: value === "true" }));
    } catch (error) { errorResponse(res, error); }
  });
  registerRoute("GET", "/api/anomalies/:issueId", (req, res) => { try { sendJSON(res, 200, anomalyWorkbenchService.get(req.params.issueId)); } catch (error) { errorResponse(res, error); } });
  registerRoute("POST", "/api/anomalies/:issueId/:operation", (req, res) => {
      return executeAction({ actionId: "anomalies.operate", executor: __exec_anomaly_workbench_operate, request: req, reply: res });
  });
}

module.exports = { register };
