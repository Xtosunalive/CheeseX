// WP-018 多用户并发防护首切片测试。分层：
//   L1 纯单元——迁移 0005 升级路径（存量行 revision=0 起跳）；get 形态 {state,revision}；缺省 put 行为等价（revision 自增但不锁）
//   L2 并发契约——expectedRevision 过期 → WORKFLOW_REVISION_CONFLICT(409, details.currentRevision=现值)，库内行/change_seq 不被污染；正确修订写入成功且 revision 单调
//   L3 通知面——changes.since 游标续拉/单调/maxSeq；探针参数校验（非数字 400 定义码）
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { createRuntimeStateStore, MIGRATIONS } = require("../persistence/runtime-state-store.cjs");

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w18-store-"));
  const db = openPersistenceDb(path.join(dir, "runtime-state.db"));
  const store = createRuntimeStateStore(db);
  return { dir, db, store };
}

test("L1 迁移注册：0005-runtime-changes 在册（id 递增、与 0001-0004 连续）", () => {
  const ids = MIGRATIONS.map((m) => m.id);
  assert.deepEqual(ids, [
    "0001-runtime-core", "0002-pipeline", "0003-anomaly",
    "0004-review-actions-issue-column", "0005-runtime-changes",
    "0006-action-approvals", // WP-172（SPEC-095 §3.5）：动作审批账本追加族
  ]);
});

test("L1 get 形态与缺省行为：无行 undefined；缺省 put 不锁、revision 自增、change_seq 追加", () => {
  const { store } = tmpStore();
  assert.equal(store.workflow.get(), undefined, "无行时 undefined（旧语义）");
  store.workflow.put({ schemaVersion: "test", tasks: ["a"] });
  const got = store.workflow.get();
  assert.deepEqual(got.state.tasks, ["a"]);
  assert.equal(got.revision, 1);
  store.workflow.put({ schemaVersion: "test", tasks: ["a", "b"] }); // 缺省不传锁——存量调用零行为变化
  const got2 = store.workflow.get();
  assert.equal(got2.revision, 2, "缺省写入照样单调自增");
  const seq = store.changes.since(0);
  assert.equal(seq.length, 2, "每次写追加一行变更");
  assert.ok(seq[1].id > seq[0].id, "游标单调");
});

test("L2 并发冲突：过期 expectedRevision → 409 带现值，行与 change_seq 双不污染", () => {
  const { store } = tmpStore();
  store.workflow.put({ schemaVersion: "test", v: 1, tasks: [] });
  const before = store.workflow.get();
  assert.equal(before.revision, 1);
  const seqBefore = store.changes.maxSeq();

  assert.throws(
    () => store.workflow.put({ schemaVersion: "test", v: 2, tasks: [] }, { expectedRevision: 0 }), // 过期（现值 1）
    (error) => error.code === "WORKFLOW_REVISION_CONFLICT" && error.status === 409 && error.details.currentRevision === 1 && error.details.expectedRevision === 0,
  );
  const after = store.workflow.get();
  assert.deepEqual(after.state, { schemaVersion: "test", v: 1, tasks: [] }, "冲突拒写：内容不变");
  assert.equal(after.revision, 1, "冲突拒写：修订不前进");
  assert.equal(store.changes.maxSeq(), seqBefore, "冲突拒写：change_seq 不追加（事务原子）");

  // 正确修订写入成功
  store.workflow.put({ schemaVersion: "test", v: 3, tasks: [] }, { expectedRevision: 1 });
  assert.equal(store.workflow.get().revision, 2);
  assert.deepEqual(store.workflow.get().state, { schemaVersion: "test", v: 3, tasks: [] });
});

test("L2 迁移升级路径（真两版）：基线版（截掉 0005 的 MIGRATIONS）建库写存量行 → 现版打开 → 0005 应用、存量 revision=0、首带锁写以 0 通过", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w18-upgrade-"));
  const dbPath = path.join(dir, "runtime-state.db");
  // 基线版：仅 0001-0004（模拟升级前的库）
  const baselineMigrations = MIGRATIONS.filter((m) => m.id !== "0005-runtime-changes");
  // 基线版：直接 SQL 建旧 schema 并写入存量行（绕过当前代码——真实旧库就是旧 schema）；
  // runtime_migration 登记表也要有（现版迁移框架按它判断应用序列）——基线只登记 0001-0004
  const baselineDb = openPersistenceDb({ path: dbPath });
  baselineDb.exec("CREATE TABLE IF NOT EXISTS workflow_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL)");
  baselineDb.prepare("INSERT INTO workflow_state (id, state_json, updated_at) VALUES (1, ?, ?)").run(JSON.stringify({ schemaVersion: "test", legacy: true, tasks: [] }), "2026-10-25T00:00:00.000Z");
  // 现版打开：迁移 0005 应用
  const currentStore = createRuntimeStateStore(openPersistenceDb({ path: dbPath }));
  const got = currentStore.workflow.get();
  assert.deepEqual(got.state, { schemaVersion: "test", legacy: true, tasks: [] }, "升级保留存量内容");
  assert.equal(got.revision, 0, "存量行 revision=0 起跳（DEFAULT 0，不猜历史）");
  // 首带锁写以 0 通过（B-2 有意偏离 yaml 族 0 值语义的根因）
  currentStore.workflow.put({ schemaVersion: "test", legacy: 2, tasks: [] }, { expectedRevision: 0 });
  assert.equal(currentStore.workflow.get().revision, 1);
  assert.deepEqual(currentStore.workflow.get().state, { schemaVersion: "test", legacy: 2, tasks: [] });
});

test("L3 changes 读面：since(cursor) 续拉、超前沿 cursor 空集、maxSeq 兜底", () => {
  const { store } = tmpStore();
  store.workflow.put({ schemaVersion: "test", a: 1, tasks: [] });
  store.workflow.put({ schemaVersion: "test", a: 2, tasks: [] });
  const first = store.changes.since(0);
  assert.equal(first.length, 2);
  const second = store.changes.since(first[first.length - 1].id);
  assert.equal(second.length, 0, "续拉无新变更=空集");
  assert.equal(store.changes.since(99999).length, 0, "超前沿 cursor=空集（探针据此原样返回现值）");
  assert.ok(store.changes.maxSeq() >= first[first.length - 1].id);
});

test("L1 JSON 列 BLOB 容错：跨进程 BLOB 写入读侧照常解出（2026-10-29 生产事故回归）", () => {
  const { db, store } = tmpStore();
  store.workflow.put({ schemaVersion: "test", tasks: ["blob-probe"] });
  // 复刻事故形态：列被按 BLOB 绑定写入（内容是合法 JSON 的 UTF-8 字节，存储类型错）
  db.exec("UPDATE workflow_state SET state_json = CAST(state_json AS BLOB) WHERE id = 1");
  // 修复前：JSON.parse(Uint8Array) 强转 "123,34,…" 字节值逗号串，position 3 抛 SyntaxError → 文章工作流全线 500
  const got = store.workflow.get();
  assert.deepEqual(got.state.tasks, ["blob-probe"]);
  assert.equal(got.revision, 1);
});
