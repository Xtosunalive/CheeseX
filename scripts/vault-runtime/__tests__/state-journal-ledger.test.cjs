// @tests: SPEC-012 F2 修复批——三类「同类问题再发生」的类消灭守卫
//   ① Python 流水落账内建（_journal_append 尾接 _vault_ledger → tmp git 仓内出现 state-journal: 提交）
//   ② 重放零回声（raw 句柄——重放 N 笔滞后事件后流水行数不变；包装面则会自我翻倍）
//   ③ 排除面单源派生（reconcile 层二与门禁⑥白名单从 destinations 契约 selfAccounted 派生）
// 层级：①为真实集成（真 python＋真 git 仓）；②为迁移契约演练；③为门禁契约。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const { openPersistenceDb } = require(path.join(REPO_ROOT, "server/shared/persistence/sqlite-adapter.cjs"));
const { initRuntimeStateStore } = require(path.join(REPO_ROOT, "server/shared/persistence/runtime-state-store.cjs"));
const { createStateJournal, replayStateJournal } = require(path.join(REPO_ROOT, "server/shared/persistence/state-journal.cjs"));
const { selfAccountedVaultFiles } = require(path.join(REPO_ROOT, "server/shared/vault-write-destinations.cjs"));

function makeGitVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2fix-"));
  fs.mkdirSync(path.join(dir, "知识库"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库", "seed.md"), "x\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  return dir;
}

test("① Python 流水落账内建：_journal_append 后 tmp git 仓出现 state-journal: 提交（真实集成）", () => {
  const vault = makeGitVault();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "f2fix-data-"));
  try {
    const python = process.env.PYTHON_PATH || "python3";
    const code = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(REPO_ROOT, "scripts/vault-runtime"))})
import os
os.environ["KB_DATA_DIR"] = ${JSON.stringify(dataDir)}
os.environ["KB_VAULT"] = ${JSON.stringify(vault)}
os.environ["VAULT_GIT_LEDGER_DISABLE"] = ""
import _runtime_state_db as db
db.save_stage(2, {"x": 1})
print("PY-OK")
`;
    const r = spawnSync(python, ["-c", code], { encoding: "utf-8", cwd: REPO_ROOT });
    assert.equal(r.status, 0, `python 应成功：${r.stderr}`);
    // 流水文件已写
    const journal = path.join(vault, ".ledger", "state-journal.jsonl");
    assert.ok(fs.existsSync(journal), "流水文件应产生");
    // 落账内建：git 仓内出现 state-journal: 提交（不再依赖任何旁批/boot）
    const log = execFileSync("git", ["log", "--oneline"], { cwd: vault, encoding: "utf-8" });
    assert.match(log, /state-journal: ③类耐久性流水/, "模块本体应落账（类消灭①）");
    // 工作区对流水文件零残留
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: vault, encoding: "utf-8" });
    assert.ok(!status.includes("state-journal"), `流水应已提交而非未追踪：${status}`);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("② 重放零回声：重放 N 笔滞后事件后流水行数不变（raw 句柄；包装面会翻倍）", () => {
  const vault = makeGitVault();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "f2fix-db-"));
  try {
    const dbPath = path.join(dataDir, "runtime-state.db");
    // 生产期：带流水写 3 笔（经包装面——业务写照常记流水）
    const journal = createStateJournal(vault);
    const live = initRuntimeStateStore(openPersistenceDb({ path: dbPath }), { journal });
    live.approval.put("a", { status: "open" });
    live.governance.put({ gapId: "g", action: "resolved", note: "", resolvedAt: "t" });
    live.pipeline.versionPut({ pipeline_run_id: "r" });
    const journalFile = path.join(vault, ".ledger", "state-journal.jsonl");
    const linesBefore = fs.readFileSync(journalFile, "utf8").trim().split("\n").length;
    assert.equal(linesBefore, 3);

    // 灾后重建：删库 → 新 store【生产同构：带 journal 包装（main.cjs 即此形态）】→ 重放 3 笔滞后事件
    // （不挂包装则回声路径根本不经过，测不出类消灭②——红面实证教训）
    for (const suf of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suf, { force: true });
    const reviveJournal = createStateJournal(vault);
    const revived = initRuntimeStateStore(openPersistenceDb({ path: dbPath }), { journal: reviveJournal });
    const result = replayStateJournal({ vaultPath: vault, store: revived });
    assert.equal(result.replayed, 3, "3 笔应全部重放");
    assert.equal(revived.approval.get("a").status, "open", "状态重建正确");

    // 类消灭②断言：重放后流水行数不变（若经包装面会 +3 回声）
    const linesAfter = fs.readFileSync(journalFile, "utf8").trim().split("\n").length;
    assert.equal(linesAfter, linesBefore, `重放不得产生回声（前 ${linesBefore} 行，后 ${linesAfter} 行）`);

    // 再 boot 一遍（水位后）仍零增量——无恶性循环
    const again = replayStateJournal({ vaultPath: vault, store: revived });
    assert.equal(again.replayed, 0);
    assert.equal(fs.readFileSync(journalFile, "utf8").trim().split("\n").length, linesBefore);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("③ 排除面单源派生：selfAccountedVaultFiles 来自契约，两个自管文件在列", () => {
  const files = selfAccountedVaultFiles();
  assert.ok(files.includes(".ledger/state-journal.jsonl"), "流水应在自管清单");
  assert.ok(files.includes(".ledger/channel-write-log.jsonl"), "通道日志应在自管清单");
  // 单源锚：派生清单与契约 selfAccounted 段逐字一致（原「门禁⑥形态锚」随 WP-143 波4b
  // 检查器物理清除退役——契约本身即唯一事实源，恢复＝从 kit 仓 /reference 取回检查器）
  const decl = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "contracts/vault-write-destinations.json"), "utf8"));
  const contractSelf = Object.entries(decl.allowedPermanent || {})
    .filter(([, meta]) => meta && typeof meta === "object" && meta.selfAccounted === true)
    .map(([key]) => key);
  assert.deepEqual([...files].sort(), [...contractSelf].sort(), "派生清单须与契约 selfAccounted 段一致");
});
