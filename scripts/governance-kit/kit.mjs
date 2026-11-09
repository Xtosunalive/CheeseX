#!/usr/bin/env node
// governance-kit/kit.mjs — 治理层统一出入口
//
// 公开代码仓不跟踪内部治理件（它们在 .gitignore 里）；治理件的版本保存在一个独立的
// 私有仓（治理 kit）。本脚本把 kit 的目录以符号链接挂到代码仓，让现有治理工具仍按
// 原来的相对路径读写，并把挂载、查询、同步、解除收成一组固定命令。
//
// 用法（在代码仓根目录）：
//   node scripts/governance-kit/kit.mjs setup   [kit路径] [--with-hooks] [--force]
//   node scripts/governance-kit/kit.mjs status  [kit路径]
//   node scripts/governance-kit/kit.mjs path    [kit路径]
//   node scripts/governance-kit/kit.mjs sync    [-m "提交信息"] [--push]
//   node scripts/governance-kit/kit.mjs reconcile
//   node scripts/governance-kit/kit.mjs unlink
//
// kit 路径来源（按优先级）：命令行参数 > CHEESE_GOV_KIT 环境变量 > .governance-kit
// 本地配置 > 同级 governance-kit 目录。本脚本不含任何私有仓名或本机绝对路径；
// .governance-kit 是本地配置，已列入 .gitignore，不入库。
//
// 边界：只创建/删除符号链接与本地配置，绝不删除已存在的真实目录或文件；
// 默认不改 git 的 core.hooksPath（治理钩子依赖私有件，需要时显式 --with-hooks）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CONFIG_FILE = path.join(ROOT, ".governance-kit");
export const DEFAULT_KIT_DIR = path.resolve(ROOT, "../governance-kit");

// 挂载点：代码仓相对路径 → kit 内相对路径。
// 不挂载的留仓本地：.env、.env.fields-gate-probe、GIT-CONTEXT.md、
// README-addendum.md、.claude/（仓身份/机器配置/内部 AI 指令，不属于共享治理层）。
export const MOUNTS = [
  { link: "docs", target: "docs", kind: "dir" },
  { link: "data/governance", target: "data/governance", kind: "dir" },
  { link: "scripts/problem-board", target: "scripts/problem-board", kind: "dir" },
  { link: "scripts/dev-log", target: "scripts/dev-log", kind: "dir" },
  { link: "scripts/ops", target: "scripts/ops", kind: "dir" },
  { link: ".githooks", target: ".githooks", kind: "dir" },
  { link: "AGENTS.md", target: "AGENTS.md", kind: "file" },
];

function git(dir, args, opts = {}) {
  // stdio:"ignore"（sync 的 add/commit/push）时 execFileSync 返回 null 而非字符串，
  // 无条件 .trim() 会让 gov:sync 直接崩在提交前——返回空串即可，调用方只看副作用。
  const out = execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts,
  });
  return typeof out === "string" ? out.trim() : "";
}

function isGitRepo(dir) {
  try {
    return git(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch { return false; }
}

export function readConfiguredKit() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return cfg.kitDir ? String(cfg.kitDir) : null;
  } catch { return null; }
}

export function candidateKitDirs(explicit) {
  return [explicit, process.env.CHEESE_GOV_KIT, readConfiguredKit(), DEFAULT_KIT_DIR]
    .filter(Boolean)
    .map((p) => path.resolve(ROOT, String(p)));
}

// kit 的判据：是一个 git 仓，且有治理合同目录。避免把任意目录当 kit 挂载。
export function isKitDir(dir) {
  try {
    return fs.statSync(dir).isDirectory()
      && fs.statSync(path.join(dir, "docs", "work-packages")).isDirectory()
      && isGitRepo(dir);
  } catch { return false; }
}

export function resolveKitDir(explicit) {
  for (const dir of candidateKitDirs(explicit)) if (isKitDir(dir)) return dir;
  return null;
}

export function mountState(kitDir) {
  return MOUNTS.map((m) => {
    const linkPath = path.join(ROOT, m.link);
    const expected = path.join(kitDir, m.target);
    let state = "absent";
    let pointsTo = null;
    try {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink()) {
        pointsTo = fs.readlinkSync(linkPath);
        state = path.resolve(path.dirname(linkPath), pointsTo) === expected ? "mounted" : "other-link";
      } else {
        state = st.isDirectory() ? "real-dir" : "real-file";
      }
    } catch { /* 不存在 */ }
    return { ...m, state, pointsTo };
  });
}

