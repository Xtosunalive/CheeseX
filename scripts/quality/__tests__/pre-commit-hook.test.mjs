// @tests: .githooks/pre-commit——提交边界执法的集成红绿证（SPEC-012 数据域登记补建·TALOS 时点结构；
//   PR-066 类消改造后本测试同时守护注册表 commit 面派生执行）。
//   ① 暂存违规 SQLite 连接点 → 真 git commit 被拦（HEAD 不动、exit≠0）——注册表面（domain-registry）
//   ② 暂存面不触任何 commitScope → 零开销直过（commit 成功）
//   ③ 空暂存 → 直过
//   ④ 注册表 commit 面门禁红 → 拦（派生执行 fail-closed）
//   ⑤ 注册表 commit 面门禁绿 → 过（scope 匹配才跑，命令输出可见）
//   ⑥ 注册表不可读 → fail-closed 拦截
// 层级：门禁契约集成测试（临时真 git 仓＋core.hooksPath 指向夹具钩子）。
// 注：worktree 的 core.hooksPath 指向主仓 .githooks（共享配置），树内新钩子在合并前不自动生效——
//     本测试以临时仓证明「合并后主仓拾取即拦截」的集成链路。
"use strict";

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// 钩子与 kit 均为私有不入公开仓：任一缺席即明示跳过（vault=skip 同惯例），本地齐全时照常执法。
const PRIVATE_ABSENT = !fs.existsSync(path.join(REPO_ROOT, ".githooks/pre-commit"))
  || !fs.existsSync(path.join(REPO_ROOT, "node_modules/@cheeseh/discipline-kit/gates/check-domain-registry.mjs"));
const test = (name, fn) => nodeTest(name, {
  skip: PRIVATE_ABSENT ? ".githooks/pre-commit 或 discipline-kit 不在公开面——钩子集成测试缺席跳过" : false,
}, fn);

const FIXTURE_REGISTRY = {
  gates: [{
    id: "domain-registry", command: "npm run check:domain-registry", execution: "ci", status: "registered",
    surfaces: ["ci", "commit"], commitScope: ["server/", "scripts/", "contracts/domain-registry"],
  }],
};

