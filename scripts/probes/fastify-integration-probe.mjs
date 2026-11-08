#!/usr/bin/env node
// Component: Fastify-Integration-Probe（PR-085 第 0 步 · 外部组件开工前现场勘探）
// @responsible: 以真实契约样本实证「Fastify 5.x ＋ 项目 Ajv2020 实例」的集成契约，为 SPEC-024 提供可复跑证据。
// @inputs: contracts/http-api.openapi.json（唯一契约事实源）；fastify（隔离安装，见「复跑」）；ajv（主树 node_modules）
// @outputs: 逐项 ✓/✗ 判定 ＋ 结论 JSON（stdout）；任一 ✗ → exit 1
// @context: 非产品代码——不被任何运行时 require；fastify 依赖随 PR-085 第 1 步 ADR-010 accepted 后才进 package.json。
// 复跑：
//   mkdir -p /tmp/pr085-probe-deps && (cd /tmp/pr085-probe-deps && npm init -y >/dev/null && npm i --no-save fastify@5.12.7)
//   node scripts/probes/fastify-integration-probe.mjs            # 可用 PROBE_DEPS=<dir> 指向其他隔离目录
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROBE_DEPS = process.env.PROBE_DEPS || "/tmp/pr085-probe-deps";

function loadFastify() {
  try { return require("fastify"); } catch (_e) { /* 主树未装（第 0 步预期） */ }
  const candidate = path.join(PROBE_DEPS, "node_modules", "fastify");
  if (!fs.existsSync(candidate)) { console.error(`fastify 未找到：请先按文件头「复跑」安装到 ${PROBE_DEPS}`); process.exit(2); }
  return require(candidate);
}
const Fastify = loadFastify();
const Ajv2020 = require("ajv/dist/2020.js");
const pino = require("pino");
const fastifyVersion = (() => { try { return require(path.join(PROBE_DEPS, "node_modules", "fastify", "package.json")).version; } catch (_e) { return require("fastify/package.json").version; } })();
const ajvVersion = require("ajv/package.json").version;

const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "http-api.openapi.json"), "utf8"));
const COMPONENTS = doc.components.schemas;

// ── 与 server/shared/api-schema-validator.cjs:22 同参，再显式关掉三个会改写请求体的框架默认项 ──
const PROJECT_AJV_OPTIONS = { allErrors: true, strict: false, validateFormats: false, removeAdditional: false, coerceTypes: false, useDefaults: false };

/** 项目校验器工厂：Ajv2020 实例 ＋ components 内联（镜像响应探针的 $ref 解析法）。 */
function projectValidatorFactory() {
  const ajv = new Ajv2020(PROJECT_AJV_OPTIONS);
  return function buildValidator(_externalSchemas, _ajvOptions) {
    return function ({ schema }) { return ajv.compile({ components: { schemas: COMPONENTS }, ...schema }); };
  };
}

