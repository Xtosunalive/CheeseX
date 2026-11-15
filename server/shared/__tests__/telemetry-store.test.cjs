// @tests: server/shared/persistence/telemetry-store.cjs
// SPEC-012 WP-B：观测事件往返与写失败降级。层级：纯单元（内存库）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { createTelemetryStore, TRACE_KINDS } = require("../persistence/telemetry-store.cjs");

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