function makeTree({ registry = FIXTURE_REGISTRY, reuseDomains, files = {}, venv = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "precommit-hook-"));
  for (const rel of ["scripts/quality/shared", "contracts", ".githooks", "server/services", "src"]) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  fs.copyFileSync(path.join(REPO_ROOT, ".githooks/pre-commit"), path.join(root, ".githooks/pre-commit"));
  fs.chmodSync(path.join(root, ".githooks/pre-commit"), 0o755);
  // WP-138：门禁本体迁 discipline-kit/gates/——夹具仍按旧脚本路径落位（钩子经 quality-gates command 调用），
  //   夹具自携 discipline.config.json（schema/common 走夹具 contracts 相对路径，faces 取场景所需子集）
  fs.copyFileSync(path.join(REPO_ROOT, "node_modules/@cheeseh/discipline-kit/gates/check-domain-registry.mjs"), path.join(root, "scripts/quality/check-domain-registry.mjs"));
  // W0.5（SPEC-025 C14）：钩子域测试路由抽为仓内纯函数模块——夹具须随钩子依赖同步，否则 fail-closed 误拦全部用例
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/quality/shared/domain-test-router.mjs"), path.join(root, "scripts/quality/shared/domain-test-router.mjs"));
  for (const f of ["data-domains.json", "data-domains.schema.json", "reuse-domains.schema.json"]) {
    const src = fs.existsSync(path.join(REPO_ROOT, "contracts", f))
      ? path.join(REPO_ROOT, "contracts", f)
      : path.join(REPO_ROOT, "node_modules/@cheeseh/discipline-kit", "schemas", f);
    fs.copyFileSync(src, path.join(root, "contracts", f));
  }
  fs.writeFileSync(path.join(root, "discipline.config.json"), JSON.stringify({
    tables: [
      { key: "reuse", file: "contracts/reuse-domains.json", schema: "contracts/reuse-domains.schema.json" },
      { key: "data", file: "contracts/data-domains.json", schema: "contracts/data-domains.schema.json" },
    ],
    common: "contracts/domain-table-common.json",
    faces: { anchors: false, data_five: true, sql_catalog: true, gate_pointer: false, test_claims: true },
    scan_dirs: ["server", "scripts"],
  }, null, 2));
  fs.writeFileSync(path.join(root, "contracts", "test-coverage-baseline.json"), JSON.stringify({ unclaimed: {} }, null, 2)); // 夹具空基线（面⑦）
  const realReuse = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "contracts", "reuse-domains.json"), "utf-8"));
  // WP-132：通用块单源——夹具随建 common 文件，表内不携带（回填即绊线）
  fs.copyFileSync(path.join(REPO_ROOT, "node_modules/@cheeseh/discipline-kit/schemas/domain-table-common.json"), path.join(root, "contracts", "domain-table-common.json"));
  fs.writeFileSync(path.join(root, "contracts", "reuse-domains.json"), JSON.stringify({
    $schema: "./reuse-domains.schema.json",
    registry_version: realReuse.registry_version,
    domains: reuseDomains || [{ id: "fixture-reuse", name: "夹具复用域", status: "candidate", register_entry: "docs/plans/problem-register.md#PR-059（夹具）" }],
  }, null, 2));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  // 环境适配（venv:"real"）：钩子 Python 桶硬编码取 .venv/bin/python（回退系统 python3）。本机系统
  // python3 无 pytest，绿路径用例须像软链 node_modules 一样软链真实 .venv，否则基线即假红。
  // 缺省不软链——假 .venv 用例（⑪）自行在夹具内建假解释器，二者不共用。
  if (venv === "real" && fs.existsSync(path.join(REPO_ROOT, ".venv/bin/python"))) {
    fs.symlinkSync(path.join(REPO_ROOT, ".venv"), path.join(root, ".venv"), "dir");
  }
  // 夹具注册表（真表指针在临时树内无文件可解析，会绊倒基线提交——先夹具化）
  fs.writeFileSync(path.join(root, "contracts", "data-domains.json"), JSON.stringify({
    $schema: "./data-domains.schema.json",
    registry_version: realReuse.registry_version,
    domains: [{
      id: "runtime-state-fixture", name: "夹具数据域", status: "gating",
      contract: "contracts/data-domains.schema.json",
      store: "data/runtime-state.db（KB_DATA_DIR 解析，.gitignore 收录）",
      store_location: "repo-data",
      data_owner: "夹具所有者",
      gate: "npm run check:domain-registry",
      register_entry: "docs/plans/problem-register.md#PR-059（夹具）",
      writers: ["scripts/quality/check-domain-registry.mjs:1（夹具网关——树内真实文件）"],
      write_protocol: "夹具协议", snapshot_policy: "夹具快照",
    }],
    status_values: realReuse.status_values,
    rules: realReuse.rules,
  }, null, 2));
  // PR-066 类消：钩子 commit 面读注册表派生执行——夹具给最小注册表与 npm scripts
  fs.writeFileSync(path.join(root, "contracts", "quality-gates.json"), JSON.stringify(registry, null, 2));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "precommit-fixture", private: true,
    scripts: {
      "check:domain-registry": "node scripts/quality/check-domain-registry.mjs",
      "fixture:pass": "node -e \"process.exit(0)\"",
      "fixture:fail": "node -e \"process.exit(1)\"",
    },
  }, null, 2));
  // W0-4：可选注入额外文件（⑧ 目录前缀 writers 夹具——失败测试与被认领目录下的样式）。
  // 注入须在 git init 前（域表 writers/tests 路径在基线时点已可校验存在），
  // 但要从未基线暂存面排除（否则基线提交自身触发域测试/门禁被拦）。
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root, env: cleanGitEnv() });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: root, env: cleanGitEnv() });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root, env: cleanGitEnv() });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, env: cleanGitEnv() });
  // 基线提交（contracts+scripts 已在）
  execFileSync("git", ["add", "-A"], { cwd: root, env: cleanGitEnv() });
  if (Object.keys(files).length > 0) {
    execFileSync("git", ["reset", "-q", "--", ...Object.keys(files)], { cwd: root, env: cleanGitEnv() });
  }
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root, env: cleanGitEnv() });
  return root;
}

function git(root, args) {
  // 防御性清洗 GIT_*：本测试可能在钩子进程内被域测试机制拉起（gate-governance 域认领），
  // 继承 GIT_DIR/GIT_INDEX_FILE 会把临时仓的 git 操作打到外层仓（PR-066 批实测）。
  return spawnSync("git", args, { cwd: root, encoding: "utf-8", env: cleanGitEnv() });
}

function cleanGitEnv() {
  const e = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY"]) delete e[k];
  return e;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("① 暂存违规连接点 → 真 git commit 被拦（HEAD 不动）——注册表面 domain-registry", () => {
  const root = makeTree();
  try {
    const headBefore = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    fs.writeFileSync(path.join(root, "server/services/stray.cjs"),
      'const { openPersistenceDb } = require("../../shared/persistence/sqlite-adapter.cjs");\nmodule.exports = { db: openPersistenceDb({ path: "x.db" }) };\n');
    git(root, ["add", "server/services/stray.cjs"]);
    const commit = git(root, ["commit", "-m", "should be blocked"]);
    assert.notEqual(commit.status, 0, "违规提交必须被 pre-commit 拦截");
    assert.match(`${commit.stdout}${commit.stderr}`, /唯一实现被绕过|pre-commit/, "拦截信息须可读");
    const headAfter = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(headAfter, headBefore, "HEAD 不得移动");
  } finally {
    cleanup(root);
  }
});

test("② 暂存面不触任何 commitScope → 直过提交成功（零开销路径）", () => {
  const root = makeTree();
  try {
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "note.md"), "纯文档改动\n");
    git(root, ["add", "docs/note.md"]);
    const commit = git(root, ["commit", "-m", "docs only"]);
    assert.equal(commit.status, 0, `文档面提交应直过：${commit.stderr}`);
    assert.match(git(root, ["log", "--oneline"]).stdout, /docs only/);
  } finally {
    cleanup(root);
  }
});

