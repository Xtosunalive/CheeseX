// Test: writer-gate
const { describe, it, mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { createWriterGate, loadRegisteredWriters } = require("../writer-gate.cjs");

const ARCH_REPO_PATH = path.resolve(__dirname, "../../..");

describe("writer-gate", () => {
  it("loads registered writers from domain-registry.json", () => {
    const writers = loadRegisteredWriters(ARCH_REPO_PATH);
    assert.ok(writers instanceof Set);
    assert.ok(writers.size > 0);
    assert.ok(writers.has("local-architect"));
    assert.ok(writers.has("schema-page"));
    assert.ok(writers.has("pipeline"));
    assert.ok(writers.has("cli"));
  });

  it("allows registered writer (local-architect)", () => {
    const operatorContext = { getOperatorId: () => "local-architect" };
    const logger = { info: mock.fn(), warn: mock.fn() };
    const gate = createWriterGate({ operatorContext, archRepoPath: ARCH_REPO_PATH, logger });

    let nextCalled = false;
    const req = { method: "PUT", url: "/api/schema/enums" };
    const res = { writeHead: mock.fn(), end: mock.fn() };
    const next = () => { nextCalled = true; };

    gate(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.writeHead.mock.calls.length, 0);
  });

  it("PR-085 裁项 5 通道轴：裁决对象是通道而非人——未登记操作者经已登记通道（api-page）仍通过，取证记录其 id", () => {
    const operatorContext = { getOperatorId: () => "ai-session-f11fb867" };
    const logger = { info: mock.fn(), warn: mock.fn() };
    const gate = createWriterGate({ operatorContext, archRepoPath: ARCH_REPO_PATH, logger });

    let nextCalled = false;
    const req = { method: "PUT", url: "/api/schema/enums" };
    const res = { writeHead: mock.fn(), end: mock.fn() };
    const next = () => { nextCalled = true; };

    gate(req, res, next);

    assert.strictEqual(nextCalled, true, "通道已登记即放行——人是谁由身份层 Principal/roles 裁（第 3 步登记表）");
    assert.strictEqual(res.writeHead.mock.calls.length, 0);
    const verdict = gate.evaluate(req);
    assert.strictEqual(verdict.operatorId, "ai-session-f11fb867", "取证仍记录操作者");
  });

  it("PR-085 裁项 5：通道未登记 → 403（fail-closed 装配错误面），封套归一", async () => {
    const operatorContext = { getOperatorId: () => "local-architect" };
    const logger = { info: mock.fn(), warn: mock.fn() };
    const gate = createWriterGate({ operatorContext, archRepoPath: ARCH_REPO_PATH, logger, channel: "rogue-channel" });

    let nextCalled = false;
    const req = { method: "PUT", url: "/api/schema/enums" };
    const res = { writeHead: mock.fn(), end: mock.fn() };
    const next = () => { nextCalled = true; };

    gate(req, res, next);

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.writeHead.mock.calls.length, 1);
    assert.deepStrictEqual(res.writeHead.mock.calls[0].arguments, [403, { "Content-Type": "application/json" }]);
    const response = JSON.parse(res.end.mock.calls[0].arguments[0]);
    assert.strictEqual(response.error_code, "WRITER_NOT_REGISTERED");
    assert.ok(response.message.includes("rogue-channel"));
    assert.ok(response.hint.includes("AI 会话改 vault 数据必须走 API"));
    assert.ok(Array.isArray(response.registered_writers));
    // fastifyHook 封套形态（裁项 4a 第 2 步）在 http-app-auth.test.cjs 经真实传输层断言
  });

  it("allows pipeline writer", () => {
    const operatorContext = { getOperatorId: () => "pipeline" };
    const logger = { info: mock.fn(), warn: mock.fn() };
    const gate = createWriterGate({ operatorContext, archRepoPath: ARCH_REPO_PATH, logger });

    let nextCalled = false;
    const req = { method: "POST", url: "/api/schema/enums" };
    const res = { writeHead: mock.fn(), end: mock.fn() };
    const next = () => { nextCalled = true; };

    gate(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.writeHead.mock.calls.length, 0);
  });

  it("allows cli writer", () => {
    const operatorContext = { getOperatorId: () => "cli" };
    const logger = { info: mock.fn(), warn: mock.fn() };
    const gate = createWriterGate({ operatorContext, archRepoPath: ARCH_REPO_PATH, logger });

    let nextCalled = false;
    const req = { method: "PUT", url: "/api/entities/123" };
    const res = { writeHead: mock.fn(), end: mock.fn() };
    const next = () => { nextCalled = true; };

    gate(req, res, next);

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.writeHead.mock.calls.length, 0);
  });
});
