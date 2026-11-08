#!/usr/bin/env node
/**
 * backfill-commit-events.mjs — dev-log 台账补账器：把 git 历史里漏记的提交补成台账事件。
 *
 * 背景（2026-09-27 立法）：post-commit 后台化（&）＋静默吞错的设计，在会话频繁中断的使用模式下
 * 静默丢账 6 天（45 笔提交零事件，台账停在 9-21）。钩子只是优化项——台账作为 git 活动的投影
 * 必须可从 git 历史重建，CI 对账门禁负责抓漂移。
 *
 * 设计约束：
 * - 幂等：判「已落账」的算法住 server/shared/dev-log.cjs 的 createCommitRecordIndex（前缀包含），
 *   与钩子同一份。PR-251 之前本件用 7 位切片集合、钩子用 8 位字面串相等，两套判据对同一事实互不相认
 *   （在册实测：7 位 1281 行／8 位 2302 行并存；全历史重放一次追加 1336 条重复事件）；
 * - 出串单源：落账的 cmd 一律经 commitCmdOf(fullHash)，本件不再自截长度；
 * - 逻辑单源：owner 前缀表取 dev-log-ledger，cls 判定与钩子共用 commit-classify.mjs（PR-198 起），
 *   不维护第二份分类逻辑；
 * - 只补不删：不触碰既有事件（含历史事件），追加 append-only；
 * - merge commit 跳过（与钩子语义一致）；空提交跳过。
 *
 * 用法（PR-251 起：范围必须显式表态，缺省只报不写）：
 *   node scripts/quality/dev-log/backfill-commit-events.mjs --since <ref> [--include-merged] [--write]
 *   node scripts/quality/dev-log/backfill-commit-events.mjs --full-history [--include-merged] [--write]
 * - 两个范围旗标都不给＝拒跑。旧版缺省即全历史重放，是本条危害面的入口——已摘；
 *   退出路径＝显式写 --full-history，能力本身未删；
 * - 缺省干跑：只报「将追加 N 条／涉及哪些提交」，不写一个字节。真落账须显式 --write；
 *   退出路径＝同一条命令尾部加 --write 重跑（干跑读数即预演）；
 * - --include-merged 连合并进来的分支侧提交一起补（默认只沿 first-parent 主干——分支侧尾巴若未随
 *   分支入账，默认面永远补不到：2026-11-02 实测 main 合并批里 63b63c4a 一笔事件永久缺失且无告警，PR-197）。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emitDevEvent, commitCmdOf, createCommitRecordIndex, COMMIT_CMD_PREFIX } from "../../../server/shared/dev-log.cjs";
import { parseNameStatus } from "./changed-files.mjs";
import { classifyCommit } from "./commit-classify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const ENTRIES_DIR = path.join(ROOT, "docs", "dev-log", "entries");

const KNOWN_FLAGS = new Set(["--since", "--include-merged", "--full-history", "--write", "--dry-run"]);
const SAMPLE_LIMIT = 12;

function git(args) {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
}

/**
 * 命令行解析（纯函数，可测面）。四条判据：
 * - 未知旗标＝拒：拼错的旗标不得被静默忽略后继续走到写入路径；
 * - `--since` 后面没值（或值本身像旗标）＝拒；
 * - 范围必须显式表态：`--since <ref>` 与 `--full-history` 二选一，都给＝拒，都不给＝拒；
 * - 写入是显式动作：缺省 dryRun=true，只有 `--write` 才落账（`--dry-run` 显式表达同一语义）。
 */
export function parseCliArgs(argv) {
  const flags = argv.filter((token) => token.startsWith("--"));
  const unknown = flags.filter((flag) => !KNOWN_FLAGS.has(flag));
  if (unknown.length > 0) {
    throw new Error(`未知旗标：${unknown.join(" ")}（在册旗标仅 ${[...KNOWN_FLAGS].join("、")}）`);
  }
  const sinceIdx = argv.indexOf("--since");
  const since = sinceIdx >= 0 ? argv[sinceIdx + 1] : undefined;
  if (sinceIdx >= 0 && (since === undefined || since.startsWith("--"))) {
    throw new Error("--since 需要一个引用值（如 --since 4d5162be^）");
  }
  const fullHistory = flags.includes("--full-history");
  if (since && fullHistory) {
    throw new Error("拒跑：--since 与 --full-history 互斥（前者有界补账、后者全历史）");
  }
  if (!since && !fullHistory) {
    throw new Error("拒跑：遍历范围未显式表态。有界补账用 --since <ref>；确需全历史加 --full-history（缺省只干跑，不写台账）");
  }
  return {
    since: since ?? null,
    fullHistory,
    includeMerged: flags.includes("--include-merged"),
    dryRun: !flags.includes("--write") || flags.includes("--dry-run"),
  };
}

/** 遍历面选择（可测面）：`--since` 走区间，只有 `--full-history` 才允许全引用遍历。
 *  默认 --first-parent 只沿主干补账；`--include-merged` 连合并进来的分支侧提交一起补——分支侧提交的
 *  钩子尾巴若未随分支入账（工作树里未提交即丢弃），默认面永远看不见它：2026-11-02 实测 main 的合并批里
 *  63b63c4a 一笔事件永久缺失且无告警（PR-197）。merge 提交本身仍由逐笔 parent 数判定跳过。 */
export function buildLogArgs({ since, includeMerged, fullHistory = false }) {
  const range = since ? `${since}..HEAD` : fullHistory ? "--all" : null;
  if (range === null) {
    throw new Error("buildLogArgs：既无 --since 也无 --full-history，拒绝遍历全历史");
  }
  const args = ["log", range];
  if (!includeMerged) args.push("--first-parent");
  return args.concat(["--reverse", "--pretty=%H|%P"]);
}

