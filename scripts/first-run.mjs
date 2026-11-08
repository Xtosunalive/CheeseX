// Component: First-Run
// @responsible: `npm run dev` 的首次启动接线——没有可用知识库时问一句位置（带默认值）即建，复用 vault-init；
//   不静默猜路径（Master 2026-10-26 裁决：Vault 是用户内容目录，同类产品首启均询问位置而非静默创建）。
// @inputs: 仓根 .env（经 server/shared/env-load.cjs 的 loadEnvFile 单源解析，显式环境变量优先）＋ VAULT_PATH 目录存在性
// @outputs: 三态判定；需要建库时调用 scripts/vault-init.mjs 导出的 main()（骨架/.env/git 全由它落，本模块零新落点；
//   WP-039：ask 通道与 interactive 透传，建库中的 Python 装配问句与问位置共用同一 readline）
// @context: Onboarding（WP-021；WP-009 续篇）
//
// 三态：
//   ready        VAULT_PATH 可解析且目录存在 → 零提问直通
//   unconfigured 无环境变量、无 .env 行      → 问「知识库放在哪？」带默认值（仓根上一级/cheese），回车即建
//   missing-dir  已配置但目录不存在          → 问「在该路径新建知识库？[Y/n]」
// stdin 非 TTY（CI/脚本/管道）：不建、不写、打印 vault:init 命令指引、返回 abort——无人回答的提问不替人回答。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "../server/shared/env-load.cjs";
import { main as vaultInitMain } from "./vault-init.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function defaultVaultPath(rootDir) {
  return path.join(path.dirname(path.resolve(rootDir)), "cheese");
}

// 显式环境变量优先于 .env（与 env-load.cjs 口径一致）；返回解析到的绝对路径或 null。
export function resolveConfiguredVaultPath({ rootDir, env = process.env, home = os.homedir() }) {
  const fromEnv = env.VAULT_PATH && String(env.VAULT_PATH).trim();
  const fromFile = loadEnvFile(path.join(rootDir, ".env")).VAULT_PATH;
  const raw = fromEnv || (fromFile && String(fromFile).trim()) || "";
  if (!raw) return null;
  const expanded = raw === "~" || raw.startsWith("~/") ? path.join(home, raw.slice(1)) : raw;
  return path.resolve(rootDir, expanded);
}

export function resolveFirstRunState({ rootDir, env = process.env, home = os.homedir() }) {
  const vaultPath = resolveConfiguredVaultPath({ rootDir, env, home });
  if (!vaultPath) return { kind: "unconfigured", vaultPath: null, suggested: defaultVaultPath(rootDir) };
  if (fs.existsSync(vaultPath) && fs.statSync(vaultPath).isDirectory()) return { kind: "ready", vaultPath };
  return { kind: "missing-dir", vaultPath };
}

function manualHint(vaultPath) {
  return `  手动建库：npm run vault:init -- --vault ${vaultPath || "<路径>"}`;
}

function isYes(answer, defaultYes = true) {
  const a = String(answer ?? "").trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes" || a === "是";
}

/**
 * @param {object} o
 * @param {string} o.rootDir 仓根（.env 落点与默认路径基准）
 * @param {(question:string)=>Promise<string>} [o.prompt] 提问函数；缺省按 stdin TTY 建 readline
 * @param {boolean} [o.interactive] 是否可提问；缺省 process.stdin.isTTY
 * @returns {Promise<{action:"none"|"initialized"|"abort", vaultPath:string|null, exitCode:number}>}
 */
export async function runFirstRun({
  rootDir = REPO_ROOT,
  env = process.env,
  home = os.homedir(),
  logger = console,
  interactive = Boolean(process.stdin.isTTY),
  prompt,
  initRunner = async (argv, options) => vaultInitMain(argv, options),
} = {}) {
  const state = resolveFirstRunState({ rootDir, env, home });
  if (state.kind === "ready") return { action: "none", vaultPath: state.vaultPath, exitCode: 0 };

  const describe = state.kind === "unconfigured"
    ? "尚未配置知识库（无 VAULT_PATH 环境变量，仓根 .env 亦无该行）"
    : `.env 的 VAULT_PATH 指向 ${state.vaultPath}，但该目录不存在`;

  if (!interactive) {
    logger.error(`✗ 首次启动：${describe}；当前不是交互终端，不替你决定位置。\n${manualHint(state.vaultPath || state.suggested)}`);
    return { action: "abort", vaultPath: state.vaultPath, exitCode: 1 };
  }

  const ask = prompt || makeTtyPrompt();
  let target;
  try {
    if (state.kind === "unconfigured") {
      logger.log(`▸ 首次启动：${describe}。`);
      const answer = await ask(`  知识库放在哪？[${state.suggested}] `);
      const chosen = String(answer ?? "").trim();
      const raw = chosen || state.suggested;
      target = path.resolve(rootDir, raw === "~" || raw.startsWith("~/") ? path.join(home, raw.slice(1)) : raw);
    } else {
      logger.log(`▸ 首次启动：${describe}。`);
      const answer = await ask("  在该路径新建知识库？[Y/n] ");
      if (!isYes(answer, true)) {
        logger.error(`✗ 已取消：未建库、未写任何文件。\n${manualHint(state.vaultPath)}`);
        return { action: "abort", vaultPath: state.vaultPath, exitCode: 1 };
      }
      target = state.vaultPath;
    }
    // WP-039：ask 通道与 interactive 透传——建库中「要现在自动准备 Python 吗」与问位置共用同一 readline；
    // readline 关闭时序后移到建库完成之后（vault-init 可能在建库中继续提问）。
    const code = await initRunner(["--vault", target], { logger, env, repoRoot: rootDir, gitEnv: env, prompt: ask, interactive });
    if (code !== 0) {
      logger.error(`✗ 首次启动：vault-init 退出码 ${code}，未起服务。\n${manualHint(target)}`);
      return { action: "abort", vaultPath: target, exitCode: 1 };
    }
  } finally {
    if (!prompt && ask.close) ask.close();
  }

  const after = resolveFirstRunState({ rootDir, env, home });
  if (after.kind !== "ready") {
    logger.error(`✗ 首次启动：建库后仍未就位（${after.kind}）。\n${manualHint(target)}`);
    return { action: "abort", vaultPath: target, exitCode: 1 };
  }
  return { action: "initialized", vaultPath: after.vaultPath, exitCode: 0 };
}

function makeTtyPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  ask.close = () => rl.close();
  return ask;
}

// CLI：node scripts/first-run.mjs [--root <仓根>]（--root 供真进程测试注入；缺省本仓）。
// 退出码：0=已就位或刚建成；1=未建（非交互/取消/建库失败）。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const i = process.argv.indexOf("--root");
  const rootDir = i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : REPO_ROOT;
  const result = await runFirstRun({ rootDir });
  if (result.action === "none") console.log(`▸ 知识库已就位：${result.vaultPath}`);
  process.exit(result.exitCode);
}
