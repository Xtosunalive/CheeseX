#!/usr/bin/env node
// vault-init.mjs — 新用户建库入口（WP-009）：一条命令把任意目录（空目录或已有 Obsidian 库）补成
// cheeseh 可启动的 Vault。
//
// @responsible: 只做四件诚实的事——①受管根骨架（空目录）②git：可选 git init＋一笔空初始提交（`--allow-empty`，
//   不写内容文件；WP-009 修订 2，Master 2026-10-26 裁定甲——发布链 approval-state-machine-assembly.cjs 以
//   `git rev-parse HEAD` 做 sourceCommit 锚点，零提交库上首次发布即抛错；git 身份缺席时不提交、打印配置命令、
//   重跑补齐）＋可选 `--remote <url>`（配 origin 与 main 上游追踪，不推送；有 origin 即复制安装
//   .git/hooks/{post-commit,post-merge} 备份钩子，模板单源 scripts/vault-assets/hooks/post-commit）
//   ③仓根 .env（仅缺席时从 .env.example 生成；WP-039：刚自动装成解释器时窄更新 PYTHON_PATH 一行）
//   ④Python 解释器探测；探测缺席时问一句即自动准备（WP-039：uv 在 PATH→uv venv＋uv pip install
//   装配清单〔单源 PYTHON_PROVISION_PACKAGES，本文件不另抄包名；WP-042 立单源，
//   2026-11-06 补 ruamel.yaml——human_edit_guard 的 YAML 依赖，曾只活在 promote 运行期而未入声明面〕，
//   装完复探并写 .env；非交互且无 --install-python 不装不问，只给手工指引；装 uv 本体永远由人执行）。
//   不写任何内容文件、不往 Vault 写 TheSchema（SPEC-023：仓内主源，Vault 侧副本存在即被 resolver 优先＝第二
//   事实源）、不造发布快照（发布是管线产物；首次发布前正式消费面为定义过的空态——见 SPEC-029/WP-014）、
//   不装 uv 本体、不改全局 git 配置、不执行 push。幂等：二次运行零改动（不重复提交、不覆盖既有钩子、
//   解释器已就位后不再触碰 .env）。
// @inputs: --vault <路径>（必填）[--python <解释器>] [--env-out <路径>（缺省仓根 .env）] [--remote <url>] [--no-git]
//   [--require-python] [--install-python] [--dry-run]
// @outputs: Vault 侧空目录骨架＋可选 .git（含空初始提交／origin／hooks）；.env（缺席生成/刚装成时窄更新）；
//   仓根 .venv（仅自动装配时，uv 产物）；stdout 清单＋末行 summary（机器可读 k=v：created/present/git/commit/
//   remote/hooks/env/py_install/node_deps/python/vault）
// @context: 骨架清单从单源派生，不另抄路径表——受管文档根＝document-source-scanner.cjs SOURCE_ROOTS；
//   文章四角色根＝article-lifecycle-paths.cjs 常量（源于 contracts/article-lifecycle.json）；
//   .ledger＝vault-paths.cjs ensureLedgerDir。Python 解释器语义同 server/shared/python-path.cjs
//   （PYTHON_PATH 须可 import yaml），本命令的装配（uv venv＋uv pip install）与 docs/环境启动说明.md 路线 A
//   同一命令面，不另立运行时回退。
// 退出码：0=建成/已就位（含缺省模式下无可用解释器、git 身份缺席未提交、自动准备失败/被拒/未引导）；1=参数错误或
//   目标路径冲突/写入失败/origin 与 --remote 冲突；2=--require-python 且（含装配后仍）无可用解释器。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { SOURCE_ROOTS } = require("../server/services/projection/document-source-scanner.cjs");
const lifecycle = require("../server/shared/article-lifecycle-paths.cjs");
const { ensureLedgerDir } = require("../server/vault-paths.cjs");

// Vault 侧备份钩子单源模板（post-commit 与 post-merge 同一脚本）；安装＝逐字节复制到 Vault .git/hooks/
export const HOOK_TEMPLATE = path.join(REPO_ROOT, "scripts", "vault-assets", "hooks", "post-commit");
export const HOOK_NAMES = ["post-commit", "post-merge"];
const INITIAL_COMMIT_MESSAGE = "vault-init: 初始空提交（发布链 sourceCommit 锚点）";

