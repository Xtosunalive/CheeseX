// Component: Ontology-Routes
// @responsible: GET + PUT /api/schema/ontology — read/write ontology.yaml (node_types, relation_types)
// @inputs: vaultPath/知识库/TheSchema/ontology.yaml
// @outputs: JSON envelope with node_types, relation_types, inference_rules, constraints
// @context: Schema-Manager
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { readOntology } = require("../services/schema-manager/ontology-write-service.cjs");
const { createFieldsWriteService } = require("../services/schema-manager/fields-write-service.cjs");
const { validateCapabilityConsumerAnchors } = require("../shared/relation-capability-selector.cjs");
const { registerRetiredRoutes } = require("../shared/retired-route-registrar.cjs");
const { validateDocumentStrict } = require("../shared/theschema-loader.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1：PUT ontology / rollback / entity-parent 经统一执行工厂（ADR-014 §6.2）——
// 传输/身份/角色校验在 http-boundary（handler 前），handler 只余动作委派；原 handler 逻辑
// 原样迁入登记执行器（schema-write.ontology / ontology-rollback / entity-parent）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

// Validation helpers imported from schema-manager/schema-validators.cjs
// G3（PR-020 批3）：ontology 结构校验器接线——此前 validateOntologyPayload 全 server 零调用（"写了没接线"），
// 现接进 PUT 写路径：合并当前本体后校验 node/relation 结构，非法 400 fail-closed 不触达写服务（与 G4 enums 闸门同构）。
const { validateOntologyPayload } = require("../services/schema-manager/schema-validators.cjs");

// ── Data extraction ──

function extractOntologySections(data, revision) {
  return {
    node_types: data.node_types || {},
    relation_types: data.relation_types || {},
    inference_rules: data.inference_rules || [],
    constraints: data.constraints || [],
    ...(revision ? { revision } : {}),
  };
}

// ── Route registration ──

function register(registerRoute, deps) {
  var vaultPath = deps.vaultPath;
  var schemaWriteService = deps.schemaWriteService;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_schema_write_ontology = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.writeOntology !== "function") {
        throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      }
      var body = ctx.body;
      if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
        throw createError("MISSING_PATCH", "Ontology edit must include a patch object", 400);
      }
      // G3：结构校验闸门（fail-closed）——合并当前本体后校验，非法结构 400 拒绝
      var current = readOntology(vaultPath);
      var mergedData = Object.assign({}, current.data);
      var gateKeys = Object.keys(body.patch).filter(function (key) { return !["revision", "confirmation"].includes(key); });
      for (var gi = 0; gi < gateKeys.length; gi++) mergedData[gateKeys[gi]] = body.patch[gateKeys[gi]];
      var schemaErrors = validateDocumentStrict("ontology", mergedData);
      var fields;
      if (!schemaErrors.length && Object.values(body.patch.node_types || {}).some(function (nodeType) {
        return nodeType.data_properties && Object.keys(nodeType.data_properties).length > 0;
      })) {
        fields = createFieldsWriteService({ vaultPath: vaultPath }).readFields().data;
      }
      var structureErrors = schemaErrors.length ? [] : validateOntologyPayload(body.patch, mergedData, current.data, fields);
      if (structureErrors.length) {
        logger.warn({ event: "ontology-write-gate-rejected", errors: structureErrors.length });
        throw createError("VALIDATION_ERROR", structureErrors.join("; "), 400, { errors: structureErrors });
      }
      // WP-006 6b 写时准入：能力字段必须有在册活消费点——声明带着接线出生，无锚点字段拒写（P0 公理⑤）
      var anchorResult = validateCapabilityConsumerAnchors(mergedData);
      if (!anchorResult.ok) {
        logger.warn({ event: "ontology-consumer-anchor-gate-rejected", errors: anchorResult.errors.length });
        throw createError("CAPABILITY_CONSUMER_ANCHOR_INVALID", anchorResult.errors.join("; "), 422, { errors: anchorResult.errors, fix: "新能力字段须与消费模块同笔登记（relation-capability-selector.cjs CAPABILITY_FIELD_CONSUMERS）；锚点失效须先修复消费或更新登记" });
      }
      if (schemaErrors.length) {
        throw createError("VALIDATION_ERROR", schemaErrors.join("; "), 400, { errors: schemaErrors });
      }
      return schemaWriteService.writeOntology(body);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "ontology-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "SCHEMA_WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.ontology", __exec_schema_write_ontology);;

  const __exec_schema_write_ontology_rollback = function (ctx) {
    try {
      return schemaWriteService.rollbackSchemaSnapshot("ontology", ctx.body.revision, ctx.body.snapshotId);
    } catch (e) {
      logger.error({ event: "ontology-rollback-failed", error: e.message, code: e.code });
      throw createError(e.code || "SCHEMA_ROLLBACK_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.ontology-rollback", __exec_schema_write_ontology_rollback);;

  const __exec_schema_write_entity_parent = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.writeEntityParent !== "function") {
        throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      }
      var body = ctx.body;
      if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
        throw createError("MISSING_PATCH", "Entity-parent edit must include a patch object", 400);
      }
      if (typeof body.patch.childId !== "string" || !body.patch.childId.trim()) {
        throw createError("MISSING_CHILD_ID", "patch.childId is required", 400);
      }
      return schemaWriteService.writeEntityParent(body);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "entity-parent-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "SCHEMA_WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.entity-parent", __exec_schema_write_entity_parent);;

  // ── GET /api/schema/ontology ──
  registerRoute("GET", "/api/schema/ontology", function (req, res) {
    try {
      var ontology = readOntology(vaultPath);
      var result = extractOntologySections(ontology.data, ontology.revision);
      return sendJSON(res, 200, result);
    } catch (e) {
      logger.error({ event: "ontology-get-failed", error: e.message });
      return sendJSON(res, 500, {
        error_code: "YAML_PARSE_FAILED",
        message: e.message,
      });
    }
  });

  // ── PUT /api/schema/ontology（WP-048 W1-A 动作化：schema.ontology.write；E3' ADR043 写回语义不变）──
  registerRoute("PUT", "/api/schema/ontology", function (req, res) {
    return executeAction({ actionId: "schema.ontology.write", executor: __exec_schema_write_ontology, request: req, reply: res });
  });

  // ── G10（PR-020 批3）：ontology 快照列表 + 回滚（WP-048 W1-A 动作化：schema.ontology.rollback）──
  registerRoute("GET", "/api/schema/ontology/history", function (_req, res) {
    try {
      return sendJSON(res, 200, { items: schemaWriteService.listSchemaSnapshots("ontology") });
    } catch (e) {
      logger.error({ event: "ontology-history-failed", error: e.message });
      return sendJSON(res, e.status || 500, { error_code: e.code || "SCHEMA_HISTORY_FAILED", message: e.message, details: e.details });
    }
  });

  registerRoute("POST", "/api/schema/ontology/rollback", function (req, res) {
    return executeAction({ actionId: "schema.ontology.rollback", executor: __exec_schema_write_ontology_rollback, request: req, reply: res });
  });

  // ── PUT /api/schema/entity-parent（N1/S7；WP-048 W1-A 动作化：schema.entity-parent.write）
  //    body: { patch: { childId, parentId } }；阻断码 SELF_REFERENCE/UNKNOWN_PARENT/NON_ENTITY_TARGET/CYCLE_DETECTED
  //    由 entity-parent-service.validateParent（server/services/release-governance/entity-parent-service.cjs:105）抛出。
  registerRoute("PUT", "/api/schema/entity-parent", function (req, res) {
    return executeAction({ actionId: "schema.entity-parent.write", executor: __exec_schema_write_entity_parent, request: req, reply: res });
  });
}

module.exports = { register };
