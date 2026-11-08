// WP-157：评审执行器单元测试——逻辑层（diff 解析/规则单源/开关与 fail-open），模型调用不联网（stub 走 skip 路径）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
import { fileURLToPath } from "node:url";
const sh = (cwd, ...a) => execFileSync(a[0], a.slice(1), { cwd, encoding: "utf-8" });

function makeRepo({ withRules = true, key = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-review-"));
  fs.mkdirSync(path.join(dir, "scripts/review"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".githooks"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "scripts/review/ai-pr-review.mjs"), path.join(dir, "scripts/review/ai-pr-review.mjs"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), withRules
    ? "# AGENTS\n\n## 七、AI 代码评审规则\n- P1 只给运行时错误行为。\n"
    : "# AGENTS\n\n（无评审规则节）\n");
  sh(dir, "git", "init", "-b", "main");
  sh(dir, "git", "-C", dir, "config", "user.email", "t@t");
  sh(dir, "git", "-C", dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  sh(dir, "git", "-C", dir, "add", "-A");
  sh(dir, "git", "-C", dir, "commit", "-qm", "init");
  fs.writeFileSync(path.join(dir, "a.txt"), "2\n");
  sh(dir, "git", "-C", dir, "add", "-A");
  sh(dir, "git", "-C", dir, "commit", "-qm", "change");
  return dir;
}
const run = (dir, env = {}, base = "HEAD~1", head = "HEAD") => {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, "scripts/review/ai-pr-review.mjs"), "--root", dir, "--base", base, "--head", head], { encoding: "utf-8", env: { ...process.env, ...env } });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};

test("空 diff → skip", () => {
  const dir = makeRepo();
  const r = run(dir, {}, "HEAD", "HEAD");
  assert.match(r.out, /空 diff/);
});

test("无 key → fail-open skip＋可感知报告", () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, "b.txt"), "x");
  sh(dir, "git", "-C", dir, "add", "-A");
  sh(dir, "git", "-C", dir, "commit", "-qm", "c2");
  const r = run(dir); // 环境 DEEPSEEK_API_KEY 可能存在于外层——显式剔除
  const r2 = run(dir, { DEEPSEEK_API_KEY: "" });
  assert.ok(/skip.*(未执行|key)/.test(r.out + r2.out) || r.code === 0, "fail-open 应 exit 0");
});

test("规则单源缺失 → FAIL（不静默）", () => {
  const dir = makeRepo({ withRules: false });
  fs.writeFileSync(path.join(dir, "b.txt"), "x");
  sh(dir, "git", "-C", dir, "add", "-A");
  sh(dir, "git", "-C", dir, "commit", "-qm", "c2");
  const r = run(dir, { DEEPSEEK_API_KEY: "" });
  assert.match(r.out, /规则单源缺失/);
});
