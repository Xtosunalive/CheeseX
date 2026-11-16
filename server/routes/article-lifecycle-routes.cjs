// Component: Article-Lifecycle-Routes
// @responsible: 生命周期 transitions 边的公开端点（Wave3 走查缺口①阶段二）——按 OpenMAIC/Strapi
//               标准形态登记为每动作专用端点（POST /api/articles/lifecycle/:articleId/{action}），
//               状态合法性由服务端生命周期守卫执法；执行器全部委托既有单源服务（promote=validate→
//               promoteDraft 链、publish=审批状态机 transition 单驱动、archive=归档随迁语义、
//               retire=retireArticle 退役管理流），不造第二语义。写端点经统一执行工厂（WP-048）。
//               路径字面量逐条注册（contract-route-parity 静态扫描口径）。
// @inputs: articleWorkflowService（promote/archive/validateDraft）、approvalStateMachine（publish 单驱动）、
//          lifecycleReconciler（retire 实弹）、article-lifecycle.json（转移边单源）
// @outputs: 四条 POST 端点注册（执行器经 registerActionExecutor 在册）
// @context: SPEC-030 §十一＋Wave3 走查报告（docs/design/wave3-paper-walkthrough-article.md 缺口①）；
//           Master 2026-11-17 裁：promote/publish 通用端点、archive 独立端点、retire 纳入（confirmed 闸防误触）

const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, dependencies) {
  const { articleWorkflowService, approvalStateMachine, lifecycleReconciler, logger } = dependencies;
  const log = logger || { warn() {}, info() {} };

  const __exec_lifecycle_promote = async function (ctx) {
    const draftPath = String((ctx.body && ctx.body.draftPath) || "").trim();
    if (!draftPath) throw Object.assign(new Error("promote 需要 draftPath（草稿 vault 相对路径）"), { code: "VALIDATION_ERROR", status: 400 });
    await articleWorkflowService.validateDraft(draftPath, {});
    return articleWorkflowService.promoteDraft(draftPath, ctx.body.confirmed === true);
  };
  const __exec_lifecycle_publish = function (ctx) {
    // 单驱动：委托审批状态机 transition（approved→snapshot；批准哈希前置由审批机执法）
    return approvalStateMachine.transition(ctx.request.params.articleId, "publish");
  };
  const __exec_lifecycle_archive = function (ctx) {
    const draftPath = String((ctx.body && ctx.body.draftPath) || "").trim();
    if (!draftPath) throw Object.assign(new Error("archive 需要 draftPath（草稿 vault 相对路径）"), { code: "VALIDATION_ERROR", status: 400 });
    return articleWorkflowService.archiveDraft(draftPath, ctx.body.confirmed === true);
  };
  const __exec_lifecycle_retire = function (ctx) {
    return lifecycleReconciler.retireArticle({ basename: `${ctx.request.params.articleId}.md`, dryRun: false });
  };

  registerActionExecutor("articles.lifecycle.promote", __exec_lifecycle_promote);
  registerActionExecutor("articles.lifecycle.publish", __exec_lifecycle_publish);
  registerActionExecutor("articles.lifecycle.archive", __exec_lifecycle_archive);
  registerActionExecutor("articles.lifecycle.retire", __exec_lifecycle_retire);

  // 路径字面量逐条注册（contract-route-parity 契约⇄路由双向对齐口径）
  registerRoute("POST", "/api/articles/lifecycle/:articleId/promote", (req, res) => executeAction({ actionId: "articles.lifecycle.promote", executor: __exec_lifecycle_promote, request: req, reply: res }), "articles.lifecycle.promote");
  registerRoute("POST", "/api/articles/lifecycle/:articleId/publish", (req, res) => executeAction({ actionId: "articles.lifecycle.publish", executor: __exec_lifecycle_publish, request: req, reply: res }), "articles.lifecycle.publish");
  registerRoute("POST", "/api/articles/lifecycle/:articleId/archive", (req, res) => executeAction({ actionId: "articles.lifecycle.archive", executor: __exec_lifecycle_archive, request: req, reply: res }), "articles.lifecycle.archive");
  registerRoute("POST", "/api/articles/lifecycle/:articleId/retire", (req, res) => executeAction({ actionId: "articles.lifecycle.retire", executor: __exec_lifecycle_retire, request: req, reply: res }), "articles.lifecycle.retire");
  log.info({ event: "article-lifecycle-routes-registered", actions: ["promote", "publish", "archive", "retire"] });
}

module.exports = { register };
