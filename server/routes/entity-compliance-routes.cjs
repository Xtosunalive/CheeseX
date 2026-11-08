// Component: Entity-Compliance-Routes
// @responsible: GET /api/entity/check — pre-pipeline entity source compliance check
// @inputs: vaultPath/wiki/entities/*.md + vaultPath/知识库/TheSchema/enums.yaml
// @outputs: JSON envelope with ComplianceSummary + EntityComplianceResult[]
// @context: Pipeline

const path = require("path");
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-B：repair/apply 经统一执行工厂——原 handler 逻辑原样迁入登记执行器。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const { logger } = require("../shared/json-logger.cjs");
const svc = require("../services/entity-compliance/entity-compliance-service.cjs");
const { normalizeSeverity } = require("../services/entity-compliance/entity-compliance-severity.cjs"); // seq193：产出链唯一归一化出口（契约外值禁裸产出）
const { scanEntities } = require("../services/entity-compliance/entity-source-scanner.cjs");
const { createEntityRepairService, revision } = require("../services/entity-compliance/entity-repair-service.cjs");
const { checkDocumentModuleEntity } = require("../services/entity-compliance/property-governance-service.cjs");
const { scanCandidateArticleSources } = require("../services/projection/document-source-scanner.cjs");
const { checkArticleCompliance } = require("../services/article-workflow/article-compliance-service.cjs");
const { loadRuleSetForVault } = require("../services/schema-manager/compliance-rule-set-service.cjs");
// WP-030/PR-145：可渲染实体标签集单源 contracts/graph-admission.json（契约缺失回退内置缺省）
var GRAPH_ADMISSION = { entityLabels: ["ArchitectureComponent", "Module"] };
try { GRAPH_ADMISSION = require("../../contracts/graph-admission.json"); } catch (_e) { /* 契约缺失回退内置缺省 */ }
// seq210：字段中文名单源（shared/field-labels.mjs 实体域字典，node≥22 require(esm)）。
// 契约 contracts/entity-readiness-rules.json 的 fields 段只留 hint（填写要求），不再存中文名。
const { fieldLabel } = require("../../shared/field-labels.mjs");

var VALID_FILTERS = ["all", "blocker", "warning", "info", "healthy"];
// PR-085 第 1 步：请求体上限与解析改由传输层按契约承载（原 256 KiB 手写上限随 readJsonBody 退役）
// 缺失实体模板字段清单 = 声明单源 contracts/entity-readiness-rules.json 的 fields 段键序
// （经 entity-compliance-service 转出声明式引擎的同源读取）。此处不再保留字段名字面量副本：
// 字段名清单与填写要求（hint）的唯一事实源是该声明文件（原则 6）；
// 字段**中文名**（label）唯一事实源是 shared/field-labels.mjs 的实体域字典（seq210：契约侧已去 label）。
// ⚠ 键序即 CREATE-N 编号序：声明里 arch_since/arch_until 排在 arch_version_overrides/module 之前，
//    与历史硬编码顺序不同 → CREATE-7..CREATE-14 对应的字段随之变化（编号仅作稳定标识，
//    无测试/前端逻辑依赖「CREATE-N ↔ 具体字段」的对应关系，见 REQUIREMENTS #1897）。
var CREATE_FIELDS = Object.keys(svc.RULE_FIELDS || {});

function createFieldMeta(field, ruleSet) {
  var allowedByField = {
    arch_layer: ruleSet.archLayers || [], arch_category: ruleSet.archCategories || [], arch_subdomain: ruleSet.subdomainIds || [],
    module: ruleSet.moduleNames || [], status: ruleSet.statuses || [],
  };
  var allowedValues = allowedByField[field] || [];
  var declared = (svc.RULE_FIELDS || {})[field] || {};
  return Object.assign({}, allowedValues.length ? { allowedValues: allowedValues } : {}, declared.hint ? { hint: declared.hint } : {});
}

