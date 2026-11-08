const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const staleLock = require("../stale-lock.cjs");
const { openPersistenceDb } = require("../../../shared/persistence/sqlite-adapter.cjs");
const { createRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");

// SPEC-012 WP-A：锁迁 runtime-state.db locks 表——锁名（如 "publish"）代替锁文件路径。
// 每用例独立内存库注入（options.runtimeState 是测试缝；生产走全局装配实例）。
function withStore(callback) {
  const db = openPersistenceDb();
  const store = createRuntimeStateStore(db);
  try { return callback(db, store); }
  finally { db.close(); }
}

function seedLockRow(db, name, ownerPid) {
  db.prepare("INSERT INTO locks (name, owner_pid, started_at, host) VALUES (?, ?, ?, ?)")
    .run(name, ownerPid, new Date().toISOString(), os.hostname());
}

describe("T1 stale lock recovery（命名锁：runtime-state locks 表）", () => {
  it("acquires lock normally and releases it", () => withStore((_db, store) => {
    const opts = { runtimeState: store };
    assert.equal(staleLock.acquireWithStaleRecovery("publish", opts), true);
    const owner = staleLock.readOwner("publish", opts);
    assert.equal(owner.pid, process.pid);
    assert.ok(owner.startedAt);
    staleLock.release("publish", opts);
    assert.equal(staleLock.readOwner("publish", opts), null);
  }));

  it("takes over a stale lock whose owner pid is dead", () => withStore((db, store) => {
    const opts = { runtimeState: store };
    // 种一行 owner pid 已死的锁（直写 locks 表，模拟前持有者进程崩溃遗留）
    seedLockRow(db, "publish", 999999);
    assert.equal(staleLock.tryAcquire("publish", opts), true, "stale lock should be taken over");
    const owner = staleLock.readOwner("publish", opts);
    assert.equal(owner.pid, process.pid, "new owner pid should replace stale one");
    staleLock.release("publish", opts);
  }));

  it("treats a live lock as BUSY (no takeover)", () => withStore((db, store) => {
    const opts = { runtimeState: store };
    // 种一行 owner pid = 当前进程（活锁，不得接管）
    seedLockRow(db, "publish", process.pid);
    assert.equal(staleLock.tryAcquire("publish", opts), false);
    // 释放后同锁名可再拿
    staleLock.release("publish", opts);
    assert.equal(staleLock.tryAcquire("publish", opts), true);
    staleLock.release("publish", opts);
  }));

  it("isPidAlive returns true for current process and false for dead pid", () => {
    assert.equal(staleLock.isPidAlive(process.pid), true);
    assert.equal(staleLock.isPidAlive(999999), false);
    assert.equal(staleLock.isPidAlive(0), false);
    assert.equal(staleLock.isPidAlive(-1), false);
  });
});
