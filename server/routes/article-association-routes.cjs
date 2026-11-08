// @responsible: 注册文章架构关联的列表、预览与乐观锁写回接口。
// 请求体由传输层按契约解析与校验（PR-085 第 1 步：contracts/http-api.openapi.json requestBody → schema.body），handler 直接读 req.body。
const { sendJSON } = require("../shared/api-envelope.cjs");

function sendError(res, error) { return sendJSON(res, error.status || 500, { error_code: error.code || "INTERNAL_ERROR", message: error.message, details: error.details }); }
const { SNAPSHOT_HASH_PATTERN } = require("../shared/version-contract.cjs"); // seq195：sha256 形状单源（审计族 R 收敛）
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-B：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function requiredRevision(value) {
  if (typeof value !== "string" || !SNAPSHOT_HASH_PATTERN.test(value)) {
    throw Object.assign(new Error("revision 必须是文章源文件的 SHA-256"), { code: "VALIDATION_ERROR", status: 400 });
  }
  return value;
}

function register(registerRoute, { articleAssociationService }) {
  // ── WP-048 W1-B 执行器：既有 handler 逻辑原样迁入 ──
  const __exec_article_associations_save = function (ctx) {
    try {
      if (typeof articleAssociationService.save !== "function") throw createError("ARTICLE_ASSOCIATION_SAVE_NOT_CONFIGURED", "文章关联写回服务不可用", 503);
      const payload = ctx.body;
      const expectedRevision = requiredRevision(payload.revision);
      const result = articleAssociationService.save(expectedRevision, payload);
      return { success: true, ...result }; // AA1：单点纠错直接写回（原子写+审计+乐观锁）
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("article-associations.save", __exec_article_associations_save);;

  const __exec_article_associations_remove = function (ctx) {
    try {
      const payload = ctx.body;
      const expectedRevision = requiredRevision(payload.revision);
      if (typeof payload.decisionId !== "string" || !payload.decisionId.trim()) throw createError("VALIDATION_ERROR", "decisionId 必填", 400);
      // 2026-10-15 Master 批准「引用随源流转」：stale 决策行移除出口；幂等（行不存在 removed=0）
      const result = articleAssociationService.removeDecision(expectedRevision, payload.decisionId.trim());
      return { success: true, ...result };
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "INTERNAL_ERROR", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("article-associations.remove", __exec_article_associations_remove);;

  registerRoute("GET", "/api/article-associations", (_req, res) => { try { sendJSON(res, 200, articleAssociationService.list()); } catch (error) { sendError(res, error); } });
  registerRoute("POST", "/api/article-associations/preview", (req, res) => { try { sendJSON(res, 200, articleAssociationService.preview(req.body)); } catch (error) { sendError(res, error); } });
  // WP-048 W1-B 动作化：article-associations.save / remove
  registerRoute("POST", "/api/article-associations/save", (req, res) => {
    return executeAction({ actionId: "article-associations.save", executor: __exec_article_associations_save, request: req, reply: res });
  });
  registerRoute("POST", "/api/article-associations/remove", (req, res) => {
    return executeAction({ actionId: "article-associations.remove", executor: __exec_article_associations_remove, request: req, reply: res });
  });
}

module.exports = { register };
