// vault-init 测试（WP-009）。分层标注：
//   L1 纯单元——参数解析 / 骨架计划 / 候选顺序 / 探测选择 / .env 渲染 / 路径解析（纯函数，零 IO）
//   L1' main() 进程内——注入 repoRoot/pythonRunner/logger，真实写临时目录；验证退出码分支与不覆盖语义
//      （不起子进程、不依赖真实解释器——属单元层的"组合逻辑"面，非集成）
//   L3 真实集成——以真实子进程跑 scripts/vault-init.mjs 建临时 Vault，再以真实子进程起 server/main.cjs，
//      经公开端点 /api/health 断言 readyState=ready（验证对象＝真实服务进程，非 mock）；
//      修订 2：--remote 指向本地裸仓，Vault 内真提交后 post-commit 钩子真推送，裸仓 main == Vault HEAD
//   L5 幂等——连续两遍：第二遍 created=0，目录树快照逐项一致（.git 内部不入快照——git 自身会动 index 时间戳，
//      且合同只约束 Vault 内容树）；既有文件逐字节不动；HEAD 哈希不变、钩子不覆盖
//   WP-039 Python 装配矩阵——L1 纯函数（updateEnvPython/probeUv/isYesAnswer）＋L1' 进程内 main() 注入
//      prompt/uvRunner/pythonRunner 走全决策象限（问/不问/flag/uv 有无/装后幂等），零真实 uv、零网络、零真实解释器；
//      uv 本体与真实安装行为由真实环境验收（合同验收第 1 条）
// 验证对象：scripts/vault-init.mjs（受管根骨架＝vault-content-data 域的根目录集）。
// git 身份：子进程用例以 GIT_AUTHOR_*/GIT_COMMITTER_* 四变量注入确定身份；身份缺席用例以 GIT_CONFIG_GLOBAL 指空文件
//   ＋GIT_CONFIG_NOSYSTEM=1 屏蔽本机全局/系统配置——不依赖跑测试那台机器有没有配 user.name。
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { HOOK_NAMES, hookTemplatePath, isInsideRepo, isYesAnswer, main, parseArgs, planSkeleton, probeGitIdentity, probePython, probeUv, pythonCandidates, PYTHON_PROVISION_PACKAGES, renderEnv, resolveVaultPath, updateEnvPython } from "../vault-init.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(rootDir, "scripts", "vault-init.mjs");
// uv pip install 期望串自单源派生——测试里硬写包名＝第四份清单，加包必咬三例（2026-11-06 补 ruamel.yaml 实证）
const PIP_INSTALL = `pip install ${PYTHON_PROVISION_PACKAGES.join(" ")}`;

const IDENTITY_ENV = { GIT_AUTHOR_NAME: "vault-init-test", GIT_AUTHOR_EMAIL: "vi@test.local", GIT_COMMITTER_NAME: "vault-init-test", GIT_COMMITTER_EMAIL: "vi@test.local" };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// 身份缺席环境：剔除四个身份变量 ＋ 全局配置指向空文件 ＋ 屏蔽系统配置
function noIdentityEnv(base = process.env) {
  const env = { ...base };
  for (const k of Object.keys(IDENTITY_ENV)) delete env[k];
  const empty = path.join(tmpDir("vi-gitcfg-"), "empty");
  fs.writeFileSync(empty, "");
  env.GIT_CONFIG_GLOBAL = empty;
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
}

function gitOut(cwd, args, env = process.env) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function headOf(cwd, env = process.env) {
  try { return gitOut(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"], env); } catch { return null; }
}

// 目录树快照：相对路径 → 目录标记或文件内容 sha256（.git 内部不进快照——git 自身会动 index 时间戳）
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) { out.set(rel, "<dir>"); walk(abs); }
      else out.set(rel, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
    }
  };
  walk(root);
  return out;
}

function runInit(args, env = { ...process.env, ...IDENTITY_ENV }) {
  const result = { code: 0, stdout: "" };
  try {
    result.stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    result.code = error.status;
    result.stdout = `${error.stdout || ""}${error.stderr || ""}`;
  }
  return result;
}