// ── Node 依赖装配（Master 2026-11-04 方向：一键装配双半边都自动——Python 已自动，Node 补齐）──
// 漂移判据：仅对 package.json 直接依赖逐名比对「声明锁版本（package-lock.json）vs 实装版本（node_modules/.package-lock.json）」——
// 不比全量 packages（可选平台绑定会假阳性）；.package-lock.json 缺席＝missing（新克隆），版本名缺失或不等＝drifted。
const NODE_DEPS_HINT = "  node 依赖自动装配失败——手工执行：npm ci --no-audit --no-fund（或 npm install）。";

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function probeNodeDeps(repoRoot) {
  const lock = readJsonSafe(path.join(repoRoot, "package-lock.json"));
  const pkg = readJsonSafe(path.join(repoRoot, "package.json"));
  if (!lock || !pkg) return "missing";
  const installed = readJsonSafe(path.join(repoRoot, "node_modules", ".package-lock.json"));
  if (!installed || !installed.packages) return "missing";
  const direct = pkg.dependencies || {};
  const problems = [];
  for (const name of Object.keys(direct)) {
    const declared = lock.packages && lock.packages[`node_modules/${name}`];
    const actual = installed.packages[`node_modules/${name}`];
    if (!declared || !actual || declared.version !== actual.version) problems.push(name);
  }
  return problems.length ? `drifted:${problems.join(",")}` : "fresh";
}

function ensureNodeDeps({ repoRoot, logger, dry, npmRunner }) {
  const state = probeNodeDeps(repoRoot);
  if (state === "fresh") return "skipped-fresh";
  if (state === "missing") logger.log("  node 依赖：node_modules 缺席——npm ci 自动装配中…");
  else logger.log(`  node 依赖：与 lockfile 漂移（${state}）——npm ci 自动重装中…`);
  if (dry) {
    logger.log("  [dry-run] 正式运行将自动执行 npm ci --no-audit --no-fund");
    return "guided";
  }
  try {
    npmRunner(repoRoot);
    const re = probeNodeDeps(repoRoot);
    if (re === "fresh") {
      logger.log("  node 依赖 → npm ci 完成（直接依赖与 lockfile 逐名一致）");
      return "installed";
    }
    logger.error(`  ! 装完复探仍漂移（意外：${re}）——按下面指引排查后重跑本命令：\n${NODE_DEPS_HINT}`);
    return "failed";
  } catch (error) {
    logger.error(`✗ vault-init: Node 依赖自动装配失败：${error && error.message ? error.message : String(error)}\n${NODE_DEPS_HINT}`);
    return "failed";
  }
}


function defaultNpmRunner(repoRoot) {
  const r = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`npm ci 退出码 ${r.status}`);
}

const USAGE = `用法：npm run vault:init -- --vault <路径> [--python <解释器>] [--env-out <路径>] [--remote <url>] [--no-git] [--require-python] [--install-python] [--dry-run]

  --vault <路径>       必填。空目录、不存在的目录或已有 Obsidian 库均可；只补缺失目录，不动既有文件。
  --python <解释器>    指定带 PyYAML 的解释器；缺省按 PYTHON_PATH → <仓根>/.venv → PATH python3 顺序探测。
  --env-out <路径>    .env 落点，缺省 <仓根>/.env；已存在时不覆盖（仅「本运行刚装成解释器」时更新 PYTHON_PATH 一行）。
  --remote <url>       给 Vault 配 origin（已存在且相同则不动，不同则报错不覆盖）并设 main 上游追踪；不推送。
                       有 origin 时安装 .git/hooks/post-commit 与 post-merge 备份钩子（提交后自动 push）。
  --no-git             不在 Vault 内 git init（也不提交、不配 remote、不装钩子）。
  --require-python     探测不到可用解释器时以退出码 2 失败（CI/脚本化场景）。
  --install-python     探测不到解释器时不问直接自动准备（uv venv＋uv pip install pyyaml pytest jsonschema）；
                       缺省交互终端问一句 [Y/n]，非交互终端不装不问、只给手工指引。
  --dry-run            只打印计划，不写任何东西、不提问。`;

