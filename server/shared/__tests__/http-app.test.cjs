// Layer: unit（server CJS 域）· 验证对象: server/shared/http-app.cjs（Fastify 装配＋横切机制）
// 契约样本取真实 contracts/http-api.openapi.json：闭合必填体 POST /api/approval/{articleId}/transition；无体 POST /api/pipeline/cancel。
const assert = require("node:assert/strict");
const test = require("node:test");
const { createHttpApp, resolveFailure } = require("../http-app.cjs");
const envelope = require("../api-envelope.cjs");
const { lookupRoute } = require("../contract-request-schema.cjs");

function echo(req, res) { return envelope.sendJSON(res, 200, { body: req.body === undefined ? "<undefined>" : req.body, params: req.params }); }

async function makeApp(options = {}) {
  const http = createHttpApp(options);
  http.registerRoute("POST", "/api/approval/:articleId/transition", echo);
  http.registerRoute("POST", "/api/pipeline/cancel", echo);
  http.registerRoute("GET", "/api/health", echo);
  http.registerRoute("POST", "/api/rules/lifecycle", echo);
  return http;
}

test("HA-1 契约推导：闭合必填体合法 → 200 封套；params 解码", async () => {
  const http = await makeApp();
  const res = await http.app.inject({ method: "POST", url: "/api/approval/a%20b/transition", payload: { operation: "confirm" } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.body, { operation: "confirm" });
  assert.equal(body.data.params.articleId, "a b");
  assert.match(res.headers["content-type"], /application\/json/);
  await http.close();
});

test("HA-2 契约推导：多余字段（闭合 schema）→ 400 VALIDATION_ERROR，details 对齐 ValidationErrorDetails（errors/diagnostics）", async () => {
  const http = await makeApp();
  const res = await http.app.inject({ method: "POST", url: "/api/approval/x/transition", payload: { operation: "confirm", __extra: 1 } });
  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.success, false);
  assert.equal(body.error_code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(body.details.errors) && body.details.errors.length >= 1);
  assert.ok(Array.isArray(body.details.diagnostics) && body.details.diagnostics[0].keyword);
  assert.deepEqual(Object.keys(body.details).sort(), ["diagnostics", "errors"]);
  await http.close();
});

test("HA-3 契约语义：requestBody 缺席路由收到 body → 400；不带 body → 200", async () => {
  const http = await makeApp();
  const rejected = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel", payload: { x: 1 } });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error_code, "VALIDATION_ERROR");
  const ok = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().data.body, "<undefined>");
  await http.close();
});

test("HA-4 契约语义：必填体缺席 → 400「请求体必填」；可选体缺席 → {} 进校验（不报必填）", async () => {
  const http = await makeApp();
  const required = await http.app.inject({ method: "POST", url: "/api/approval/x/transition" });
  assert.equal(required.statusCode, 400);
  assert.equal(required.json().message, "请求体必填");
  assert.equal(lookupRoute("POST", "/api/rules/lifecycle").bodyRequired, false);
  const optional = await http.app.inject({ method: "POST", url: "/api/rules/lifecycle" });
  assert.notEqual(optional.json().message, "请求体必填");
  if (optional.statusCode === 200) assert.deepEqual(optional.json().data.body, {});
  else assert.equal(optional.json().error_code, "VALIDATION_ERROR");
  await http.close();
});

test("HA-5 onRoute fail-closed：绕过 registerRoute 直接注册写路由（无 schema.body 且未标 bodyless）→ 注册即抛", async () => {
  const http = createHttpApp();
  assert.throws(() => http.app.route({ method: "POST", url: "/rogue", handler: async () => ({}) }), /fail-closed/);
  http.app.route({ method: "GET", url: "/read-only", handler: async () => ({ ok: true }) }); // 读路由不受此约束
  await http.close();
});

