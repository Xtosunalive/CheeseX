// @responsible: 注册文章上传、状态、候选、标准化及草稿处理接口。
// 请求体由传输层按契约解析与校验（PR-085 第 1 步：contracts/http-api.openapi.json requestBody → schema.body；
// 上传路由 14 MiB 限额由契约 x-body-limit-bytes 承载），handler 直接读 req.body。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-B：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, dependencies) {
  const service = dependencies.articleWorkflowService;
  // PR-048（写后重扫钩子）：补齐字段保存成功后即时触发 anomaly 对账——issue 卡不再
  // 等下一次全局诊断才销账。复用 reconcileDiagnostic（N3/#822 既有机制，读时派生重采集+
  // applyLedgerTransitions），不自造第二套销账路径。钩子失败不回滚已成功的字段写入
  // （写主权已落盘），只告警——销账延迟退化为旧行为，不产生数据不一致。
  const reconcileAfterFieldWrite = dependencies.reconcileAnomalies
    ? function () {
        try { dependencies.reconcileAnomalies({ purpose: "article_field_completion" }); }
        catch (error) { (dependencies.logger || console).warn({ event: "field-completion-reconcile-failed", error: error && error.message }); }
      }
    : null;

  // ── WP-048 W1-B 执行器：既有 handler 逻辑原样迁入（错误回退码 ARTICLE_WORKFLOW_ERROR 逐字节保留） ──
  const __exec_article_workflow_upload = function (ctx) {
    try {
      // WP-022：expectedRevision 可选乐观锁（多用户并发防护——详见 openapi WorkflowRevisionConflict 组件）
      return service.upload(ctx.body, { expectedRevision: ctx.body && ctx.body.expectedRevision });
    } catch (e) { return rethrowWorkflow(e); }
  };
  registerActionExecutor("article-workflow.upload", __exec_article_workflow_upload);;
  const __exec_article_workflow_retire = function (ctx) {
    try {
      const body = ctx.body;
      const url = new URL(ctx.request.url || "/api/articles/retire", "http://127.0.0.1");
      const dryRun = url.searchParams.get("dryRun") === "1";
      return dependencies.retireArticle({ basename: String((body && body.basename) || ""), dryRun });
    } catch (e) { return rethrowWorkflow(e); }
  };
  registerActionExecutor("article-workflow.retire", __exec_article_workflow_retire);;
  const __exec_article_workflow_standardize = function (ctx) {
    try {
      const body = ctx.body;
      return service.standardize(ctx.request.params.id, body && body.confirmed);
    } catch (e) { return rethrowWorkflow(e); }
  };
  registerActionExecutor("article-workflow.standardize", __exec_article_workflow_standardize);;
  const __exec_article_workflow_patch_fields = function (ctx) {
    try {
      const body = ctx.body;
      const result = service.updateCandidateFields(ctx.request.params.id, body && body.fields);
      if (reconcileAfterFieldWrite) reconcileAfterFieldWrite();
      return result;
    } catch (e) { return rethrowWorkflow(e); }
  };
  registerActionExecutor("article-workflow.patch-fields", __exec_article_workflow_patch_fields);;
  const __exec_article_workflow_drafts_promote = async function (ctx) {
    try {
      return await service.promoteDraft(ctx.body.filePath, ctx.body.confirmed, { expectedRevision: ctx.body && ctx.body.expectedRevision });
    } catch (e) { return rethrowWorkflow(e); }
  };
  registerActionExecutor("article-workflow.drafts-promote", __exec_article_workflow_drafts_promote);;
  // WP-171（SPEC-095 §3.3 首批）：validate 动作化——最后一个旁路写路径收编（WP-048 同款：逻辑原样迁入）
  const __exec_article_workflow_drafts_validate = async function (ctx) {
    try {
      // WP-022：expectedRevision 乐观锁透传（锁住 ensureUploadTask 建态写）——语义逐字保留
      return await service.validateDraft(ctx.body.filePath, { expectedRevision: ctx.body && ctx.body.expectedRevision });
    } catch (e) { return rethrowWorkflow(e); }
  };
  registerActionExecutor("article-workflow.drafts-validate", __exec_article_workflow_drafts_validate);;

  // WP-048 W1-B 动作化：upload（success_status 201 声明于动作定义）
  registerRoute("POST", "/api/articles/upload", function (req, res) {
    return executeAction({ actionId: "articles.upload", executor: __exec_article_workflow_upload, request: req, reply: res });
  });

  registerRoute("GET", "/api/articles/status/:taskId", function (req, res) {
    handle(res, function () { return service.getTask(req.params.taskId); });
  });

  registerRoute("GET", "/api/articles/uploads", function (req, res) {
    const url = new URL(req.url || "/api/articles/uploads", "http://127.0.0.1");
    const rawLimit = url.searchParams.get("limit") || "50";
    handle(res, function () { return service.listUploads(Number(rawLimit)); });
  });

  // PR-065/SPEC-013 L2：文章退役动作（WP-048 W1-B 动作化：articles.retire）——?dryRun=1 只读预演（零落盘）；
  // 执行沿 source_file 链事务性全清（工作副本/正式版/原文归档/清单行），失败回滚不留半态
  registerRoute("POST", "/api/articles/retire", function (req, res) {
    return executeAction({ actionId: "articles.retire", executor: __exec_article_workflow_retire, request: req, reply: res });
  });

  registerRoute("GET", "/api/articles/precleaned", function (_req, res) {
    handle(res, function () { return service.listPrecleaned(); });
  });

  registerRoute("GET", "/api/articles/candidates/search", function (req, res) {
    const url = new URL(req.url || "/api/articles/candidates/search", "http://127.0.0.1");
    handle(res, function () {
      return service.searchCandidates({
        keyword: url.searchParams.get("keyword") || "",
        limit: url.searchParams.get("limit") || undefined,
        offset: url.searchParams.get("offset") || undefined,
      });
    });
  });

  registerRoute("GET", "/api/articles/precleaned/:id", function (req, res) {
    handle(res, function () { return service.getPrecleaned(req.params.id); });
  });

  // 旧批准入口 410 墓碑（tombstone 标记：带 body 调用仍答 410，退役信号不被契约「禁止 body」的 400 盖掉）
  const legacyApprovalGone = Object.assign(function (_req, res) {
    sendJSON(res, 410, {
      error_code: "LEGACY_ARTICLE_APPROVAL_GONE",
      message: "旧文章批准入口已停用，请使用标准化 Article Proposal 流程",
    });
  }, { tombstone: true });
  const legacyBulkApprovalGone = Object.assign(function (_req, res) {
    sendJSON(res, 410, {
      error_code: "LEGACY_ARTICLE_APPROVAL_GONE",
      message: "旧批量文章批准入口已停用，请使用标准化 Article Proposal 流程",
    });
  }, { tombstone: true });
  registerRoute("PUT", "/api/articles/precleaned/:id/approval", legacyApprovalGone);
  registerRoute("PUT", "/api/articles/precleaned/approval", legacyBulkApprovalGone);

  // 标准化校验：ERROR 阻断（409 ARTICLE_STANDARDIZATION_BLOCKED）——WP-048 W1-B 动作化：articles.standardize
  registerRoute("POST", "/api/articles/precleaned/:id/standardization", function (req, res) {
    return executeAction({ actionId: "articles.standardize", executor: __exec_article_workflow_standardize, request: req, reply: res });
  });

  // 候选字段补齐（腿B）：白名单四字段（product/article_type/module/version），可用值与标准化引擎同源（loadArticleRuleSet）。
  registerRoute("GET", "/api/articles/field-completion-options", function (_req, res) {
    handle(res, function () { return service.getFieldCompletionOptions(); });
  });

  // WP-048 W1-B 动作化：articles.patch-fields（写后异常对账钩子随执行器保留）
  registerRoute("PATCH", "/api/articles/precleaned/:id/fields", function (req, res) {
    return executeAction({ actionId: "articles.patch-fields", executor: __exec_article_workflow_patch_fields, request: req, reply: res });
  });

  // WP-171（SPEC-095 §3.3 首批）：articles.drafts-validate 动作化——对外路径/请求/响应形态零变化
  registerRoute("POST", "/api/articles/drafts/validate", function (req, res) {
    return executeAction({ actionId: "articles.drafts-validate", executor: __exec_article_workflow_drafts_validate, request: req, reply: res });
  });

  // WP-048 W1-B 动作化：articles.drafts-promote
  registerRoute("POST", "/api/articles/drafts/promote", function (req, res) {
    return executeAction({ actionId: "articles.drafts-promote", executor: __exec_article_workflow_drafts_promote, request: req, reply: res });
  });

}

function handle(res, operation) {
  try { sendJSON(res, 200, operation()); }
  catch (error) { sendWorkflowError(res, error); }
}

function sendWorkflowError(res, error) {
  return sendJSON(res, Number.isInteger(error.status) ? error.status : 500, {
    error_code: error.code || "ARTICLE_WORKFLOW_ERROR",
    message: error.message || "文章工作流请求失败",
    details: error.details,
  });
}

// WP-048 W1-B：执行器内错误重抛（与 sendWorkflowError 逐字段等价的 throw 形态——非工厂，createError 仍是唯一构造点；
// http-app 错误处理器渲染同一封套）
function rethrowWorkflow(error) {
  if (error && error.code) throw error;
  throw createError("ARTICLE_WORKFLOW_ERROR", (error && error.message) || "文章工作流请求失败", Number.isInteger(error && error.status) ? error.status : 500, error && error.details);
}

module.exports = { register };