export function parseArgs(argv) {
  const out = { vault: null, python: null, envOut: null, remote: null, git: true, requirePython: false, installPython: false, dryRun: false, help: false };
  // 取值选项的值不得是另一个选项名——否则 `--vault --no-git` 会在 cwd 建出名叫 --no-git 的整套骨架（红队反例 2）
  const value = (name, i) => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} 缺少值`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--vault") out.vault = value(arg, ++i);
    else if (arg === "--python") out.python = value(arg, ++i);
    else if (arg === "--env-out") out.envOut = value(arg, ++i);
    else if (arg === "--remote") out.remote = value(arg, ++i);
    else if (arg === "--no-git") out.git = false;
    else if (arg === "--require-python") out.requirePython = true;
    else if (arg === "--install-python") out.installPython = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return out;
}

// `~`/`~/x` 展开为家目录（shell 只在裸参数展开，经 npm run -- 透传的引号参数到这里仍是字面 ~）；其余交给 path.resolve。
export function resolveVaultPath(input, home = os.homedir()) {
  if (input === "~") return home;
  if (input.startsWith("~/")) return path.resolve(home, input.slice(2));
  return path.resolve(input);
}

// Vault 不得落在本仓内（会把 知识库/ 骨架建进代码仓；仓根 data/ 等目录已有别的语义）
export function isInsideRepo(vaultPath, repoRoot) {
  const rel = path.relative(repoRoot, vaultPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// 骨架＝受管文档根（实体/来源/总览/查询/对比/待办）∪ 文章四角色根 ∪ .ledger。顺序稳定、去重，
// 相对 Vault 根的 posix 路径（与契约字面一致，便于测试断言与人读清单）。
export function planSkeleton() {
  const roots = [
    ...SOURCE_ROOTS.map((definition) => definition.relativePath),
    lifecycle.DRAFT_ROOT,
    lifecycle.WORKING_ROOT,
    lifecycle.FORMAL_ROOT,
    lifecycle.ARCHIVE_ROOT,
  ];
  return [...new Set(roots)];
}

export function pythonCandidates({ explicit, env = process.env, repoRoot = REPO_ROOT, platform = process.platform }) {
  const venv = platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  return [
    explicit ? { source: "--python", command: explicit } : null,
    env.PYTHON_PATH ? { source: "PYTHON_PATH", command: env.PYTHON_PATH } : null,
    { source: ".venv", command: venv },
    { source: "PATH", command: "python3" },
  ].filter(Boolean);
}

// 逐个候选跑 `-c "import sys, yaml; print(sys.executable)"`，首个通过即选中（resolved＝解释器自报的
// 绝对路径——.env 必须写绝对路径，裸 python3 会随 PATH 漂移，正是 .env.example 警告的故障形态）；
// 全部失败返回 chosen=null。runner 可注入（单测），返回绝对路径字符串或 null。
export function probePython(candidates, runner = defaultPythonRunner) {
  const results = [];
  let chosen = null;
  for (const candidate of candidates) {
    const resolved = runner(candidate.command);
    results.push({ ...candidate, ok: Boolean(resolved), resolved });
    if (resolved && !chosen) chosen = { ...candidate, resolved };
  }
  return { chosen, results };
}

function defaultPythonRunner(command) {
  try {
    const out = execFileSync(command, ["-c", "import sys, yaml; print(sys.executable)"], { stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 });
    const resolved = out.toString("utf8").trim();
    return resolved && path.isAbsolute(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

// 应答语义与 first-run.mjs isYes 同款：空串取默认，y/yes/是 为是，n/no/否 为否，其余非空按默认。
export function isYesAnswer(answer, defaultYes = true) {
  const a = String(answer ?? "").trim().toLowerCase();
  if (!a) return defaultYes;
  if (a === "n" || a === "no" || a === "否") return false;
  if (a === "y" || a === "yes" || a === "是") return true;
  return defaultYes;
}

// uv 探测/安装执行面（可注入：单测记录调用、绝不跑真 uv）。
function defaultUvRunner(command, args, options = {}) {
  execFileSync(command, args, { ...options, stdio: options.stdio ?? "ignore" });
}

// uv 可用性＝`uv --version` 跑得动（只查不装；装 uv 本体是系统级动作，永远由人执行——WP-039 non_goals）。
export function probeUv(runner = defaultUvRunner, env = process.env) {
  try {
    runner("uv", ["--version"], { env, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

// Python 自动装配包清单（单源——WP-042）：uv 安装参数与手工指引文案统一从这里拼。
// jsonschema 不得缺：pipeline 管线 extract_graph.py:73 顶层 import schema_loader，schema_loader.py:17
// 顶层 import jsonschema——缺它新库首次管线必炸（extract_graph.py exit=1；CI 曾单独补装同一依赖
// 6bce8b2a，本机 onboarding 链漏了同一根因）。
export const PYTHON_PROVISION_PACKAGES = ["pyyaml", "pytest", "jsonschema", "ruamel.yaml", "networkx"];

const PYTHON_MANUAL_HINT = `    手工准备（任选其一，仓根执行；装好重跑本命令即写入 .env）：
      uv venv && uv pip install ${PYTHON_PROVISION_PACKAGES.join(" ")}        # 之后 .venv/bin/python 即可用
      或：python3 -m pip install --user ${PYTHON_PROVISION_PACKAGES.join(" ")}
    不设的话服务能起，但校验/提升/投影三条链路会坏（校验一条静默假通过），管线首跑也会因缺依赖失败。`;

const UV_INSTALL_HINT = `  uv 不在 PATH——不替你装 uv（下载执行安装脚本属系统级动作）。两条路任选：
    a) 先装 uv 再重跑本命令：curl -LsSf https://astral.sh/uv/install.sh | sh
       （Windows: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"）
    b) 或不经 uv 直接准备：