function summaryOf(stdout) {
  const line = stdout.trim().split("\n").findLast((l) => l.startsWith("vault-init: "));
  assert.ok(line, `缺 summary 行：\n${stdout}`);
  // k=v 或 k="v with spaces"
  return Object.fromEntries([...line.replace("vault-init: ", "").matchAll(/(\w+)=("([^"]*)"|\S+)/g)].map((m) => [m[1], m[3] ?? m[2]]));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

// ── L1 纯单元 ──

test("L1 parseArgs：必填/开关/未知参数；取值选项的值不得是选项名（红队反例 2）", () => {
  const parsed = parseArgs(["--vault", "/v", "--python", "/py", "--env-out", "/e", "--remote", "git@h:r.git", "--no-git", "--require-python", "--install-python", "--dry-run"]);
  assert.deepEqual(parsed, { vault: "/v", python: "/py", envOut: "/e", remote: "git@h:r.git", git: false, requirePython: true, installPython: true, dryRun: true, help: false });
  assert.equal(parseArgs([]).vault, null);
  assert.equal(parseArgs(["--vault", "/v"]).git, true);
  assert.equal(parseArgs(["--vault", "/v"]).remote, null);
  assert.throws(() => parseArgs(["--bogus"]), /未知参数：--bogus/);
  assert.throws(() => parseArgs(["--vault", "--no-git"]), /--vault 缺少值/);
  assert.throws(() => parseArgs(["--vault"]), /--vault 缺少值/);
  assert.throws(() => parseArgs(["--vault", "/v", "--python", "--dry-run"]), /--python 缺少值/);
  assert.throws(() => parseArgs(["--vault", "/v", "--remote"]), /--remote 缺少值/);
});

test("L1 probeGitIdentity：四个环境变量齐全即 env；否则读 config；都无 → ok=false（不接受 git 自动猜测）", () => {
  const cwd = tmpDir("vi-id-");
  const noId = noIdentityEnv({ PATH: process.env.PATH });
  assert.equal(probeGitIdentity({ cwd, env: noId }).ok, false);
  // 三个变量不算齐全
  assert.equal(probeGitIdentity({ cwd, env: { ...noId, GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "a" } }).ok, false);
  const viaEnv = probeGitIdentity({ cwd, env: { ...noId, ...IDENTITY_ENV } });
  assert.deepEqual([viaEnv.ok, viaEnv.source, viaEnv.name], [true, "env", "vault-init-test"]);
  // 配置来源：往 GIT_CONFIG_GLOBAL 指的文件里写身份
  fs.writeFileSync(noId.GIT_CONFIG_GLOBAL, "[user]\n\tname = cfg-user\n\temail = cfg@x\n");
  const viaCfg = probeGitIdentity({ cwd, env: noId });
  assert.deepEqual([viaCfg.ok, viaCfg.source, viaCfg.name, viaCfg.email], [true, "config", "cfg-user", "cfg@x"]);
});

test("L1 hookTemplatePath：模板存在、可执行、与 HOOK_NAMES 两钩子同源", () => {
  const template = hookTemplatePath(rootDir);
  assert.ok(fs.existsSync(template), template);
  assert.ok(fs.statSync(template).mode & 0o111, "模板须带可执行位");
  assert.match(fs.readFileSync(template, "utf8"), /backup-health\/backup-stalled\.json/);
  assert.deepEqual(HOOK_NAMES, ["post-commit", "post-merge"]);
});

test("L1 resolveVaultPath：~ 与 ~/x 展开为家目录（红队建议 4）；其余 path.resolve", () => {
  assert.equal(resolveVaultPath("~", "/home/u"), "/home/u");
  assert.equal(resolveVaultPath("~/kb", "/home/u"), path.resolve("/home/u", "kb"));
  assert.equal(resolveVaultPath("/abs/x", "/home/u"), "/abs/x");
  assert.equal(resolveVaultPath("rel/x", "/home/u"), path.resolve("rel/x"));
});

test("L1 isInsideRepo：仓根自身与仓内子目录为真；同级/上级/无关为假（红队建议 5）", () => {
  assert.equal(isInsideRepo("/r/repo", "/r/repo"), true);
  assert.equal(isInsideRepo("/r/repo/data/vault", "/r/repo"), true);
  assert.equal(isInsideRepo("/r/repo-sibling", "/r/repo"), false);
  assert.equal(isInsideRepo("/r", "/r/repo"), false);
  assert.equal(isInsideRepo("/elsewhere/vault", "/r/repo"), false);
});

test("L1 planSkeleton：从单源派生——受管文档六根＋文章四角色根，去重、顺序稳定", () => {
  const plan = planSkeleton();
  assert.deepEqual(plan, [
    "知识库/wiki/entities", "知识库/wiki/sources", "知识库/wiki/overview", "知识库/wiki/queries", "知识库/wiki/comparisons", "知识库/wiki/todo",
    "知识库/raw/drafts", "知识库/raw/precleaned", "知识库/wiki/articles", "知识库/raw/archive",
  ]);
  assert.equal(new Set(plan).size, plan.length);
  assert.ok(plan.every((rel) => rel.startsWith("知识库/") && !rel.includes("TheSchema")), "骨架不得含 TheSchema（SPEC-023 仓内主源）");
});

test("L1 pythonCandidates：--python ＞ PYTHON_PATH ＞ .venv ＞ PATH；缺项跳过", () => {
  const all = pythonCandidates({ explicit: "/x", env: { PYTHON_PATH: "/y" }, repoRoot: "/repo", platform: "darwin" });
  assert.deepEqual(all.map((c) => c.source), ["--python", "PYTHON_PATH", ".venv", "PATH"]);
  assert.equal(all[2].command, "/repo/.venv/bin/python");
  const none = pythonCandidates({ explicit: null, env: {}, repoRoot: "/repo", platform: "win32" });
  assert.deepEqual(none.map((c) => c.source), [".venv", "PATH"]);
  assert.equal(none[0].command, path.join("/repo", ".venv", "Scripts", "python.exe"));
});

test("L1 probePython：首个 import 通过者当选并带回绝对路径；全败 chosen=null", () => {
  const candidates = [{ source: "a", command: "a" }, { source: "b", command: "b" }, { source: "c", command: "c" }];
  const runner = (cmd) => (cmd === "b" ? "/abs/b" : cmd === "c" ? "/abs/c" : null);
  const { chosen, results } = probePython(candidates, runner);
  assert.equal(chosen.source, "b");
  assert.equal(chosen.resolved, "/abs/b");
  assert.deepEqual(results.map((r) => r.ok), [false, true, true]);
  assert.equal(probePython(candidates, () => null).chosen, null);
});

test("L1 renderEnv：VAULT_PATH 必改；PYTHON_PATH 仅在给定时改；模板缺 VAULT_PATH 则追加；CRLF 模板行尾原样（红队建议 6）", () => {
  const template = "# c\nVAULT_PATH=/old\n\nPYTHON_PATH=/oldpy\n# LANGFUSE_DISABLED=1\n";
  assert.equal(renderEnv(template, { vaultPath: "/new", pythonPath: "/newpy" }), "# c\nVAULT_PATH=/new\n\nPYTHON_PATH=/newpy\n# LANGFUSE_DISABLED=1\n");
  assert.equal(renderEnv(template, { vaultPath: "/new", pythonPath: null }), "# c\nVAULT_PATH=/new\n\nPYTHON_PATH=/oldpy\n# LANGFUSE_DISABLED=1\n");
  assert.equal(renderEnv("A=1\n", { vaultPath: "/v", pythonPath: null }), "A=1\nVAULT_PATH=/v\n");
  assert.equal(renderEnv("A=1\r\nVAULT_PATH=/old\r\nB=2\r\n", { vaultPath: "/v", pythonPath: null }), "A=1\r\nVAULT_PATH=/v\r\nB=2\r\n");
});

// ── main() 进程内（注入 repoRoot/runner，零真实解释器依赖；验证退出码分支与 .env 不覆盖）──

function fakeRepo() {
  const repo = tmpDir("vi-repo-");
  fs.copyFileSync(path.join(rootDir, ".env.example"), path.join(repo, ".env.example"));
  return repo;
}
const quiet = { log() {}, error() {} };

test("main：--require-python 且无解释器 → 退出 2；缺省模式无解释器 → 退出 0 且 .env 保留模板 PYTHON_PATH 行", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  assert.equal(await main(["--vault", vault, "--no-git", "--require-python"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null, interactive: false }), 2);
  fs.rmSync(path.join(repo, ".env"), { force: true });
  assert.equal(await main(["--vault", vault, "--no-git"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null, interactive: false }), 0);
  const env = fs.readFileSync(path.join(repo, ".env"), "utf8");
  assert.match(env, new RegExp(`^VAULT_PATH=${vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  const templatePython = fs.readFileSync(path.join(repo, ".env.example"), "utf8").match(/^PYTHON_PATH=(.*)$/m)[1];
  assert.match(env, new RegExp(`^PYTHON_PATH=${templatePython.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "无解释器时保留模板值");
});

test("main：.env 已存在 → 逐字节不覆盖（退出 0，env=present）", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  fs.writeFileSync(path.join(repo, ".env"), "VAULT_PATH=/somewhere/else\nPYTHON_PATH=/py\n");
  const before = fs.readFileSync(path.join(repo, ".env"), "utf8");
  const lines = [];
  assert.equal(await main(["--vault", vault, "--no-git"], { logger: { log: (l) => lines.push(l), error: (l) => lines.push(l) }, env: {}, repoRoot: repo, pythonRunner: () => "/abs/py" }), 0);
  assert.equal(fs.readFileSync(path.join(repo, ".env"), "utf8"), before);
  assert.ok(lines.some((l) => l.includes("不覆盖") && l.includes(`VAULT_PATH=${vault}`)), "应提示手改 VAULT_PATH");
});

test("main：参数错误/目标是文件/骨架路径或 .ledger 被同名文件挡/Vault 在仓内 → 退出 1，不清障（红队反例 1、建议 5）", async () => {
  const repo = fakeRepo();
  assert.equal(await main([], { logger: quiet, repoRoot: repo, pythonRunner: () => null }), 1);
  const file = path.join(tmpDir("vi-file-"), "f");
  fs.writeFileSync(file, "x");
  assert.equal(await main(["--vault", file, "--no-git"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null }), 1);
  const vault = tmpDir("vi-vault-");
  fs.mkdirSync(path.join(vault, "知识库", "wiki"), { recursive: true });
  fs.writeFileSync(path.join(vault, "知识库", "wiki", "entities"), "我是文件");
  assert.equal(await main(["--vault", vault, "--no-git"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null }), 1);
  assert.equal(fs.readFileSync(path.join(vault, "知识库", "wiki", "entities"), "utf8"), "我是文件");
  const vault2 = tmpDir("vi-vault-");
  fs.writeFileSync(path.join(vault2, ".ledger"), "我是文件");
  const lines = [];
  assert.equal(await main(["--vault", vault2, "--no-git"], { logger: { log: (l) => lines.push(l), error: (l) => lines.push(l) }, env: {}, repoRoot: repo, pythonRunner: () => null }), 1);
  assert.ok(lines.some((l) => l.includes(".ledger 已存在但不是目录")), lines.join("\n"));
  assert.equal(fs.readFileSync(path.join(vault2, ".ledger"), "utf8"), "我是文件");
  // Vault 指向仓根或仓内子目录：拒绝，且不在仓内建任何目录
  assert.equal(await main(["--vault", repo, "--no-git"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null }), 1);
  assert.equal(await main(["--vault", path.join(repo, "data", "my-vault"), "--no-git"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null }), 1);
  assert.equal(fs.existsSync(path.join(repo, "知识库")), false);
  assert.equal(fs.existsSync(path.join(repo, "data")), false);
});

test("main：--dry-run 零写入", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  assert.equal(await main(["--vault", vault, "--dry-run"], { logger: quiet, env: {}, repoRoot: repo, pythonRunner: () => null }), 0);
  assert.equal(fs.existsSync(vault), false);
  assert.equal(fs.existsSync(path.join(repo, ".env")), false);
});

// ── L3 真实集成 ＋ L5 幂等（真实子进程：init ×2 → 真实 server 进程 → 公开端点）──

test("L3/L5 真实子进程建库两遍幂等，既有文件不动，真实 server 起到 readyState=ready（路径含空格——红队反例 7）", { timeout: 90_000 }, async () => {
  const work = tmpDir("vi-int-");
  const vault = path.join(work, "my vault");
  const envOut = path.join(work, ".env");

  // 第一遍：全建（身份经环境变量注入）
  const first = runInit(["--vault", vault, "--env-out", envOut]);
  assert.equal(first.code, 0, first.stdout);
  const s1 = summaryOf(first.stdout);
  assert.equal(s1.vault, vault, "summary 的 vault 值须完整（含空格）");
  assert.equal(s1.created, "11");
  assert.equal(s1.present, "0");
  assert.equal(s1.git, "init");
  assert.equal(s1.commit, "created");
  assert.equal(s1.env, "created");
  for (const rel of [...planSkeleton(), ".ledger"]) assert.ok(fs.statSync(path.join(vault, rel)).isDirectory(), `缺 ${rel}`);
  assert.ok(fs.existsSync(path.join(vault, ".git")), "git init 应建 .git");
  // 修订 2（Master 裁定甲）：建库即落一笔空初始提交——HEAD 可解析、零文件、署名＝注入身份而非猜测
  const head1 = headOf(vault);
  assert.ok(head1, "初始提交后 HEAD 应可解析");
  assert.equal(gitOut(vault, ["show", "--stat", "--format=", "HEAD"]), "", "初始提交必须是空提交（零文件）");
  assert.equal(gitOut(vault, ["log", "-1", "--format=%an <%ae>"], { ...process.env, ...IDENTITY_ENV }), "vault-init-test <vi@test.local>");
  assert.match(fs.readFileSync(envOut, "utf8"), /^VAULT_PATH=.+$/m);
  // 骨架只建目录：Vault 内零内容文件（.git 不入快照）
  const files = [...snapshot(vault).entries()].filter(([, v]) => v !== "<dir>");
  assert.deepEqual(files, [], "init 不得写任何内容文件");

  // 用户内容入场后第二遍：既有文件逐字节不动，created=0，快照一致，HEAD 不变
  const userFile = path.join(vault, "知识库", "wiki", "entities", "user-entity.md");
  fs.writeFileSync(userFile, "---\ntitle: 用户实体\n---\n");
  const before = snapshot(vault);
  const mtimeBefore = fs.statSync(userFile).mtimeMs;
  const second = runInit(["--vault", vault, "--env-out", envOut]);
  assert.equal(second.code, 0, second.stdout);
  const s2 = summaryOf(second.stdout);
  assert.equal(s2.created, "0");
  assert.equal(s2.present, "11");
  assert.equal(s2.git, "present");
  assert.equal(s2.commit, "present");
  assert.equal(s2.env, "present");
  assert.deepEqual([...snapshot(vault).entries()], [...before.entries()], "第二遍目录树快照须与第一遍一致");
  assert.equal(fs.statSync(userFile).mtimeMs, mtimeBefore);
  assert.equal(headOf(vault), head1, "已有 HEAD 不得再提交");

  // 真实 server 进程：公开端点就绪（PR-101 未修前分类面 404 属已知边界，此处只断言 health）
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(rootDir, "server", "main.cjs")], {
    env: { ...process.env, VAULT_PATH: vault, KB_DATA_DIR: path.join(work, "data"), API_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });
  try {
    const deadline = Date.now() + 60_000;
    let health = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
        const body = await res.json();
        if (body?.data?.readyState === "ready") { health = body.data; break; }
      } catch { /* 未就绪，重试 */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(health, `server 未在 60s 内 ready：\n${serverLog.slice(-2000)}`);
    assert.deepEqual(health.ready, { dashboardRoutes: true, formalConsumer: true, schemaRuntime: true });
    assert.ok(!serverLog.includes("document-index-init-failed"), "骨架就位后不得再报受管文档源缺失");
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
});

test("L3 git 不在 PATH：友好报错退出 1，不裸吐栈（红队反例 3）；--no-git 时同环境可建成", () => {
  const work = tmpDir("vi-nogit-");
  const vault = path.join(work, "vault");
  const envOut = path.join(work, ".env");
  // 场景＝git 与解释器都不可达：PATH 置空之外还须剔除外部 PYTHON_PATH（绝对路径不依赖 PATH，继承即把 python=missing 断言打假）
  const env = { ...process.env, ...IDENTITY_ENV, PATH: "" };
  delete env.PYTHON_PATH;
  let code = 0;
  let out = "";
  try {
    execFileSync(process.execPath, [SCRIPT, "--vault", vault, "--env-out", envOut], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    code = error.status;
    out = `${error.stdout || ""}${error.stderr || ""}`;
  }
  assert.equal(code, 1, out);
  assert.match(out, /✗ vault-init: 找不到 git 可执行文件/);
  assert.doesNotMatch(out, /at .*execFileSync|spawnSync/, "不得裸吐栈");
  assert.equal(fs.existsSync(path.join(vault, ".git")), false);
  assert.equal(fs.existsSync(envOut), false, "git 失败在 .env 之前——不得留下半截 .env");

  const ok = execFileSync(process.execPath, [SCRIPT, "--vault", vault, "--env-out", envOut, "--no-git"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  const s = summaryOf(ok);
  assert.equal(s.git, "skipped");
  assert.equal(s.commit, "skipped");
  assert.equal(s.hooks, "skipped");
  // python 存在性不在此断言——探针候选 .venv 走仓根绝对路径，不随 PATH 置空失效（PR-106：装有 .venv 的机器上
  // python=missing 恒红）；解释器缺失语义由 main() 进程内注入 runner 的用例覆盖
  assert.ok(s.python === "missing" || path.isAbsolute(s.python), `python=${s.python}`);
  assert.equal(s.env, "created");
});

// ── 修订 2：身份缺席闭环 ＋ --remote/钩子（真实子进程、真实裸仓、真推送）──

test("L3 修订2 身份缺席：退出 0 不提交、summary commit=skipped-no-identity、打印配置命令；身份就位后重跑补提交（闭环）", () => {
  const work = tmpDir("vi-noid-");
  const vault = path.join(work, "vault");
  const envOut = path.join(work, ".env");

  const envNoId = noIdentityEnv();
  const r1 = runInit(["--vault", vault, "--env-out", envOut], envNoId);
  assert.equal(r1.code, 0, r1.stdout);
  const s1 = summaryOf(r1.stdout);
  assert.equal(s1.commit, "skipped-no-identity");
  assert.equal(headOf(vault, envNoId), null, "身份缺席时不得有 HEAD");
  assert.match(r1.stdout, /git config --global user\.name/);
  assert.match(r1.stdout, /git config --global user\.email/);

  // 身份就位（写入此前为空的 GIT_CONFIG_GLOBAL 文件）后重跑同一命令：补上初始提交
  fs.writeFileSync(envNoId.GIT_CONFIG_GLOBAL, "[user]\n\tname = late-user\n\temail = late@x\n");
  const r2 = runInit(["--vault", vault, "--env-out", envOut], envNoId);
  assert.equal(r2.code, 0, r2.stdout);
  assert.equal(summaryOf(r2.stdout).commit, "created");
  const head = headOf(vault, envNoId);
  assert.ok(head, "补提交后 HEAD 应可解析");
  assert.equal(gitOut(vault, ["log", "-1", "--format=%an <%ae>"], envNoId), "late-user <late@x>", "署名须来自配置而非主机名猜测");
});

test("L3 修订2 --remote 本地裸仓：origin＋上游＋钩子安装；Vault 内真提交后钩子自动推送（裸仓 main == Vault HEAD、无 stalled）；二次运行幂等、url 冲突拒绝", { timeout: 60_000 }, () => {
  const work = tmpDir("vi-remote-");
  const vault = path.join(work, "vault");
  const bare = path.join(work, "bare.git");
  const envOut = path.join(work, ".env");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { stdio: "ignore" });

  const r1 = runInit(["--vault", vault, "--env-out", envOut, "--remote", bare]);
  assert.equal(r1.code, 0, r1.stdout);
  const s1 = summaryOf(r1.stdout);
  assert.equal(s1.remote, "added");
  assert.equal(s1.hooks, "installed");
  assert.equal(gitOut(vault, ["remote", "get-url", "origin"]), bare);
  assert.equal(gitOut(vault, ["config", "branch.main.remote"]), "origin");
  assert.equal(gitOut(vault, ["config", "branch.main.merge"]), "refs/heads/main");
  const template = fs.readFileSync(hookTemplatePath(rootDir));
  for (const name of HOOK_NAMES) {
    const target = path.join(vault, ".git", "hooks", name);
    assert.ok(fs.existsSync(target), `缺 .git/hooks/${name}`);
    assert.deepEqual(fs.readFileSync(target), template, `${name} 须与模板逐字节一致`);
    assert.ok(fs.statSync(target).mode & 0o111, `${name} 须可执行`);
  }

  // 真提交触发 post-commit 钩子自动推送
  fs.writeFileSync(path.join(vault, "知识库", "wiki", "entities", "e.md"), "# e\n");
  const gitEnv = { ...process.env, ...IDENTITY_ENV };
  execFileSync("git", ["add", "-A"], { cwd: vault, stdio: "ignore" });
  execFileSync("git", ["commit", "-q", "-m", "user content"], { cwd: vault, env: gitEnv, stdio: "ignore" });
  assert.equal(gitOut(bare, ["rev-parse", "main"]), headOf(vault, gitEnv), "钩子应把 HEAD 推到裸仓 main");
  assert.equal(fs.existsSync(path.join(vault, ".git", "backup-health", "backup-stalled.json")), false, "推送成功不得有 stalled 告警");

  // 幂等：二次运行 remote=present hooks=present，钩子不被覆盖
  fs.writeFileSync(path.join(vault, ".git", "hooks", "post-commit"), "# user-customized\n");
  const r2 = runInit(["--vault", vault, "--env-out", envOut, "--remote", bare]);
  assert.equal(r2.code, 0, r2.stdout);
  const s2 = summaryOf(r2.stdout);
  assert.equal(s2.remote, "present");
  assert.equal(s2.hooks, "present");
  assert.equal(fs.readFileSync(path.join(vault, ".git", "hooks", "post-commit"), "utf8"), "# user-customized\n", "既有钩子不得覆盖");

  // url 冲突：退出 1，origin 与钩子不变
  const r3 = runInit(["--vault", vault, "--env-out", envOut, "--remote", path.join(work, "other.git")]);
  assert.equal(r3.code, 1);
  assert.match(r3.stdout, /origin 已是/);
  assert.equal(gitOut(vault, ["remote", "get-url", "origin"]), bare);
  assert.equal(fs.readFileSync(path.join(vault, ".git", "hooks", "post-commit"), "utf8"), "# user-customized\n");
});

// ── WP-039：Python 装配决策矩阵（L1 纯函数＋L1' 进程内注入；零真实 uv/零网络/零真实解释器）──

test("L1 updateEnvPython：有行原位改；无行末尾追加；CRLF 保真；注释行与其余行不动", () => {
  assert.equal(updateEnvPython("A=1\nPYTHON_PATH=/old\nB=2\n", "/new"), "A=1\nPYTHON_PATH=/new\nB=2\n");
  assert.equal(updateEnvPython("A=1\n\n", "/new"), "A=1\n\nPYTHON_PATH=/new\n", "末尾空行原样保留，新行插在空行之后、文件末之前");
  assert.equal(updateEnvPython("A=1\n", "/new"), "A=1\nPYTHON_PATH=/new\n");
  assert.equal(updateEnvPython("# PYTHON_PATH=旧文档注释\nVAULT_PATH=/v\n", "/new"), "# PYTHON_PATH=旧文档注释\nVAULT_PATH=/v\nPYTHON_PATH=/new\n", "注释行视为文档不动");
  assert.equal(updateEnvPython("A=1\r\nPYTHON_PATH=/old\r\n", "/new"), "A=1\r\nPYTHON_PATH=/new\r\n");
});

test("L1 probeUv：runner 正常→true；抛错→false", () => {
  assert.equal(probeUv(() => {}), true);
  assert.equal(probeUv(() => { throw new Error("ENOENT"); }), false);
});

test("L1 isYesAnswer：空串取默认；y/yes/是；n/no/否；其余非空取默认（与 first-run isYes 同款）", () => {
  assert.equal(isYesAnswer("", true), true);
  assert.equal(isYesAnswer("", false), false);
  for (const a of ["y", "Y", "yes", "是"]) assert.equal(isYesAnswer(a, false), true, a);
  for (const a of ["n", "N", "no", "否"]) assert.equal(isYesAnswer(a, true), false, a);
  assert.equal(isYesAnswer("随便", true), true);
  assert.equal(isYesAnswer(undefined, true), true);
});

// 装配矩阵公共件：注入式 uv（--version 探测步只放行不记账；venv 步真建 .venv/bin 目录、pip 步置就绪位）
function makeUvFixture(repo) {
  const calls = [];
  const state = { installed: false };
  const venvPython = path.join(repo, ".venv", "bin", "python");
  const uvRunner = (cmd, args) => {
    assert.equal(cmd, "uv");
    if (args[0] === "--version") return; // 可用性探测，不属装配动作
    calls.push(args.join(" "));
    if (args[0] === "venv") fs.mkdirSync(path.join(repo, ".venv", "bin"), { recursive: true });
    if (args[0] === "pip") state.installed = true;
  };
  const pythonRunner = (command) => (state.installed && command === venvPython ? "/abs/venv-python" : null);
  return { calls, state, uvRunner, pythonRunner };
}

function capturingLogger() {
  const lines = [];
  return { lines, logger: { log: (l) => lines.push(String(l)), error: (l) => lines.push(String(l)) } };
}

test("WP-039 装配：问→答Y＋uv 在 → uv venv＋uv pip install 两步、复探当选、既有 .env 仅追加 PYTHON_PATH 行", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  fs.writeFileSync(path.join(repo, ".env"), "VAULT_PATH=/somewhere/else\n# 注释行\n");
  const { calls, uvRunner, pythonRunner } = makeUvFixture(repo);
  const asked = [];
  const { lines, logger } = capturingLogger();
  const code = await main(["--vault", vault, "--no-git"], { logger, env: {}, repoRoot: repo, pythonRunner, uvRunner, prompt: async (q) => { asked.push(q); return ""; }, interactive: true });
  assert.equal(code, 0);
  assert.deepEqual(calls, ["venv", PIP_INSTALL], calls.join(" | "));
  assert.equal(asked.length, 1);
  assert.match(asked[0], /自动准备 Python/);
  assert.equal(fs.readFileSync(path.join(repo, ".env"), "utf8"), "VAULT_PATH=/somewhere/else\n# 注释行\nPYTHON_PATH=/abs/venv-python\n", "VAULT_PATH 与注释行逐字节不动，PYTHON_PATH 追加");
  const summary = lines.findLast((l) => l.startsWith("vault-init: "));
  assert.match(summary, /py_install=installed/);
  assert.match(summary, /env=updated-python/);
});

test("WP-039 装配：.venv 已在但缺 pyyaml → 只补 pip 不重建 venv；装成后重跑零安装零 .env 改动（幂等，py_install=skipped）", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  fs.mkdirSync(path.join(repo, ".venv", "bin"), { recursive: true });
  const { calls, uvRunner, pythonRunner } = makeUvFixture(repo);
  const asked = [];
  const prompt = async (q) => { asked.push(q); return ""; };
  const { lines, logger } = capturingLogger();
  assert.equal(await main(["--vault", vault, "--no-git"], { logger, env: {}, repoRoot: repo, pythonRunner, uvRunner, prompt, interactive: true }), 0);
  assert.deepEqual(calls, [PIP_INSTALL], "venv 已在不得重建");
  assert.equal(asked.length, 1);
  const envAfterFirst = fs.readFileSync(path.join(repo, ".env"), "utf8");
  assert.match(envAfterFirst, /^PYTHON_PATH=\/abs\/venv-python$/m);

  const { lines: lines2, logger: logger2 } = capturingLogger();
  assert.equal(await main(["--vault", vault, "--no-git"], { logger: logger2, env: {}, repoRoot: repo, pythonRunner, uvRunner, prompt, interactive: true }), 0);
  assert.equal(calls.length, 1, "第二遍零 uv 调用");
  assert.equal(asked.length, 1, "第二遍零提问（探测即中）");
  assert.equal(fs.readFileSync(path.join(repo, ".env"), "utf8"), envAfterFirst, ".env 逐字节不动");
  assert.match(lines2.findLast((l) => l.startsWith("vault-init: ")), /py_install=skipped/);
});

test("WP-039 装配：答 n → 不装不写、给手工指引、py_install=declined；uv 一步都不跑", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  fs.writeFileSync(path.join(repo, ".env"), "VAULT_PATH=/somewhere/else\n");
  const before = fs.readFileSync(path.join(repo, ".env"), "utf8");
  const { lines, logger } = capturingLogger();
  const code = await main(["--vault", vault, "--no-git"], { logger, env: {}, repoRoot: repo, pythonRunner: () => null, uvRunner: () => { throw new Error("declined 不得调用 uv"); }, prompt: async () => "n", interactive: true });
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(repo, ".env"), "utf8"), before);
  assert.match(lines.join("\n"), /pip install --user pyyaml/);
  assert.match(lines.findLast((l) => l.startsWith("vault-init: ")), /py_install=declined/);
});

