// Component: Dependencies-Routes
// @responsible: GET/PUT/validate /api/schema/dependencies — read/write versioned relation rules
// @inputs: vaultPath/知识库/TheSchema/dependencies.yaml；JSON 请求体由传输层按契约解析与校验（PR-085 第 1 步，handler 直接读 req.body）
// @outputs: JSON envelope with dependency rules, diagnostics, revision and options
// @context: Schema-Manager
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const {
  listDependencies,
  validateDependencyPayload,
} = require("../services/schema-manager/dependencies-write-service.cjs");
const { registerRetiredRoutes } = require("../shared/retired-route-registrar.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1：PUT / rollback 经统一执行工厂——原 handler 逻辑原样迁入执行器
// （schema-write.dependencies / dependencies-rollback）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function sendRouteError(res, event, error) {
  logger.error({ event, error: error.message, code: error.code });
  return sendJSON(res, error.status || 500, {
    error_code: error.code || "YAML_PARSE_FAILED",
    message: error.message,
    details: error.details,
  });
}

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  const impactPreviewService = deps.impactPreviewService;
  const schemaWriteService = deps.schemaWriteService;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_schema_write_dependencies = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.writeDependencies !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      return schemaWriteService.writeDependencies(ctx.body);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "dependencies-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "YAML_PARSE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.dependencies", __exec_schema_write_dependencies);;

  const __exec_schema_write_dependencies_rollback = function (ctx) {
    try {
      const payload = ctx.body;
      return schemaWriteService.rollbackSchemaSnapshot("dependencies", payload.revision, payload.snapshotId);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "dependencies-rollback-failed", error: e.message, code: e.code });
      throw createError(e.code || "YAML_PARSE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.dependencies-rollback", __exec_schema_write_dependencies_rollback);;

  registerRoute("GET", "/api/schema/dependencies", function (_req, res) {
    try {
      return sendJSON(res, 200, listDependencies(vaultPath));
    } catch (error) {
      return sendRouteError(res, "dependencies-get-failed", error);
    }
  });

  registerRoute("POST", "/api/schema/dependencies/validate", function (req, res) {
    const payload = req.body;
    try {
      return sendJSON(res, 200, validateDependencyPayload(vaultPath, payload.items));
    } catch (error) {
      return sendRouteError(res, "dependencies-validate-failed", error);
    }
  });

  registerRoute("POST", "/api/schema/dependencies/preview", function (req, res) {
    const payload = req.body;
    try {
      if (!impactPreviewService) throw Object.assign(new Error("依赖规则影响预览服务不可用"), { code: "PREVIEW_UNAVAILABLE", status: 503 });
      return sendJSON(res, 200, impactPreviewService.preview(payload.items));
    } catch (error) {
      return sendRouteError(res, "dependencies-preview-failed", error);
    }
  });

  // E3' ADR043：PUT /api/schema/dependencies（WP-048 W1-A 动作化：schema.dependencies.write）
  registerRoute("PUT", "/api/schema/dependencies", function (req, res) {
    return executeAction({ actionId: "schema.dependencies.write", executor: __exec_schema_write_dependencies, request: req, reply: res });
  });

  // ── G10（PR-020 批3）：dependencies 快照列表 + 回滚（形状对齐 enums history|rollback 路由先例）──
  registerRoute("GET", "/api/schema/dependencies/history", function (_req, res) {
    try {
      return sendJSON(res, 200, { items: schemaWriteService.listSchemaSnapshots("dependencies") });
    } catch (error) {
      return sendRouteError(res, "dependencies-history-failed", error);
    }
  });

  registerRoute("POST", "/api/schema/dependencies/rollback", function (req, res) {
    return executeAction({ actionId: "schema.dependencies.rollback", executor: __exec_schema_write_dependencies_rollback, request: req, reply: res });
  });
}

module.exports = { register };