${PYTHON_MANUAL_HINT}`;

// 装配动作（uv 路线，与 docs/环境启动说明.md 第二节路线 A 同一命令面）：.venv 缺席先 uv venv（已存在
// 不重建——避免 uv 对既有环境的覆盖歧义），再 uv pip install（uv 自动发现仓根 .venv）。runner 可注入。
function provisionPythonWithUv({ repoRoot, env, uvRunner }) {
  const venvBin = process.platform === "win32" ? path.join(".venv", "Scripts") : path.join(".venv", "bin");
  if (!fs.existsSync(path.join(repoRoot, venvBin))) uvRunner("uv", ["venv"], { cwd: repoRoot, env, stdio: "inherit" });
  uvRunner("uv", ["pip", "install", ...PYTHON_PROVISION_PACKAGES], { cwd: repoRoot, env, stdio: "inherit" });
}

// .env 模板两行改写：VAULT_PATH 必改；PYTHON_PATH 仅在探测到解释器时改，否则保留模板原行（并由调用方提示）。
// 行尾符按模板原样（CRLF 模板不被整体改写成 LF——"只改两行"对字节也成立）。
export function renderEnv(template, { vaultPath, pythonPath }) {
  const eol = template.includes("\r\n") ? "\r\n" : "\n";
  const lines = template.split(/\r?\n/);
  let sawVault = false;
  const rendered = lines.map((line) => {
    if (/^VAULT_PATH=/.test(line)) { sawVault = true; return `VAULT_PATH=${vaultPath}`; }
    if (pythonPath && /^PYTHON_PATH=/.test(line)) return `PYTHON_PATH=${pythonPath}`;
    return line;
  });
  if (!sawVault) {
    const insertAt = rendered.length && rendered[rendered.length - 1] === "" ? rendered.length - 1 : rendered.length;
    rendered.splice(insertAt, 0, `VAULT_PATH=${vaultPath}`);
  }
  return rendered.join(eol);
}

// 窄更新既有 .env（WP-039）：只动 PYTHON_PATH 一行（无则末尾追加），其余字节原样；VAULT_PATH 等行永不触碰。
// CRLF 保真同 renderEnv；被注释的 `# PYTHON_PATH=` 视为文档不动，另起一行追加生效值。纯函数（可单测）。
export function updateEnvPython(content, pythonPath) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let saw = false;
  const out = lines.map((line) => {
    if (/^PYTHON_PATH=/.test(line)) { saw = true; return `PYTHON_PATH=${pythonPath}`; }
    return line;
  });
  if (!saw) {
    const insertAt = out.length && out[out.length - 1] === "" ? out.length - 1 : out.length;
    out.splice(insertAt, 0, `PYTHON_PATH=${pythonPath}`);
  }
  return out.join(eol);
}

