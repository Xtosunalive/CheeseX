// @tests: scripts/governance-kit/kit.mjs（治理 kit 统一出入口）＋
//   scripts/quality/wp-derive.mjs（挂载态合同枚举）＋
//   scripts/quality/check-merge-reconcile.mjs（治理件缺席时的假绿防线）。
// 层级：纯单元 + CLI 契约。夹具全部用临时 git 仓自建，不依赖私有治理 kit，
// 公开仓新克隆可直接跑；空数据态（治理件缺席）也在覆盖内。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const kit = await import(pathToFileURL(path.join(ROOT, "scripts/governance-kit/kit.mjs")).href);
const wp = await import(pathToFileURL(path.join(ROOT, "scripts/quality/wp-derive.mjs")).href);
const RECONCILE = path.join(ROOT, "scripts/quality/check-merge-reconcile.mjs");

function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-kit-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function initRepo(t, name, { withRegister = false } = {}) {
  const dir = path.join(makeTmp(t), name);
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "test"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"], { stdio: "ignore" });
  fs.mkdirSync(path.join(dir, "docs", "work-packages"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "work-packages", "WP-001.json"), "{}\n");
  if (withRegister) {
    fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs", "plans", "problem-register.md"),
      "# 登记簿\n\n## PR-001 测试条目\n- 状态：**已关闭**\n");
  }
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "fixture"], { stdio: "ignore" });
  return dir;
}

function runReconcile(repo, extra = []) {
  return spawnSync("node", [RECONCILE, "--repo", repo, "--no-fetch", "--target", "HEAD", "--head", "HEAD", ...extra],
    { encoding: "utf8" });
}

test("统一出入口：挂载点覆盖治理层，不含仓本地配置与密钥", () => {
  const links = kit.MOUNTS.map((m) => m.link);
  assert.equal(links.length, 7);
  for (const required of ["docs", "AGENTS.md", ".githooks", "data/governance", "scripts/dev-log"]) {
    assert.ok(links.includes(required), `${required} 应在挂载点内`);
  }
  for (const forbidden of [".env", ".env.fields-gate-probe", "GIT-CONTEXT.md", "README-addendum.md", ".claude"]) {
    assert.ok(!links.includes(forbidden), `${forbidden} 属仓本地件，不应挂载`);
  }
});

test("统一出入口：只认带治理合同目录的 git 仓，环境变量优先", (t) => {
  const base = makeTmp(t);
  const plain = path.join(base, "plain");
  fs.mkdirSync(plain);
  const repo = initRepo(t, "kit");
  assert.equal(kit.isKitDir(plain), false);
  assert.equal(kit.isKitDir(repo), true);

  const prev = process.env.CHEESE_GOV_KIT;
  t.after(() => {
    if (prev === undefined) delete process.env.CHEESE_GOV_KIT;
    else process.env.CHEESE_GOV_KIT = prev;
  });
  process.env.CHEESE_GOV_KIT = repo;
  assert.equal(kit.resolveKitDir(), repo);
});

test("挂载态从治理 kit 磁盘枚举合同；未挂载返回 null 交回 git 索引", (t) => {
  const base = makeTmp(t);
  const kitDocs = path.join(base, "kit-docs");
  fs.mkdirSync(path.join(kitDocs, "work-packages"), { recursive: true });
  fs.writeFileSync(path.join(kitDocs, "work-packages", "WP-002.json"), "{}");
  fs.writeFileSync(path.join(kitDocs, "work-packages", "WP-001.json"), "{}");
  fs.writeFileSync(path.join(kitDocs, "work-packages", "notes.md"), "not a contract");

  const mountRoot = path.join(base, "code");
  fs.mkdirSync(mountRoot);
  fs.symlinkSync(kitDocs, path.join(mountRoot, "docs"), "dir");
  assert.deepEqual(wp.governanceContractFiles(mountRoot), [
    "docs/work-packages/WP-001.json",
    "docs/work-packages/WP-002.json",
  ]);
  assert.equal(wp.governanceContractFiles(path.join(base, "no-docs")), null);
});