/** 第 1 步错误处理器的映射表草案：框架 body 错误 → 项目错误码（第 0 步已登记入契约）。 */
function mapBodyError(error) {
  if (error && error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return { status: 413, error_code: "REQUEST_BODY_TOO_LARGE" };
  if (error && error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") return { status: 415, error_code: "UNSUPPORTED_MEDIA_TYPE" };
  if (error && (error.code === "FST_ERR_CTP_EMPTY_JSON_BODY" || error.code === "FST_ERR_CTP_INVALID_JSON_BODY" || error instanceof SyntaxError)) return { status: 400, error_code: "VALIDATION_ERROR" };
  if (error && Array.isArray(error.validation)) return { status: 400, error_code: "VALIDATION_ERROR", details: error.validation };
  if (error && error.code === "BODY_NOT_ALLOWED") return { status: 400, error_code: "VALIDATION_ERROR" };
  return { status: typeof error?.status === "number" ? error.status : 500, error_code: error?.code || "INTERNAL_ERROR" };
}

const als = new AsyncLocalStorage();
const observed = { bodyErrorCodes: {} };

function buildApp({ projectAjv, bodyLimit, jsonOnly } = {}) {
  const opts = { loggerInstance: pino({ level: "silent" }) };
  if (bodyLimit) opts.bodyLimit = bodyLimit;
  if (projectAjv) opts.schemaController = { compilersFactory: { buildValidator: projectValidatorFactory() } };
  const app = Fastify(opts);
  // 现场事实：Fastify 5 默认同时装有 application/json 与 text/plain 两个解析器——JSON-only API 须拆掉后者，非 JSON 才统一 415
  if (jsonOnly) app.removeContentTypeParser("text/plain");
  // 请求上下文：onRequest 用 enterWith（run() 包不住后续生命周期）
  app.addHook("onRequest", async (request) => { als.enterWith({ traceId: request.headers["x-trace-id"] || null, url: request.url }); });
  // 「契约无 requestBody 的路由收到 body → 400」：onRoute 给无 body schema 的写路由打标，preValidation 执法
  app.addHook("onRoute", (routeOptions) => {
    const isWrite = ["POST", "PUT", "PATCH"].includes(String(routeOptions.method));
    if (isWrite && !(routeOptions.schema && routeOptions.schema.body)) routeOptions.config = { ...(routeOptions.config || {}), bodyless: true };
  });
  app.addHook("preValidation", async (request) => {
    if (request.routeOptions.config && request.routeOptions.config.bodyless && request.body !== undefined && request.body !== null) {
      const error = new Error("契约未声明请求体，拒绝携带 body"); error.code = "BODY_NOT_ALLOWED"; error.status = 400; throw error;
    }
  });
  app.addHook("onSend", async (_request, reply) => { const store = als.getStore(); if (store && store.traceId) reply.header("x-trace-id-echo", store.traceId); });
  app.setErrorHandler((error, _request, reply) => {
    if (error.code) observed.bodyErrorCodes[error.code] = (observed.bodyErrorCodes[error.code] || 0) + 1;
    else if (error instanceof SyntaxError) observed.bodyErrorCodes["SyntaxError(no code)"] = (observed.bodyErrorCodes["SyntaxError(no code)"] || 0) + 1;
    const mapped = mapBodyError(error);
    reply.code(mapped.status).send({ success: false, error_code: mapped.error_code, message: error.message, details: mapped.details, fastify_code: error.code || null });
  });
  return app;
}

// ── 真实契约样本 ──
function pickOp(pred) {
  for (const [p, item] of Object.entries(doc.paths)) for (const [m, op] of Object.entries(item)) {
    const schema = op.requestBody?.content?.["application/json"]?.schema; if (!schema) continue;
    if (pred(schema, m, p)) return { method: m.toUpperCase(), path: p, schema };
  }
  return null;
}
const deref = (s) => (s && s.$ref ? COMPONENTS[s.$ref.split("/").pop()] : s);
const hasKey = (o, pred) => { let f = false; (function w(x) { if (f || !x || typeof x !== "object") return; if (pred(x)) f = true; for (const v of Object.values(x)) w(v); })(o); return f; };
const refSample = pickOp((s) => typeof s.$ref === "string" && hasKey(deref(s), (x) => x.additionalProperties === false));
const closedSample = pickOp((s) => deref(s) && deref(s).additionalProperties === false && deref(s).required);
const nullableComponent = Object.entries(COMPONENTS).find(([, s]) => hasKey(s, (x) => x.nullable === true));

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); }

