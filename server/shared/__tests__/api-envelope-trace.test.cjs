const assert = require("node:assert/strict");
const test = require("node:test");

const { createHttpApp } = require("../http-app.cjs");
const { sendJSON } = require("../api-envelope.cjs");

// PR-085 第 1 步：trace 贯通经真实传输层——onRequest 钩子 enterWith 入上下文，sendJSON 取同一 trace_id 写封套与 X-Trace-Id 响应头
test("API envelope and response header reuse the active request trace id", async () => {
  const http = createHttpApp({ cors: false });
  http.registerRoute("GET", "/conflict", (_req, res) => sendJSON(res, 409, { error_code: "CONFLICT", message: "conflict" }));
  const res = await http.app.inject({ method: "GET", url: "/conflict", headers: { "x-trace-id": "tr_envelope-12345678" } });

  assert.equal(res.statusCode, 409);
  assert.equal(res.headers["x-trace-id"], "tr_envelope-12345678");
  assert.equal(res.json().trace_id, "tr_envelope-12345678");
  assert.equal(res.json().error_code, "CONFLICT");
  await http.close();
});
