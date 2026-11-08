// Component: Relations-Routes
// @responsible: EDGE-RELATION-GOV-001 对象本体批——人工/治理关系实例账的读/写/历史 HTTP 通道。
// @inputs: relations-write-service（唯一写网关）、onRelationsWritten（写后投影重建挂钩——main 注入）
// @outputs: GET/PUT /api/schema/relations、GET /history、POST /rollback
// @context: Schema-Manager（样板＝dependencies-routes 直写回；写后经 onRelationsWritten 触发
//   edge-projection-service.rebuild——治理边并源进 graph_nodes/edges，/api/edges 即时可读）
"use strict";

const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { createError } = require("../shared/error-factory.cjs");
const relationsWriteService = require("../services/schema-manager/relations-write-service.cjs");
// WP-048 Wave 1：PUT / rollback 经统一执行工厂——原 handler 逻辑原样迁入执行器
// （schema-write.relations / relations-rollback，含写后并源 onRelationsWritten 钩子）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
// EG-1b 刀1（WP-002）：本地错误出口收敛——handler 直接 throw，渲染/日志由框架错误钩子统一承载
// （http-app setErrorHandler：status/code/details 感知＋route-handler-failed 日志——T4/T5/T6 契约）

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  const onRelationsWritten = typeof deps.onRelationsWritten === "function" ? deps.onRelationsWritten : null;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_schema_write_relations = function (ctx) {
    const payload = ctx.body || {};
    if (!Array.isArray(payload.relations)) {
      throw createError("RELATIONS_INVALID", "relations 必须是数组", { status: 400 });
    }
    const written = relationsWriteService.writeRelations({
      listGraphNodeIds: deps.listGraphNodeIds,
      vaultPath,
      relations: payload.relations,
      expectedRevision: payload.revision,
    });
    // 写后并源：治理边即时进②类投影（失败只告警不回滚写——投影可重建，下次 boot/摄取钩收敛）
    if (onRelationsWritten) {
      try { onRelationsWritten(); } catch (e) { logger.warn({ event: "relations-written-projection-rebuild-failed", error: e.message }); }
    }
    const { resolveTheSchemaDir } = require("../shared/theschema-root.cjs");
    return { success: true, relations: written.data.relations || [], revision: written.revision, relationsPath: require("node:path").join(resolveTheSchemaDir(vaultPath), "relations.yaml"), ...relationsWriteService.listRelationOptions(vaultPath) };
  };
  registerActionExecutor("schema-write.relations", __exec_schema_write_relations);;

  const __exec_schema_write_relations_rollback = function (ctx) {
    const payload = ctx.body || {};
    const rolled = relationsWriteService.rollbackSnapshot(vaultPath, payload.revision, payload.snapshotId);
    if (onRelationsWritten) {
      try { onRelationsWritten(); } catch (e) { logger.warn({ event: "relations-rollback-projection-rebuild-failed", error: e.message }); }
    }
    return { success: true, relations: rolled.data.relations || [], revision: rolled.revision };
  };
  registerActionExecutor("schema-write.relations-rollback", __exec_schema_write_relations_rollback);;

  registerRoute("GET", "/api/schema/relations", function (_req, res) {
    const current = relationsWriteService.readRelationsFile(vaultPath);
    // 选项集随读返回（字典在册名＋注册表类型——写校验同源，前端下拉无第二事实源）
    const options = relationsWriteService.listRelationOptions(vaultPath);
    return sendJSON(res, 200, { relations: current.data.relations || [], revision: current.revision, ...options });
  });

  registerRoute("PUT", "/api/schema/relations", function (req, res) {
    return executeAction({ actionId: "schema.relations.write", executor: __exec_schema_write_relations, request: req, reply: res });
  });

  registerRoute("GET", "/api/schema/relations/history", function (_req, res) {
    return sendJSON(res, 200, { snapshots: relationsWriteService.listSnapshots(vaultPath) });
  });

  registerRoute("POST", "/api/schema/relations/rollback", function (req, res) {
    return executeAction({ actionId: "schema.relations.rollback", executor: __exec_schema_write_relations_rollback, request: req, reply: res });
  });
}

module.exports = { register };
