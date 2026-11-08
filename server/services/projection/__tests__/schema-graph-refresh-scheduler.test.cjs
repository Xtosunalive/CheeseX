// WP-027（PR-142）：schema-graph-refresh-scheduler 去抖调度单元——
// 静默窗内多通知单次执行／freshness 已最新跳过／未最新执行真实增量（runRefresh=due 同款配对）／
// due 计数每窗一次／执行失败（含管道锁在飞冲突）fail-open／ran=false 分支可见。
// 通道语义红队先例：勿走 global_diagnostic（只读诊断不更新图）——runRefresh 注入即 due 同款。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSchemaGraphRefreshScheduler } = require("../schema-graph-refresh-scheduler.cjs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHarness(overrides = {}) {
  const calls = { notifySchemaWrite: 0, run: 0, runArgs: [], traces: [] };
  const scheduler = createSchemaGraphRefreshScheduler({
    logger: { info() {}, warn() {}, error() {} },
    telemetry: { recordTrace(kind, payload) { calls.traces.push({ kind, ...payload }); } },
    computeFreshness: () => ({ upToDate: false, changed: ["ontology.yaml"] }),
    runRefresh: async () => { calls.run += 1; return { ran: true, ingested: { graphArtifacts: 2 } }; },
    pipelineDue: { noteSchemaWrite() { calls.notifySchemaWrite += 1; } },
    quietMs: 30,
    ...overrides,
  });
  return { scheduler, calls };
}

test("静默窗内多次通知只执行一次真实增量＋due 计数一次", async () => {
  const { scheduler, calls } = makeHarness();
  scheduler.notify({ category: "ontology", source: "service" });
  await sleep(10);
  scheduler.notify({ category: "enums", source: "watcher" });
  await sleep(10);
  scheduler.notify({ category: "enums", source: "watcher" }); // 双缝重复通知
  assert.equal(scheduler.getState().pending, true, "静默窗内 pending");
  assert.equal(calls.notifySchemaWrite, 1, "计数每窗一次");
  await sleep(60);
  assert.equal(scheduler.getState().pending, false);
  assert.equal(calls.run, 1, "三次通知只执行一次");
  assert.equal(scheduler.getState().lastTriggeredAt !== null, true, "成功执行记触发时刻");
  assert.ok(calls.traces.some((t) => t.event === "run-triggered" && t.ingested), "telemetry 记 run-triggered＋ingested");
});

test("freshness 已最新（upToDate=true）→ 跳过执行（双缝重复写的去重防线）", async () => {
  const { scheduler, calls } = makeHarness({ computeFreshness: () => ({ upToDate: true, changed: [] }) });
  scheduler.notify({ category: "enums", source: "watcher" });
  await sleep(60);
  assert.equal(calls.run, 0, "已最新不执行");
  assert.equal(scheduler.getState().lastSkipReason, "fresh");
  assert.ok(calls.traces.some((t) => t.event === "skip-fresh"));
});

test("freshness 未知（upToDate=null，从未抽取）→ 按需刷新方向执行", async () => {
  const { scheduler, calls } = makeHarness({ computeFreshness: () => ({ upToDate: null, changed: [] }) });
  scheduler.notify({ category: "versions", source: "service" });
  await sleep(60);
  assert.equal(calls.run, 1);
});

test("freshness 复核抛错 → 仍尝试执行（fail toward refresh）", async () => {
  const { scheduler, calls } = makeHarness({ computeFreshness: () => { throw new Error("boom"); } });
  scheduler.notify({ category: "ontology", source: "service" });
  await sleep(60);
  assert.equal(calls.run, 1);
  assert.ok(calls.traces.some((t) => t.event === "freshness-failed"));
});

test("runRefresh 抛错 → fail-open 不外抛，telemetry 记 run-failed（管道锁在飞冲突同路径）", async () => {
  const calls = { notifySchemaWrite: 0, traces: [] };
  const scheduler = createSchemaGraphRefreshScheduler({
    logger: { info() {}, warn() {}, error() {} },
    telemetry: { recordTrace(kind, payload) { calls.traces.push({ kind, ...payload }); } },
    computeFreshness: () => ({ upToDate: false, changed: ["fields.yaml"] }),
    runRefresh: async () => { throw new Error("extract exit=1: 管道锁已被持有"); },
    pipelineDue: { noteSchemaWrite() {} },
    quietMs: 20,
  });
  scheduler.notify({ category: "fields", source: "service" });
  await sleep(50);
  assert.ok(calls.traces.some((t) => t.event === "run-failed"));
  assert.equal(scheduler.getState().pending, false, "失败后清 pending（下次保存重开窗）");
});

test("runRefresh 返回 ran=false（runNow 内部失败已记 pipeline-run）→ 调度面 run-failed 可见", async () => {
  const { scheduler, calls } = makeHarness({ runRefresh: async () => ({ ran: false, error: "extract exit=1" }) });
  scheduler.notify({ category: "ontology", source: "service" });
  await sleep(60);
  assert.equal(scheduler.getState().lastSkipReason, "run-failed");
  assert.ok(calls.traces.some((t) => t.event === "run-failed" && /extract/.test(t.error)));
  assert.equal(scheduler.getState().lastTriggeredAt, null, "未成功不记触发时刻");
});

test("runRefresh 未装配（boot 竞态）→ 记 run-failed 不崩溃", async () => {
  const { scheduler, calls } = makeHarness({ runRefresh: null });
  scheduler.notify({ category: "ontology", source: "service" });
  await sleep(60);
  assert.equal(scheduler.getState().lastSkipReason, "run-channel-unavailable");
  assert.ok(calls.traces.some((t) => t.event === "run-failed"));
});

test("notify 入参异常（null）→ fail-open 不抛", () => {
  const { scheduler } = makeHarness();
  assert.doesNotThrow(() => scheduler.notify(null));
});