function readEnvValue(content, key) {
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

// git init -b main；git < 2.28 不支持 -b 时裸 init 后把 HEAD 指到 main。
// git 根本不在 PATH（ENOENT）不是"-b 不支持"，不得进 fallback 再炸一次——抛带原因的错误给调用方友好退出。
function gitInit(vaultPath, env) {
  const run = (args) => execFileSync("git", args, { cwd: vaultPath, env, stdio: "ignore" });
  try {
    run(["init", "-q", "-b", "main"]);
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error("找不到 git 可执行文件（不在 PATH）——装 git 或用 --no-git 跳过");
    run(["init", "-q"]);
    run(["symbolic-ref", "HEAD", "refs/heads/main"]);
  }
}

// 只读查询：任何失败（无 HEAD、无 origin、cwd 不存在、git 缺席）都归一为 null，调用方按"没有"处理。
function gitQuery(cwd, args, env) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

function gitRun(cwd, args, env) {
  execFileSync("git", args, { cwd, env, stdio: "ignore" });
}

// git 身份只认显式来源：user.name＋user.email 配置（任意层级）或 GIT_AUTHOR_*＋GIT_COMMITTER_* 四个环境变量。
// 不接受 git 按登录名＋主机名自动猜出的身份——新机器上把 "user@MacBook.local" 写进 Vault 历史是假署名；
// 宁可不提交并把配置命令摆到用户面前（提交时再以 -c user.useConfigOnly=true 封死自动猜测）。
export function probeGitIdentity({ cwd, env = process.env }) {
  const envKeys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  if (envKeys.every((k) => env[k] && String(env[k]).trim())) {
    return { ok: true, source: "env", name: env.GIT_AUTHOR_NAME, email: env.GIT_AUTHOR_EMAIL };
  }
  const name = gitQuery(cwd, ["config", "--get", "user.name"], env);
  const email = gitQuery(cwd, ["config", "--get", "user.email"], env);
  if (name && email) return { ok: true, source: "config", name, email };
  return { ok: false, source: null, name, email };
}

export function hookTemplatePath(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, "scripts", "vault-assets", "hooks", "post-commit");
}

// 钩子目录经 git 解析（尊重 core.hooksPath；worktree 形态下 .git 是指针文件）；查不到时退回 .git/hooks。
function hooksDir(vaultPath, env) {
  const rel = gitQuery(vaultPath, ["rev-parse", "--git-path", "hooks"], env);
  return rel ? path.resolve(vaultPath, rel) : path.join(vaultPath, ".git", "hooks");
}

const IDENTITY_HINT = `  ! git 身份缺席：未落初始提交（发布链以 HEAD 为 sourceCommit 锚点，缺它首次发布会失败）。配置后重跑本命令即补上：
      git config --global user.name "你的名字"
      git config --global user.email "you@example.com"
    （不想改全局配置：去掉 --global，在 Vault 目录内执行）`;

