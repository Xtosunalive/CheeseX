// Component: HTTP-App（PR-085 第 1/2 步 · ADR-010 · SPEC-024 §五机制归宿表）
// @responsible: 传输层标准框架化装配——Fastify 实例承载全部横切机制：CORS（随身份模式收窄）、请求上下文（AsyncLocalStorage）、
//               pino-http 日志行、Langfuse 请求 span、**身份接缝**（auth-stack 三态解析→Principal 入 ALS；凭据无效 401 不降级；
//               写方法无主体 401；/api/auth/* 四端点）、writer-gate 通道钩子（403 封套）、契约推导请求校验（onRoute fail-closed／
//               bodyless／可选体缺席）、onSend 响应出站探针、错误处理器、404 文案。路由层只剩 handler 本体。
// @inputs: createHttpApp({ logger, httpLogger, requestSpan, auth, writerGate, isWriteGateExempt, bodyLimit, cors })
//          auth = createAuthFromEnv() 产物 { mode, stack, oidc|null, cors }；缺省（测试）不装身份层＝匿名放行（与第 1 步形态一致）
// @outputs: { app, registerRoute(method, pathname, handler), listen({ port, host }), close() }；resolveFailure（供测试）
// @context: 原 main.cjs 手写 http.createServer 段、route-dispatch.cjs（错误隔离）、route-pattern.cjs（线性匹配）随本模块退役。
//           handler 签名保持 (req, res)：req 即 Fastify request（params/url/headers/method/body），res 即 reply，经 sendJSON 出站——
//           路由文件只需把手写 body 读取改成 req.body（契约推导校验已在 handler 之前完成）。
const Fastify = require("fastify");
const { LogController } = require("fastify");
const fastifyCors = require("@fastify/cors");
const { enterRequestContext, getTraceId, createTraceId, setPrincipal, getPrincipal } = require("./request-context.cjs");
const { sendJSON, errorEnvelope, getResponseSchemaProbe } = require("./api-envelope.cjs");
const { toDotLocation } = require("./api-schema-validator.cjs");
const contractRequest = require("./contract-request-schema.cjs");
const { requiredRolesFor } = require("./auth/route-roles.cjs"); // 第 3 步：路由→角色绑定（加载即对账契约）
const { createError } = require("./error-factory.cjs"); // EG-1b：错误工厂定义唯一——本模块不另立本地工厂

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const kSpanSettle = Symbol("http-app.span-settle");

function pathnameOf(request) {
  try { return new URL(request.url || "/", "http://127.0.0.1").pathname; } catch (_error) { return "/"; }
}


/**
 * 错误 → 响应映射（SPEC-024 集成契约 ⑦；第 0 步探针 B1–B4／C1 实证的框架码全集）。
 * kind="body"：框架 body 层拒绝（请求侧，warn 级日志）；kind="handler"：业务 handler 抛出（route-dispatch fail() 语义，error 级日志）。
 */
function resolveFailure(error) {
  const code = error && error.code;
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") return { kind: "body", status: 413, error_code: "REQUEST_BODY_TOO_LARGE", message: "请求体超过传输层上限" };
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return { kind: "body", status: 415, error_code: "UNSUPPORTED_MEDIA_TYPE", message: "请求体 Content-Type 须为 application/json" };
  if (code === "FST_ERR_CTP_EMPTY_JSON_BODY" || code === "FST_ERR_CTP_INVALID_JSON_BODY") return { kind: "body", status: 400, error_code: "VALIDATION_ERROR", message: "请求体不是合法 JSON" };
  if (Array.isArray(error && error.validation)) {
    const root = error.validationContext || "body";
    const diagnostics = error.validation.map((item) => {
      const location = toDotLocation(item.instancePath || "", root);
      return { location, message: `${location} ${item.message}`, keyword: item.keyword };
    });
    // details 形状对齐契约 ValidationErrorDetails（additionalProperties:false；errors: string[]／diagnostics: object[]）
    return { kind: "body", status: 400, error_code: "VALIDATION_ERROR", message: "请求体不符合契约", details: { errors: diagnostics.map((d) => d.message), diagnostics } };
  }
  if (code === "BODY_NOT_ALLOWED" || code === "BODY_REQUIRED") return { kind: "body", status: 400, error_code: "VALIDATION_ERROR", message: error.message };
  const status = Number.isInteger(error && error.status)
    ? error.status
    : (Number.isInteger(error && error.statusCode) && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500);
  const errorCode = code && !String(code).startsWith("FST_ERR_") ? code : "INTERNAL_ERROR";
  const mapped = { kind: "handler", status, error_code: errorCode, message: (error && error.message) || "API 路由执行失败" };
  if (error && error.details !== undefined) mapped.details = error.details;
  return mapped;
}

