const assert = require("node:assert/strict");
const test = require("node:test");

const { sendJSON } = require("../api-envelope.cjs");
const { createHttpLogger, createJsonLogger } = require("../json-logger.cjs");
const { observeOperation } = require("../operation-observer.cjs");
const { createHttpApp } = require("../http-app.cjs");

// PR-085 第 1 步：日志行形状锚定——pino-http 在 http-app onRequest 钩子内原样调用，request.completed 行的
// trace_id/http.status_code 与封套 trace_id、嵌套 operation 行同源（AsyncLocalStorage enterWith）；敏感头/体不入日志。
test("one trace id correlates the response, HTTP lifecycle, and nested operation", async () => {
  const lines = [];
  const logger = createJsonLogger({ sink: (line) => lines.push(line) });
  const httpLogger = createHttpLogger({ logger });
  const http = createHttpApp({ logger, httpLogger, cors: false });
  // 直接注册带宽松 body schema 的路由（本测试验证观测链路，不验证契约推导——契约路由走 registerRoute）
  http.app.route({
    method: "POST",
    url: "/api/proposals",
    schema: { body: { type: "object" } },
    handler: async (_req, res) => observeOperation({
      logger,
      name: "proposal.create",
      fields: { proposal_id: "proposal-123456789abc" },
    }, () => sendJSON(res, 201, { proposal_id: "proposal-123456789abc" })),
  });

  const res = await http.app.inject({
    method: "POST",
    url: "/api/proposals",
    headers: { authorization: "Bearer must-not-be-logged", "x-trace-id": "tr_integration-12345678" },
    payload: { content: "private article body" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const payload = res.json();
  const records = lines.map((line) => JSON.parse(line));
  const completed = records.find((entry) => entry.event === "request.completed");
  const operation = records.find((entry) => entry.event === "proposal.create.completed");

  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["x-trace-id"], "tr_integration-12345678");
  assert.equal(payload.trace_id, "tr_integration-12345678");
  assert.ok(completed, "pino-http request.completed 行必须存在（日志行形状锚定）");
  assert.equal(completed.trace_id, "tr_integration-12345678");
  assert.equal(completed.subsystem, "http");
  assert.equal(completed.http.status_code, 201);
  assert.equal(completed.http.method, "POST");
  assert.equal(completed.http.path, "/api/proposals");
  assert.equal(operation.trace_id, "tr_integration-12345678");
  assert.equal(operation.proposal_id, "proposal-123456789abc");

  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes("must-not-be-logged"), false);
  assert.equal(serialized.includes("private article body"), false);
  await http.close();
});

// 错误行形状：业务错误经错误处理器 → request.completed（warn 级，error_code 字段来自 reply.raw.errorCode）
test("error_code rides the HTTP lifecycle log line for failed requests", async () => {
  const lines = [];
  const logger = createJsonLogger({ sink: (line) => lines.push(line) });
  const httpLogger = createHttpLogger({ logger });
  const http = createHttpApp({ logger, httpLogger, cors: false });
  http.registerRoute("GET", "/api/conflict", () => { const e = new Error("撞车"); e.code = "CONFLICT"; e.status = 409; throw e; });
  const res = await http.app.inject({ method: "GET", url: "/api/conflict" });
  await new Promise((resolve) => setImmediate(resolve));
  const records = lines.map((line) => JSON.parse(line));
  const lifecycle = records.find((entry) => entry.event === "request.completed" || entry.event === "request.failed");
  assert.equal(res.statusCode, 409);
  assert.ok(lifecycle, "HTTP 生命周期行必须存在");
  assert.equal(lifecycle.http.status_code, 409);
  assert.equal(lifecycle.http.error_code, "CONFLICT");
  await http.close();
});
