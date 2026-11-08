// Component: Enums-Routes
// @responsible: GET + PUT /api/schema/enums — read/write enums.yaml skeleton sections
// @inputs: vaultPath/知识库/TheSchema/enums.yaml
// @outputs: JSON envelope with managed sections, source file, and revision
// @context: Schema-Manager
const { sendJSON } = require("../shared/api-envelope.cjs");
const { displayTheSchemaPath } = require("../shared/theschema-root.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { readEnums, listSnapshots } = require("../services/schema-manager/enums-write-service.cjs");
// ADR-009 D3（SPEC-017 W2 读面最小切片）：合层读——?subject=<id> 返回 元层∪挂载主体层
const { readEnumsForSubject } = require("../shared/schema-config.cjs");
// PR-052：API 响应校验与读侧同源——复用 enums-loader 的 normalizeEnums（contracts/enums.schema.json 唯一形态源）
const { normalizeEnums } = require("../shared/enums-loader.cjs");
const { createEnumsChangePreviewService } = require("../services/schema-manager/enums-change-preview-service.cjs");
const { registerRetiredRoutes } = require("../shared/retired-route-registrar.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1：PUT enums / rollback 经统一执行工厂（ADR-014 §6.2）——原 handler 逻辑原样迁入
// 登记执行器（schema-write.enums / enums-rollback）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const { VALID_SECTIONS, SECTION_YAML_KEY_MAP, validateDomains, validateSubdomains, validateLayers, validateStringArray, validateStringMap, validateModules, validateSubdomainConstraints, validatePolicyReferences, validateRemovedSubdomainReferences, validateRemovedSubdomainUsage, validateSection } = require("../services/schema-manager/schema-validators.cjs");

// ── Section metadata ──

// 前端节键 → yaml 键映射与合法节清单单源于 schema-validators.cjs（SECTION_YAML_KEY_MAP），
// 供下方校验闸门与 GET 单节读取使用（原路由内 YAML_KEY_MAP 副本退役）。
var YAML_KEY_MAP = SECTION_YAML_KEY_MAP;

  // ── Validation: imported from schema-manager/schema-validators.cjs ──
  // (validateDomains, validateSubdomains, validateLayers, validateStringArray, validateStringMap,
  //  validateModules, validateSubdomainConstraints, validatePolicyReferences,
  //  validateRemovedSubdomainReferences, validateSection)

  // ── G4（PR-020 批1）：写路径结构校验闸门——与 preview 同源同款，单一实现两处调用 ──
  // payload 使用前端节键（categories/lifecycle_status 等），校验前先映射为 yaml 键（与 writeEnumsPatch 的 mutate 对齐）。
  function validateEnumsPatchPayload(payload, currentEnums, vaultPath) {
    var sectionKeys = Object.keys(payload).filter(function (key) { return !["revision", "confirmation"].includes(key); });
    for (var i = 0; i < sectionKeys.length; i++) {
      if (!YAML_KEY_MAP[sectionKeys[i]]) return "Unknown section: " + sectionKeys[i];
    }
    // yaml 键形态的合并视图：仅供 validatePolicyReferences（其消费 yaml 键 arch_categories）
    var merged = {};
    for (var j = 0; j < sectionKeys.length; j++) {
      merged[YAML_KEY_MAP[sectionKeys[j]]] = payload[sectionKeys[j]];
    }
    var mergedFull = Object.assign({}, currentEnums.data, merged);
    // PR-054/035 随批：validateSection 第三参升级为全量 doc（subdomain_constraints/subdomains
    // 语义校验需 domains/subdomains/categories——原传 mergedDomains 使子域→域引用校验失明）
    var validationErrors = [];
    for (var si = 0; si < sectionKeys.length; si++) {
      // validateSection 按前端节键分发（与 preview 端点同口径）——不得先映射成 yaml 键再传入
      validationErrors = validationErrors.concat(validateSection(sectionKeys[si], payload[sectionKeys[si]], mergedFull));
    }
    var nextSubdomains = mergedFull.subdomains !== undefined ? mergedFull.subdomains : (currentEnums.data.subdomains || {});
    var nextModules = mergedFull.modules !== undefined ? mergedFull.modules : (currentEnums.data.modules || {});
    validationErrors = validationErrors.concat(validateRemovedSubdomainReferences(currentEnums.data.subdomains || {}, nextSubdomains, nextModules));
    validationErrors = validationErrors.concat(validateRemovedSubdomainUsage(vaultPath, currentEnums.data.subdomains || {}, nextSubdomains));
    validationErrors = validationErrors.concat(validatePolicyReferences(mergedFull));
    return validationErrors.length ? validationErrors.join("; ") : null;
  }

// ── Read helpers ──

// PR-052：响应投影复用读侧已规范化的对象——API 与读侧同一 schema、同一 Ajv 实例族，
// 不再各写一套形态兜底（本函数原 typeof/Array.isArray 三元式口径退役）。
// 脏形态在 normalizeEnums 阶段已被局部降级，这里只做「节 → 前端键」投影。
function extractFrontendSections(data, metadata, vaultPath) {
  var normalized = normalizeEnums(data);
  if (normalized.normalizationTrail.length || normalized.degradedNodes.length) {
    logger.warn({
      event: "enums-response-normalized",
      normalizationTrail: normalized.normalizationTrail,
      degradedNodes: normalized.degradedNodes,
      reason: "enums.yaml 形态偏差已局部规范化（响应仍正常返回，不 500）",
    });
  }
  var normalizedData = normalized.data;
  var result = {
    domains: normalizedData.domains,
    subdomains: normalizedData.subdomains,
    subdomain_constraints: normalizedData.subdomain_constraints,
    layers: normalizedData.layers,
    categories: normalizedData.arch_categories,
    article_types: normalizedData.article_types,
    doc_types: normalizedData.doc_types,
    modules: normalizedData.modules,
    tags: normalizedData.tags,
    tag_aliases: normalizedData.tag_aliases,
    disabled_tags: normalizedData.disabled_tags,
    // C2（#1792）：实体生命周期候选随全量读取投影（单源 enums.yaml lifecycle.*），
    // 供异常修复抽屉 status 下拉接线；新增可选字段，旧消费者不受影响。
    lifecycle_status: normalizedData.lifecycle.status,
  };
  if (metadata) {
    result.revision = metadata.revision;
    if (vaultPath) result.sourceFile = displayTheSchemaPath(vaultPath, "enums.yaml");
  }
  return result;
}

// ── Route registration ──

function register(registerRoute, deps) {
  var vaultPath = deps.vaultPath;
  var changePreviewService = deps.changePreviewService || createEnumsChangePreviewService({ vaultPath: vaultPath });
  var schemaWriteService = deps.schemaWriteService;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_schema_write_enums = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.writeEnums !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      var payload = ctx.body;
      var patch = payload && typeof payload === "object" ? payload.patch : null;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw createError("VALIDATION_ERROR", "Edit must include a patch object", 400);
      }
      // B1 执法（Master 2026-10-23 裁 b）＋WP-064 修正：冻结对象＝arch_categories 派生视图直改；
      // categories（前端键，yaml 键 arch_categories）恢复 PR-054/035 配置路径——矩阵未配置时
      // fallback 直改（写闸校验＋快照＋派生重算全走 writeEnums），矩阵已配置时影子写回标。
      // 只拦 yaml 键 arch_categories 直改（绕过 categories 前端键语义的旁路）。
      if (patch.arch_categories !== undefined) {
        logger.warn({ event: "enums-write-derived-segment-rejected", segment: "arch_categories", ruling: "B1=b" });
        throw createError("DERIVED_SEGMENT_READ_ONLY", "arch_categories 是派生视图：值＝subdomain_constraints 矩阵各子域 allowed_categories 并集（ADR-006）。禁止人直改（B1=b，Master 2026-10-23）——配置矩阵后由矩阵派生。", 403);
      }
      var gateError = validateEnumsPatchPayload(patch, readEnums(vaultPath), vaultPath);
      if (gateError) {
        logger.warn({ event: "enums-write-gate-rejected", error: gateError });
        throw createError("VALIDATION_ERROR", gateError, 400);
      }
      return schemaWriteService.writeEnums(payload);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "enums-write-failed", error: e.message, code: e.code });
      throw createError(e.code || "SCHEMA_WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.enums", __exec_schema_write_enums);;

  const __exec_schema_write_enums_rollback = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.snapshotRevert !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      return schemaWriteService.snapshotRevert(ctx.body);
    } catch (e) {
      if (e && e.code) throw e;
      logger.error({ event: "enums-rollback-failed", error: e.message, code: e.code });
      throw createError(e.code || "SCHEMA_WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-write.enums-rollback", __exec_schema_write_enums_rollback);;

  registerRoute("GET", "/api/schema/enums/history", function (_req, res) {
    return sendJSON(res, 200, { items: listSnapshots(vaultPath) });
  });
  // E3' ADR043：POST /api/schema/enums/rollback（WP-048 W1-A 动作化：schema.enums.rollback）
  registerRoute("POST", "/api/schema/enums/rollback", function (req, res) {
    return executeAction({ actionId: "schema.enums.rollback", executor: __exec_schema_write_enums_rollback, request: req, reply: res });
  });

  // ── GET /api/schema/enums ──
  registerRoute("GET", "/api/schema/enums", function (req, res) {
    try {
      var url = new URL(req.url, "http://127.0.0.1");
      var section = url.searchParams.get("section");
      var subject = url.searchParams.get("subject");
      // 形态对齐：readEnumsForSubject 返回裸 data（合层视图），包成 enums-write-service 同款 {data} 形态；
      // revision 由 extractFrontendSections 的 metadata 缺省路径自处（合层视角暂无单 revision 概念——元层+主体层双源）
      var enums = subject ? { data: readEnumsForSubject(vaultPath, subject) } : readEnums(vaultPath);

      if (section) {
        if (!VALID_SECTIONS.includes(section)) {
          return sendJSON(res, 400, {
            error_code: "VALIDATION_ERROR",
            message: "Unknown section: " + section + ". Valid: " + VALID_SECTIONS.join(", "),
          });
        }
        var yamlKey = YAML_KEY_MAP[section];
        // PR-052：单节响应同样过读侧规范化（同源同实例）——脏形态局部降级而非 500（PR-049 防线）
        var sectionData = normalizeEnums(enums.data).data[yamlKey];
        if (section === "layers" && !Array.isArray(sectionData)) sectionData = [];
        else if (section === "categories" && !Array.isArray(sectionData)) sectionData = [];
        else if (!sectionData) sectionData = {};
        return sendJSON(res, 200, { [section]: sectionData });
      }

      var frontendData = extractFrontendSections(enums.data, enums, vaultPath);
      return sendJSON(res, 200, frontendData);
    } catch (e) {
      logger.error({ event: "enums-get-failed", error: e.message });
      return sendJSON(res, e.status || 500, {
        error_code: e.code || "YAML_PARSE_FAILED",
        message: e.message,
      });
    }
  });

  // ── POST /api/schema/enums/preview ──
  registerRoute("POST", "/api/schema/enums/preview", function (req, res) {
    try {
      var payload = req.body;
      var sectionKeys = Object.keys(payload).filter(function (key) { return key !== "revision"; });
      for (var i = 0; i < sectionKeys.length; i++) {
        if (!VALID_SECTIONS.includes(sectionKeys[i])) {
          return sendJSON(res, 400, { error_code: "VALIDATION_ERROR", message: "Unknown section: " + sectionKeys[i] });
        }
      }
      var currentEnums = readEnums(vaultPath);
      // PR-054/035 随批：第三参升级为全量 merged 视图（同 gate 口径——语义校验需 domains/subdomains/categories）
      var previewMerged = Object.assign({}, currentEnums.data, payload);
      var validationErrors = [];
      for (var si = 0; si < sectionKeys.length; si++) {
        validationErrors = validationErrors.concat(validateSection(sectionKeys[si], payload[sectionKeys[si]], previewMerged));
      }
      var nextSubdomains = payload.subdomains || currentEnums.data.subdomains || {};
      var nextModules = payload.modules || currentEnums.data.modules || {};
      validationErrors = validationErrors.concat(validateRemovedSubdomainReferences(currentEnums.data.subdomains || {}, nextSubdomains, nextModules));
      validationErrors = validationErrors.concat(validateRemovedSubdomainUsage(vaultPath, currentEnums.data.subdomains || {}, nextSubdomains));
      validationErrors = validationErrors.concat(validatePolicyReferences(Object.assign({}, currentEnums.data, payload, { arch_categories: payload.categories || currentEnums.data.arch_categories || [] })));
      if (validationErrors.length) {
        return sendJSON(res, 400, { error_code: "VALIDATION_ERROR", message: validationErrors.join("; "), details: { errors: validationErrors } });
      }
      return sendJSON(res, 200, changePreviewService.preview(payload, currentEnums));
    } catch (e) {
      logger.error({ event: "enums-preview-failed", error: e.message });
      return sendJSON(res, e.status || 500, { error_code: e.code || "INTERNAL_ERROR", message: e.message, details: e.details });
    }
  });

  // E3' ADR043：PUT /api/schema/enums（WP-048 W1-A 动作化：schema.enums.write）
  // G4（PR-020 批1）：写前结构校验闸门（fail-closed）——已随 handler 逻辑迁入执行器 schema-write.enums
  registerRoute("PUT", "/api/schema/enums", function (req, res) {
    return executeAction({ actionId: "schema.enums.write", executor: __exec_schema_write_enums, request: req, reply: res });
  });
}

module.exports = { register, validateRemovedSubdomainReferences };