test("断链 / kit 内容缺失被识别为挂载损坏，不混同于未挂载或空 kit", (t) => {
  const base = makeTmp(t);
  const broken = path.join(base, "broken-code");
  fs.mkdirSync(broken);
  fs.symlinkSync(path.join(base, "missing-kit-docs"), path.join(broken, "docs"), "dir");
  assert.equal(wp.governanceMountBroken(broken), true, "断链符号链接应判损坏");
  assert.equal(wp.governanceMountBroken(base), false, "无 docs 应判未挂载");

  const kitDocs = path.join(base, "kit-docs");
  fs.mkdirSync(kitDocs);
  const incomplete = path.join(base, "incomplete-code");
  fs.mkdirSync(incomplete);
  fs.symlinkSync(kitDocs, path.join(incomplete, "docs"), "dir");
  assert.equal(wp.governanceMountBroken(incomplete), true, "目标存在但缺合同目录应判损坏");

  fs.mkdirSync(path.join(kitDocs, "work-packages"));
  assert.equal(wp.governanceMountBroken(incomplete), false, "正常挂载不应判损坏");
  assert.deepEqual(wp.governanceContractFiles(incomplete), [], "合法空 kit 是空数组");
});

test("声明必须在治理仓对账（--expect-governance）时：治理件缺席即 fail-closed，不静默假绿", (t) => {
  const repo = initRepo(t, "code-only");
  const r = runReconcile(repo, ["--json", "--expect-governance"]);
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.violations[0], /可比对象/);
});

test("不声明治理仓时保留既有契约：历史无治理件允许空集合 ok，但必须明示未做对账", (t) => {
  const repo = initRepo(t, "code-only");
  const r = runReconcile(repo, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.expectedMax, 0);
  assert.match(r.stderr, /merge_reconcile=NOTE.*未执行撞号与分叉对账/);
});

test("治理 kit 仓：登记簿可读，声明开关不误伤，对账给出真实取号节", (t) => {
  const repo = initRepo(t, "governance", { withRegister: true });
  const r = runReconcile(repo, ["--json", "--expect-governance"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.expectedMax, 1);
});

test("gov:sync 把治理层变更提交进治理仓（stdio:ignore 不再让 git() 崩）", (t) => {
  const repo = initRepo(t, "sync-kit");
  fs.writeFileSync(path.join(repo, "docs", "work-packages", "WP-001.json"), '{"probe":true}\n');
  const head = () => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const before = head();
  assert.equal(kit.main(["sync", repo, "-m", "chore(governance): e2e 探针"]), 0);
  assert.notEqual(head(), before, "治理层变更应落成一次提交");
  const files = execFileSync("git", ["-C", repo, "show", "--pretty=format:", "--name-only", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(files, /^docs\/work-packages\/WP-001\.json$/m);
  assert.equal(execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
});

test("通过符号链接路径调用 CLI 仍执行，不静默假绿", (t) => {
  const base = makeTmp(t);
  const repo = initRepo(t, "alias-kit");
  const alias = path.join(base, "kit-alias.mjs");
  fs.symlinkSync(path.join(ROOT, "scripts", "governance-kit", "kit.mjs"), alias);
  const r = spawnSync("node", [alias, "path", repo], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), repo, "CLI 必须真的执行并输出 kit 路径");
});

test("gov:sync 不把 post-commit 新写出的治理层台账误报成非治理层变更", (t) => {
  const repo = initRepo(t, "sync-postcommit");
  fs.mkdirSync(path.join(repo, ".githooks"), { recursive: true });
  const hook = path.join(repo, ".githooks", "post-commit");
  fs.writeFileSync(hook, `#!/bin/sh
printf '\\n' >> docs/work-packages/WP-001.json
mkdir -p docs/dev-log/entries
echo '{"probe":1}' > docs/dev-log/entries/post.jsonl
exit 0
`);
  fs.chmodSync(hook, 0o755);
  execFileSync("git", ["-C", repo, "config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  fs.writeFileSync(path.join(repo, "docs", "work-packages", "WP-001.json"), '{"probe":true}\n');
  const logs = [];
  const orig = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  try { assert.equal(kit.main(["sync", repo, "-m", "probe"]), 0); }
  finally { console.log = orig; }
  const text = logs.join("\n");
  assert.doesNotMatch(text, /非治理层变更/);
  assert.match(text, /治理层台账/);
});

test("fresh worktree 用符号链接接 node_modules 也不污染工作树", (t) => {
  const base = makeTmp(t);
  execFileSync("git", ["init", "-q", base], { stdio: "ignore" });
  fs.copyFileSync(path.join(ROOT, ".gitignore"), path.join(base, ".gitignore"));
  fs.symlinkSync("/nonexistent", path.join(base, "node_modules"), "dir");
  const r = spawnSync("git", ["-C", base, "check-ignore", "node_modules"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /node_modules/);
});