test("WP-039 装配：非交互且无 flag → 不问不装给指引（退出 0；--require-python 退出 2）；prompt 不得被调", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  const asked = [];
  const prompt = async (q) => { asked.push(q); return ""; };
  const uvGuard = () => { throw new Error("guided 不得调用 uv"); };
  for (const extra of [[], ["--require-python"]]) {
    fs.rmSync(path.join(repo, ".env"), { force: true });
    const { lines, logger } = capturingLogger();
    const code = await main(["--vault", vault, "--no-git", ...extra], { logger, env: {}, repoRoot: repo, pythonRunner: () => null, uvRunner: uvGuard, prompt, interactive: false });
    assert.equal(code, extra.length ? 2 : 0);
    assert.equal(asked.length, 0);
    const envText = fs.readFileSync(path.join(repo, ".env"), "utf8");
    assert.match(envText, /^VAULT_PATH=.+$/m, "guided 路径仍应生成 .env（VAULT_PATH 填好）");
    assert.doesNotMatch(envText, /^PYTHON_PATH=\/abs\//, "未装配不得写入真实解释器路径（保留模板占位）");
    assert.match(lines.join("\n"), /pip install --user pyyaml/);
  }
});

test("WP-039 装配：--install-python＋非交互 → flag 即回答，不问直装（.env 缺席时生成并双值填齐）", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  const { calls, uvRunner, pythonRunner } = makeUvFixture(repo);
  const { lines, logger } = capturingLogger();
  const code = await main(["--vault", vault, "--no-git", "--install-python"], { logger, env: {}, repoRoot: repo, pythonRunner, uvRunner, prompt: async () => { throw new Error("flag 即回答，不得提问"); }, interactive: false });
  assert.equal(code, 0);
  assert.deepEqual(calls, ["venv", PIP_INSTALL]);
  const envText = fs.readFileSync(path.join(repo, ".env"), "utf8");
  assert.match(envText, new RegExp(`^VAULT_PATH=${vault.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(envText, /^PYTHON_PATH=\/abs\/venv-python$/m);
  assert.match(lines.findLast((l) => l.startsWith("vault-init: ")), /py_install=installed/);
  assert.match(lines.findLast((l) => l.startsWith("vault-init: ")), /env=created/);
});

test("WP-039 装配：答Y 但 uv 不在 PATH → 不安装，给装 uv 命令与 pip 回退，py_install=guided", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  const { lines, logger } = capturingLogger();
  const code = await main(["--vault", vault, "--no-git"], {
    logger, env: {}, repoRoot: repo, pythonRunner: () => null,
    uvRunner: (cmd, args) => { throw new Error(`不应执行 uv ${args.join(" ")}`); },
    prompt: async () => "", interactive: true,
  });
  assert.equal(code, 0);
  const out = lines.join("\n");
  assert.match(out, /astral\.sh\/uv\/install\.sh/);
  assert.match(out, /pip install --user pyyaml/);
  assert.match(lines.findLast((l) => l.startsWith("vault-init: ")), /py_install=guided/);
});

test("WP-039 装配：uv pip 步失败 → 友好报错不裸栈、py_install=failed、退出 0（--require-python 退出 2）", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  const uvRunner = (cmd, args, opts) => {
    if (args[0] === "--version") return;
    if (args[0] === "venv") fs.mkdirSync(path.join(repo, ".venv", "bin"), { recursive: true });
    if (args[0] === "pip") throw new Error("network down");
  };
  const { lines, logger } = capturingLogger();
  const code = await main(["--vault", vault, "--no-git"], { logger, env: {}, repoRoot: repo, pythonRunner: () => null, uvRunner, prompt: async () => "", interactive: true });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /Python 自动准备失败：network down/);
  assert.doesNotMatch(lines.join("\n"), /at .*execFileSync|spawnSync/, "不得裸吐栈");
  assert.match(lines.findLast((l) => l.startsWith("vault-init: ")), /py_install=failed/);

  const { lines: lines2, logger: logger2 } = capturingLogger();
  fs.rmSync(path.join(repo, ".env"), { force: true });
  const code2 = await main(["--vault", vault, "--no-git", "--require-python"], { logger: logger2, env: {}, repoRoot: repo, pythonRunner: () => null, uvRunner, prompt: async () => "", interactive: true });
  assert.equal(code2, 2, "装配失败后仍无解释器，--require-python 应退出 2");
});

test("WP-039 装配：dry-run 无解释器 → 不问不装零写入，打印装配计划行", async () => {
  const repo = fakeRepo();
  const vault = path.join(tmpDir("vi-vault-"), "v");
  const asked = [];
  const { lines, logger } = capturingLogger();
  const code = await main(["--vault", vault, "--dry-run"], { logger, env: {}, repoRoot: repo, pythonRunner: () => null, uvRunner: () => { throw new Error("dry-run 不得调用 uv"); }, prompt: async (q) => { asked.push(q); return ""; }, interactive: true });
  assert.equal(code, 0);
  assert.equal(asked.length, 0);
  assert.equal(fs.existsSync(vault), false);
  assert.equal(fs.existsSync(path.join(repo, ".env")), false);
  assert.match(lines.join("\n"), /\[dry-run\].*自动准备 Python/s);
});
