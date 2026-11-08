// @responsible: 系统级轻量端点——变更探针（WP-018：多用户跨会话通知，轮询消费）。
// @inputs: GET /api/system/changes-since?cursor=<int>&limit=<int>
// @outputs: 信封 { cursor, changes: [{family, entity, updatedAt}] }——cursor=返回集末位 id（无变更=现值原样），
//           前端 setInterval 同 GlobalPipelineControl 惯例消费；无 SSE 新基建。
const { sendJSON } = require("../shared/api-envelope.cjs");

function register(registerRoute, dependencies) {
  const { runtimeStateStore } = dependencies;
  if (!runtimeStateStore || typeof runtimeStateStore.changes?.since !== "function") {
    throw new Error("system-routes: runtimeStateStore.changes 未注入（main.cjs 装配断线）");
  }

  registerRoute("GET", "/api/system/changes-since", (req, res) => {
    const raw = new URL(req.url, "http://local").searchParams;
    const cursorRaw = raw.get("cursor");
    const limitRaw = raw.get("limit");
    let cursor = 0;
    if (cursorRaw !== null) {
      if (!/^\d+$/.test(cursorRaw)) {
        return sendJSON(res, 400, { error_code: "CHANGES_CURSOR_INVALID", message: "cursor 须为非负整数（上次返回的 cursor 原样续传）" });
      }
      cursor = Number(cursorRaw);
    }
    let limit = 200;
    if (limitRaw !== null) {
      if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 1000) {
        return sendJSON(res, 400, { error_code: "CHANGES_LIMIT_INVALID", message: "limit 须为 1-1000 的整数" });
      }
      limit = Number(limitRaw);
    }
    const rows = runtimeStateStore.changes.since(cursor, limit);
    const nextCursor = rows.length ? rows[rows.length - 1].id : runtimeStateStore.changes.maxSeq();
    return sendJSON(res, 200, {
      cursor: nextCursor,
      changes: rows.map((row) => ({ family: row.family, entity: row.entity, updatedAt: row.updated_at })),
    });
  });
}

module.exports = { register };
