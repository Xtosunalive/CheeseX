// Component: Sync-Routes Tests
// @responsible: 验证 sync route 的完整契约：内容阻断不拒绝诊断、活动任务复用、vaultId 匹配。
//   Final-state tests register the real route module with injected dependencies.
// @inputs: 临时 Vault fixture、mock readiness、mock PipelineRunService
// @outputs: 测试断言
// @context: Sync

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-C：push 已动作化
const { sendJSON } = require("../../shared/api-envelope.cjs");

// ═══════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════

function createTestVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-test-vault-"));
  fs.mkdirSync(path.join(dir, "知识库", "wiki", "entities"), { recursive: true });
  return dir;
}

function computeVaultId(vaultPath) {
  const crypto = require("crypto");
  const realPath = fs.realpathSync(vaultPath);
  return crypto.createHash("sha256").update(realPath, "utf8").digest("hex").slice(0, 16);
}

function mockReady() {
  return { ready: true, totalArchComponents: 1, blockerEntities: 0, blockerCount: 0, warningCount: 0, warningDetails: [], blockingSourceKeys: [] };
}

function mockBlocked() {
  return { ready: false, totalArchComponents: 1, blockerEntities: 1, blockerCount: 2, warningCount: 0, warningDetails: [], blockingSourceKeys: ["wiki/entities/test.md"] };
}

function createMockPipeline() {
  const FIXED_JOB_ID = "mock-job-0000-0000";
  return {
    start: function (mode) {
      return { state: "running", jobId: FIXED_JOB_ID, mode: mode, stage: "starting", message: "Pipeline 正在启动", startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, logs: [] };
    },
    getStatus: () => ({}),
    cancel: () => ({}),
  };
}

function createMockPipelineRunning() {
  const job = { state: "running", jobId: "existing-job", mode: "full", purpose: "global_diagnostic" };
  return {
    startDiagnostic: function () { return job; },
    getStatus: () => job,
    cancel: () => ({}),
  };
}

// ═══════════════════════════════════════════════════════════════
// Route dispatch：PR-085 第 1 步起经 route-harness（Fastify inject）走生产同一传输层——
// 契约推导校验／bodyless／错误处理器／404 均为真实行为，不再镜像旧 main.cjs 线性匹配
// ═══════════════════════════════════════════════════════════════

function createDispatch(h) {
  return async function dispatchToRoute(method, pathname, bodyPayload) {
    const call = {};
    if (bodyPayload !== undefined && bodyPayload !== null) call.body = bodyPayload;
    const res = await h.request({ method, url: pathname }, call);
    return { status: res.statusCode, body: res.body };
  };
}

// ═══════════════════════════════════════════════════════════════
// Route-dispatch baseline: unregistered routes return 404
// ═══════════════════════════════════════════════════════════════
// This isolated table intentionally omits sync routes and verifies dispatch fallback behavior.

describe("route dispatch rejects unregistered sync routes", () => {
  let vaultPath, vaultId, dispatch;

  before(() => {
    vaultPath = createTestVault();
    setupActionRuntime({ vaultPath }); // WP-048 W1-C：sync.push 已动作化
    vaultId = computeVaultId(vaultPath);
    const routes = createRouteHarness();
    routes.registerRoute("GET", "/api/health", (_req, res) => sendJSON(res, 200, { status: "ok" }));
    dispatch = createDispatch(routes);
  });

  after(() => { fs.rmSync(vaultPath, { recursive: true, force: true }); });

  it("H0-smoke: GET /api/health returns 200", async () => {
    const res = await dispatch("GET", "/api/health");
    assert.strictEqual(res.status, 200);
  });

  it("returns 404 when POST /api/sync/push is not registered", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-h0-test", mode: "full" });
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for legacy push when sync routes are not registered", async () => {
    const res = await dispatch("POST", "/api/sync/push", { entities: [{ id: "test" }] });
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for legacy connections when sync routes are not registered", async () => {
    const res = await dispatch("POST", "/api/sync/push", { connections: [{ from: "a", to: "b" }] });
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for combined legacy payload when sync routes are not registered", async () => {
    const res = await dispatch("POST", "/api/sync/push", { entities: [{ id: "test" }], connections: [{ from: "a", to: "b" }], source: "obsidian" });
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for GET pull when sync routes are not registered", async () => {
    const res = await dispatch("GET", "/api/sync/pull", null);
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for POST pull when sync routes are not registered", async () => {
    const res = await dispatch("POST", "/api/sync/pull", {});
    assert.strictEqual(res.status, 404);
  });

  it("returns 404 for blocked push when sync routes are not registered", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-blocked", mode: "full" });
    assert.strictEqual(res.status, 404);
  });
});

// ═══════════════════════════════════════════════════════════════
// Final sync contract with the real route module and injected dependencies
// ═══════════════════════════════════════════════════════════════

