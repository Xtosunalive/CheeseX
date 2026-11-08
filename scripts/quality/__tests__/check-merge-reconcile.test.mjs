// check-merge-reconcile 测试（WP-012）。分层：
//   L1 纯单元——登记册解析 / 集合差 / 对账判定（撞号、closed-wins 双向、非关闭分叉、干净）
//   L3 真实集成——临时 git 仓三分支（base→main / task 各自演进），以真实子进程跑 CLI，断言退出码与违例文案；
//      合并后重跑幂等 ok；无远端时缺省 fetch 失败 fail-closed
// 验证对象：scripts/quality/check-merge-reconcile.mjs（真实 git，零 mock）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { diffSets, parseRegister, reconcile } from "../check-merge-reconcile.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "check-merge-reconcile.mjs");

const entry = (id, state, extra = "") => `## ${id} 标题（${state}）\n\n- 状态：**${state}**（说明）\n- 来源：x\n${extra}\n`;

test("L1 parseRegister：取各条目首个状态粗体词；无状态行为 null", () => {
  const text = `# 簿\n\n---\n\n${entry("PR-002", "已关闭")}${entry("PR-001", "候选")}## PR-000 残块\n- 来源：x\n`;
  const parsed = parseRegister(text);
  assert.deepEqual([...parsed.entries()].map(([k, v]) => [k, v.state]), [["PR-002", "已关闭"], ["PR-001", "候选"], ["PR-000", null]]);
});

test("L1 diffSets：Map 与 Set 两形态的「相对基线新增」", () => {
  assert.deepEqual([...diffSets(new Map([["PR-001", {}]]), new Map([["PR-001", {}], ["PR-002", {}]]))], ["PR-002"]);
  assert.deepEqual([...diffSets(new Set(["WP-001.json"]), new Set(["WP-001.json", "WP-002.json"]))], ["WP-002.json"]);
  assert.deepEqual([...diffSets(new Set(["WP-001.json"]), new Set())], []);
});

function side(sha, pr, wp = []) {
  return { sha, pr: new Map(Object.entries(pr).map(([k, v]) => [k, { state: v }])), wp: new Set(wp) };
}

test("L1 reconcile：撞号（PR/WP 双方同号新开）→ 违例；各开不同号 → 干净", () => {
  const base = side("b".repeat(40), { "PR-001": "候选" }, ["WP-001.json"]);
  const collide = reconcile({
    base,
    target: side("t".repeat(40), { "PR-001": "候选", "PR-002": "候选" }, ["WP-001.json", "WP-002.json"]),
    head: side("h".repeat(40), { "PR-001": "候选", "PR-002": "候选" }, ["WP-001.json", "WP-002.json"]),
  });
  assert.equal(collide.violations.length, 2);
  assert.match(collide.violations[0], /撞号：PR-002/);
  assert.match(collide.violations[1], /撞号：WP-002\.json/);
  const clean = reconcile({
    base,
    target: side("t".repeat(40), { "PR-001": "候选", "PR-002": "候选" }, ["WP-001.json", "WP-002.json"]),
    head: side("h".repeat(40), { "PR-001": "候选", "PR-003": "候选" }, ["WP-001.json", "WP-003.json"]),
  });
  assert.deepEqual(clean.violations, []);
  assert.equal(clean.expectedMax, 3, "取号节期望 max 取双侧并集最大号");
});

test("L1 reconcile：closed-wins 双向——对侧已关闭/本侧回退 → 以对侧为准；本侧已关闭/对侧改动 → 以本侧为准；双非关闭分叉 → 列出；单侧改动 → 不算分叉", () => {
  const base = side("b".repeat(40), { "PR-001": "已立案", "PR-002": "已立案", "PR-003": "已立案", "PR-004": "已立案" });
  const r = reconcile({
    base,
    target: side("t".repeat(40), { "PR-001": "已关闭", "PR-002": "修复中", "PR-003": "待验收", "PR-004": "已关闭" }),
    head: side("h".repeat(40), { "PR-001": "修复中", "PR-002": "已关闭", "PR-003": "修复中", "PR-004": "已立案" }),
  });
  assert.equal(r.violations.length, 3, r.violations.join("\n"));
  assert.match(r.violations[0], /分叉：PR-001 .*以对侧（已关闭）为准/);
  assert.match(r.violations[1], /分叉：PR-002 .*以本侧（已关闭）为准/);
  assert.match(r.violations[2], /分叉：PR-003 .*禁止静默取单侧/);
  // PR-004：仅对侧改动（本侧仍=基线）→ 合并自然采对侧，不算分叉
});

