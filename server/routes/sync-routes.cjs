// Component: Sync-Routes — safe V2 sync push orchestration for global diagnosis.
// @responsible: POST /api/sync/push V2: validate → legacy gate → Pipeline.startDiagnostic
//   Does NOT write master_graph, SQLite, SA, layout, or Markdown.
//   All derived artifacts are produced only by Pipeline.
// @inputs: pipelineRunService, vaultPath (dependency-injected)
// @outputs: 202 SyncPushData | 400/409/410/422/500/503 error
// @context: Sync

const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-C：push 经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const { computeVaultId } = require("../shared/vault-id.cjs");

const MAX_SYNC_ID_LENGTH = 128;
const VALID_MODES = new Set(["full", "quick"]);
// PR-085 第 1 步：请求体上限（原 64 KiB）与 JSON 解析改由传输层按契约承载（contracts/http-api.openapi.json requestBody），handler 直接读 req.body。

/**
 * Register sync routes via dependency injection.
 * @param {function} registerRoute — main.cjs route registration function
 * @param {{ pipelineRunService, vaultPath }} deps
 */
function register(registerRoute, deps) {
  var pipelineRunService = deps.pipelineRunService;
  var vaultPath = deps.vaultPath;

  // ── POST /api/sync/push V2（WP-048 W1-C 动作化：sync.push——五道闸与 202/409/503 语义逐条保留） ──
  const __exec_sync_push = function (ctx) {
    var body = ctx.body;
    // ═══ Gate 1: Reject legacy entities/connections payload ═══
    if (body && (body.entities !== undefined || body.connections !== undefined)) {
      throw createError("LEGACY_DERIVED_PUSH_RETIRED", "旧 entities/connections 推送已退役。请使用 V2 协议：只传 protocolVersion + vaultId + syncId + mode，Pipeline 会从 Markdown 源文件重新提取所有派生数据。", 410);
    }

    // ═══ Gate 2: Validate protocolVersion / vaultId / syncId / mode ═══
    if (!body || typeof body !== "object") {
      throw createError("VALIDATION_ERROR", "请求体必须为 JSON 对象", 400);
    }

    if (body.protocolVersion !== "2") {
      throw createError("VALIDATION_ERROR", "protocolVersion 必须为 '2'", 400);
    }

    if (typeof body.vaultId !== "string" || body.vaultId.length === 0) {
      throw createError("VALIDATION_ERROR", "vaultId 必须为非空字符串", 400);
    }
    if (!/^[0-9a-f]{16}$/.test(body.vaultId)) {
      throw createError("VALIDATION_ERROR", "vaultId 格式非法，必须为 16 个十六进制字符", 400);
    }

    var serverVaultId = computeVaultId(vaultPath);
    if (body.vaultId !== serverVaultId) {
      throw createError("VAULT_ID_MISMATCH", "客户端 vaultId 与服务端不匹配", 422, {
        clientVaultId: body.vaultId,
        serverVaultId: serverVaultId,
      });
    }

    if (typeof body.syncId !== "string" || body.syncId.length === 0) {
      throw createError("VALIDATION_ERROR", "syncId 必须为非空字符串", 400);
    }
    if (body.syncId.length > MAX_SYNC_ID_LENGTH) {
      throw createError("VALIDATION_ERROR", "syncId 不能超过 " + MAX_SYNC_ID_LENGTH + " 个字符", 400);
    }

    if (!VALID_MODES.has(body.mode)) {
      throw createError("VALIDATION_ERROR", "mode 仅支持 full | quick，收到: " + (body.mode || "undefined"), 400);
    }

    // 内容问题由全局诊断发现并写入待处理问题，不在启动前拒绝。
    try {
      var job = typeof pipelineRunService.startDiagnostic === "function"
        ? pipelineRunService.startDiagnostic(body.mode)
        : pipelineRunService.start(body.mode, { purpose: "global_diagnostic", joinExisting: true });
      return { syncId: body.syncId, job: job };
    } catch (err) {
      if (err.code === "PIPELINE_ALREADY_RUNNING") {
        throw createError(err.code, err.message, 409);
      }
      if (err.code === "PIPELINE_RUNNER_NOT_FOUND") {
        throw createError(err.code, err.message, 503);
      }
      throw createError("INTERNAL_ERROR", "Pipeline 启动失败: " + (err.message || String(err)), 500);
    }
  };
  registerActionExecutor("sync.push", __exec_sync_push);

  registerRoute("POST", "/api/sync/push", function (req, res) {
    return executeAction({ actionId: "sync.push", executor: __exec_sync_push, request: req, reply: res });
  });
  // /api/sync/pull 墓碑唯一通道 = retired-route-registrar（contracts/retired-routes.json）——WP-048
  // W1-C 盘点修正：ADR-014 §八 #41 由「动作化」改「保持墓碑」（change_request ADR-014-§八-#41-墓碑）。
}

module.exports = { register };