async function main() {
  console.log(`环境：node ${process.version} · fastify ${fastifyVersion} · ajv ${ajvVersion} · openapi ${doc.openapi}（${Object.keys(doc.paths).length} paths）`);
  const closedSchema = deref(closedSample.schema);
  const requiredKey = closedSchema.required[0];
  const validBody = {}; validBody[requiredKey] = closedSchema.properties[requiredKey].enum ? closedSchema.properties[requiredKey].enum[0] : "x";

  // A. 项目 Ajv2020 接线 ＋ 真实契约 $ref/闭合 schema
  {
    const app = buildApp({ projectAjv: true, jsonOnly: true });
    app.post("/closed", { schema: { body: closedSample.schema } }, async (request) => ({ body: request.body }));
    app.post("/ref", { schema: { body: refSample.schema } }, async (request) => ({ body: request.body }));
    app.post("/synthetic", { schema: { body: { type: "object", properties: { n: { type: "integer" }, b: { type: "boolean" }, mode: { type: "string", default: "full" } } } } }, async (request) => ({ body: request.body }));
    app.post("/bodyless", async () => ({ ok: true }));
    app.post("/ctx", async (request) => { await new Promise((r) => setTimeout(r, 5)); const nested = async () => als.getStore(); const store = await nested(); return { seen: store ? store.traceId : null, header: request.headers["x-trace-id"] }; });
    await app.ready();
    const okRes = await app.inject({ method: "POST", url: "/closed", payload: validBody });
    check("A1 真实契约闭合 schema 合法体 → 200", okRes.statusCode === 200, `${closedSample.method} ${closedSample.path} 样本`);
    const refRes = await app.inject({ method: "POST", url: "/ref", payload: {} });
    check("A2 真实契约 $ref schema 可编译并执法（空体 → 400）", refRes.statusCode === 400 && refRes.json().error_code === "VALIDATION_ERROR", `${refSample.method} ${refSample.path}`);
    const extra = { ...validBody, __extra: 1 };
    const extraRes = await app.inject({ method: "POST", url: "/closed", payload: extra });
    check("A3 项目实例：闭合 schema 多余字段 → 400（不剥除、不放行）", extraRes.statusCode === 400, `fastify_code=${extraRes.json().fastify_code}`);
    const coerceRes = await app.inject({ method: "POST", url: "/synthetic", payload: { n: "5", b: "true" } });
    check("A4 项目实例：类型不强转（\"5\"→integer 判违约 → 400）", coerceRes.statusCode === 400);
    const defaultsRes = await app.inject({ method: "POST", url: "/synthetic", payload: {} });
    check("A5 项目实例：不填 default（mode 保持 undefined）", defaultsRes.statusCode === 200 && defaultsRes.json().body.mode === undefined);
    const allErrRes = await app.inject({ method: "POST", url: "/synthetic", payload: { n: "x", b: "y" } });
    check("A6 项目实例：allErrors=true（两处违约全报）", (allErrRes.json().details || []).length >= 2, `details=${(allErrRes.json().details || []).length}`);
    // B. 错误码映射（真实框架错误 → 已登记项目码）
    const badJson = await app.inject({ method: "POST", url: "/closed", payload: "{not json", headers: { "content-type": "application/json" } });
    check("B1 非法 JSON → 400 VALIDATION_ERROR", badJson.statusCode === 400 && badJson.json().error_code === "VALIDATION_ERROR", `fastify_code=${badJson.json().fastify_code}`);
    const emptyJson = await app.inject({ method: "POST", url: "/closed", payload: "", headers: { "content-type": "application/json" } });
    check("B2 空 body（声明 json）→ 400 VALIDATION_ERROR", emptyJson.statusCode === 400 && emptyJson.json().error_code === "VALIDATION_ERROR", `fastify_code=${emptyJson.json().fastify_code}`);
    const mediaRes = await app.inject({ method: "POST", url: "/closed", payload: "<x/>", headers: { "content-type": "application/xml" } });
    check("B3 Content-Type 非 JSON（application/xml）→ 415 UNSUPPORTED_MEDIA_TYPE", mediaRes.statusCode === 415 && mediaRes.json().error_code === "UNSUPPORTED_MEDIA_TYPE", `fastify_code=${mediaRes.json().fastify_code}`);
    const plainRes = await app.inject({ method: "POST", url: "/closed", payload: "plain", headers: { "content-type": "text/plain" } });
    check("B3b text/plain 在拆掉默认解析器后 → 415（否则框架默认解析为字符串后落 400 FST_ERR_VALIDATION）", plainRes.statusCode === 415, `fastify_code=${plainRes.json().fastify_code}`);
    const bodylessRes = await app.inject({ method: "POST", url: "/bodyless", payload: { x: 1 } });
    check("B4 契约无 requestBody 路由收到 body → 400（onRoute 打标＋preValidation 执法）", bodylessRes.statusCode === 400 && bodylessRes.json().error_code === "VALIDATION_ERROR");
    const bodylessOk = await app.inject({ method: "POST", url: "/bodyless" });
    check("B5 契约无 requestBody 路由不带 body → 200", bodylessOk.statusCode === 200);
    // E. ALS 传播 ＋ 并发隔离
    const [c1, c2] = await Promise.all([
      app.inject({ method: "POST", url: "/ctx", headers: { "x-trace-id": "tr_aaaaaaaa" } }),
      app.inject({ method: "POST", url: "/ctx", headers: { "x-trace-id": "tr_bbbbbbbb" } }),
    ]);
    check("E1 onRequest enterWith → handler 内嵌套 await 后仍读到 traceId", c1.json().seen === "tr_aaaaaaaa" && c2.json().seen === "tr_bbbbbbbb", `${c1.json().seen}/${c2.json().seen}`);
    check("E2 onSend 钩子读 ALS 回写响应头（并发两请求互不串）", c1.headers["x-trace-id-echo"] === "tr_aaaaaaaa" && c2.headers["x-trace-id-echo"] === "tr_bbbbbbbb");
    check("G1 现有 pino 实例经 loggerInstance 接入可启动", true, "pino " + require("pino/package.json").version);
    await app.close();
  }
  // F. 重复路由 fail-closed（现场事实：第二次 app.post() 注册时即同步抛出，不等 ready）
  {
    const app = buildApp({ projectAjv: true, jsonOnly: true });
    app.post("/dup", async () => ({}));
    let dup = null; try { app.post("/dup", async () => ({})); } catch (e) { dup = e.code; }
    check("F1 重复注册同一路由 → 注册时同步抛 FST_ERR_DUPLICATED_ROUTE", dup === "FST_ERR_DUPLICATED_ROUTE", `code=${dup}`);
    try { await app.close(); } catch (_e) { /* 未就绪实例关闭可忽略 */ }
  }
  // C. bodyLimit → 413
  {
    const app = buildApp({ projectAjv: true, bodyLimit: 64, jsonOnly: true });
    app.post("/small", { schema: { body: { type: "object" } } }, async () => ({ ok: true }));
    app.post("/big", { bodyLimit: 1024, schema: { body: { type: "object" } } }, async () => ({ ok: true }));
    await app.ready();
    const big = await app.inject({ method: "POST", url: "/small", payload: { pad: "x".repeat(200) } });
    check("C1 超过 bodyLimit → 413 REQUEST_BODY_TOO_LARGE", big.statusCode === 413 && big.json().error_code === "REQUEST_BODY_TOO_LARGE", `fastify_code=${big.json().fastify_code}`);
    const perRoute = await app.inject({ method: "POST", url: "/big", payload: { pad: "x".repeat(200) } });
    check("C2 路由级 bodyLimit 覆盖全局（上传路由单独限额可行）", perRoute.statusCode === 200);
    await app.close();
  }
  // D. 反证：Fastify 默认 Ajv 会改写请求体、且解析不了契约 $ref（证明项目实例是必须项）
  {
    const refApp = buildApp({ projectAjv: false });
    refApp.post("/ref", { schema: { body: refSample.schema } }, async () => ({}));
    let buildErr = null; try { await refApp.ready(); } catch (e) { buildErr = e.code; }
    check("D0 框架默认校验器：契约 $ref 无法解析（FST_ERR_SCH_VALIDATION_BUILD）——反证", buildErr === "FST_ERR_SCH_VALIDATION_BUILD", `code=${buildErr}`);
    try { await refApp.close(); } catch (_e) { /* 未就绪实例 */ }
    const app = buildApp({ projectAjv: false });
    app.post("/closed", { schema: { body: deref(closedSample.schema) } }, async (request) => ({ body: request.body }));
    app.post("/synthetic", { schema: { body: { type: "object", properties: { n: { type: "integer" }, b: { type: "boolean" }, mode: { type: "string", default: "full" } } } } }, async (request) => ({ body: request.body }));
    await app.ready();
    const stripped = await app.inject({ method: "POST", url: "/closed", payload: { ...validBody, __extra: 1 } });
    check("D1 框架默认实例：多余字段被静默剥除（200 且字段消失）——反证", stripped.statusCode === 200 && stripped.json().body.__extra === undefined, `status=${stripped.statusCode}`);
    const coerced = await app.inject({ method: "POST", url: "/synthetic", payload: { n: "5", b: "true" } });
    check("D2 框架默认实例：\"5\"→5、\"true\"→true 静默强转——反证", coerced.statusCode === 200 && coerced.json().body.n === 5 && coerced.json().body.b === true);
    const defaulted = await app.inject({ method: "POST", url: "/synthetic", payload: {} });
    check("D3 框架默认实例：useDefaults 填入 mode=\"full\"——反证", defaulted.json().body && defaulted.json().body.mode === "full");
    await app.close();
  }
  // H. nullable 编译兼容（请求侧今日 0 用例，响应侧有；Ajv2020 strict:false 下须可编译）
  {
    const ajv = new Ajv2020(PROJECT_AJV_OPTIONS);
    let compiled = false, err = null;
    try { ajv.compile({ components: { schemas: COMPONENTS }, $ref: `#/components/schemas/${nullableComponent ? nullableComponent[0] : "ApiError"}` }); compiled = true; } catch (e) { err = e.message; }
    check("H1 含 nullable 的真实 component 在项目 Ajv2020 可编译", compiled, nullableComponent ? nullableComponent[0] : "(无 nullable 样本)" + (err ? " err=" + err : ""));
  }

  const failed = results.filter((r) => !r.ok);
  const conclusions = {
    fastify: fastifyVersion, ajv: ajvVersion, node: process.version,
    validator_wiring: "schemaController.compilersFactory.buildValidator → Ajv2020(PROJECT_AJV_OPTIONS).compile({components:{schemas}, ...schema})",
    ajv_options: PROJECT_AJV_OPTIONS,
    ref_strategy: "components 内联（与 api-schema-validator.cjs 同法）；无需 addSchema/$id 改写。反证 D0：框架默认校验器对契约 $ref 直接 FST_ERR_SCH_VALIDATION_BUILD",
    body_error_mapping: { FST_ERR_CTP_BODY_TOO_LARGE: "413 REQUEST_BODY_TOO_LARGE", FST_ERR_CTP_INVALID_MEDIA_TYPE: "415 UNSUPPORTED_MEDIA_TYPE", FST_ERR_CTP_EMPTY_JSON_BODY: "400 VALIDATION_ERROR", "FST_ERR_CTP_INVALID_JSON_BODY|SyntaxError": "400 VALIDATION_ERROR", FST_ERR_VALIDATION: "400 VALIDATION_ERROR(+details)", BODY_NOT_ALLOWED: "400 VALIDATION_ERROR" },
    observed_framework_error_codes: observed.bodyErrorCodes,
    bodyless_enforcement: "onRoute 打标 config.bodyless（写方法且无 schema.body）＋ preValidation 拒绝 request.body!==undefined",
    content_type_parsers: "框架默认装有 application/json ＋ text/plain 两个解析器；第 1 步 removeContentTypeParser('text/plain') 后非 JSON 统一 415",
    request_context: "onRequest 钩子 AsyncLocalStorage.enterWith；并发隔离通过",
    logger: "loggerInstance 选项接入现有 pino 实例",
    samples: { closed: `${closedSample.method} ${closedSample.path}`, ref: `${refSample.method} ${refSample.path}`, nullable: nullableComponent ? nullableComponent[0] : null },
    passed: results.length - failed.length, failed: failed.map((f) => f.name),
  };
  console.log("\n结论 JSON："); console.log(JSON.stringify(conclusions, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error("探针异常：", error); process.exit(1); });
