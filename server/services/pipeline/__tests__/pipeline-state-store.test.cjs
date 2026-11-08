const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const { readPipelineState, queueRefresh } = require("../pipeline-state-store.cjs");
const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");

// SPEC-012 WP-A：pipeline_state 迁 runtime-state.db（pipeline_state[pending_refresh] 键）——
// 守护：损坏/异形 fail-closed（禁止静默返回 {} 覆写现场）+ 迁出锚（vault 不再产生该文件）。
// 旧「原子三段式/tmp 残留」面随文件形态退役（事务替代）；run_stage 键由 Python 侧
// _runtime_state_db 占用，与 pending_refresh 各占其键（互踩覆写构造性消失）。

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-state-"));
  return vault;
}

test("queueRefresh 首写入库且 vault 不产生 pipeline_state.json（迁出锚）", () => {
  const vault = makeVault();
  const state = queueRefresh(vault, "comp-1");
  assert.equal(state.pending_refresh.length, 1);
  assert.equal(state.pending_refresh[0], "comp-1");
  const stored = getRuntimeStateStore(vault).pipeline.stateGet("pending_refresh");
  assert.deepEqual(stored.pending_refresh, ["comp-1"]);
  assert.ok(stored.last_refresh_requested);
  assert.equal(fs.existsSync(path.join(vault, ".ledger", "pipeline_state.json")), false, "vault 内不得再产生该文件");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("queueRefresh 幂等去重 + 读回一致", () => {
  const vault = makeVault();
  queueRefresh(vault, "comp-1");
  queueRefresh(vault, "comp-1");
  const state = queueRefresh(vault, "comp-2");
  assert.deepEqual(state.pending_refresh, ["comp-1", "comp-2"]);
  assert.deepEqual(readPipelineState(vault).pending_refresh, ["comp-1", "comp-2"]);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("readPipelineState 异形（数组/字符串直灌）时 fail-closed 抛 PIPELINE_STATE_CORRUPT", () => {
  const vault = makeVault();
  getRuntimeStateStore(vault).pipeline.statePut("pending_refresh", [1, 2]); // 上游异形直灌模拟
  assert.throws(() => readPipelineState(vault), (err) => err.code === "PIPELINE_STATE_CORRUPT");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("queueRefresh 异形状态下不覆写现场（先 read fail-closed，写不发生）", () => {
  const vault = makeVault();
  getRuntimeStateStore(vault).pipeline.statePut("pending_refresh", "not-an-object");
  assert.throws(() => queueRefresh(vault, "comp-1"), (err) => err.code === "PIPELINE_STATE_CORRUPT");
  assert.equal(getRuntimeStateStore(vault).pipeline.stateGet("pending_refresh"), "not-an-object", "异形现场原样保留");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("Node/Python 各占其键：pending_refresh 与 run_stage 互不覆写（双进程互踩构造性消失）", () => {
  const vault = makeVault();
  const store = getRuntimeStateStore(vault).pipeline;
  queueRefresh(vault, "comp-node");
  store.statePut("run_stage", { last_stage: 3, stage_data: {}, ts: "now" }); // Python save_stage 同款
  const after = readPipelineState(vault);
  assert.deepEqual(after.pending_refresh, ["comp-node"], "Python 写 run_stage 不清 Node 的 pending_refresh");
  assert.equal(store.stateGet("run_stage").last_stage, 3, "Node 写 pending_refresh 不动 run_stage");
  fs.rmSync(vault, { recursive: true, force: true });
});
