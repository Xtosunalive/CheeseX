// Component: Pipeline-State-Store
// @responsible: 封装管线刷新队列状态的读写（SPEC-012 WP-A：③类迁 runtime-state.db）
// @inputs: runtimeState store（缺省按 vaultPath 作用域懒建；生产走 boot init 实例）
// @outputs: readPipelineState(vaultPath) / queueRefresh(vaultPath, componentId)
//
// 历史：2026-09-26 原子三段式（tmp+rename）消灭无保护 vault 写；SPEC-012 起 Node 的
// pending_refresh 占 pipeline_state 键、Python 的 run_stage 各占其键——旧「同文件全量覆写
// 互踩」（Python save_state 清掉 Node pending_refresh）构造性消失。
// fail-closed 语义保持：读侧损坏/形态非法抛 PIPELINE_STATE_CORRUPT（库形态下移交事务层，
// 入口校验保留防上游灌入异形）。

const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

const STATE_KEY = "pending_refresh";
const LEDGER_CODE = "PIPELINE_STATE_CORRUPT";

function readPipelineState(vaultPath) {
  const stored = getRuntimeStateStore(vaultPath).pipeline.stateGet(STATE_KEY);
  if (stored === undefined) return {};
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    const wrapped = new Error("管线状态数据结构非法（非对象）：pipeline_state[pending_refresh]");
    wrapped.code = LEDGER_CODE;
    throw wrapped;
  }
  return stored;
}

function queueRefresh(vaultPath, componentId) {
  const store = getRuntimeStateStore(vaultPath).pipeline;
  const state = readPipelineState(vaultPath);
  if (!state.pending_refresh) state.pending_refresh = [];
  if (state.pending_refresh.indexOf(componentId) < 0) state.pending_refresh.push(componentId);
  state.last_refresh_requested = new Date().toISOString();
  store.statePut(STATE_KEY, state);
  return state;
}

module.exports = { readPipelineState, queueRefresh };