// ── L3 真实 git ──

function sh(cwd, args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function commitAll(cwd, msg) {
  sh(cwd, ["add", "-A"]);
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg]);
}
function writeRegister(cwd, entries) {
  fs.mkdirSync(path.join(cwd, "docs/plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs/plans/problem-register.md"), `# 簿\n\n---\n\n${entries.join("")}`);
}
function writeWp(cwd, id) {
  fs.mkdirSync(path.join(cwd, "docs/work-packages"), { recursive: true });
  fs.writeFileSync(path.join(cwd, `docs/work-packages/${id}.json`), `{"package_id":"${id}"}\n`);
}
function runCli(repo, extra) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--repo", repo, ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

function scenarioRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "merge-reconcile-"));
  sh(repo, ["init", "-q", "-b", "main"]);
  writeRegister(repo, [entry("PR-002", "已立案"), entry("PR-001", "候选")]);
  writeWp(repo, "WP-001");
  commitAll(repo, "base");
  sh(repo, ["branch", "task"]);
  // main（对侧）：新开 PR-003＋关闭 PR-002＋新开 WP-002
  writeRegister(repo, [entry("PR-003", "候选"), entry("PR-002", "已关闭"), entry("PR-001", "候选")]);
  writeWp(repo, "WP-002");
  commitAll(repo, "main side");
  // task（本侧）：也新开 PR-003（撞号）＋把 PR-002 改成修复中（回退对侧已关闭）＋也新开 WP-002（撞号）
  sh(repo, ["checkout", "-q", "task"]);
  writeRegister(repo, [entry("PR-003", "候选"), entry("PR-002", "修复中"), entry("PR-001", "候选")]);
  writeWp(repo, "WP-002");
  commitAll(repo, "task side");
  return repo;
}

test("L3 真实 git：撞号＋closed-wins 分叉 → FAIL 退出 1 并逐条列出；对账重编后 → ok 退出 0；合并后重跑幂等 ok", () => {
  const repo = scenarioRepo();
  const bad = runCli(repo, ["--no-fetch", "--target", "main", "--head", "task"]);
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /撞号：PR-003/);
  assert.match(bad.out, /撞号：WP-002\.json/);
  assert.match(bad.out, /分叉：PR-002 .*以对侧（已关闭）为准/);
  assert.match(bad.out, /merge_reconcile=FAIL .*取号节期望 max=PR-003/);

  // 本侧对账：PR-003→PR-004 重编、WP-002→WP-003、PR-002 回到基线态（closed-wins 由合并采对侧）
  writeRegister(repo, [entry("PR-004", "候选"), entry("PR-002", "已立案"), entry("PR-001", "候选")]);
  fs.rmSync(path.join(repo, "docs/work-packages/WP-002.json"));
  writeWp(repo, "WP-003");
  commitAll(repo, "task renumbered");
  const good = runCli(repo, ["--no-fetch", "--target", "main", "--head", "task"]);
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /merge_reconcile=ok .*pr_new_theirs=\[PR-003\] pr_new_ours=\[PR-004\] wp_new_theirs=\[WP-002\.json\] wp_new_ours=\[WP-003\.json\] 取号节期望 max=PR-004/);

  // 合并后：目标与 HEAD 合一 → theirs 空 → ok（幂等）
  sh(repo, ["checkout", "-q", "main"]);
  // 登记簿同文件双改必冲突——按对账结论手工合成（PR-004＞PR-003＞PR-002 已关闭＞PR-001）后提交合并
  try { execFileSync("git", ["-C", repo, "merge", "--no-commit", "task"], { stdio: "ignore" }); } catch { /* 预期冲突 */ }
  writeRegister(repo, [entry("PR-004", "候选"), entry("PR-003", "候选"), entry("PR-002", "已关闭"), entry("PR-001", "候选")]);
  commitAll(repo, "merge task（登记簿已对账）");
  const merged = runCli(repo, ["--no-fetch", "--target", "main", "--head", "main"]);
  assert.equal(merged.code, 0, merged.out);
  assert.match(merged.out, /pr_new_theirs=\[\] pr_new_ours=\[\]/);
});

