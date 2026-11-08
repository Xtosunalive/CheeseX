// Component: First-Run-Test
// @responsible: WP-021 首次启动接线测试——①纯单元三态判定；③真实集成：真 vault-init（真 git init/真骨架/真 .env）
//   经注入提问函数走完建库；真进程 CLI 验非 TTY 退出 1 零落盘与已就位直通。
//   WP-039：建库中 vault-init 会续问「自动准备 Python？」——交互用例以提问队列作答（Python 问句一律答 n，
//   防真装）；零真实 uv/网络；ask 通道与 interactive 的透传有专断言。
// 隔离：每例独立 mkdtemp，仓根放在 <tmp>/repo，默认库路径即 <tmp>/cheese（不触 os.tmpdir() 根）；
//   .env.example 从本仓复制；git 身份以 GIT_AUTHOR_*/GIT_COMMITTER_* 注入＋GIT_CONFIG_GLOBAL 指空文件、
//   GIT_CONFIG_NOSYSTEM=1（不依赖本机 git 配置；与 vault-init.test 同款）。零真仓/真库落盘。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultVaultPath, resolveFirstRunState, runFirstRun } from "../first-run.mjs";
import { main as vaultInitMain } from "../vault-init.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "first-run.mjs");

// initRunner 注入：真 vault-init＋pythonRunner 恒 null（保证必问 Python 问句，确定性两问）＋uv 守卫（declined 不得触达）
function realInitRecorder(recorder) {
  return async (argv, options) => {
    if (recorder) recorder(options);
    return vaultInitMain(argv, { ...options, pythonRunner: () => null, uvRunner: () => { throw new Error("declined 不得调用 uv"); } });
  };
}

function makeRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "first-run-"));
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root);
  fs.copyFileSync(path.join(REPO_ROOT, ".env.example"), path.join(root, ".env.example"));
  const emptyGitConfig = path.join(tmp, "gitconfig-empty");
  fs.writeFileSync(emptyGitConfig, "");
  const env = {
    PATH: process.env.PATH,
    HOME: tmp,
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "first-run-test",
    GIT_AUTHOR_EMAIL: "fr@test.local",
    GIT_COMMITTER_NAME: "first-run-test",
    GIT_COMMITTER_EMAIL: "fr@test.local",
  };
  return { tmp, root, env, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

const quiet = { log() {}, error() {} };
function capture() {
  const lines = [];
  return { lines, logger: { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) } };
}
function listTree(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null;
}

test("三态判定：未配置 / 已就位 / 已配置但目录不存在；显式环境变量优先于 .env；~ 展开", () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const s0 = resolveFirstRunState({ rootDir: root, env, home: tmp });
    assert.equal(s0.kind, "unconfigured");
    assert.equal(s0.suggested, path.join(tmp, "cheese"));
    assert.equal(defaultVaultPath(root), path.join(tmp, "cheese"));

    const existing = path.join(tmp, "existing-vault");
    fs.mkdirSync(existing);
    assert.deepEqual(resolveFirstRunState({ rootDir: root, env: { ...env, VAULT_PATH: existing }, home: tmp }), { kind: "ready", vaultPath: existing });

    fs.writeFileSync(path.join(root, ".env"), `VAULT_PATH=${path.join(tmp, "gone")}\n`);
    const s2 = resolveFirstRunState({ rootDir: root, env, home: tmp });
    assert.equal(s2.kind, "missing-dir");
    assert.equal(s2.vaultPath, path.join(tmp, "gone"));

    // 显式环境变量优先于 .env（与 env-load.cjs 口径一致）
    assert.equal(resolveFirstRunState({ rootDir: root, env: { ...env, VAULT_PATH: existing }, home: tmp }).kind, "ready");
    // ~ 展开
    fs.mkdirSync(path.join(tmp, "home-vault"));
    assert.equal(resolveFirstRunState({ rootDir: root, env: { ...env, VAULT_PATH: "~/home-vault" }, home: tmp }).vaultPath, path.join(tmp, "home-vault"));
  } finally {
    cleanup();
  }
});

test("非交互终端：未配置 → 不建库、不写 .env、给出 vault:init 命令、退出码 1", async () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const { lines, logger } = capture();
    const before = listTree(tmp);
    const r = await runFirstRun({ rootDir: root, env, home: tmp, logger, interactive: false, prompt: async () => { throw new Error("非交互不得提问"); } });
    assert.equal(r.action, "abort");
    assert.equal(r.exitCode, 1);
    assert.deepEqual(listTree(tmp), before, "不得创建任何目录");
    assert.ok(!fs.existsSync(path.join(root, ".env")), "不得写 .env");
    assert.ok(lines.join("\n").includes("npm run vault:init -- --vault"), lines.join("\n"));
  } finally {
    cleanup();
  }
});

