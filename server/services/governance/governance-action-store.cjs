// Component: Governance-Action-Store
// @responsible: 封装治理动作账本的读写（SPEC-012 WP-A：③类迁 runtime-state.db——真事务替代 tmp+rename）
// @inputs: runtimeState store（缺省取装配实例；node:test 环境懒建内存库）
// @outputs: createGovernanceActionStore(options?) → { getResolvedGapIds, readActions, addAction }
//
// 历史：ADR-001 期账本住 vaultPath/.ledger/governance_actions.json（随 Vault 进版本控制）；
// SPEC-012 分层契约下③类迁进程私有库（boot 一次性导入旧文件，见 persistence/runtime-state-import.cjs）。
// fail-closed 语义不变：损坏即抛 GOVERNANCE_LEDGER_CORRUPT（库形态下损坏面移交 sqlite 事务，
// 入口校验保留防上游灌入非数组形态）。

const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

function createGovernanceActionStore(options) {
  const store = (options && options.runtimeState) || getRuntimeStateStore(options && options.vaultPath);

  function readActions() {
    const actions = store.governance.list();
    if (!Array.isArray(actions)) {
      const wrapped = new Error("治理动作账本结构非法（非数组）");
      wrapped.code = "GOVERNANCE_LEDGER_CORRUPT";
      throw wrapped;
    }
    return actions;
  }

  function getResolvedGapIds() {
    // PR-317 加固批（Master 裁）：最新条目胜出——同 gapId 的 reopened 行使其退出已处置集
    //（缺口重新可见可处置）；resolved/ignored/exempted 仍在集内。
    const RESOLVED_ACTIONS = new Set(["resolved", "ignored", "exempted"]);
    const latestByGap = new Map();
    for (const action of readActions()) {
      if (action.gapId) latestByGap.set(action.gapId, action);
    }
    const resolvedGapIds = new Set();
    for (const [gapId, action] of latestByGap) {
      if (RESOLVED_ACTIONS.has(action.action)) resolvedGapIds.add(gapId);
    }
    return resolvedGapIds;
  }

  /**
   * @param {{ gapId: string, action: string, note?: string }} entry
   */
  function addAction(entry) {
    store.governance.put({
      gapId: entry.gapId,
      action: entry.action,
      note: entry.note || "",
      resolvedAt: new Date().toISOString(),
    });
    return readActions();
  }

  return { getResolvedGapIds, readActions, addAction };
}

module.exports = { createGovernanceActionStore };
