#!/usr/bin/env node
// setup-git-hooks.mjs — npm `prepare` 入口（WP-009 修订 2）：把本仓 core.hooksPath 指到 .githooks。
// @responsible: .githooks/ 随库提交，但 core.hooksPath 是克隆本地配置，新克隆不会自动生效——此前要求新用户
//   手敲 `git config core.hooksPath .githooks`（docs/环境启动说明.md 第二节）；本脚本让 `npm install` 顺带完成。
// @inputs: 无参数；仓根＝本文件上一级目录
// @outputs: 本仓 .git/config 的 core.hooksPath；stdout 一行结果
// @context: 只在 core.hooksPath 未设置时写入；已设任何值（含绝对路径）一律不动——改既有配置不是接线职责。
//   非 git 工作区（tarball 安装、CI 导出目录）或 PATH 无 git 时静默退出 0——prepare 失败会让 npm install
//   整体失败，这里绝不阻断安装。worktree 内执行时 git config 写到共享的 .git/config（common dir），所有工作树同时生效。
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_PATH = ".githooks";

export function setupGitHooks({ repoRoot = REPO_ROOT, logger = console, runner = defaultRunner } = {}) {
  let insideGit;
  try {
    insideGit = runner(["rev-parse", "--is-inside-work-tree"], repoRoot).trim() === "true";
  } catch {
    // git 不在 PATH 或不是 git 工作区：安装场景不需要钩子
    return { state: "skipped", reason: "not-a-git-worktree-or-no-git" };
  }
  if (!insideGit) return { state: "skipped", reason: "not-a-git-worktree" };

  let current = "";
  try { current = runner(["config", "--get", "core.hooksPath"], repoRoot).trim(); } catch { /* 未设置 */ }
  if (current) {
    // 已有任何值（含绝对路径、别的目录）都不动——改既有配置不是新手接线的职责（AGENTS §五 主动性不等于授权）
    logger.log(`  = git hooks: core.hooksPath 已设为 ${current}${current === HOOKS_PATH ? "" : "（非缺省值，保留不动）"}`);
    return { state: "present", current };
  }
  try {
    runner(["config", "core.hooksPath", HOOKS_PATH], repoRoot);
  } catch (error) {
    logger.log(`  ! git hooks: 写 core.hooksPath 失败（${error && error.message ? error.message.split("\n")[0] : String(error)}）——可手动执行 git config core.hooksPath ${HOOKS_PATH}`);
    return { state: "failed" };
  }
  logger.log(`  + git hooks: core.hooksPath=${HOOKS_PATH}`);
  return { state: "set" };
}

function defaultRunner(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupGitHooks();
  process.exit(0);
}
