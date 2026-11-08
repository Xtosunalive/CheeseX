// setup-git-hooks 测试（WP-009 修订 2）。分层标注：
//   L1 进程内——注入 runner/logger：未设置→写入；已设任何值→不动；非 git 工作区／git 缺席→skipped
//   L3 真实集成——真实临时 git 仓 ＋ 真实 git 子进程：首跑写入 .githooks，二跑 present；已设绝对路径不被改写；
//      非 git 目录 skipped
// 验证对象：scripts/setup-git-hooks.mjs（npm prepare 入口——仓库钩子自动接线）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { setupGitHooks } from "../setup-git-hooks.mjs";

const quiet = { log() {} };

function fakeRunner({ inside = "true", current = null, onSet = () => {} }) {
  return (args) => {
    if (args[0] === "rev-parse") return inside;
    if (args[0] === "config" && args[1] === "--get") { if (current === null) throw new Error("exit 1"); return current; }
    if (args[0] === "config") { onSet(args[2]); return ""; }
    throw new Error(`unexpected ${args.join(" ")}`);
  };
}

test("L1 未设置 → 写入 .githooks；已设任何值（含绝对路径）→ present 且不写", () => {
  let written = null;
  assert.deepEqual(setupGitHooks({ repoRoot: "/r", logger: quiet, runner: fakeRunner({ onSet: (v) => { written = v; } }) }), { state: "set" });
  assert.equal(written, ".githooks");

  written = null;
  const r = setupGitHooks({ repoRoot: "/r", logger: quiet, runner: fakeRunner({ current: "/abs/elsewhere/.githooks", onSet: (v) => { written = v; } }) });
  assert.deepEqual(r, { state: "present", current: "/abs/elsewhere/.githooks" });
  assert.equal(written, null, "已设值不得改写");
  assert.equal(setupGitHooks({ repoRoot: "/r", logger: quiet, runner: fakeRunner({ current: ".githooks" }) }).state, "present");
});

test("L1 非 git 工作区／git 缺席 → skipped，不抛", () => {
  assert.equal(setupGitHooks({ repoRoot: "/r", logger: quiet, runner: fakeRunner({ inside: "false" }) }).state, "skipped");
  assert.equal(setupGitHooks({ repoRoot: "/r", logger: quiet, runner: () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); } }).state, "skipped");
});

test("L3 真实 git 仓：首跑写入、二跑 present；预设绝对路径不被改写；非 git 目录 skipped", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "sgh-repo-"));
  execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
  const get = () => { try { return execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } };

  assert.equal(get(), null);
  assert.equal(setupGitHooks({ repoRoot: repo, logger: quiet }).state, "set");
  assert.equal(get(), ".githooks");
  assert.equal(setupGitHooks({ repoRoot: repo, logger: quiet }).state, "present");
  assert.equal(get(), ".githooks");

  const abs = path.join(repo, "custom-hooks");
  execFileSync("git", ["config", "core.hooksPath", abs], { cwd: repo, stdio: "ignore" });
  assert.equal(setupGitHooks({ repoRoot: repo, logger: quiet }).state, "present");
  assert.equal(get(), abs, "已设绝对路径须逐字保留");

  // 非 git 目录（真实 git 子进程）：skipped 不抛——repoRoot 指向无 .git 的目录，GIT_CEILING 防止向上找到别的仓
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "sgh-plain-"));
  const prevCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = os.tmpdir();
  try {
    assert.equal(setupGitHooks({ repoRoot: plain, logger: quiet }).state, "skipped");
  } finally {
    if (prevCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = prevCeiling;
  }
});
