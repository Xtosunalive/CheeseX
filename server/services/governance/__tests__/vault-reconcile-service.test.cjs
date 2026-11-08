// @tests: server/services/governance/vault-reconcile-service.cjs
// WP4 验收：周期对账双层判定 + health 自证
// PR-056：git 调用异步化——慢 git 期间事件循环可运转（非阻塞断言）
// SPEC-012 WP-J：观测域过渡排除摘除——脏项全量计为漂移证据（health 目录构造性不存在）
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const { createVaultReconcileService } = require(
  path.join(ROOT, "server", "services", "governance", "vault-reconcile-service.cjs"),
);

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vault-reconcile-test-"));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
const NULL_LOGGER = { info() {}, warn() {}, error() {} };

// ── 1. 创建服务，getLastReconcileAt 初始为 null ──
test("createVaultReconcileService 初始 lastReconcileAt 为 null", () => {
  const dir = makeTmpDir();
  try {
    const svc = createVaultReconcileService({ vaultPath: dir });
    assert.strictEqual(svc.getLastReconcileAt(), null);
  } finally {
    cleanup(dir);
  }
});

// ── 2. 非 git 目录时 start + stop 不崩溃 ──
test("start/stop 非 git 目录时不抛错", (t, done) => {
  const dir = makeTmpDir();
  const svc = createVaultReconcileService({
    vaultPath: dir,
    intervalMs: 100, // 100ms 快速触发
    logger: NULL_LOGGER,
  });
  svc.start();
  // 等待至少一次 reconcile
  setTimeout(() => {
    svc.stop();
    // 非 git 目录但 start/stop 不应抛
    cleanup(dir);
    done();
  }, 200);
});

// ── 3. start 后 getLastReconcileAt 被更新 ──
test("start 后 getLastReconcileAt 不为 null", (t, done) => {
  const dir = makeTmpDir();
  const svc = createVaultReconcileService({
    vaultPath: dir,
    intervalMs: 100,
    logger: NULL_LOGGER,
  });
  svc.start();
  setTimeout(() => {
    const ts = svc.getLastReconcileAt();
    svc.stop();
    cleanup(dir);
    assert.ok(ts !== null, "lastReconcileAt 应在 start 后被设置");
    assert.ok(typeof ts === "string", "lastReconcileAt 应为 ISO 字符串");
    done();
  }, 300);
});

// ── 4. stop 幂等性 ──
test("stop 多次调用不崩溃", () => {
  const dir = makeTmpDir();
  const svc = createVaultReconcileService({ vaultPath: dir });
  assert.doesNotThrow(() => {
    svc.stop();
    svc.stop();
  });
  cleanup(dir);
});

// ── 5. 非 git 目录 → health 文件不产生（无漂移文件创建）──
test("非 git 目录时不产生 vault-drift.json（无法检测，不误报）", (t, done) => {
  const dir = makeTmpDir();
  const svc = createVaultReconcileService({
    vaultPath: dir,
    intervalMs: 50,
    logger: NULL_LOGGER,
  });
  svc.start();
  setTimeout(() => {
    svc.stop();
    const driftFile = path.join(dir, ".ledger", "health", "vault-drift.json");
    // 非 git 目录——git 命令失败，不应产生漂移文件（没有漂移信号）
    const exists = fs.existsSync(driftFile);
    cleanup(dir);
    assert.strictEqual(exists, false, "非 git 目录不应产生 vault-drift.json");
    done();
  }, 200);
});

// ── 6. PR-056 先红后绿：慢 git 期间事件循环可运转（同步子进程会冻结）──
test("PR-056 慢 git 期间事件循环不被阻塞", async () => {
  const dir = makeTmpDir();
  try {
    // 造 4 份 schema 文件存在 → 4 次 diff + 1 次 status 全走注入 runner
    for (const rel of ["enums", "ontology", "dependencies", "versions"]) {
      const p = path.join(dir, "知识库", "TheSchema", rel + ".yaml");
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "x: 1\n", "utf8");
    }
    const slowGit = (args) => new Promise((resolve) => setTimeout(() => resolve(""), 120));
    const svc = createVaultReconcileService({ vaultPath: dir, gitRunner: slowGit, logger: NULL_LOGGER });

    const pending = svc.runReconcile();
    let loopTicked = false;
    setImmediate(() => { loopTicked = true; });
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(loopTicked, "对账进行中（await 慢 git 120ms）事件循环必须可运转——同步 execFileSync 实现下此断言红");
    await pending;
    assert.ok(svc.getLastReconcileAt() !== null, "对账完成后 lastReconcileAt 应更新");
  } finally {
    cleanup(dir);
  }
});

// ── 7. WP-J：观测域过渡排除摘除——脏项全量计为漂移证据；痕迹落 telemetry 库 ──
test("SPEC-012 WP-J 脏项全量计入漂移证据（观测域排除已随构造性不存在摘除）；漂移与心跳落 telemetry 库", async () => {
  const dir = makeTmpDir();
  try {
    const schemaPath = path.join(dir, "知识库", "TheSchema", "enums.yaml");
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
    fs.writeFileSync(schemaPath, "x: 1\n", "utf8");
    const fakeGit = (args) => {
      const sub = args.includes("diff") ? "" : "?? .ledger/health/vault-drift.json\n M 知识库/wiki/被改文章.md\n";
      return Promise.resolve(sub);
    };
    const svc = createVaultReconcileService({ vaultPath: dir, gitRunner: fakeGit, logger: NULL_LOGGER });
    await svc.runReconcile();

    const { getTelemetryStore, TRACE_KINDS } = require("../../../shared/persistence/telemetry-store.cjs");
    const drift = getTelemetryStore(dir).latestTrace(TRACE_KINDS.VAULT_DRIFT);
    assert.ok(drift, "有真实脏项 → telemetry 库应有一笔 vault-drift 痕迹");
    const dirtyJoined = drift.payload.dirtyFiles.join("\n");
    assert.ok(dirtyJoined.includes(".ledger/health/"), "WP-J 摘除观测域排除——health 路径若真出现照计脏项（异常回归信号，不再静默排除；目录退场由第 23 号门禁反向断言兜底）");
    assert.ok(dirtyJoined.includes("知识库/wiki/被改文章.md"), "真实脏项应保留");
    const heartbeat = getTelemetryStore(dir).latestTrace(TRACE_KINDS.RECONCILE_RUN);
    assert.ok(heartbeat && heartbeat.payload.dirty === true, "每轮应记 reconcile-run 心跳（/api/health 据此算 stale）");
    assert.strictEqual(fs.existsSync(path.join(dir, ".ledger", "health")), false, "vault 内不得出现 health 目录");
  } finally {
    cleanup(dir);
  }
});
