// Component: Inference-Conflict-Routes — GET /api/kg/inference-conflicts ＋ POST …/{conflictId}/review
// @responsible: 推理规则冲突只读列表＋裁决/重开（store.review 单源：resolve 需结构化裁决或文本＋
//               sourceRevision 乐观守卫；reopen 反悔——Wave3 阶段三，Master 2026-11-17 裁）。
//               写端点经统一执行工厂（WP-048），路径字面量冒号风格（parity 归一口径）。
// @inputs: inferenceConflictStore
// @outputs: 冲突列表＋裁决端点
const { sendJSON } = require("../shared/api-envelope.cjs");
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, deps) {
  const conflictStore = (deps && deps.conflictStore) || null;

  function getStore(res) {
    if (!conflictStore || typeof conflictStore.list !== "function") {
      sendJSON(res, 503, { error_code: "CONFLICT_STORE_UNAVAILABLE", message: "推理冲突存储未初始化" });
      return null;
    }
    return conflictStore;
  }

  // ── GET /api/kg/inference-conflicts ──
  registerRoute("GET", "/api/kg/inference-conflicts", (req, res) => {
    try {
      const store = getStore(res);
      if (!store) return;
      const url = new URL(req.url || "/api/kg/inference-conflicts", "http://127.0.0.1");
      const statusFilter = url.searchParams.get("status") || "all";
      if (!["unresolved", "resolved", "all"].includes(statusFilter)) {
        return sendJSON(res, 400, { error_code: "INVALID_QUERY", message: "status 必须是 unresolved | resolved | all" });
      }
      const all = store.list();
      const filtered = statusFilter === "all" ? all : all.filter((c) => c.status === statusFilter);
      sendJSON(res, 200, { conflicts: filtered, total: filtered.length });
    } catch (error) {
      const code = error && error.code ? error.code : "INTERNAL_ERROR";
      const status = code === "CONFLICT_STORE_CORRUPT" ? 503 : 500;
      sendJSON(res, status, { error_code: code, message: error && error.message ? error.message : "获取冲突列表失败" });
    }
  });

  // ── POST /api/kg/inference-conflicts/:conflictId/review — 裁决/重开（Wave3 阶段三）──
  const __exec_inference_review = function (ctx) {
    if (!conflictStore || typeof conflictStore.review !== "function") {
      throw Object.assign(new Error("推理冲突存储未初始化"), { code: "CONFLICT_STORE_UNAVAILABLE", status: 503 });
    }
    return conflictStore.review(ctx.request.params.conflictId, ctx.body || {});
  };
  registerActionExecutor("inference.review", __exec_inference_review);
  registerRoute("POST", "/api/kg/inference-conflicts/:conflictId/review", (req, res) => {
    return executeAction({ actionId: "inference.review", executor: __exec_inference_review, request: req, reply: res });
  }, "inference.review");
}

module.exports = { register };