test("L3 缺省 fetch：无远端时对齐失败 → FAIL 退出 1（对账必须以远端为准，fail-closed）；显式 --no-fetch 才降级", () => {
  const repo = scenarioRepo();
  const noRemote = runCli(repo, ["--target", "main", "--head", "task"]);
  assert.equal(noRemote.code, 1);
  assert.match(noRemote.out, /对齐失败：git fetch origin 不可达/);
});

// PR-239：真实 Git 子进程回归；不以替身模拟读取成功或失败。
test("L3 PR-239：超过默认缓冲区的登记簿仍检出撞号和关闭状态分叉", (t) => {
  const repo = scenarioRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  for (const ref of ["main", "task"]) {
    sh(repo, ["checkout", "-q", ref]);
    fs.appendFileSync(path.join(repo, "docs/plans/problem-register.md"), "补充证据\n".repeat(100_000));
    commitAll(repo, "large register");
  }
  const result = runCli(repo, ["--no-fetch", "--target", "main", "--head", "task"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /撞号：PR-003/);
  assert.match(result.out, /分叉：PR-002 .*以对侧（已关闭）为准/);
  assert.match(result.out, /取号节期望 max=PR-003/);
});

function missingObjectRepo(t, kind) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "merge-reconcile-missing-object-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  sh(repo, ["init", "-q", "-b", "main"]);
  const tree = (input) => execFileSync("git", ["-C", repo, "mktree", "--missing"], { input, encoding: "utf8" }).trim();
  const missing = "f".repeat(40);
  const docs = kind === "register"
    ? tree(`040000 tree ${tree(`100644 blob ${missing}\tproblem-register.md\n`)}\tplans\n`)
    : tree(`040000 tree ${missing}\twork-packages\n`);
  const root = tree(`040000 tree ${docs}\tdocs\n`);
  const commit = sh(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit-tree", root, "-m", "missing object"]);
  sh(repo, ["update-ref", "refs/heads/main", commit]);
  return repo;
}

for (const kind of ["register", "work-packages"]) {
  test(`L3 PR-239：${kind} 在树中存在但 Git 对象不可读时明确阻断`, (t) => {
    const repo = missingObjectRepo(t, kind);
    const result = runCli(repo, ["--no-fetch", "--target", "main", "--head", "main", "--json"]);
    assert.equal(result.code, 1, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.ok, false);
    assert.match(report.violations.join("\n"), /读取失败/);
  });
}

test("L3 PR-239：历史提交确实没有登记簿和工作包目录时允许空集合", (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "merge-reconcile-empty-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  sh(repo, ["init", "-q", "-b", "main"]);
  sh(repo, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "empty base"]);
  const result = runCli(repo, ["--no-fetch", "--target", "main", "--head", "main", "--json"]);
  assert.equal(result.code, 0, result.out);
  const report = JSON.parse(result.out);
  assert.equal(report.ok, true);
  assert.equal(report.expectedMax, 0);
});

for (const kind of ["register-directory", "register-symlink", "work-packages-file"]) {
  test(`L3 PR-239：已存在的 ${kind} 类型错误不能视为空数据`, (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "merge-reconcile-wrong-type-"));
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
    sh(repo, ["init", "-q", "-b", "main"]);
    if (kind === "work-packages-file") {
      fs.mkdirSync(path.join(repo, "docs"), { recursive: true });
      fs.writeFileSync(path.join(repo, "docs/work-packages"), '{"package_id":"WP-007"}\n');
    } else {
      const register = path.join(repo, "docs/plans/problem-register.md");
      fs.mkdirSync(path.dirname(register), { recursive: true });
      if (kind === "register-symlink") fs.symlinkSync("missing-register-target", register);
      else {
        fs.mkdirSync(register);
        fs.writeFileSync(path.join(register, "entry.md"), entry("PR-007", "已关闭"));
      }
    }
    commitAll(repo, "wrong entry type");
    const result = runCli(repo, ["--no-fetch", "--target", "main", "--head", "main", "--json"]);
    assert.equal(result.code, 1, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.ok, false);
    assert.match(report.violations.join("\n"), /读取失败.*类型/);
  });
}