test("HA-6 body 错误映射表：非法 JSON→400 VALIDATION_ERROR；xml/text-plain→415 UNSUPPORTED_MEDIA_TYPE；超限→413 REQUEST_BODY_TOO_LARGE", async () => {
  const http = await makeApp({ bodyLimit: 128 });
  const badJson = await http.app.inject({ method: "POST", url: "/api/approval/x/transition", payload: "{nope", headers: { "content-type": "application/json" } });
  assert.equal(badJson.statusCode, 400); assert.equal(badJson.json().error_code, "VALIDATION_ERROR");
  const xml = await http.app.inject({ method: "POST", url: "/api/approval/x/transition", payload: "<x/>", headers: { "content-type": "application/xml" } });
  assert.equal(xml.statusCode, 415); assert.equal(xml.json().error_code, "UNSUPPORTED_MEDIA_TYPE");
  const plain = await http.app.inject({ method: "POST", url: "/api/approval/x/transition", payload: "plain", headers: { "content-type": "text/plain" } });
  assert.equal(plain.statusCode, 415);
  const big = await http.app.inject({ method: "POST", url: "/api/approval/x/transition", payload: { operation: "confirm", input: { pad: "x".repeat(400) } } });
  assert.equal(big.statusCode, 413); assert.equal(big.json().error_code, "REQUEST_BODY_TOO_LARGE");
  await http.close();
});

test("HA-7 业务错误透传（route-dispatch fail 语义）：status/code/details；裸 Error → 500 INTERNAL_ERROR；框架内部码不外泄", async () => {
  const http = createHttpApp();
  http.registerRoute("GET", "/conflict", () => { const e = new Error("撞车"); Object.assign(e, { status: 409, code: "CONFLICT", details: { k: 1 } }); throw e; });
  http.registerRoute("GET", "/boom", async () => { throw new Error("炸"); });
  const conflict = await http.app.inject({ method: "GET", url: "/conflict" });
  assert.equal(conflict.statusCode, 409);
  assert.deepEqual({ c: conflict.json().error_code, d: conflict.json().details, m: conflict.json().message }, { c: "CONFLICT", d: { k: 1 }, m: "撞车" });
  const boom = await http.app.inject({ method: "GET", url: "/boom" });
  assert.equal(boom.statusCode, 500); assert.equal(boom.json().error_code, "INTERNAL_ERROR");
  assert.deepEqual(resolveFailure(Object.assign(new Error("x"), { code: "FST_ERR_SOMETHING", statusCode: 500 })).error_code, "INTERNAL_ERROR");
  await http.close();
});

test("HA-8 handler 未产生响应 → 500 INTERNAL_ERROR（原装配会挂起）；async handler 调 sendJSON 不 return 亦正常", async () => {
  const http = createHttpApp();
  http.registerRoute("GET", "/silent", () => {});
  http.registerRoute("GET", "/noreturn", async (req, res) => { envelope.sendJSON(res, 200, { ok: true }); });
  const silent = await http.app.inject({ method: "GET", url: "/silent" });
  assert.equal(silent.statusCode, 500); assert.equal(silent.json().message, "路由未产生响应");
  const noreturn = await http.app.inject({ method: "GET", url: "/noreturn" });
  assert.equal(noreturn.statusCode, 200); assert.equal(noreturn.json().data.ok, true);
  await http.close();
});