function missingEntityResults(masterGraph, ruleSet, existingResults) {
  if (!masterGraph) return [];
  var nodes = Array.isArray(masterGraph.nodes) ? masterGraph.nodes : [];
  var entityNodes = nodes.filter(function (node) {
    var labels = Array.isArray(node.labels) ? node.labels : [];
    return GRAPH_ADMISSION.entityLabels.some(function (l) { return labels.indexOf(l) >= 0; });
  });
  var knownSources = new Set(existingResults.map(function (item) { return item.sourceKey; }));
  var missingBySource = new Map();
  nodes.filter(function (node) { return Array.isArray(node.labels) && node.labels.indexOf("Document") >= 0; }).forEach(function (docNode) {
    var check = checkDocumentModuleEntity(docNode, entityNodes, ruleSet.moduleNames || []);
    var result = check && check.document_module_entity;
    var moduleName = result && typeof result.moduleName === "string" ? result.moduleName.trim() : "";
    if (!result || result.passed || !moduleName || moduleName.indexOf("/") >= 0 || moduleName.indexOf("\\") >= 0 || /\0/.test(moduleName)) return;
    var sourceKey = "知识库/wiki/entities/" + moduleName + ".md";
    if (knownSources.has(sourceKey) || missingBySource.has(sourceKey)) return;
    missingBySource.set(sourceKey, {
      entityId: "", title: moduleName, fileName: moduleName + ".md", sourcePath: "", sourceKey: sourceKey,
      sourceExists: false, sourceType: "entity", architectureIntent: "active", score: 0, totalChecks: CREATE_FIELDS.length,
      blockerCount: CREATE_FIELDS.length, warningCount: 0, infoCount: 0, module: moduleName,
      groups: [{ id: "identity", label: "缺失实体模板", checks: CREATE_FIELDS.map(function (field, index) {
        return Object.assign({ ruleId: "CREATE-" + (index + 1), field: field, label: fieldLabel(field, "entity") || field, severity: normalizeSeverity("blocker"), passed: false, value: null, message: "尚未填写", editable: true, reason: "missing" }, createFieldMeta(field, ruleSet));
      }) }],
    });
  });
  return Array.from(missingBySource.values());
}


function scanAndCheck(vaultPath, masterGraph, scanDraftSourcesFn) {
  var scanned = scanEntities(vaultPath);
  var docs = scanned.map(function (item) { return item.doc; });
  var indexes = svc.buildEntityIndexes(docs);
  var ruleSet = loadRuleSetForVault(vaultPath);
  var results = docs.map(function (doc, index) {
    var result = svc.checkEntityCompliance(doc, ruleSet, indexes);
    var frontmatter = doc.frontmatter || {};
    var relPath = path.relative(vaultPath, scanned[index].file).split(path.sep).join("/");
    result.sourceKey = relPath;
    result.sourceRevision = revision(scanned[index].raw, { mtimeMs: scanned[index].mtimeMs, size: scanned[index].size });
    result.sourceExists = true;
    result.sourceType = "entity";
    result.sourceValues = svc.buildSourceValues(frontmatter);
    result.architectureIntent = frontmatter.arch_component === true ? "active" : "ordinary";
    return result;
  });
  results.push.apply(results, missingEntityResults(masterGraph, ruleSet, results));
  var articleScan = scanCandidateArticleSources({ vaultPath: vaultPath });
  var articles = articleScan.documents;
  results.push.apply(results, articles.map(function (document) {
    var result = checkArticleCompliance(document, ruleSet);
    result.sourceValues = svc.buildArticleSourceValues(document);
    result.sourceRevision = revision(document._raw || "", { mtimeMs: document._mtimeMs || 0, size: document._size || 0 });
    return result;
  }));
  // Scan raw/drafts/ for validation-failed drafts so they appear in entity-compliance
  var draftDocs = typeof scanDraftSourcesFn === "function" ? scanDraftSourcesFn(vaultPath) : [];
  for (var df = 0; df < draftDocs.length; df++) {
    var draft = draftDocs[df];
    var document = {
      articleId: draft.frontmatter.article_id || "",
      identitySource: draft.frontmatter.article_id ? "article_id" : "source_path",
      documentId: "path:" + draft.relPath, title: draft.frontmatter.title || path.basename(draft.file, ".md"), sourcePath: draft.relPath,
      product: draft.frontmatter.product || "", version: draft.frontmatter.version || "", module: draft.frontmatter.module || "",
      articleType: draft.frontmatter.article_type || "", docType: draft.frontmatter["doc-type"] || "",
      categoryPath: draft.frontmatter["category-path"] || "",
      tags: draft.frontmatter.tags,
      hasBody: draft.hasBody,
    };
    var draftResult = checkArticleCompliance(document, ruleSet);
    draftResult.sourceValues = svc.buildArticleSourceValues(document);
    draftResult.sourceRevision = revision(draft.raw, { mtimeMs: draft.mtimeMs, size: draft.size });
    results.push(draftResult);
  }
  return { results: results, ruleSet: ruleSet };
}