function createHttpApp(options = {}) {
  const { logger = null, httpLogger = null, requestSpan = null, auth = null, writerGate = null, isWriteGateExempt = () => false, bodyLimit } = options;
  // CORS 单源：装了身份层则由 auth.cors 决定（local="*"；oidc=显式名单带凭据／未配即仅同源 false）；否则沿用 options.cors（测试可关）
  const cors = auth ? auth.cors : options.cors;
  const pinoInstance = logger && logger.raw ? logger.raw : null;
  const app = Fastify({
    ...(pinoInstance ? { loggerInstance: pinoInstance } : { logger: false }),
    // 日志行形状由 pino-http 原样承载（trace_id/subsystem/error_code）；框架自带的 incoming/completed 行关闭
    //（5.12 起顶层 disableRequestLogging 弃用，改经 LogController 实例）
    logController: new LogController({ disableRequestLogging: true }),
    exposeHeadRoutes: false, // 原路由表无 HEAD（HEAD → 404），路由表条目数保持不变
    ...(Number.isInteger(bodyLimit) && bodyLimit > 0 ? { bodyLimit } : {}),
    schemaController: { compilersFactory: { buildValidator: contractRequest.createValidatorCompiler() } },
  });
  // 现场事实（探针 B3b）：框架默认装有 text/plain 解析器——JSON-only API 拆掉后非 JSON 统一 415
  app.removeContentTypeParser("text/plain");
  // 空体 ≡ 无体（SPEC-024 契约语义 2 修订）：原手写读取一律 JSON.parse(body||"{}")，本层以「空体解析为 undefined」
  // 保持等价——必填与否交给契约（preValidation 判 BODY_REQUIRED），不再由解析器以 400 抢答。
  // 解析本体沿用框架公开的默认 JSON 解析器（同参防原型污染 getDefaultJsonParser）。
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (body === "" || body === undefined || body === null) return done(null, undefined);
    return parseJson(req, body, done);
  });
  if (cors !== false) {
    app.register(fastifyCors, {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Trace-Id"],
      strictPreflight: false, // 原装配：任意 OPTIONS → 204
      ...(cors || {}),
    });
  }

  // ── 请求上下文（ALS enterWith，须最先）＋ pino-http 日志行 ＋ Langfuse span（onRequest 开 / onResponse 结）──
  app.addHook("onRequest", async (request, reply) => {
    enterRequestContext({ traceId: request.headers["x-trace-id"] });
    if (httpLogger) httpLogger(request.raw, reply.raw);
    if (requestSpan) {
      let settle = null;
      const pending = new Promise((resolve) => { settle = resolve; });
      request[kSpanSettle] = settle;
      const outcome = requestSpan(request.raw, reply.raw, () => pending);
      if (outcome && typeof outcome.catch === "function") outcome.catch(() => {});
    }
  });
  app.addHook("onResponse", async (request) => {
    const settle = request[kSpanSettle];
    if (settle) { request[kSpanSettle] = null; settle(); }
  });

  // ── 身份接缝（ADR-010 决策 6/7；OpenMAIC 序列同构）：每请求解析 Principal 入 ALS；
  //    invalid（凭据存在但无效）→ 401 立即拒绝、绝不降级（读写一律）；anonymous → 读放行、写由下方主体门判 401；error → 500 ──
  if (auth) {
    app.addHook("onRequest", async (request, reply) => {
      const outcome = await auth.stack.resolve(request);
      if (outcome.outcome === "authenticated") {
        // 第 3 步：主体先经角色登记表装饰有效角色（defaults＋显式登记）再入上下文
        const registry = auth.roleRegistry;
        const principal = registry ? registry.decorate(outcome.principal) : outcome.principal;
        setPrincipal(principal);
        for (const value of outcome.setCookies) reply.header("set-cookie", value);
        return undefined;
      }
      if (outcome.outcome === "invalid") {
        // 保持立即401且不降级；凭据所属方法负责清理，浏览器下一次可重新登录。
        for (const value of outcome.setCookies || []) reply.header("set-cookie", value);
        if (logger) logger.warn({ event: "auth-credential-invalid", method: request.method, path: pathnameOf(request), auth_method: outcome.method, reason: outcome.reason });
        return sendJSON(reply, 401, { error_code: "UNAUTHENTICATED", message: "身份凭据无效或已过期" });
      }
      if (outcome.outcome === "error") {
        if (logger) logger.error({ event: "auth-method-failed", auth_method: outcome.method, error: outcome.error && outcome.error.message });
        throw createError("INTERNAL_ERROR", "身份校验不可判定", 500);
      }
      return undefined; // anonymous
    });
    // 主体门：写方法须有已解析主体（墓碑与 authExempt 路由除外——退役信号/登出不设门）
    app.addHook("onRequest", async (request, reply) => {
      if (request.is404 || !WRITE_METHODS.has(request.method)) return undefined;
      const config = (request.routeOptions && request.routeOptions.config) || {};
      if (config.tombstone === true || config.authExempt === true) return undefined;
      if (getPrincipal()) return undefined;
      return sendJSON(reply, 401, { error_code: "UNAUTHENTICATED", message: "写操作须先登录（AUTH_MODE=" + auth.mode + "）" });
    });
    // 角色门（第 3 步 · ADR-010 决策 7）：路由角色绑定表统一执法——preHandler 时路由已定、body 已解析
    //（审批 publish 的载荷敏感升级亦在表内单源）；local 模式全角色恒过（现状零变化）。
    app.addHook("preHandler", async (request, reply) => {
      if (request.is404) return undefined;
      const config = (request.routeOptions && request.routeOptions.config) || {};
      if (config.tombstone === true || config.authExempt === true) return undefined;
      const required = requiredRolesFor(request.method, request.routeOptions && request.routeOptions.url, request.body);
      if (!required || required.length === 0) return undefined;
      const principal = getPrincipal();
      if (principal && required.every((role) => principal.roles.includes(role))) return undefined;
      if (logger) logger.warn({ event: "role-gate-rejected", method: request.method, path: pathnameOf(request), operator: principal ? principal.operatorId : null, required, have: principal ? [...principal.roles] : [] });
      return sendJSON(reply, 403, {
        error_code: "ROLE_DENIED",
        message: "操作所需角色未满足",
        details: { operatorId: principal ? principal.operatorId : null, required, have: principal ? [...principal.roles] : [] },
      });
    });
  }

  // ── writer-gate（SPEC-011-W11 WP5·403）：写方法＋非白名单路径；未匹配路由（404）不进门——与原装配一致 ──
  if (writerGate) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.is404) return undefined;
      if (!WRITE_METHODS.has(request.method)) return undefined;
      if (isWriteGateExempt(pathnameOf(request))) return undefined;
      return writerGate.fastifyHook(request, reply);
    });
  }

  // ── onRoute fail-closed：写路由要么有契约推导 schema.body，要么被标记 bodyless（契约无 requestBody），要么是 410 墓碑——否则注册即错 ──
  app.addHook("onRoute", (routeOptions) => {
    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    for (const method of methods) {
      if (!WRITE_METHODS.has(String(method).toUpperCase())) continue;
      const hasBodySchema = Boolean(routeOptions.schema && routeOptions.schema.body);
      const bodyless = Boolean(routeOptions.config && routeOptions.config.bodyless === true);
      const tombstone = Boolean(routeOptions.config && routeOptions.config.tombstone === true);
      if (!hasBodySchema && !bodyless && !tombstone) {
        throw new Error(`[http-app] fail-closed：写路由 ${method} ${routeOptions.url} 无契约推导 schema.body 且未标记 bodyless——写路由必须经 registerRoute 注册并在 contracts/http-api.openapi.json 声明`);
      }
    }
  });

  // ── 契约语义：requestBody 缺席＝禁止 body；必填缺席 → 400；可选缺席 → {} 进校验（与原 JSON.parse(body||"{}") 等价但走契约）──
  app.addHook("preValidation", async (request) => {
    const config = (request.routeOptions && request.routeOptions.config) || {};
    const hasBody = request.body !== undefined && request.body !== null;
    if (config.bodyless === true && hasBody) throw createError("BODY_NOT_ALLOWED", "契约未声明请求体，拒绝携带 body", 400);
    if (config.bodyContract && !hasBody) {
      if (config.bodyContract.required) throw createError("BODY_REQUIRED", "请求体必填", 400);
      request.body = {};
    }
  });

  // ── 响应出站契约探针（seq196 enforce／shadow，ADR060）：全部 JSON 响应一律经过；违约→替换 500 不外泄 ──
  app.addHook("onSend", async (request, reply, payload) => {
    const probe = getResponseSchemaProbe();
    if (!probe || typeof payload !== "string" || payload.length === 0) return payload;
    let parsed;
    try { parsed = JSON.parse(payload); } catch (_error) { return payload; }
    let verdict = null;
    try { verdict = probe(request.url, request.method, reply.statusCode, parsed); } catch (_probeError) { /* 探针异常不波及响应链路（可用性优先） */ }
    if (!verdict || verdict.action !== "block") return payload;
    const traceId = getTraceId() || createTraceId();
    reply.code(500).type("application/json; charset=utf-8").header("X-Trace-Id", traceId);
    reply.raw.errorCode = "INTERNAL_ERROR";
    // PR-156 刀一：被拦响应显形化——替换体携带原始错误码与消息（此前只给 violations，用户侧
    // 无从得知真实拒因——目录欠账期间每个漏登记者都被吞因）。enforcement 语义不变：违约载荷仍不外泄，
    // 仅把「自己的错误说了什么」转述给用户。
    const original = parsed && typeof parsed === "object" ? parsed : null;
    const originalCode = original && original.error_code ? String(original.error_code) : "";
    const originalMessage = original && (original.message || original.error) ? String(original.message || original.error) : "";
    const suffix = originalCode ? `：原始错误 ${originalCode}${originalMessage ? "——" + originalMessage : ""}` : "";
    return JSON.stringify(errorEnvelope({ errorCode: "INTERNAL_ERROR", message: "响应契约校验失败（enforce 拦截）" + suffix, details: verdict.violations, traceId }));
  });

  // ── 错误处理器：框架 body 错误映射表 ＋ 业务错误 status/code/details（route-dispatch fail() 语义）──
  app.setErrorHandler((error, request, reply) => {
    const mapped = resolveFailure(error);
    if (mapped.kind === "handler") {
      reply.raw.err = error; // pino-http「request.failed」形态（原 route-dispatch 设 res.err）
      if (logger) logger.error({ event: "route-handler-failed", method: request.method, path: pathnameOf(request), error: error instanceof Error ? error.message : String(error) });
    } else if (logger) {
      logger.warn({ event: "request-body-rejected", method: request.method, path: pathnameOf(request), error_code: mapped.error_code, fastify_code: error.code || null });
    }
    return sendJSON(reply, mapped.status, { error_code: mapped.error_code, message: mapped.message, details: mapped.details });
  });

  app.setNotFoundHandler((request, reply) => sendJSON(reply, 404, { error_code: "NOT_FOUND", message: `未注册的 API 路由: ${request.method} ${pathnameOf(request)}` }));

  /**
   * 路由注册（唯一入口）：查契约决定 schema.body／bodyless／bodyLimit；handler 保持 (req, res) 签名。
   * 契约含 requestBody 却推导不出 schema 的情形在 contract-request-schema 加载期已抛（启动即错）。
   * handler.tombstone === true（410 墓碑）：无视请求体，一律答 410——「已退役，改用 X」的信号不被 400 盖掉。
   */
  function registerRoute(method, pathname, handler) {
    const upper = String(method || "").toUpperCase();
    const facts = contractRequest.lookupRoute(upper, pathname);
    const routeOptions = { method: upper, url: pathname, config: { inContract: facts.inContract }, handler: wrapHandler(handler) };
    if (handler && handler.authExempt === true) routeOptions.config.authExempt = true;
    if (handler && handler.tombstone === true) {
      routeOptions.config.tombstone = true;
    } else if (facts.inContract && facts.hasRequestBody) {
      routeOptions.schema = { body: facts.bodySchema };
      routeOptions.config.bodyContract = { required: facts.bodyRequired };
      if (facts.bodyLimit) routeOptions.bodyLimit = facts.bodyLimit;
    } else if (WRITE_METHODS.has(upper)) {
      routeOptions.config.bodyless = true;
    }
    app.route(routeOptions);
    return routeOptions;
  }

  function wrapHandler(handler) {
    return async function routeHandler(request, reply) {
      const result = await handler(request, reply);
      if (reply.sent) return reply;
      if (result !== undefined) return result;
      throw createError("INTERNAL_ERROR", "路由未产生响应", 500);
    };
  }

  // ── /api/auth/*（身份层自有端点，随 auth 装配恒注册——契约与 parity 门禁对账以 http-app 为注册面之一）──
  if (auth) {
    const oidc = auth.oidc;
    const describePrincipal = (p) => (p ? { operatorId: p.operatorId, kind: p.kind, roles: [...p.roles], assurance: p.assurance, channel: p.channel, name: p.claims.name ?? null } : null);
    registerRoute("GET", "/api/auth/me", (_req, res) => {
      const p = getPrincipal();
      return sendJSON(res, 200, { mode: auth.mode, authenticated: Boolean(p && p.assurance === "verified"), principal: describePrincipal(p) });
    });
    registerRoute("GET", "/api/auth/login", (req, res) => {
      if (!oidc) throw createError("AUTH_LOCAL_MODE", "本地单用户模式无登录流程（AUTH_MODE=local）", 400);
      return oidc.loginHandler(req, res);
    });
    registerRoute("GET", "/api/auth/callback", (req, res) => {
      if (!oidc) throw createError("AUTH_LOCAL_MODE", "本地单用户模式无登录流程（AUTH_MODE=local）", 400);
      return oidc.callbackHandler(req, res);
    });
    const logout = Object.assign(async (req, res) => {
      if (oidc) await oidc.logoutHandler(req, res);
      return sendJSON(res, 200, { mode: auth.mode, authenticated: false, principal: null });
    }, { authExempt: true });
    registerRoute("POST", "/api/auth/logout", logout);
  }

  async function listen({ port, host = "127.0.0.1" }) {
    await app.listen({ port, host });
    return app.server.address();
  }

  return { app, registerRoute, listen, close: () => app.close() };
}

module.exports = { createHttpApp, resolveFailure, WRITE_METHODS, pathnameOf };
