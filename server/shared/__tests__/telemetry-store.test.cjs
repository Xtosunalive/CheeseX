// @tests: server/shared/persistence/telemetry-store.cjs + telemetry-import.cjs
// SPEC-012 WP-B——④类痕迹迁出：store 尽力而为语义、心跳可查、boot 导入后目录退场。
// 层级：纯单元（内存库）＋迁移契约（boot 导入＝真实 fs 操作）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { createTelemetryStore, TRACE_KINDS } = require("../persistence/telemetry-store.cjs");
const { importLegacyTelemetry } = require("../persistence/telemetry-import.cjs");

function makeStore() {
  return createTelemetryStore(openPersistenceDb());
}

test("① recordTrace/latestTrace/listTraces 往返", () => {
  const store = makeStore();
  assert.equal(store.recordTrace(TRACE_KINDS.VAULT_DRIFT, { driftFiles: ["a"] }), true);
  store.recordTrace(TRACE_KINDS.VAULT_DRIFT, { driftFiles: ["b"] });
  const latest = store.latestTrace(TRACE_KINDS.VAULT_DRIFT);
  assert.deepEqual(latest.payload.driftFiles, ["b"], "latest 取最新一笔");
  const list = store.listTraces(TRACE_KINDS.VAULT_DRIFT, 10);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0].payload.driftFiles, ["b"], "list 新→旧");
  assert.equal(store.latestTrace(TRACE_KINDS.FRONTMATTER_CHECK), null, "无记录类别返回 null");
});

test("② 尽力而为：库关闭后 recordTrace 返回 false 不抛（遥测不阻断主链路）", () => {
  const db = openPersistenceDb();
  const store = createTelemetryStore(db);
  db.close();
  assert.equal(store.recordTrace(TRACE_KINDS.RECONCILE_RUN, {}), false, "写失败降级为 false");
});

test("③ boot 导入：旧 health 三件痕迹入库且目录退场（④类迁出收尾）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-import-"));
  try {
    const healthDir = path.join(dir, ".ledger", "health");
    fs.mkdirSync(healthDir, { recursive: true });
    fs.writeFileSync(path.join(healthDir, "vault-drift.json"), JSON.stringify({ checkedAt: "t1", driftFiles: ["x"], dirtyFiles: [] }));
    fs.writeFileSync(path.join(healthDir, "frontmatter-check.json"), JSON.stringify({ checkedAt: "t2", file: "a.md", violations: [] }));
    const ledgerCalls = [];
    const result = importLegacyTelemetry({
      vaultPath: dir,
      gitLedger: {
        markSystemFile: (paths) => ledgerCalls.push({ type: "mark", paths }),
        scheduleLedger: (domain, summary, paths) => ledgerCalls.push({ type: "schedule", domain, summary, paths }),
      },
    });
    assert.equal(result.imported, 2);
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(healthDir), false, "观测目录应整体退场");
    assert.ok(ledgerCalls.some((c) => c.type === "schedule" && c.domain === "health"), "目录移除应落 health: 账");
    const store = require("../persistence/telemetry-store.cjs").getTelemetryStore(dir);
    assert.deepEqual(store.latestTrace(TRACE_KINDS.VAULT_DRIFT).payload.driftFiles, ["x"], "导入痕迹可查");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("④ boot 导入幂等：目录不存在 no-op", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-import-empty-"));
  try {
    const result = importLegacyTelemetry({ vaultPath: dir });
    assert.equal(result.imported, 0);
    assert.equal(result.removed, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
