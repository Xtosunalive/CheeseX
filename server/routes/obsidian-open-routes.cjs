// Component: Obsidian-Open-Routes
// @responsible: 暴露受限的本地 Obsidian 文档打开接口。
// @inputs: sourcePath JSON 请求（请求体由传输层按契约解析与校验——PR-085 第 1 步，原 8 KiB 手写上限随 readBody 退役）
// @outputs: 标准 API envelope
// @context: Vault

const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-C：写端点经统一执行工厂——原 handler 逻辑原样迁入登记执行器（ADR-014 §6.2）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");

function register(registerRoute, dependencies) {
  const service = dependencies.obsidianOpenService;
  // WP-048 W1-C 动作化：system.open-obsidian（受限 OS Adapter 打开，非任意命令）
  const __exec_system_open_obsidian = async function (ctx) {
    const payload = ctx.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw createError("VALIDATION_ERROR", "请求体必须是对象", 400);
    }
    return await service.openSource(payload.sourcePath);
  };
  registerActionExecutor("system.open-obsidian", __exec_system_open_obsidian);

  registerRoute("POST", "/api/system/open-obsidian", function (req, res) {
    return executeAction({ actionId: "system.open-obsidian", executor: __exec_system_open_obsidian, request: req, reply: res });
  });
}

module.exports = { register };