test("③ 空暂存（无变更）→ 钩子直过不误伤", () => {
  const root = makeTree();
  try {
    // 直接跑钩子（空索引）
    const hook = spawnSync("sh", [path.join(root, ".githooks/pre-commit")], { cwd: root, encoding: "utf-8", env: cleanGitEnv() });
    assert.equal(hook.status, 0, `空暂存应直过：${hook.stderr}`);
  } finally {
    cleanup(root);
  }
});

test("④ 注册表 commit 面门禁红 → 拦（派生执行 fail-closed，PR-066）", () => {
  const root = makeTree({ registry: {
    gates: [{
      id: "fixture-src-gate", command: "npm run fixture:fail", execution: "ci", status: "registered",
      surfaces: ["commit"], commitScope: ["src/"],
    }],
  } });
  try {
    const headBefore = git(root, ["rev-parse", "HEAD"]).stdout.trim();
    fs.writeFileSync(path.join(root, "src", "widget.tsx"), "export const w = 1;\n");
    git(root, ["add", "src/widget.tsx"]);
    const commit = git(root, ["commit", "-m", "src change with red gate"]);
    assert.notEqual(commit.status, 0, "src 面提交在注册表门禁红时必须被拦（旧钩子「前端留给 CI」豁免已退役）");
    assert.match(`${commit.stdout}${commit.stderr}`, /fixture:fail|fail-closed/, "拦截信息须点名红的门禁命令");
    assert.equal(git(root, ["rev-parse", "HEAD"]).stdout.trim(), headBefore, "HEAD 不得移动");
  } finally {
    cleanup(root);
  }
});

test("⑤ 注册表 commit 面门禁绿 → 过（scope 匹配才跑，输出可见）", () => {
  const root = makeTree({ registry: {
    gates: [{
      id: "fixture-src-gate", command: "npm run fixture:pass", execution: "ci", status: "registered",
      surfaces: ["commit"], commitScope: ["src/"],
    }],
  } });
  try {
    fs.writeFileSync(path.join(root, "src", "widget.tsx"), "export const w = 1;\n");
    git(root, ["add", "src/widget.tsx"]);
    const commit = git(root, ["commit", "-m", "src change with green gate"]);
    assert.equal(commit.status, 0, `src 面提交在门禁绿时应过：${commit.stderr}`);
    assert.match(`${commit.stdout}${commit.stderr}`, /fixture:pass/, "派生执行的命令须在钩子输出可见");
  } finally {
    cleanup(root);
  }
});

test("⑥ 注册表不可读 → fail-closed 拦截（事实源读不了=无法判定最小充分检查）", () => {
  const root = makeTree();
  try {
    fs.writeFileSync(path.join(root, "contracts", "quality-gates.json"), "{ broken json");
    fs.writeFileSync(path.join(root, "src", "widget.tsx"), "export const w = 1;\n");
    git(root, ["add", "src/widget.tsx"]);
    const hook = spawnSync("sh", [path.join(root, ".githooks/pre-commit")], { cwd: root, encoding: "utf-8", env: cleanGitEnv() });
    assert.notEqual(hook.status, 0, "注册表不可解析时必须 fail-closed");
    assert.match(hook.stderr, /fail-closed|不可读|不可解析/, "拦截信息须说明注册表读取失败");
  } finally {
    cleanup(root);
  }
});

test("⑦ 域测试调用必须串行（--test-concurrency=1 在册性——并行夹具互踩毒源码，2026-10-15 实证）", () => {
  const hook = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".githooks", "pre-commit"), "utf-8");
  assert.match(hook, /node --test --test-concurrency=1 \$touched_tests/, "钩子域测试调用必须带 --test-concurrency=1（反例夹具共享探测文件，并行互踩）");
});