function buildReadiness(results) {
  var archResults = results.filter(function (item) { return item.architectureIntent === "active"; });
  var summary = svc.buildSummary(archResults);
  // #940: 一次报全 — errors/warnings/infos 全量诊断数组
  var errors = [], warnings = [], infos = [];
  archResults.forEach(function (item) {
    (item.groups || []).forEach(function (group) {
      (group.checks || []).forEach(function (f) {
        if (f.passed) return;
        var entry = { entityId: item.entityId || "", title: item.title || item.fileName || "", sourceKey: item.sourceKey || "", ruleId: f.ruleId || "", field: f.field || "", message: f.message || "", hint: f.hint || "" };
        if (f.severity === "error" || f.severity === "blocker") errors.push(entry);
        else if (f.severity === "warn" || f.severity === "warning") warnings.push(entry);
        else infos.push(entry);
      });
    });
  });
  return {
    ready: errors.length === 0,
    reason: archResults.length === 0 ? "NO_ARCH_COMPONENTS" : undefined,
    totalArchComponents: archResults.length,
    blockerEntities: summary.blockerEntityCount,
    blockerCount: summary.blockerCount,
    warningCount: summary.warningCount,
    errors: errors, warnings: warnings, infos: infos,
    warningDetails: warnings,
    blockingSourceKeys: archResults.filter(function (item) { return item.blockerCount > 0; }).map(function (item) { return item.sourceKey; }),
  };
}

/**
 * Register entity compliance routes.
 * @param {function} registerRoute
 * @param {{ vaultPath: string, readMasterGraph?: function }} deps
 */
