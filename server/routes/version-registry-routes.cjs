// Component: Version-Registry-Routes
// @responsible: 暴露产品版本注册、校验、保存和冻结发布 HTTP API。
// @inputs: JSON 请求体（由传输层按契约解析与校验——PR-085 第 1 步，handler 直接读 req.body）与 Version-Registry-Service
// @outputs: 标准 API envelope
// @context: Schema-Manager
// WP-048 Wave 1：PUT versions / POST freeze / PUT product-identity 经统一执行工厂——
// 原 handler 逻辑原样迁入执行器（schema-write.versions / versions-freeze / product-identity）。

const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { createError } = require("../shared/error-factory.cjs");
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function routeError(res, event, error) {
  logger.error({ event, error: error.message, code: error.code });
  return sendJSON(res, error.status || 500, { error_code: error.code || "INTERNAL_ERROR", message: error.message, details: error.details });
}

function register(registerRoute, dependencies) {
  const service = dependencies.versionRegistryService;
  const schemaWriteService = dependencies.schemaWriteService;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_schema_write_versions = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.writeVersions !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      return schemaWriteService.writeVersions(ctx.body);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "versions-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.versions", __exec_schema_write_versions);;

  const __exec_schema_write_versions_freeze = async function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.freezeVersion !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      return await schemaWriteService.freezeVersion(ctx.body); // PR-056：底层 python 投影异步化
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "versions-freeze-failed", error: e.message, code: e.code });
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.versions-freeze", __exec_schema_write_versions_freeze);;

  const __exec_schema_write_product_identity = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.writeProductIdentity !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      return schemaWriteService.writeProductIdentity(ctx.body);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "product-identity-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.product-identity", __exec_schema_write_product_identity);;

  registerRoute("GET", "/api/schema/versions", (_req, res) => {
    try { return sendJSON(res, 200, service.getRegistry()); }
    catch (error) { return routeError(res, "versions-get-failed", error); }
  });
  registerRoute("GET", "/api/schema/product-identity", (_req, res) => {
    try { return sendJSON(res, 200, service.getProductIdentity()); }
    catch (error) { return routeError(res, "product-identity-get-failed", error); }
  });
  // E3' ADR043：PUT /api/schema/product-identity（WP-048 W1-A 动作化：schema.product-identity.write）
  registerRoute("PUT", "/api/schema/product-identity", (req, res) => {
    return executeAction({ actionId: "schema.product-identity.write", executor: __exec_schema_write_product_identity, request: req, reply: res });
  });
  registerRoute("POST", "/api/schema/versions/validate", (req, res) => {
    const payload = req.body;
    try { return sendJSON(res, 200, service.validateRegistryPayload(payload)); }
    catch (error) { return routeError(res, "versions-validate-failed", error); }
  });
  // E3' ADR043：PUT /api/schema/versions（WP-048 W1-A 动作化：schema.versions.write）
  registerRoute("PUT", "/api/schema/versions", (req, res) => {
    return executeAction({ actionId: "schema.versions.write", executor: __exec_schema_write_versions, request: req, reply: res });
  });
  // PR-056：freeze 底层 python 投影异步化（WP-048 W1-A 动作化：schema.versions.freeze）
  registerRoute("POST", "/api/schema/versions/freeze", (req, res) => {
    return executeAction({ actionId: "schema.versions.freeze", executor: __exec_schema_write_versions_freeze, request: req, reply: res });
  });
}

module.exports = { register };
