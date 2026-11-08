// Component: Writer-Gate
// @responsible: 写者来源校验中间件（SPEC-011-W11 WP5·403）
// 校验 operator-context 身份是否在 domain-registry writers 登记集中，未登记 → 403

const fs = require("fs");
const path = require("path");

// 从 data-domains.json 加载合法写者集合（启动时计算一次，运行时复用）
let _registeredWriters = null;
function loadRegisteredWriters(archRepoPath) {
  if (_registeredWriters) return _registeredWriters;

  // 2026-10-14 拆表批：写者登记住 data-domains.json（TALOS 分表——表即 kind）
  const registryPath = path.join(archRepoPath, "contracts", "data-domains.json");
  if (!fs.existsSync(registryPath)) {
    throw new Error(`data-domains.json not found at ${registryPath}`);
  }

  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  const writers = new Set();

  // 从所有数据域行中提取 writers 数组（表即 kind，行内不再判别）
  for (const domain of registry.domains || []) {
    if (Array.isArray(domain.writers)) {
      for (const writerEntry of domain.writers) {
        // writer entry 格式: "writer-id:..." 或 "描述文本（writer-id）"
        // 提取 writer-id（冒号前或括号内）
        const colonMatch = writerEntry.match(/^([^:]+):/);
        const parenMatch = writerEntry.match(/\(([^)]+)\)$/);

        if (colonMatch) {
          const writerId = colonMatch[1].trim();
          // 过滤掉文件路径格式（如 "schema-write-service.cjs:121-131"）
          if (!writerId.includes(".cjs") && !writerId.includes(".py")) {
            writers.add(writerId);
          }
        } else if (parenMatch) {
          writers.add(parenMatch[1].trim());
        }
      }
    }
  }

  // 添加默认合法写者（页面/管线/CLI 的抽象身份）
  writers.add("local-architect");  // 默认 operator
  writers.add("schema-page");      // 页面写
  writers.add("pipeline");         // 管线写
  writers.add("cli");              // CLI 脚本
  writers.add("api-page");         // PR-085 裁项 5 通道轴：HTTP API 写入通道（多用户形态下写者=通道、人=Principal）

  _registeredWriters = writers;
  return writers;
}

/**
 * 创建写者校验中间件
 * @param {Object} options
 * @param {Object} options.operatorContext - operator-context 实例（提供 getOperatorId()——只作取证记录，不作裁决）
 * @param {string} options.archRepoPath - 仓库根路径（用于读取 data-domains.json）
 * @param {Object} options.logger - 日志器
 * @param {string} options.channel - PR-085 裁项 5 通道轴：本进程承载的写通道 id（HTTP API＝"api-page"，缺省）。
 *   裁决口径：写门校验**通道**是否登记（人是谁由身份层 Principal 裁，roles 归第 3 步登记表）——
 *   多用户下任何已认证用户经本通道写均通过本门，人与通道的取证同时入 details。
 * @returns {Function} Express-style 中间件 (req, res, next)，另挂 evaluate(req) 与 fastifyHook(request, reply)
 *   —— PR-085 第 1 步：承载改 Fastify onRequest 钩子；第 2 步（裁项 4a 后半）：403 归一标准封套
 *   （error_code WRITER_NOT_REGISTERED 不变；hint/operator/registered_writers 移 details；契约 403 全量声明）。
 */
function createWriterGate({ operatorContext, archRepoPath, logger, channel = "api-page" }) {
  const registeredWriters = loadRegisteredWriters(archRepoPath);

  logger.info({
    event: "writer-gate-initialized",
    registered_writers: Array.from(registeredWriters),
  });

  function evaluate(req) {
    // 取证用操作者（请求上下文 Principal；无身份层时为本地回落）——不参与裁决
    const operatorId = (() => { try { return operatorContext.getOperatorId(); } catch (_error) { return null; } })();
    if (registeredWriters.has(channel)) return { allowed: true, operatorId, channel };
    logger.warn({
      event: "writer-gate-rejected",
      channel,
      operator: operatorId,
      method: req.method,
      url: req.url,
    });
    return {
      allowed: false,
      operatorId,
      channel,
      body: {
        error_code: "WRITER_NOT_REGISTERED",
        message: `写通道 '${channel}' 未在 data-domains.json 登记（写者通道制——人由身份层 Principal 裁）。`,
        hint: "AI 会话改 vault 数据必须走 API；文件直写=违规。登记流程见 contracts/data-domains.json 的 writers 字段说明。",
        operator: operatorId,
        registered_writers: Array.from(registeredWriters).sort(),
      },
    };
  }

  function writerGateMiddleware(req, res, next) {
    const verdict = evaluate(req);
    if (!verdict.allowed) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify(verdict.body, null, 2));
      return;
    }
    // 校验通过，继续路由处理
    next();
  }

  writerGateMiddleware.evaluate = evaluate;
  writerGateMiddleware.fastifyHook = async function writerGateHook(request, reply) {
    const verdict = evaluate(request);
    if (verdict.allowed) return undefined;
    // 裁项 4a 第 2 步：归一标准封套（裸形态退役）；hint/名单保留在 details 供客户端指引
    const { sendJSON } = require("./api-envelope.cjs");
    return sendJSON(reply, 403, {
      error_code: verdict.body.error_code,
      message: verdict.body.message,
      details: { hint: verdict.body.hint, operator: verdict.body.operator, registered_writers: verdict.body.registered_writers },
    });
  };
  return writerGateMiddleware;
}

module.exports = { createWriterGate, loadRegisteredWriters };