function register(registerRoute, deps) {
  var vaultPath = (deps && deps.vaultPath) ? deps.vaultPath : (process.env.VAULT_PATH || "");
  var readMasterGraph = (deps && deps.readMasterGraph) ? deps.readMasterGraph : function () { return null; };
  var scanDraftSources = (deps && deps.scanDraftSources) ? deps.scanDraftSources : function () { return []; };

  var repairService = deps && deps.repairService;
  if (!repairService) repairService = createEntityRepairService({ vaultPath: vaultPath, ruleSetProvider: function () { return loadRuleSetForVault(vaultPath); } });

  registerRoute("GET", "/api/entity/check", function (req, res) {
    try {
      // ── Parse query params ──
      var url = new URL(req.url, "http://localhost");
      var filter = url.searchParams.get("filter") || "all";
      var q = url.searchParams.get("q") || "";
      var rawLimit = parseInt(url.searchParams.get("limit") || "50", 10) || 50;
      var rawOffset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
      var limit = Math.min(Math.max(rawLimit, 1), 200);
      var offset = Math.max(rawOffset, 0);

      if (VALID_FILTERS.indexOf(filter) < 0) {
        return sendJSON(res, 400, { error_code: "VALIDATION_ERROR", message: "filter 参数非法" });
      }

      var masterGraph = readMasterGraph();
      var results = scanAndCheck(vaultPath, masterGraph, scanDraftSources).results;

      // ── Summary + filter + paginate ──
      var summary = svc.buildSummary(results);
      var filtered = svc.filterResults(results, filter, q);
      var total = filtered.length;
      var page = filtered.slice(offset, offset + limit);

      sendJSON(res, 200, {
        generatedAt: new Date().toISOString(), summary: summary, readiness: buildReadiness(results),
        total: total, limit: limit, offset: offset, items: page,
      });
    } catch (e) {
      logger.error({ event: "entity-compliance-error", error: e.message, stack: e.stack });
      sendJSON(res, e.status || 500, { error_code: e.code || "INTERNAL_ERROR", message: "实体合规检查失败: " + e.message });
    }
  });

  registerRoute("GET", "/api/entity/check-one", function (req, res) {
    // seq205 展示即事实（契约 06 编辑前重读）：复用同一条 scanAndCheck 管线取单实体现算结果——
    // 与全量扫描语义零漂移（同一 indexes/规则集/shape），前端打开修复抽屉时自动调用。
    try {
      var url = new URL(req.url, "http://localhost");
      var sourceKey = (url.searchParams.get("sourceKey") || "").trim();
      if (!sourceKey || sourceKey.indexOf("..") >= 0 || sourceKey.indexOf("\\") >= 0 || !/\.md$/.test(sourceKey)) {
        return sendJSON(res, 400, { error_code: "VALIDATION_ERROR", message: "sourceKey 非法" });
      }
      var results = scanAndCheck(vaultPath, readMasterGraph(), scanDraftSources).results;
      var match = null;
      for (var i = 0; i < results.length; i++) {
        if (results[i].sourceKey === sourceKey) { match = results[i]; break; }
      }
      if (!match) {
        return sendJSON(res, 404, { error_code: "SOURCE_MISSING", message: "源文档不在合规检查范围: " + sourceKey });
      }
      sendJSON(res, 200, { generatedAt: new Date().toISOString(), result: match });
    } catch (e) {
      logger.error({ event: "entity-compliance-checkone-error", error: e.message, stack: e.stack });
      sendJSON(res, e.status || 500, { error_code: e.code || "INTERNAL_ERROR", message: "单实体合规检查失败: " + e.message });
    }
  });

  registerRoute("GET", "/api/entity/readiness", function (_req, res) {
    var masterGraph = readMasterGraph();
    sendJSON(res, 200, buildReadiness(scanAndCheck(vaultPath, masterGraph, scanDraftSources).results));
  });

  registerRoute("POST", "/api/entity/repair/preview", async function (req, res) {
    try {
      sendJSON(res, 200, repairService.preview(req.body));
    } catch (e) {
      logger.error({ event: "entity-repair-preview-error", error: e.message, code: e.code });
      sendJSON(res, e.status || 500, { error_code: e.code || "WRITE_FAILED", message: e.message, details: e.details });
    }
  });
  // E2'b #1：ADR043 退役 graph-fact Proposal——直接写回正式源（WP-048 W1-B 动作化：entity.repair-apply；
  // repairService.apply 原子写回 + 乐观锁 + 备份；错误回退码 WRITE_FAILED 逐字节保留）
  const __exec_entity_compliance_repair_apply = async function (ctx) {
    try {
      if (typeof repairService.apply !== "function") {
        throw createError("REPAIR_APPLY_NOT_CONFIGURED", "Entity Repair 服务不能直接写回", 500);
      }
      return repairService.apply(ctx.body);
    } catch (e) {
      logger.error({ event: "entity-repair-apply-error", error: e.message, code: e.code });
      if (e && e.code) throw e;
      throw createError(e.code || "WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("entity-compliance.repair-apply", __exec_entity_compliance_repair_apply);;

  registerRoute("POST", "/api/entity/repair/apply", function (req, res) {
    return executeAction({ actionId: "entity.repair-apply", executor: __exec_entity_compliance_repair_apply, request: req, reply: res });
  });
}

module.exports = { register: register, scanAndCheck: scanAndCheck, buildReadiness: buildReadiness, loadRuleSetForVault: loadRuleSetForVault };
