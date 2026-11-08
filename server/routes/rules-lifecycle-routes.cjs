// Component: Rules-Lifecycle-Routes（ADR-007 波3 · SPEC-008 §3.1/3.2）
// @responsible: 规则通道 HTTP 面——GET 台账 / POST propose|retire。
//               discovery 响应的 ruleCandidates 扩展在 schema-discovery-routes 内实现
//               （单路由单职责——本文件不装饰别人的路由）。
// @inputs: rules-lifecycle-service
// @outputs: GET /api/rules/lifecycle、POST /api/rules/lifecycle
// @context: SPEC-008。请求体由传输层按契约解析与校验（PR-085 第 1 步），handler 直接读 req.body（可选体缺席为 {}）。
const { sendJSON } = require("../shared/api-envelope.cjs");

const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1：POST /api/rules/lifecycle 经统一执行工厂——原 handler 逻辑原样迁入执行器 rules-lifecycle.transition。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, deps) {
  const rulesService = deps.rulesLifecycleService;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_rules_lifecycle_transition = function (ctx) {
    if (!rulesService) throw createError("RULES_SERVICE_UNAVAILABLE", "规则通道服务未装配", 503);
    const payload = ctx.body;
    try {
      if (payload.action === "propose") return rulesService.proposeRule(payload);
      if (payload.action === "retire") return rulesService.retireRule(payload);
      throw createError("UNSUPPORTED_RULE_ACTION", "action 须为 propose | retire", 400);
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "RULES_LIFECYCLE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("rules-lifecycle.transition", __exec_rules_lifecycle_transition);;

  registerRoute("GET", "/api/rules/lifecycle", function (_req, res) {
    if (!rulesService) return sendJSON(res, 503, { error_code: "RULES_SERVICE_UNAVAILABLE", message: "规则通道服务未装配" });
    return sendJSON(res, 200, rulesService.listRules());
  });

  registerRoute("POST", "/api/rules/lifecycle", function (req, res) {
    return executeAction({ actionId: "rules.lifecycle.transition", executor: __exec_rules_lifecycle_transition, request: req, reply: res });
  });
}

module.exports = { register };
