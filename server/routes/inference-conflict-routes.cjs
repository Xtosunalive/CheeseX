// Component: Inference-Conflict-Routes — GET /api/kg/inference-conflicts
// @responsible: 推理规则冲突只读历史列表 HTTP 路由。
// @inputs: inferenceConflictStore
// @outputs: 冲突列表
const { sendJSON } = require("../shared/api-envelope.cjs");

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
}

module.exports = { register };