/** 一笔提交的补账计划——无落账面的纯计算；干跑与真跑共用这一条路径，两者读数必同源。 */
async function planCommit(fullHash, parentField, ledgerIndex, ownerPrefixes) {
  const parentCount = parentField.trim() ? parentField.trim().split(" ").length : 0;
  if (parentCount > 1) return { kind: "merge" };
  if (ledgerIndex.has(fullHash)) return { kind: "recorded" };

  const commitMsg = git(["log", "-1", "--pretty=%B", fullHash]);
  const reqMatch = commitMsg.match(/#(\d+)/);
  const req = reqMatch ? `#${reqMatch[1]}` : null;

  const statusLines = git(["-c", "core.quotepath=false", "show", "--pretty=format:", "--name-status", fullHash])
    .trim()
    .split("\n")
    .filter(Boolean);
  const files = parseNameStatus(statusLines);
  if (files.length === 0) return { kind: "empty" }; // 空提交无归属语义

  const byOwner = new Map();
  for (const file of files) {
    let best = null;
    let bestLen = 0;
    for (const [owner, prefixes] of Object.entries(ownerPrefixes)) {
      for (const prefix of prefixes) {
        if (file.startsWith(prefix) && prefix.length > bestLen) {
          best = owner;
          bestLen = prefix.length;
        }
      }
    }
    const resolved = best || "team-lead"; // 兜底辖区（与钩子一致）
    if (!byOwner.has(resolved)) byOwner.set(resolved, []);
    byOwner.get(resolved).push(file);
  }
  const topDirs = new Set(files.map((f) => (f.includes("/") ? f.split("/")[0] : f)));
  return { kind: "plan", fullHash, req, cls: classifyCommit({ files, topDirs }), byOwner };
}

function emitPlan(plan, cmd, entriesDir) {
  let count = 0;
  for (const [owner, ownerFiles] of plan.byOwner) {
    emitDevEvent(
      {
        event: "dev.commit.completed",
        owner,
        cls: plan.cls,
        auth: "none",
        req: plan.req,
        zone: ownerFiles[0].includes("/") ? ownerFiles[0].slice(0, ownerFiles[0].lastIndexOf("/") + 1) : ownerFiles[0],
        files: ownerFiles,
        cmd,
        exit: 0,
        duration_ms: null,
        level: "info",
        source: "dev",
      },
      { entriesDir }
    );
    count++;
  }
  return count;
}

async function main() {
  const { since, fullHistory, includeMerged, dryRun } = parseCliArgs(process.argv.slice(2));
  const lines = git(buildLogArgs({ since, includeMerged, fullHistory })).trim().split("\n").filter(Boolean);

  const ledgerIndex = createCommitRecordIndex(ENTRIES_DIR);
  const { OWNER_ZONE_PREFIXES } = await import("../shared/dev-log-ledger.mjs");

  let appended = 0;
  let planned = 0;
  let skippedRecorded = 0;
  let skippedMerge = 0;
  let skippedEmpty = 0;
  const samples = [];

  for (const line of lines) {
    const [fullHash, parents = ""] = line.split("|");
    const plan = await planCommit(fullHash, parents, ledgerIndex, OWNER_ZONE_PREFIXES);
    if (plan.kind === "merge") {
      skippedMerge++;
      continue;
    }
    if (plan.kind === "recorded") {
      skippedRecorded++;
      continue;
    }
    if (plan.kind === "empty") {
      skippedEmpty++;
      continue;
    }
    const cmd = commitCmdOf(plan.fullHash);
    const short = cmd.slice(COMMIT_CMD_PREFIX.length);
    if (dryRun) {
      planned += plan.byOwner.size;
      if (samples.length < SAMPLE_LIMIT) samples.push(`${short} → ${[...plan.byOwner.keys()].join(",")}`);
      continue;
    }
    appended += emitPlan(plan, cmd, ENTRIES_DIR);
    // commitTs 供人工核对；事件 ts 为补账时间（append-only 台账不改写历史语义）
    const commitTs = git(["log", "-1", "--pretty=%cI", plan.fullHash]).trim();
    process.stderr.write(`backfill: ${short} → ${[...plan.byOwner.keys()].join(",")} (commit@${commitTs.slice(0, 10)})\n`);
  }

  const scope = since ? `--since ${since}` : "--full-history";
  const mergedNote = includeMerged ? " --include-merged" : "";
  if (dryRun) {
    process.stderr.write(
      `backfill 干跑（未写台账）：${scope}${mergedNote} 范围内将追加 ${planned} 条事件` +
        `；跳过已记录 ${skippedRecorded} 笔、merge ${skippedMerge} 笔、空提交 ${skippedEmpty} 笔\n` +
        samples.map((sample) => `  待补 ${sample}\n`).join("") +
        (planned > samples.length ? `  …其余 ${planned - samples.length} 条未列\n` : "") +
        `确认无误后真落账：node scripts/quality/dev-log/backfill-commit-events.mjs ${scope}${mergedNote} --write\n`
    );
    return;
  }
  process.stderr.write(
    `backfill 完成：追加 ${appended} 条事件；跳过已记录 ${skippedRecorded} 笔、merge ${skippedMerge} 笔、空提交 ${skippedEmpty} 笔\n`
  );
}

// 只有被直接执行时才跑补账（被 import 取 buildLogArgs 不得产生写台账的副作用）
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`backfill fatal: ${error.message}\n`);
    process.exit(1);
  });
}
