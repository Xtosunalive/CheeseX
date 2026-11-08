const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const { createGovernanceActionStore } = require("../governance-action-store.cjs");
const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function vaultLedgerPath(vault) {
  return path.join(vault, ".ledger", "governance_actions.json");
}

test("治理动作账本入 runtime-state 库，不再落 vault（SPEC-012 WP-A 迁出语义）", () => {
  const vault = makeTempDir("governance-store-");
  const store = createGovernanceActionStore({ vaultPath: vault });
  store.addAction({ gapId: "gap-1", action: "resolved", note: "已处置" });

  const actions = getRuntimeStateStore(vault).governance.list();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].gapId, "gap-1");
  assert.strictEqual(actions[0].action, "resolved");
  assert.strictEqual(actions[0].note, "已处置");

  // 迁出语义：vault 内不再落 .ledger/governance_actions.json
  assert.ok(!fs.existsSync(vaultLedgerPath(vault)), "账本已迁 runtime-state 库，vault 内不得残留该文件");

  assert.deepStrictEqual(store.getResolvedGapIds(), new Set(["gap-1"]));
  assert.strictEqual(store.readActions().length, 1);
});

test("状态从 runtime-state 库读取（迁移逻辑已随旧文件清理移除，H1 可重建）", () => {
  const vault = makeTempDir("governance-store-");
  getRuntimeStateStore(vault).governance.put({ gapId: "gap-a", action: "resolved", note: "", resolvedAt: "2026-10-14T00:00:00.000Z" });
  const store = createGovernanceActionStore({ vaultPath: vault });
  assert.deepStrictEqual(store.getResolvedGapIds(), new Set(["gap-a"]));
  // 账本只在 runtime-state 库这一份；构造参数不再接受 legacyPath（旧位置已物理删除）
  assert.strictEqual(getRuntimeStateStore(vault).governance.list().length, 1);
});

test("同一 gapId 重复处置时更新而非追加（同 gapId UPSERT）", () => {
  const vault = makeTempDir("governance-store-");
  const store = createGovernanceActionStore({ vaultPath: vault });
  store.addAction({ gapId: "gap-2", action: "resolved" });
  store.addAction({ gapId: "gap-2", action: "reopened" });

  const actions = getRuntimeStateStore(vault).governance.list();
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].action, "reopened");
});

// 旧「账本损坏时抛错且不被覆写」「非数组结构同样抛错」两测已退役：vault 文件损坏攻击面随 SPEC-012 WP-A
// 迁移消失（无可变共享文件，损坏防护移交 sqlite 事务层）。此处以 store 往返完整性测试替代锚定。
test("store 往返完整性：put 三条 → list 深等值返回（损坏面移交事务层，SPEC-012 WP-A）", () => {
  const vault = makeTempDir("governance-store-");
  const runtimeState = getRuntimeStateStore(vault);
  const entries = [
    { gapId: "gap-r1", action: "resolved", note: "一", resolvedAt: "2026-10-14T00:00:01.000Z" },
    { gapId: "gap-r2", action: "waived", note: "二", resolvedAt: "2026-10-14T00:00:02.000Z" },
    { gapId: "gap-r3", action: "reopened", note: "三", resolvedAt: "2026-10-14T00:00:03.000Z" },
  ];
  for (const entry of entries) runtimeState.governance.put(entry);

  assert.deepStrictEqual(runtimeState.governance.list(), entries);
});
