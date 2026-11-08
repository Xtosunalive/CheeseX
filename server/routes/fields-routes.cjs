// Component: Fields-Routes（ADR-008 D2 / SPEC-017 W4）
// @responsible: GET + PUT /api/schema/fields — 字段字典读/写（fields-write-service 唯一写通道）
// @inputs: vaultPath/知识库/TheSchema/fields.yaml
// @outputs: JSON envelope { fields, revision, last_updated }；PUT 含 projectionSynced
// @context: Schema-Manager；三件套（严格校验/哈希乐观锁/快照）在 service 内建。
// WP-048 Wave 1：PUT 经统一执行工厂（schema.fields.write）——原 handler 逻辑原样迁入执行器 schema-write.fields。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { displayTheSchemaPath } = require("../shared/theschema-root.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { createFieldsWriteService } = require("../services/schema-manager/fields-write-service.cjs");
const { createError } = require("../shared/error-factory.cjs");
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  const service = createFieldsWriteService({ vaultPath, logger, onGraphInputWrite: deps.onGraphInputWrite }); // WP-027：fields 图输入写缝透传

  const __exec_schema_write_fields = async function (ctx) {
    try {
      const payload = ctx.body;
      return await service.writeFields({ fields: payload.fields, expectedRevision: payload.revision });
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "fields-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "FIELDS_WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.fields", __exec_schema_write_fields);;

  registerRoute("GET", "/api/schema/fields", function (_req, res) {
    try {
      const { data, revision } = service.readFields();
      return sendJSON(res, 200, { fields: data.fields || [], revision, last_updated: data.last_updated || null, sourceFile: displayTheSchemaPath(vaultPath, "fields.yaml") });
    } catch (e) {
      logger.error({ event: "fields-get-failed", error: e.message });
      return sendJSON(res, e.status || 500, { error_code: e.code || "INTERNAL_ERROR", message: e.message, details: e.details });
    }
  });

  registerRoute("PUT", "/api/schema/fields", function (req, res) {
    return executeAction({ actionId: "schema.fields.write", executor: __exec_schema_write_fields, request: req, reply: res });
  });
}

module.exports = { register };
