// Component: Pipeline-Routes — HTTP adapter for PipelineRunService.
// @responsible: 将管道运行服务暴露为启动、状态和取消 HTTP 路由；图新鲜度对账查询（WP-027）。
// @inputs: PipelineRunService 与管道控制请求；graphFreshness（对账现算）＋graphRefreshScheduler（调度状态）
// @outputs: 管道作业状态 HTTP 响应
// @context: Pipeline
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-C：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, deps) {
  const service = deps.pipelineRunService;

  registerRoute("GET", "/api/pipeline/status", function (_req, res) {
    // WP-055 试点消费方（SPEC-049 Q4）：追加 readModelVersion（追加非破坏）——查询族示范
    let readModelVersion;
    try { readModelVersion = deps.getReadModelVersion(); } catch (_e) { /* 版本计算失败不阻断 status */ }
    sendJSON(res, 200, { ...service.getStatus(), readModelVersion });
  });

  // WP-027（PR-142）：图是否落后于当前规则输入——schema 管理页状态提示消费。
  // upToDate=null 表示未知（从未增量抽取过），消费方不得当作 false/true。
  registerRoute("GET", "/api/pipeline/graph-freshness", function (_req, res) {
    const compute = deps.graphFreshness;
    const scheduler = deps.graphRefreshScheduler;
    if (typeof compute !== "function") {
      return sendJSON(res, 503, { error_code: "GRAPH_FRESHNESS_UNAVAILABLE", message: "图新鲜度对账未装配" });
    }
    try {
      const freshness = compute();
      const schedulerState = typeof scheduler.getState === "function" ? scheduler.getState() : null;
      return sendJSON(res, 200, { ...freshness, scheduler: schedulerState });
    } catch (error) {
      return sendJSON(res, 500, { error_code: "GRAPH_FRESHNESS_FAILED", message: error.message || "图新鲜度对账失败" });
    }
  });

  // ── WP-048 W1-C 执行器：既有 handler 逻辑原样迁入（202 与 409/503 语义逐条保留） ──
  const __exec_pipeline_run = function (ctx) {
    var url = new URL(ctx.request.url, "http://127.0.0.1");
    var rawMode = url.searchParams.get("mode") || "full";
    if (rawMode !== "full" && rawMode !== "quick") {
      throw createError("VALIDATION_ERROR", "mode 仅支持 full | quick（断点续走走 rebuild?mode=resume）", 400);
    }
    try {
      return typeof service.startDiagnostic === "function"
        ? service.startDiagnostic(rawMode)
        : service.start(rawMode, { purpose: "global_diagnostic", joinExisting: true });
    } catch (error) {
      if (error.code === "PIPELINE_ALREADY_RUNNING") {
        throw createError(error.code, error.message, 409, service.getStatus());
      }
      throw createError(error.code || "PIPELINE_UNAVAILABLE", error.message || "Pipeline 无法启动", 503);
    }
  };
  registerActionExecutor("pipeline.run", __exec_pipeline_run);

  const __exec_pipeline_rebuild = function (ctx) {
    // WP-019（PR-113）：mode=resume＝失败后断点续跑（--resume——runner 按持久化 last_stage 定起点）
    var url = new URL(ctx.request.url, "http://127.0.0.1");
    var rebuildMode = url.searchParams.get("mode") || "full";
    if (rebuildMode !== "full" && rebuildMode !== "resume") {
      throw createError("VALIDATION_ERROR", "mode 仅支持 full | resume", 400);
    }
    try {
      return service.start(rebuildMode, { purpose: "article_graph", joinExisting: true });
    } catch (error) {
      if (error.code === "PIPELINE_ALREADY_RUNNING") {
        throw createError(error.code, error.message, 409, service.getStatus());
      }
      throw createError(error.code || "PIPELINE_UNAVAILABLE", error.message || "Pipeline 无法启动", 503);
    }
  };
  registerActionExecutor("pipeline.rebuild", __exec_pipeline_rebuild);

  registerRoute("POST", "/api/pipeline/run", function (req, res) {
    return executeAction({ actionId: "pipeline.run", executor: __exec_pipeline_run, request: req, reply: res });
  });

  registerRoute("POST", "/api/pipeline/rebuild", function (req, res) {
    return executeAction({ actionId: "pipeline.rebuild", executor: __exec_pipeline_rebuild, request: req, reply: res });
  });


  const __exec_pipeline_cancel = function () {
    try {
      return service.cancel();
    } catch (error) {
      if (error.code === "PIPELINE_NOT_RUNNING") {
        throw createError(error.code, error.message, 409, service.getStatus());
      }
      throw createError("PIPELINE_CANCEL_FAILED", error.message || "取消失败", 500);
    }
  };
  registerActionExecutor("pipeline.cancel", __exec_pipeline_cancel);

  registerRoute("POST", "/api/pipeline/cancel", function (req, res) {
    return executeAction({ actionId: "pipeline.cancel", executor: __exec_pipeline_cancel, request: req, reply: res });
  });
}

module.exports = { register };