test("⑧ writers 目录前缀命中：暂存 src/styles/ 触发域测试（W0-4 theme 域认领 src/styles/）", () => {
  const failing = "scripts/quality/__tests__/fixture-writers-fail.test.mjs";
  const root = makeTree({
    reuseDomains: [{ id: "fixture-reuse", name: "夹具复用域", status: "candidate", register_entry: "docs/plans/problem-register.md#PR-059（夹具）", writers: ["src/styles/"], tests: [failing] }],
    files: {
      [failing]: "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('触达即拦', () => { assert.fail('域测试必须被触发'); });\n",
      "src/styles/x.css": ".x { color: red; }\n",
    },
  });
  try {
    execFileSync("git", ["add", "src/styles/x.css"], { cwd: root, env: cleanGitEnv() });
    const r = git(root, ["commit", "-qm", "w04"]);
    assert.notEqual(r.status, 0, "暂存 src/styles/ 应触发域测试（目录前缀 writers）而被拦");
    assert.match(`${r.stderr}${r.stdout}`, /域测试红/);
  } finally {
    cleanup(root);
  }
});

test("⑨ W0.5（SPEC-025 C14）：域表登记 .py 测试被真实路由执行——失败即拦（此前仅 cjs|mjs，py 登记=假注册）", () => {
  const pyFail = "scripts/vault-py/fx/tests/test_fx.py";
  const root = makeTree({
    reuseDomains: [{ id: "fixture-py", name: "夹具 Python 域", status: "candidate", register_entry: "docs/plans/problem-register.md#PR-059（夹具）", writers: ["scripts/vault-py/fx/"], tests: [pyFail] }],
    files: {
      [pyFail]: "def test_must_be_routed():\n    assert False, '域 .py 测试必须被路由执行'\n",
      "scripts/vault-py/fx/mod.py": "X = 1\n",
    },
  });
  try {
    execFileSync("git", ["add", "scripts/vault-py/fx/mod.py"], { cwd: root, env: cleanGitEnv() });
    const r = git(root, ["commit", "-qm", "w05-py"]);
    assert.notEqual(r.status, 0, "暂存触及 Python 域应路由执行 .py 测试而被拦");
    assert.match(`${r.stderr}${r.stdout}`, /Python 域测试红|Python 测试/, "拦截信息须标明 Python 桶");
  } finally {
    cleanup(root);
  }
});

test("⑩ W0.5：Python 桶通过则放行（绿路径不误伤）", () => {
  const pyOk = "scripts/vault-py/ok/tests/test_ok.py";
  const root = makeTree({
    venv: "real",
    reuseDomains: [{ id: "fixture-py-ok", name: "夹具 Python 域绿", status: "candidate", register_entry: "docs/plans/problem-register.md#PR-059（夹具）", writers: ["scripts/vault-py/ok/"], tests: [pyOk] }],
    files: { [pyOk]: "def test_ok():\n    assert True\n", "scripts/vault-py/ok/mod.py": "Y = 2\n" },
  });
  try {
    execFileSync("git", ["add", "scripts/vault-py/ok/mod.py"], { cwd: root, env: cleanGitEnv() });
    const r = git(root, ["commit", "-qm", "w05-py-ok"]);
    assert.equal(r.status, 0, `Python 测试通过应放行: ${r.stderr}${r.stdout}`);
    assert.match(`${r.stderr}${r.stdout}`, /Python 测试/, "须有 Python 桶执行输出（证明真跑了而非跳过）");
  } finally {
    cleanup(root);
  }
});

test("⑪ W0.5：pytest 不可用 → fail-closed 拦截并给安装引导（路由到了却跑不了＝假绿，宁拦勿漏）", () => {
  const pyT = "scripts/vault-py/np/tests/test_np.py";
  const root = makeTree({
    reuseDomains: [{ id: "fixture-py-nopytest", name: "夹具无 pytest", status: "candidate", register_entry: "docs/plans/problem-register.md#PR-059（夹具）", writers: ["scripts/vault-py/np/"], tests: [pyT] }],
    files: { [pyT]: "def test_z():\n    assert True\n", "scripts/vault-py/np/mod.py": "Z = 3\n" },
  });
  try {
    // 夹具 .venv/bin/python＝假解释器（import pytest 必败）——钩子优先取 .venv，模拟 pytest 缺失环境
    fs.mkdirSync(path.join(root, ".venv/bin"), { recursive: true });
    fs.writeFileSync(path.join(root, ".venv/bin/python"), "#!/bin/sh\nexit 1\n");
    fs.chmodSync(path.join(root, ".venv/bin/python"), 0o755);
    execFileSync("git", ["add", "scripts/vault-py/np/mod.py"], { cwd: root, env: cleanGitEnv() });
    const r = git(root, ["commit", "-qm", "w05-nopytest"]);
    assert.notEqual(r.status, 0, "pytest 不可用必须拦截（不得静默跳过 Python 桶）");
    assert.match(`${r.stderr}${r.stdout}`, /pytest 不可用.*fail-closed/, "拦截信息须说明 pytest 不可用");
    assert.match(`${r.stderr}${r.stdout}`, /环境启动说明/, "须给安装引导");
  } finally {
    cleanup(root);
  }
});
