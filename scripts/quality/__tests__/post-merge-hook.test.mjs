// post-merge 钩子守护测试（Node 依赖自动装配，Master 2026-11-04 方向「两个都自动安装」）
// 验证对象：.githooks/post-merge——lockfile 变更→自动 npm ci；无变更→零动作；失败告警不阻断。
// 层级：L3 真实子进程（真实 git 沙箱仓＋PATH 桩 npm 写标记，不触真仓 node_modules）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOOK = path.join(ROOT, ".githooks", "post-merge");

// .githooks 为仓库自用工具不入公开仓：缺席时明示跳过（vault=skip 同惯例），本地有钩子时照常执法。
const HOOK_SKIP = fs.existsSync(HOOK) ? false : ".githooks/post-merge 不在公开面——钩子测试缺席跳过";
const hookTest = (name, fn) => test(name, { skip: HOOK_SKIP }, fn);

function sh(cmd, cwd, env) {
  return execFileSync("bash", ["-c", cmd], { cwd, env, encoding: "utf8" });
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp107-postmerge-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  // PATH 桩 npm：记录调用到 marker，成功退出
  fs.writeFileSync(path.join(bin, "npm"), '#!/bin/sh\necho called >> "$MARKER"\nexit 0\n', { mode: 0o755 });
  const run = (c) => sh(c, dir, { ...process.env, PATH: `${bin}:${process.env.PATH}`, MARKER: path.join(dir, "marker") });
  run("git init -q -b main .");
  run('git config user.email t@t && git config user.name t');
  fs.writeFileSync(path.join(dir, "package-lock.json"), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  run("git add -A && git commit -qm base");
  return { dir, run, marker: path.join(dir, "marker") };
}

hookTest("lockfile 变更的合并（ORIG_HEAD→HEAD）→ 桩 npm 被调用", () => {
  const { dir, run, marker } = makeSandbox();
  fs.writeFileSync(path.join(dir, "package-lock.json"), '{"lockfileVersion":3,"changed":true}\n');
  run("git add -A && git commit -qm change");
  run("git update-ref ORIG_HEAD HEAD~1"); // 模拟合并完成后的 ORIG_HEAD 指向合并前
  run(HOOK);
  assert.equal(fs.readFileSync(marker, "utf8").trim(), "called", "桩 npm 应被调用一次");
  run(`git update-ref -d ORIG_HEAD 2>/dev/null; true`);
  fs.rmSync(dir, { recursive: true, force: true });
});

hookTest("无 lockfile 变更 → 桩 npm 零调用（零动作即退出 0）", () => {
  const { dir, run, marker } = makeSandbox();
  fs.writeFileSync(path.join(dir, "README.md"), "no-lock-change\n");
  run("git add -A && git commit -qm docs-only");
  run("git update-ref ORIG_HEAD HEAD~1");
  const out = run(HOOK);
  assert.ok(!fs.existsSync(marker), "桩 npm 不得被调用");
  assert.equal(out, "");
  fs.rmSync(dir, { recursive: true, force: true });
});

hookTest("npm ci 失败 → 告警不阻断（退出 0，合并完成不被回滚）", () => {
  const { dir, run } = makeSandbox();
  // 换成必败桩
  const bin = path.join(dir, "bin", "npm");
  fs.writeFileSync(bin, '#!/bin/sh\necho "[post-merge] npm ci 失败——请手工执行" >&2\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "package-lock.json"), '{"v":2}\n');
  run("git add -A && git commit -qm change");
  run("git update-ref ORIG_HEAD HEAD~1");
  const code = sh(`${HOOK}; echo EXIT=$?`, dir, { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}` }).split("EXIT=")[1].trim();
  assert.equal(code, "0", "钩子失败必须退出 0（不阻断合并）");
  fs.rmSync(dir, { recursive: true, force: true });
});