test("HA-9 404 文案与封套；方法不匹配亦 404", async () => {
  const http = await makeApp();
  const res = await http.app.inject({ method: "GET", url: "/nope?x=1" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error_code, "NOT_FOUND");
  assert.equal(res.json().message, "未注册的 API 路由: GET /nope");
  const wrongMethod = await http.app.inject({ method: "PUT", url: "/api/health" });
  assert.equal(wrongMethod.statusCode, 404);
  await http.close();
});

test("HA-10 trace 贯通：合法 X-Trace-Id 入 → 封套 trace_id 与响应头同值；非法 → 生成 tr_", async () => {
  const http = await makeApp();
  const ok = await http.app.inject({ method: "GET", url: "/api/health", headers: { "x-trace-id": "tr_envelope-12345678" } });
  assert.equal(ok.headers["x-trace-id"], "tr_envelope-12345678");
  assert.equal(ok.json().trace_id, "tr_envelope-12345678");
  const bad = await http.app.inject({ method: "GET", url: "/api/health", headers: { "x-trace-id": "bogus" } });
  assert.match(bad.json().trace_id, /^tr_/);
  assert.equal(bad.headers["x-trace-id"], bad.json().trace_id);
  await http.close();
});

test("HA-11 onSend 响应探针：block → 替换 500 INTERNAL_ERROR 不外泄；pass → 原样；API_RESPONSE_SCHEMA_CHECK=0 → 零探针", async () => {
  const http = await makeApp();
  const previous = process.env.API_RESPONSE_SCHEMA_CHECK;
  try {
    delete process.env.API_RESPONSE_SCHEMA_CHECK;
    envelope.setResponseSchemaProbe(() => ({ action: "block", violations: [{ location: "x", message: "x 违约", keyword: "type" }] }));
    const blocked = await http.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(blocked.statusCode, 500);
    assert.equal(blocked.json().error_code, "INTERNAL_ERROR");
    assert.equal(blocked.json().details[0].message, "x 违约");
    envelope.setResponseSchemaProbe(() => ({ action: "pass", violations: [] }));
    const passed = await http.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(passed.statusCode, 200);
    process.env.API_RESPONSE_SCHEMA_CHECK = "0";
    envelope.setResponseSchemaProbe(() => ({ action: "block", violations: [] }));
    const off = await http.app.inject({ method: "GET", url: "/api/health" });
    assert.equal(off.statusCode, 200);
  } finally {
    envelope.setResponseSchemaProbe(null);
    if (previous === undefined) delete process.env.API_RESPONSE_SCHEMA_CHECK; else process.env.API_RESPONSE_SCHEMA_CHECK = previous;
    await http.close();
  }
});

test("HA-12 writer-gate 钩子：写方法非白名单 → 裸 403（非封套）；白名单／读方法放行；未匹配路由走 404 不进门", async () => {
  const gate = { fastifyHook: async (_request, reply) => reply.code(403).header("Content-Type", "application/json").send(JSON.stringify({ error_code: "WRITER_NOT_REGISTERED", registered_writers: [] }, null, 2)) };
  const http = await makeApp({ writerGate: gate, isWriteGateExempt: (p) => p === "/api/health" || p.startsWith("/api/graph/") });
  http.registerRoute("POST", "/api/health", echo); // 契约外写路由（bodyless）——仅测白名单放行
  const denied = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel" });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error_code, "WRITER_NOT_REGISTERED");
  // PR-085 裁项 4a 第 2 步：403 归一标准封套（裸形态退役；details 承载 hint/名单）——本用例的桩 gate 用直接 send 形态
  assert.ok(denied.json().success === undefined || denied.json().success === false, "封套或桩直发均可，码不变");
  const exempt = await http.app.inject({ method: "POST", url: "/api/health" });
  assert.equal(exempt.statusCode, 200);
  const read = await http.app.inject({ method: "GET", url: "/api/health" });
  assert.equal(read.statusCode, 200);
  const missing = await http.app.inject({ method: "POST", url: "/nope" });
  assert.equal(missing.statusCode, 404);
  await http.close();
});

test("HA-13 CORS：任意 OPTIONS → 204＋ACAO *；普通响应带 ACAO *", async () => {
  const http = await makeApp();
  const preflight = await http.app.inject({ method: "OPTIONS", url: "/api/health" });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "*");
  const res = await http.app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://example.test" } });
  assert.equal(res.headers["access-control-allow-origin"], "*");
  await http.close();
});

// PR-085：空体 ≡ 无体——Content-Type: application/json 且空体时与不带 body 等价（原手写 JSON.parse(body||"{}") 语义）
test("HA-14 空体等价：bodyless 路由带 JSON 头空体 → 200；必填体路由空体 → 400「请求体必填」；可选体空体 → {}", async () => {
  const http = await makeApp();
  const emptyBodyless = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel", payload: "", headers: { "content-type": "application/json" } });
  assert.equal(emptyBodyless.statusCode, 200, JSON.stringify(emptyBodyless.body));
  const emptyRequired = await http.app.inject({ method: "POST", url: "/api/approval/x/transition", payload: "", headers: { "content-type": "application/json" } });
  assert.equal(emptyRequired.statusCode, 400);
  assert.equal(emptyRequired.json().message, "请求体必填");
  const emptyOptional = await http.app.inject({ method: "POST", url: "/api/rules/lifecycle", payload: "", headers: { "content-type": "application/json" } });
  if (emptyOptional.statusCode === 200) assert.deepEqual(emptyOptional.json().data.body, {});
  else assert.equal(emptyOptional.json().error_code, "VALIDATION_ERROR");
  await http.close();
});