describe("sync routes registered with mock dependencies", () => {
  let vaultPath, vaultId, routes, dispatch, mockPipeline;

  before(() => {
    vaultPath = createTestVault();
    vaultId = computeVaultId(vaultPath);
    mockPipeline = createMockPipeline();
    routes = createRouteHarness();
    const syncRoutes = require("../sync-routes.cjs");
    syncRoutes.register(routes.registerRoute, { pipelineRunService: mockPipeline, getReadiness: mockReady, vaultPath: vaultPath });
    dispatch = createDispatch(routes);
  });

  after(() => { fs.rmSync(vaultPath, { recursive: true, force: true }); });

  it("B1: V2 Push 成功 → 202 + SyncPushData", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-h1-test", mode: "full" });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.syncId, "sync-h1-test");
    assert.strictEqual(res.body.data.job.jobId, "mock-job-0000-0000");
    assert.strictEqual(res.body.data.job.state, "running");
  });

  it("B2: V2 Push quick mode → 202", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-quick", mode: "quick" });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(res.body.data.job.mode, "quick");
  });

  it("B3: content blockers still start global diagnosis", async () => {
    routes = createRouteHarness();
    const syncRoutes = require("../sync-routes.cjs");
    syncRoutes.register(routes.registerRoute, { pipelineRunService: mockPipeline, getReadiness: mockBlocked, vaultPath: vaultPath });
    dispatch = createDispatch(routes);

    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-blocked", mode: "full" });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.job.state, "running");
  });

  it("B4: vaultId mismatch → 422 VAULT_ID_MISMATCH", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: "deadbeefdeadbeef", syncId: "sync-mismatch", mode: "full" });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error_code, "VAULT_ID_MISMATCH");
  });

  it("B5: protocolVersion ≠ '2' → 400 VALIDATION_ERROR", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "1", vaultId: vaultId, syncId: "sync-v1", mode: "full" });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error_code, "VALIDATION_ERROR");
  });

  it("B6: empty syncId → 400 VALIDATION_ERROR", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "", mode: "full" });
    assert.strictEqual(res.status, 400);
  });

  it("B7: syncId > 128 chars → 400 VALIDATION_ERROR", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "x".repeat(129), mode: "full" });
    assert.strictEqual(res.status, 400);
  });

  it("B8: illegal mode → 400 VALIDATION_ERROR", async () => {
    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-bad-mode", mode: "incremental" });
    assert.strictEqual(res.status, 400);
  });

  it("B9: legacy payload → 拒绝（PR-085：契约 V2 必填字段先行 → 400 VALIDATION_ERROR；混合形态仍触达 410 LEGACY_DERIVED_PUSH_RETIRED）", async () => {
    // 纯 legacy 载荷缺 protocolVersion/vaultId/syncId/mode——契约 required 校验在 handler 之前拒绝，details 指明缺哪些 V2 字段
    const legacyOnly = [
      { entities: [{ id: "test" }] },
      { connections: [{ from: "a", to: "b" }] },
      { entities: [{ id: "test" }], connections: [{ from: "a", to: "b" }], source: "obsidian" },
    ];
    for (const payload of legacyOnly) {
      const res = await dispatch("POST", "/api/sync/push", payload);
      assert.strictEqual(res.status, 400, `expected 400 for: ${JSON.stringify(payload)} → ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.error_code, "VALIDATION_ERROR");
      assert.ok(res.body.details.errors.some((e) => /protocolVersion/.test(e)), "须指明缺 V2 字段");
    }
    // 带齐 V2 字段但夹带 legacy 键——通过契约校验后由 handler Gate 1 判 410（该门禁仍活）
    const mixed = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-legacy-mixed", mode: "full", entities: [{ id: "test" }] });
    assert.strictEqual(mixed.status, 410, JSON.stringify(mixed.body));
    assert.strictEqual(mixed.body.error_code, "LEGACY_DERIVED_PUSH_RETIRED");
  });

  it("B10: repeated diagnosis trigger returns the active task", async () => {
    routes = createRouteHarness();
    const syncRoutes = require("../sync-routes.cjs");
    syncRoutes.register(routes.registerRoute, { pipelineRunService: createMockPipelineRunning(), getReadiness: mockReady, vaultPath: vaultPath });
    dispatch = createDispatch(routes);

    const res = await dispatch("POST", "/api/sync/push", { protocolVersion: "2", vaultId: vaultId, syncId: "sync-busy", mode: "full" });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(res.body.data.job.jobId, "existing-job");
  });

  it("B11: sync-routes 单独注册时不认领 /api/sync/pull（D9-3：墓碑唯一通道=registrar）", () => {
    const pullRoutes = [...routes.routes.keys()].filter((key) => key.endsWith(" /api/sync/pull"));
    assert.strictEqual(pullRoutes.length, 0, "内联墓碑已退役删除，重引入即红灯");
  });

  it("B12: sync-routes-only dispatch GET /api/sync/pull → 404（回归守卫）", async () => {
    const res = await dispatch("GET", "/api/sync/pull", null);
    assert.strictEqual(res.status, 404);
  });

  it("B13: health includes vaultId + sync-push-v2", async () => {
    const { computeVaultId } = require("../../shared/vault-id.cjs");
    // 独立 harness（已 inject 过的实例不可再加路由——框架 fail-closed）
    const healthHarness = createRouteHarness();
    healthHarness.registerRoute("GET", "/api/health", (_req, res) => sendJSON(res, 200, { status: "ok", service: "cheese", apiVersion: "1", vaultId: computeVaultId(vaultPath), capabilities: ["pipeline", "entity-readiness", "entity-repair", "sync-push-v2"], uptime: process.uptime() }));

    const res = await createDispatch(healthHarness)("GET", "/api/health");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.vaultId, vaultId);
    assert.ok(res.body.data.capabilities.includes("sync-push-v2"));
  });

  it("B14: malformed JSON stream → 400 VALIDATION_ERROR", async () => {
    // PR-085：非法 JSON 由传输层拒绝（FST_ERR_CTP_INVALID_JSON_BODY → 400 VALIDATION_ERROR），封套形状不变
    const res = await routes.request({ method: "POST", url: "/api/sync/push" }, { rawBody: '{"protocolVersion":' });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error_code, "VALIDATION_ERROR");
  });

  it("B15: missing protocolVersion → 400", async () => {
    const res = await dispatch("POST", "/api/sync/push", { vaultId: vaultId, syncId: "sync-no-proto", mode: "full" });
    assert.strictEqual(res.status, 400);
  });

  it("B16: sync-routes.cjs does NOT import fs/SQLite/graph-writer/child_process", () => {
    const src = fs.readFileSync(require.resolve("../sync-routes.cjs"), "utf8");
    assert.ok(!src.includes("require('fs')"), "should not import fs");
    assert.ok(!src.includes('require("fs")'), "should not import fs");
    assert.ok(!src.includes("require('better-sqlite3')"), "should not import better-sqlite3");
    assert.ok(!src.includes("master-graph-service"), "should not import master-graph-service");
    assert.ok(!src.includes("require('child_process')"), "should not import child_process");
    assert.ok(!src.includes('require("child_process")'), "should not import child_process");
  });
});

// ═══════════════════════════════════════════════════════════════
// Live tombstone wiring (D9-3): registrar (contract-owned) mounted FIRST,
// mirroring main.cjs:70 — registrar must be the ONLY /api/sync/pull channel.
// B11/B12 原断言的是 sync-routes 内联死代码路径（隔离 harness 未挂 registrar，
// 与线上行为 ROUTE_RETIRED 背离）；本节钉住线上真实路径与单一墓碑通道。
// ═══════════════════════════════════════════════════════════════

describe("live tombstone wiring: registrar owns /api/sync/pull", () => {
  let vaultPath, dispatch;

  before(() => {
    vaultPath = createTestVault();
    const routes = createRouteHarness();
    // main.cjs — contract-owned tombstones（PR-085：唯一通道；框架下重复注册即抛，不再依赖注册顺序）
    require("../../shared/retired-route-registrar.cjs").registerRetiredRoutes(routes.registerRoute);
    // then domain routes
    require("../sync-routes.cjs").register(routes.registerRoute, {
      pipelineRunService: createMockPipeline(),
      getReadiness: mockReady,
      vaultPath: vaultPath,
    });
    dispatch = createDispatch(routes);
  });

  after(() => { fs.rmSync(vaultPath, { recursive: true, force: true }); });

  it("T1: GET /api/sync/pull → 410 SYNC_PULL_RETIRED via contract registrar", async () => {
    const res = await dispatch("GET", "/api/sync/pull", null);
    assert.strictEqual(res.status, 410);
    assert.strictEqual(res.body.error_code, "SYNC_PULL_RETIRED");
    assert.ok(res.body.details && res.body.details.retiredAt, "registrar envelope must carry retiredAt details");
  });

  it("T2: POST /api/sync/pull → 410 SYNC_PULL_RETIRED via contract registrar", async () => {
    const res = await dispatch("POST", "/api/sync/pull", {});
    assert.strictEqual(res.status, 410);
    assert.strictEqual(res.body.error_code, "SYNC_PULL_RETIRED");
    assert.ok(res.body.details && res.body.details.retiredAt, "registrar envelope must carry retiredAt details");
  });

  it("T3: sync-routes does not claim /api/sync/pull (tombstone SSOT = registrar)", () => {
    const claimed = [];
    require("../sync-routes.cjs").register((method, pathname) => claimed.push(`${method} ${pathname}`), {
      pipelineRunService: createMockPipeline(),
      getReadiness: mockReady,
      vaultPath: vaultPath,
    });
    const pullClaims = claimed.filter((r) => r.includes("/api/sync/pull"));
    assert.strictEqual(pullClaims.length, 0, `sync-routes.cjs must not register /api/sync/pull, got: ${pullClaims.join(", ")}`);
  });
});
