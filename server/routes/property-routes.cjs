// Component: Property-Routes — property governance check/repair/refresh handlers.
// @responsible: 提供属性治理检查、修复和刷新 HTTP 路由。
// @inputs: Vault entity、enums、manifest 与治理请求
// @outputs: 属性检查结果与受控修复响应
// @context: Canvas
// Ported from 架构图系统/electron/main.cjs:4115 (layer-change handler) — adapted to module governance.

const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-C：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const { logger } = require("../shared/json-logger.cjs");
const pgSvc = require("../services/entity-compliance/property-governance-service.cjs");
const { buildRuleSet } = require("../shared/enums-loader.cjs");
const { queueRefresh } = require("../services/pipeline/pipeline-state-store.cjs");
const { readPropertyInspectionArtifacts, readVaultSourceIdentity } = require("../shared/working-artifact-snapshot.cjs");

// PR-085 第 1 步：POST /api/property/repair 墓碑由 main.cjs 按 contracts/retired-routes.json 全量注册（唯一通道）——
// 模块级重复注册随框架退役（旧线性匹配靠顺序遮住重复，Fastify 注册即抛 FST_ERR_DUPLICATED_ROUTE）。

function sourceIdentity(vaultPath, sourcePath, cache) {
  if (!cache.has(sourcePath)) cache.set(sourcePath, readVaultSourceIdentity(vaultPath, sourcePath));
  return cache.get(sourcePath);
}

function register(registerRoute, deps) {
  var vaultPath = deps.vaultPath;

  // ── GET /api/property/check ──
  registerRoute("GET", "/api/property/check", function (req, res) {
    var u = new URL(req.url, "http://127.0.0.1");
    var filter = u.searchParams.get("filter") || "all";
    var q = u.searchParams.get("q") || "";
    var limit = parseInt(u.searchParams.get("limit") || "50", 10);
    var offset = parseInt(u.searchParams.get("offset") || "0", 10);

    var snapshots = readPropertyInspectionArtifacts(vaultPath);
    // PR-084：组件集走读侧唯一咽喉的文档语义层（无数据＝零值形状→空结果 200）；
    // 字节级 revision 审计仍走快照族（snapshots.workingRevisions）——两层分工，路由不再自判空。
    var sa = deps.readSemanticArchitecture();

    var graph = snapshots.masterGraph.data;
    if (!graph || typeof graph !== "object") graph = { nodes: [], connections: [] };
    var manifest = snapshots.extractManifest.data;

    var results = pgSvc.checkAll(
      sa.components, manifest,
      graph.nodes || [], graph.connections || [],
      buildRuleSet(snapshots.enums.data || {}).moduleNames,
    );

    // Bind Proposal optimistic locks to the exact source bytes read once here.
    var sourceIdentities = new Map();
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.sourcePath) {
        var identity = sourceIdentity(vaultPath, r.sourcePath, sourceIdentities);
        r.sourcePathExists = Boolean(identity);
        if (identity) {
          r.sourcePath = identity.sourceKey;
          r.sourceRevision = identity.revision;
        }
      }
    }

    var filtered = pgSvc.filterResults(results, filter, q);
    var summary = pgSvc.buildSummary(results);
    var page = filtered.slice(offset, offset + limit);

    sendJSON(res, 200, {
      summary: summary, total: filtered.length,
      limit: limit, offset: offset, items: page,
      workingRevisions: snapshots.workingRevisions,
    });
  });

  // ── POST /api/property/refresh ──
  // WP-048 W1-C 动作化：property.refresh（原 handler 逻辑原样迁入）
  const __exec_property_refresh = function (ctx) {
    var payload = ctx.body;
    var componentId = String(payload.componentId || "").trim();
    if (!componentId) throw createError("VALIDATION_ERROR", "componentId 为必填项", 400);

    try { queueRefresh(vaultPath, componentId); } catch (e) { /* non-fatal */ }

    logger.info({ event: "property-refresh-queued", componentId: componentId });
    return { componentId: componentId, queued: true };
  };
  registerActionExecutor("property.refresh", __exec_property_refresh);

  registerRoute("POST", "/api/property/refresh", function (req, res) {
    return executeAction({ actionId: "property.refresh", executor: __exec_property_refresh, request: req, reply: res });
  });
}

module.exports = { register };