// prompt：async (question)=>answer 注入（first-run 透传同一 ask 通道）；缺省交互终端现建 readline。
// interactive：缺省按 stdin TTY；注入 prompt 的测试显式传 true/false 保证确定性。
export async function main(argv, { logger = console, env = process.env, repoRoot = REPO_ROOT, pythonRunner = defaultPythonRunner, gitEnv = process.env, prompt = null, interactive = Boolean(process.stdin.isTTY), uvRunner = defaultUvRunner, npmRunner = defaultNpmRunner } = {}) {
  let args;
  try { args = parseArgs(argv); }
  catch (error) { logger.error(`✗ vault-init: ${error.message}\n\n${USAGE}`); return 1; }
  if (args.help) { logger.log(USAGE); return 0; }
  if (!args.vault) { logger.error(`✗ vault-init: 缺少 --vault <路径>\n\n${USAGE}`); return 1; }

  const vaultPath = resolveVaultPath(args.vault);
  const dry = args.dryRun;
  const act = (label, fn) => { if (dry) logger.log(`  [dry-run] ${label}`); else fn(); };
  logger.log(`▸ vault-init → ${vaultPath}${dry ? "（dry-run：只打印计划）" : ""}`);

  if (isInsideRepo(vaultPath, repoRoot)) {
    logger.error(`✗ vault-init: ${vaultPath} 在本仓（${repoRoot}）内——Vault 必须是仓外目录，否则 知识库/ 骨架会建进代码仓`);
    return 1;
  }

  let created = 0;
  let present = 0;
  let gitState = "skipped";
  let commitState = "skipped";
  let remoteState = "skipped";
  let hooksState = "skipped";
  let identityMissing = false;
  // 写入步骤（建目录/git）里任何未预期的系统错误（悬空符号链接下 mkdir ENOENT、git 缺席…）都走同一出口：
  // 友好报错＋退出 1，不裸吐栈；已建部分留在原位（全是空目录，重跑即续）。
  try {
    // ── 0. 目标根 ──
    if (fs.existsSync(vaultPath) && !fs.statSync(vaultPath).isDirectory()) {
      logger.error(`✗ vault-init: ${vaultPath} 已存在且不是目录`);
      return 1;
    }
    if (!fs.existsSync(vaultPath)) act(`mkdir ${vaultPath}`, () => fs.mkdirSync(vaultPath, { recursive: true }));

    // ── 1. 受管根骨架（只建缺失目录；同名文件挡路即失败，不清障）──
    for (const rel of [...planSkeleton(), ".ledger"]) {
      const abs = path.join(vaultPath, ...rel.split("/"));
      if (fs.existsSync(abs)) {
        if (!fs.statSync(abs).isDirectory()) { logger.error(`✗ vault-init: ${rel} 已存在但不是目录，拒绝覆盖`); return 1; }
        present++;
        logger.log(`  = ${rel}`);
        continue;
      }
      created++;
      act(`mkdir -p ${rel}`, () => (rel === ".ledger" ? ensureLedgerDir(vaultPath) : fs.mkdirSync(abs, { recursive: true })));
      logger.log(`  + ${rel}`);
    }

    // ── 2. git（Vault 为 git 仓是既定前提：vault-io 账本随提交入库；发布制品住同级 .releases/（WP-023——业务资产非 git 元数据）；
    //    发布链拿 HEAD 当 sourceCommit 锚点——所以不止 init，还得有第一笔提交）──
    if (args.git) {
      const gitDirExisted = fs.existsSync(path.join(vaultPath, ".git"));
      if (gitDirExisted) { gitState = "present"; logger.log("  = .git"); }
      else {
        gitState = "init";
        act("git init -b main", () => gitInit(vaultPath, gitEnv));
        logger.log("  + .git（git init）");
      }
      // dry-run 且 .git 尚不存在：无从查询，按"全无"规划
      const canQuery = gitDirExisted || !dry;
      const probeCwd = fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory() ? vaultPath : os.homedir();
      const identity = probeGitIdentity({ cwd: probeCwd, env: gitEnv });

      // 2a. 空初始提交（已有 HEAD 不动；零提交的存量库也补上）
      const head = canQuery ? gitQuery(vaultPath, ["rev-parse", "--verify", "--quiet", "HEAD"], gitEnv) : null;
      if (head) { commitState = "present"; logger.log(`  = HEAD ${head.slice(0, 8)}`); }
      else if (!identity.ok) {
        commitState = "skipped-no-identity";
        identityMissing = true;
        logger.log("  ! 初始提交跳过：git 身份缺席（见下方提示）");
      } else {
        commitState = "created";
        act(`git commit --allow-empty（${identity.name} <${identity.email}>）`, () => gitRun(vaultPath, ["-c", "user.useConfigOnly=true", "commit", "-q", "--allow-empty", "-m", INITIAL_COMMIT_MESSAGE], gitEnv));
        logger.log(`  + 初始空提交（${identity.name} <${identity.email}>，身份来源 ${identity.source}）`);
      }

      // 2b. origin（只配不推；已有且不同即拒绝——不替用户换远端）
      const existingOrigin = canQuery ? gitQuery(vaultPath, ["remote", "get-url", "origin"], gitEnv) : null;
      if (args.remote) {
        if (existingOrigin && existingOrigin !== args.remote) {
          logger.error(`✗ vault-init: origin 已是 ${existingOrigin}，与 --remote ${args.remote} 不同——不覆盖。要换先执行：git -C "${vaultPath}" remote set-url origin <url>`);
          return 1;
        }
        if (existingOrigin) { remoteState = "present"; logger.log(`  = origin ${existingOrigin}`); }
        else {
          remoteState = "added";
          const branch = (canQuery && gitQuery(vaultPath, ["symbolic-ref", "--short", "HEAD"], gitEnv)) || "main";
          act(`git remote add origin ${args.remote}；branch.${branch}.{remote,merge} → origin/${branch}（不推送）`, () => {
            gitRun(vaultPath, ["remote", "add", "origin", args.remote], gitEnv);
            gitRun(vaultPath, ["config", `branch.${branch}.remote`, "origin"], gitEnv);
            gitRun(vaultPath, ["config", `branch.${branch}.merge`, `refs/heads/${branch}`], gitEnv);
          });
          logger.log(`  + origin ${args.remote}（${branch} 上游 → origin/${branch}；首次推送由你或钩子执行）`);
        }
      } else if (existingOrigin) { remoteState = "present"; logger.log(`  = origin ${existingOrigin}`); }
      else remoteState = "none";

      // 2c. 备份钩子（有 origin 才装——没有推送目标的钩子只会每次提交都写 stalled 告警）
      if (remoteState === "added" || remoteState === "present") {
        const dir = canQuery ? hooksDir(vaultPath, gitEnv) : path.join(vaultPath, ".git", "hooks");
        const template = hookTemplatePath(repoRoot);
        let installed = 0;
        for (const name of HOOK_NAMES) {
          const target = path.join(dir, name);
          if (fs.existsSync(target)) { logger.log(`  = .git/hooks/${name}（已存在，不覆盖）`); continue; }
          installed++;
          act(`安装 .git/hooks/${name} ← scripts/vault-assets/hooks/post-commit`, () => {
            fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(template, target);
            fs.chmodSync(target, 0o755);
          });
          logger.log(`  + .git/hooks/${name}（提交后自动 push；失败写 .git/backup-health/backup-stalled.json）`);
        }
        hooksState = installed > 0 ? "installed" : "present";
      } else {
        hooksState = "skipped-no-remote";
      }
    } else {
      logger.log("  - .git（--no-git：不 init、不提交、不配 origin、不装钩子）");
    }
  } catch (error) {
    logger.error(`✗ vault-init: ${error && error.message ? error.message : String(error)}`);
    return 1;
  }

  // ── 3. Python 探测；缺席时问一句即自动准备（uv 优先；非交互不装不问——WP-039）──
  const askUser = async (question) => {
    if (prompt) return prompt(question);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await new Promise((resolve) => rl.question(question, resolve)); }
    finally { rl.close(); }
  };
  let { chosen, results } = probePython(pythonCandidates({ explicit: args.python, env, repoRoot }), pythonRunner);
  for (const r of results) logger.log(`  python ${r.ok ? "✓" : "✗"} ${r.source}: ${r.command}${r.resolved && r.resolved !== r.command ? ` → ${r.resolved}` : ""}`);
  let pyInstall = "skipped";
  if (chosen) {
    logger.log(`  python → ${chosen.resolved}（${chosen.source}，import yaml 通过）`);
  } else {
    logger.log("  python → 未找到可 import yaml 的解释器。");
    if (dry) {
      pyInstall = "guided";
      logger.log("  [dry-run] 正式运行将在此询问「要现在自动准备 Python 吗？」（uv 优先）；本次不问不装");
    } else {
      let wants = null; // null=无法提问（非交互）——无人回答的提问不替人回答（WP-021 同款纪律）
      if (args.installPython) wants = true;
      else if (interactive) wants = isYesAnswer(await askUser("  要现在自动准备 Python 吗？[Y/n]（uv 建环境并装 pyyaml，约十几秒）"), true);
      if (wants === null || wants === false) {
        pyInstall = wants === null ? "guided" : "declined";
        logger.log(PYTHON_MANUAL_HINT);
      } else if (!probeUv(uvRunner, env)) {
        pyInstall = "guided";
        logger.log(UV_INSTALL_HINT);
      } else {
        logger.log(`  python → uv 在 PATH，自动准备中（uv venv＋uv pip install ${PYTHON_PROVISION_PACKAGES.join(" ")}）…`);
        try {
          provisionPythonWithUv({ repoRoot, env, uvRunner });
          const re = probePython(pythonCandidates({ explicit: args.python, env, repoRoot }), pythonRunner);
          for (const r of re.results) logger.log(`  python ${r.ok ? "✓" : "✗"} ${r.source}: ${r.command}${r.resolved && r.resolved !== r.command ? ` → ${r.resolved}` : ""}`);
          chosen = re.chosen;
          if (chosen) {
            pyInstall = "installed";
            logger.log(`  python → ${chosen.resolved}（装成，import yaml 通过）`);
          } else {
            pyInstall = "failed";
            logger.error(`  ! 装完复探仍未通过（意外）——按下面指引排查后重跑本命令：\n${PYTHON_MANUAL_HINT}`);
          }
        } catch (error) {
          pyInstall = "failed";
          logger.error(`✗ vault-init: Python 自动准备失败：${error && error.message ? error.message : String(error)}\n${PYTHON_MANUAL_HINT}`);
        }
      }
    }
  }

  // ── 3.5 Node 依赖装配（自动：缺席/漂移即 npm ci，不问——与 Python 半边对齐，Master 2026-11-04 方向）──
  const nodeDepsState = ensureNodeDeps({ repoRoot, logger, dry, npmRunner });

  // ── 4. .env（缺席时生成；已存在逐字节不动——唯一例外：本运行刚装成解释器时窄更新 PYTHON_PATH 一行）──
  const envOut = path.resolve(args.envOut || path.join(repoRoot, ".env"));
  const templateFile = path.join(repoRoot, ".env.example");
  let envState = "skipped";
  if (fs.existsSync(envOut)) {
    if (pyInstall === "installed" && chosen) {
      const current = fs.readFileSync(envOut, "utf8");
      const updated = updateEnvPython(current, chosen.resolved);
      if (updated !== current) {
        act(`改写 ${envOut} 的 PYTHON_PATH 行`, () => fs.writeFileSync(envOut, updated));
        envState = "updated-python";
        logger.log(`  + ${envOut}（仅更新 PYTHON_PATH=${chosen.resolved}；其余字节不动）`);
      } else {
        envState = "present";
        logger.log(`  = ${envOut}（已存在，PYTHON_PATH 已是本解释器）`);
      }
    } else {
      envState = "present";
      const current = fs.readFileSync(envOut, "utf8");
      const hints = [];
      const curVault = readEnvValue(current, "VAULT_PATH");
      if (curVault !== vaultPath) hints.push(`VAULT_PATH=${vaultPath}（现为 ${curVault ?? "未设置"}）`);
      const curPython = readEnvValue(current, "PYTHON_PATH");
      if (chosen && curPython !== chosen.resolved) hints.push(`PYTHON_PATH=${chosen.resolved}（现为 ${curPython ?? "未设置"}）`);
      logger.log(`  = ${envOut}（已存在，不覆盖）${hints.length ? "\n    若要指向本库请手改：\n    " + hints.join("\n    ") : "——已指向本库"}`);
    }
  } else if (!fs.existsSync(templateFile)) {
    logger.log(`  ! 缺模板 ${templateFile}，跳过 .env 生成`);
  } else {
    envState = "created";
    const content = renderEnv(fs.readFileSync(templateFile, "utf8"), { vaultPath, pythonPath: chosen?.resolved ?? null });
    act(`写 ${envOut}`, () => fs.writeFileSync(envOut, content));
    logger.log(`  + ${envOut}（VAULT_PATH 已填${chosen ? "，PYTHON_PATH 已填" : "；PYTHON_PATH 保留模板值，待你准备解释器后改"}）`);
  }

  // ── 5. 收尾 ──
  if (identityMissing) logger.log(IDENTITY_HINT);
  logger.log(`
下一步：
  npm run dev            # 起 API（127.0.0.1:${env.API_PORT || 18083}）与前端（localhost:${env.VITE_PORT || 5174}）
  npm run health         # 两个服务就绪自检${remoteState === "none" ? `
  异地备份（可选）：npm run vault:init -- --vault "${vaultPath}" --remote <git url>   # 幂等；配 origin 并装提交后自动 push 的钩子` : ""}
边界：正式消费面在两种情形下呈定义过的空态（服务本身就绪，词表、实体、文章面不受影响）——
  ①尚无发布：404 NO_CURRENT_RELEASE（发布由管线产出，不是初始化产出）；
  ②已发布但未挂载主体／未配置产品身份：409 PROJECTION_IDENTITY_UNMOUNTED，响应 guidance 给出挂载路径（合法空态，WP-014／SPEC-029）。`);
  // 末行 summary（机器可读 k=v）：含路径的值加引号——路径可含空格（红队反例 7）
  logger.log(`vault-init: created=${created} present=${present} git=${gitState} commit=${commitState} remote=${remoteState} hooks=${hooksState} env=${envState} py_install=${pyInstall} node_deps=${nodeDepsState}${dry ? " dry_run=1" : ""} python="${chosen ? chosen.resolved : "missing"}" vault="${vaultPath}"`);

  if (args.requirePython && !chosen) return 2;
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(await main(process.argv.slice(2)));
}
