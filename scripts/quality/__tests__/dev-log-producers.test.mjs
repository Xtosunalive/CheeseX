import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── #1873：dev-log 生产者行为测试（commit 事件）──
// 隔离环境：临时 git 仓跑 emitter，断言 exit 0 与 merge 跳过语义；零工作树污染。

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const EMIT_COMMIT = join(REPO_ROOT, "scripts", "quality", "dev-log", "emit-commit-event.mjs");

function buildTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "devlog-producer-"));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q", "-b", "master"]);
  git(["config", "user.email", "t@t"]);
  git(["config", "user.name", "t"]);
  return { dir, git };
}

function runEmitter(script, { cwd } = {}) {
  return spawnSync("node", [script], { cwd, encoding: "utf8" });
}

test("emit-commit-event：普通提交 → exit 0（事件按 owner 拆条；临时仓无 ledger 目录时由 emitter 兜底路径落主仓台账或 stderr 告警，均不阻塞）", () => {
  const { dir, git } = buildTempRepo();
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "export {};");
    git(["add", "."]);
    git(["commit", "-q", "-m", "feat: test commit for #9999"]);
    const r = runEmitter(EMIT_COMMIT, { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("emit-commit-event：merge commit 跳过（exit 0，零事件产出）", () => {
  const { dir, git } = buildTempRepo();
  try {
    writeFileSync(join(dir, "a.md"), "a");
    git(["add", "."]);
    git(["commit", "-q", "-m", "a"]);
    git(["checkout", "-q", "-b", "side"]);
    writeFileSync(join(dir, "b.md"), "b");
    git(["add", "."]);
    git(["commit", "-q", "-m", "b"]);
    git(["checkout", "-q", "master"]);
    git(["merge", "-q", "--no-ff", "side", "-m", "merge side"]);
    const r = runEmitter(EMIT_COMMIT, { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    // merge 提交（>1 parent）应静默跳过
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("emit-commit-event：空仓 / 无提交（git 命令失败）→ 静默 exit 0 不崩", () => {
  const dir = mkdtempSync(join(tmpdir(), "devlog-empty-"));
  try {
    const r = runEmitter(EMIT_COMMIT, { cwd: dir });
    assert.equal(r.status, 0, `expect graceful exit 0:\n${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2026-10-26：删除件入账（changed-files.mjs 单源）──
// 层级：①纯单元（parseNameStatus 解析口径）＋③真实集成（真 git 仓 + 真 emitter 进程）。
// 隔离：显式 NODE_TEST_CONTEXT=1 → dev-log.cjs 走 stdout 不落盘（零真账本污染；PR-116 教训）。
// 反例来源：4a209d89 删 server/ 文件 + 改 contracts/ 两文件——server-api-engineer 零入账；
// 纯删除提交落兜底分支，错记 team-lead / zone docs/ / files=[]。

import { parseNameStatus } from "../dev-log/changed-files.mjs";
import { OWNER_ZONE_PREFIXES } from "../shared/dev-log-ledger.mjs";

function ownerOfPrefix(prefix) {
  const hit = Object.entries(OWNER_ZONE_PREFIXES).find(([, ps]) => ps.includes(prefix));
  assert.ok(hit, `OWNER_ZONE_PREFIXES 应含前缀 ${prefix}`);
  return hit[0];
}

function runEmitterIsolated(cwd) {
  const r = spawnSync("node", [EMIT_COMMIT], { cwd, encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "1" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("parseNameStatus：A/M/D 全计，R/C 取新路径不重复旧路径", () => {
  const files = parseNameStatus([
    "A\tsrc/a.ts",
    "M\tserver/b.cjs",
    "D\tserver/services/dead.cjs",
    "R100\tdocs/old.md\tdocs/new.md",
    "C75\tcontracts/x.json\tcontracts/y.json",
    "T\tscripts/mode-change.sh",
  ]);
  assert.deepEqual(files, [
    "src/a.ts",
    "server/b.cjs",
    "server/services/dead.cjs",
    "docs/new.md",
    "contracts/y.json",
    "scripts/mode-change.sh",
  ]);
  assert.deepEqual(parseNameStatus([]), []);
});

test("emit-commit-event：纯删除提交按被删路径归属，不再落 team-lead/files=[] 兜底", () => {
  const { dir, git } = buildTempRepo();
  try {
    const serverOwner = ownerOfPrefix("server/");
    mkdirSync(join(dir, "server", "x"), { recursive: true });
    writeFileSync(join(dir, "server", "x", "dead.cjs"), "module.exports = {};");
    git(["add", "."]);
    git(["commit", "-q", "-m", "add"]);
    git(["rm", "-q", "server/x/dead.cjs"]);
    git(["commit", "-q", "-m", "del only"]);

    const events = runEmitterIsolated(dir);
    const mine = events.filter((e) => e.event === "dev.commit.completed");
    assert.equal(mine.length, 1, JSON.stringify(mine));
    assert.equal(mine[0].owner, serverOwner);
    assert.deepEqual(mine[0].files, ["server/x/dead.cjs"]);
    assert.ok(mine[0].zone.startsWith("server/"), `zone=${mine[0].zone}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("emit-commit-event：混合提交（改 contracts/ + 删 server/）两辖区各一条，删除路径不蒸发", () => {
  const { dir, git } = buildTempRepo();
  try {
    const serverOwner = ownerOfPrefix("server/");
    const contractsOwner = ownerOfPrefix("contracts/");
    mkdirSync(join(dir, "server", "x"), { recursive: true });
    mkdirSync(join(dir, "contracts"), { recursive: true });
    writeFileSync(join(dir, "server", "x", "dead.cjs"), "module.exports = {};");
    writeFileSync(join(dir, "contracts", "d.json"), "{}");
    git(["add", "."]);
    git(["commit", "-q", "-m", "seed"]);
    git(["rm", "-q", "server/x/dead.cjs"]);
    writeFileSync(join(dir, "contracts", "d.json"), '{"v":1}');
    git(["add", "."]);
    git(["commit", "-q", "-m", "mixed"]);

    const events = runEmitterIsolated(dir).filter((e) => e.event === "dev.commit.completed");
    const byOwner = Object.fromEntries(events.map((e) => [e.owner, e]));
    assert.ok(byOwner[serverOwner], `缺 ${serverOwner} 事件：${JSON.stringify(events)}`);
    assert.deepEqual(byOwner[serverOwner].files, ["server/x/dead.cjs"]);
    assert.ok(byOwner[contractsOwner], `缺 ${contractsOwner} 事件`);
    assert.deepEqual(byOwner[contractsOwner].files, ["contracts/d.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