test("交互·未配置：回车取默认路径 → 真 vault-init 建出骨架＋.env；Python 问句同通道续问、透传可证；再次运行零提问直通", async () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const asked = [];
    let passedOptions = null;
    const promptFn = async (q) => { asked.push(q); return asked.length === 1 ? "" : "n"; };
    const r = await runFirstRun({ rootDir: root, env, home: tmp, logger: quiet, interactive: true, prompt: promptFn, initRunner: realInitRecorder((o) => { passedOptions = o; }) });
    assert.equal(r.action, "initialized", JSON.stringify(r));
    assert.equal(asked.length, 2, "恰好两问：位置＋自动准备 Python（pythonRunner=null 保证确定性）");
    assert.match(asked[1], /自动准备 Python/);
    assert.equal(passedOptions.prompt, promptFn, "ask 通道应透传给 vault-init");
    assert.equal(passedOptions.interactive, true, "interactive 应透传");
    const vault = path.join(tmp, "cheese");
    assert.equal(r.vaultPath, vault);
    assert.ok(fs.existsSync(path.join(vault, "知识库")), "受管根骨架应建出");
    assert.ok(fs.existsSync(path.join(vault, ".git")), "vault-init 缺省 git init");
    const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
    assert.match(envText, new RegExp(`^VAULT_PATH=${vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));

    const r2 = await runFirstRun({ rootDir: root, env, home: tmp, logger: quiet, interactive: true, prompt: async () => { throw new Error("已就位不得提问"); } });
    assert.deepEqual(r2, { action: "none", vaultPath: vault, exitCode: 0 });
  } finally {
    cleanup();
  }
});

test("交互·未配置：输入自定义路径 → 建在该路径", async () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const custom = path.join(tmp, "my-kb");
    let n = 0;
    const r = await runFirstRun({ rootDir: root, env, home: tmp, logger: quiet, interactive: true, prompt: async () => (++n === 1 ? custom : "n"), initRunner: realInitRecorder() });
    assert.equal(r.action, "initialized");
    assert.equal(r.vaultPath, custom);
    assert.ok(fs.existsSync(path.join(custom, "知识库")));
    assert.ok(!fs.existsSync(path.join(tmp, "cheese")), "默认路径不应被创建");
  } finally {
    cleanup();
  }
});

test("交互·目录不存在：答 n → 取消、零落盘、.env 不变、退出 1；答回车（缺省 Y）→ 在该路径建成", async () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const target = path.join(tmp, "configured-but-gone");
    const envText = `VAULT_PATH=${target}\n`;
    fs.writeFileSync(path.join(root, ".env"), envText);

    const { lines, logger } = capture();
    const rNo = await runFirstRun({ rootDir: root, env, home: tmp, logger, interactive: true, prompt: async () => "n" });
    assert.equal(rNo.action, "abort");
    assert.equal(rNo.exitCode, 1);
    assert.ok(!fs.existsSync(target), "拒绝后不得创建目录");
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), envText, ".env 不得被改");
    assert.ok(lines.join("\n").includes("npm run vault:init -- --vault"));

    const rYes = await runFirstRun({ rootDir: root, env, home: tmp, logger: quiet, interactive: true, prompt: async (q) => (q.includes("自动准备") ? "n" : ""), initRunner: realInitRecorder() });
    assert.equal(rYes.action, "initialized");
    assert.equal(rYes.vaultPath, target);
    assert.ok(fs.existsSync(path.join(target, "知识库")));
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), envText, ".env 已存在时 vault-init 不覆盖（Python 答 n 零改动）");
  } finally {
    cleanup();
  }
});

test("vault-init 非零退出 → abort 退出 1，不声称就位", async () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const { lines, logger } = capture();
    const r = await runFirstRun({ rootDir: root, env, home: tmp, logger, interactive: true, prompt: async () => "", initRunner: () => 1 });
    assert.equal(r.action, "abort");
    assert.equal(r.exitCode, 1);
    assert.ok(lines.join("\n").includes("退出码 1"));
  } finally {
    cleanup();
  }
});

test("真进程 CLI：stdin 为管道（非 TTY）→ 退出 1、零落盘、输出含命令指引", () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const before = listTree(tmp);
    const r = spawnSync(process.execPath, [CLI, "--root", root], { encoding: "utf8", input: "\n", env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepEqual(listTree(tmp), before);
    assert.ok((r.stdout + r.stderr).includes("npm run vault:init -- --vault"));
  } finally {
    cleanup();
  }
});

test("真进程 CLI：已就位 → 退出 0、零改动、打印已就位路径", () => {
  const { root, env, tmp, cleanup } = makeRoot();
  try {
    const vault = path.join(tmp, "ready-vault");
    fs.mkdirSync(vault);
    fs.writeFileSync(path.join(root, ".env"), `VAULT_PATH=${vault}\n`);
    const before = listTree(tmp);
    const r = spawnSync(process.execPath, [CLI, "--root", root], { encoding: "utf8", input: "", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(vault));
    assert.deepEqual(listTree(tmp), before);
  } finally {
    cleanup();
  }
});