function setup(kitDir, { withHooks, force }) {
  const states = mountState(kitDir);
  const conflicts = states.filter((m) => m.state === "real-dir" || m.state === "real-file");
  if (conflicts.length) {
    console.error("gov:setup 中止——以下位置是真实目录/文件，脚本不会覆盖或删除：");
    for (const m of conflicts) console.error(`  ${m.link} (${m.state})`);
    console.error("请先自行确认内容并移走，再重试。");
    return 1;
  }
  const otherLinks = states.filter((m) => m.state === "other-link");
  if (otherLinks.length && !force) {
    console.error("gov:setup 中止——以下符号链接指向别处；确认无误后加 --force 才会重建：");
    for (const m of otherLinks) console.error(`  ${m.link} -> ${m.pointsTo}`);
    return 1;
  }
  if (otherLinks.length && force) {
    for (const m of otherLinks) fs.unlinkSync(path.join(ROOT, m.link));
  }

  let created = 0;
  for (const m of states) {
    if (m.state === "mounted") continue;
    const linkPath = path.join(ROOT, m.link);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(path.join(kitDir, m.target), linkPath, m.kind);
    created++;
  }
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ kitDir }, null, 2)}\n`, "utf8");

  console.log(`gov:setup 完成：kit=${kitDir}；新建 ${created} 个挂载，${states.length - created} 个已就位。`);
  if (withHooks) {
    git(ROOT, ["config", "core.hooksPath", ".githooks"]);
    console.log("已设置 core.hooksPath=.githooks（治理钩子启用，提交前会跑代码仓门禁）。");
  } else {
    console.log("未改 core.hooksPath；治理钩子默认不启用（依赖私有件，需要时显式 --with-hooks）。");
  }
  return 0;
}

function status(kitDir) {
  if (!kitDir) {
    console.log("gov:status 未找到治理 kit——先执行 gov:setup <kit路径>，或设置 CHEESE_GOV_KIT。");
    return 0;
  }
  const states = mountState(kitDir);
  const mounted = states.filter((m) => m.state === "mounted").length;
  console.log(`kit=${kitDir}`);
  console.log(`HEAD=${git(kitDir, ["rev-parse", "--short", "HEAD"])}`);
  const contracts = path.join(kitDir, "docs", "work-packages");
  console.log(`治理合同=${fs.readdirSync(contracts).filter((f) => f.endsWith(".json")).length} 件`);
  for (const m of states) console.log(`  ${m.state.padEnd(10)} ${m.link}${m.pointsTo ? ` -> ${m.pointsTo}` : ""}`);
  let hooks = "(未设置)";
  try { hooks = git(ROOT, ["config", "core.hooksPath"]) || "(未设置)"; } catch { /* 无配置 */ }
  console.log(`挂载 ${mounted}/${states.length}；core.hooksPath=${hooks}`);
  return 0;
}

// kit 是 cheeseh 全历史克隆，里面还有 1482 个代码文件。同步只提交治理层路径，
// 不把 kit 里的代码文件变更带进治理仓历史（红队复核 F-2）。
const GOV_PATHS = [
  "docs", "data/governance", "scripts/problem-board", "scripts/dev-log",
  "scripts/ops", ".githooks", "AGENTS.md", "GIT-CONTEXT.md",
  "README-addendum.md", "GOVERNANCE-KIT.md",
];

function sync(kitDir, { message, push }) {
  // pathspec 指向不存在的路径时 git add 会 exit 128；治理层目录不齐全的 kit
  // （新克隆／局部裁剪）不应让同步崩掉，只把在盘存在的治理路径交给 git。
  // 全部缺席时也不能省略 pathspec，否则 status 会退化成全仓扫描。
  const paths = GOV_PATHS.filter((p) => fs.existsSync(path.join(kitDir, p)));
  if (paths.length === 0) {
    console.log("gov:sync kit 内无治理层路径，跳过提交。");
    return 0;
  }
  const dirty = git(kitDir, ["status", "--porcelain", "--", ...paths]);
  if (!dirty) {
    console.log("gov:sync 治理层无变更，跳过提交。");
  } else {
    git(kitDir, ["add", "-A", "--", ...paths], { stdio: "ignore" });
    git(kitDir, ["commit", "-m", message], { stdio: "ignore" });
    console.log(`gov:sync 已提交：${message}`);
    if (push) {
      git(kitDir, ["push"], { stdio: "ignore" });
      console.log("gov:sync 已推送到 kit 远端（私有）。");
    } else {
      console.log("未推送；需要推送时加 --push。");
    }
  }
  // 提交后 post-commit 会新写出一条台账（治理层）。若只看全仓 status 就报
  // 「非治理层变更」，每次同步都会误报一次；按治理层路径把两类剩余变更分开说明。
  // 必须拿未 trim 的原始输出：git() 会 .trim() 整段，把首行 " M docs/..." 的
  // 前导空格削掉，slice(3) 就截出残路径，反而把治理层误判成非治理层。
  const remaining = execFileSync("git", ["-C", kitDir, "status", "--porcelain"], { encoding: "utf8" })
    .split("\n").filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  const nonGov = remaining.filter((p) => !GOV_PATHS.some((g) => p === g || p.startsWith(`${g}/`)));
  const pendingGov = remaining.length - nonGov.length;
  if (nonGov.length) console.log(`gov:sync 提示：kit 里仍有 ${nonGov.length} 项非治理层变更未处理（本命令不碰，请自行核对）。`);
  if (pendingGov) console.log(`gov:sync 提示：post-commit 新写出 ${pendingGov} 项治理层台账变更，下次 gov:sync 带走（钩子正常工作的稳定尾巴）。`);
  return 0;
}

// 治理对账（撞号/分叉）必须在 kit 仓的 git 历史里跑：代码仓已不跟踪治理件。
// 工具代码只保留代码仓这一份（单一事实源），用 --repo 把查询指向 kit 仓。
function reconcile(kitDir) {
  const tool = path.join(ROOT, "scripts", "quality", "check-merge-reconcile.mjs");
  try {
    execFileSync("node", [tool, "--repo", kitDir, "--expect-governance", "--target", "origin/main", "--head", "HEAD"], { cwd: ROOT, stdio: "inherit" });
    return 0;
  } catch (error) {
    console.error(`gov:reconcile 治理对账未通过（exit ${error.status ?? "?"}）——按输出逐条对账后再合并。`);
    return 1;
  }
}

function unlink() {
  let removed = 0;
  for (const m of MOUNTS) {
    const linkPath = path.join(ROOT, m.link);
    try {
      if (fs.lstatSync(linkPath).isSymbolicLink()) {
        fs.unlinkSync(linkPath);
        removed++;
      }
    } catch { /* 不存在 */ }
  }
  console.log(`gov:unlink 移除 ${removed} 个符号链接；kit 仓内容与本地配置均保留。`);
  return 0;
}

function parse(argv) {
  const cmd = argv[0] || "status";
  const opts = {
    kit: null, withHooks: false, force: false, push: false,
    message: "chore(governance): 治理层同步（来自开发仓）",
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--with-hooks") opts.withHooks = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--push") opts.push = true;
    else if (a === "-m") opts.message = argv[++i];
    else if (a.startsWith("--")) { console.error(`gov-kit: 未知参数 ${a}`); process.exit(2); }
    else if (!opts.kit) opts.kit = a;
  }
  return { cmd, opts };
}

export function main(argv = process.argv.slice(2)) {
  const { cmd, opts } = parse(argv);
  if (cmd === "unlink") return unlink();
  if (!["setup", "status", "path", "sync", "reconcile"].includes(cmd)) {
    console.error(`gov-kit: 未知子命令 ${cmd}（可用：setup/status/path/sync/reconcile/unlink）`);
    return 2;
  }
  const kitDir = resolveKitDir(opts.kit);
  if (cmd === "path") {
    if (!kitDir) { console.error("gov:path 未找到治理 kit"); return 1; }
    console.log(kitDir);
    return 0;
  }
  if (cmd === "status") return status(kitDir);
  if (!kitDir) {
    console.error("未找到治理 kit。给一个 kit 路径、设置 CHEESE_GOV_KIT，或先运行 gov:setup <kit路径>。");
    return 1;
  }
  if (cmd === "setup") return setup(kitDir, opts);
  if (cmd === "reconcile") return reconcile(kitDir);
  return sync(kitDir, opts);
}

// 只比字面路径不够：/tmp 等符号链接路径下 argv[1] 与 import.meta.url 的真实路径
// 不一致，CLI 会静默跳过 main() 却 exit 0（假绿）。先字面比，再按 realpath 兜底。
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  const arg = path.resolve(entry);
  if (self === arg) return true;
  try { return fs.realpathSync(self) === fs.realpathSync(arg); } catch { return false; }
}
if (isMainModule()) process.exitCode = main();
