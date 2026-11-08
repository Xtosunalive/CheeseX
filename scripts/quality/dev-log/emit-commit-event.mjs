#!/usr/bin/env node
/**
 * emit-commit-event.mjs — dev-log 生产者 B：提交事件（source:"dev"）。
 *
 * #1873：post-commit 钩子调用，把每次真实提交自动落为 dev-log 事件。
 * 由 .githooks/post-commit 在仓库根以 `node scripts/quality/dev-log/emit-commit-event.mjs` 调起。
 *
 * 设计约束：
 * - 失败静默退出 0（post-commit 语义：绝不阻塞提交）；stderr 前缀 dev-log-producer: 排查用。
 * - merge commit（>1 parent）跳过——无独立开发语义，且此前反推实验已定「排除 merge」。
 * - owner 判定：按本提交改动文件的前缀匹配 OWNER_ZONE_PREFIXES（dev-log-ledger.mjs 既有单源），
 *   一个提交天然跨多 owner → 按 owner 拆多条事件（实验结论：事件数 ≠ 提交数）。
 *   无匹配文件的提交（纯文档/其他区）落 team-lead（主理人兜底辖区）。
 * - cls 判定（W 码词表派生，不自持映射表——#1870 单源）：
 *   触 contracts/ 或 package.json 或跨 5+ 文件或跨 3+ 顶层目录 → W5 重型任务；
 *   纯 docs/ 且无代码 → W3 调研（文档即产出，files 非空）；否则 W4 标准开发。
 * - auth：缺省 none（对话侧授权证据在 REQUIREMENTS 指令字段，属回填解析器职责，本钩子不臆造）。
 * - req：从提交信息里的 #N 引用自动关联（check:change-record 已强制提交↔条目闭环）。
 * - files/zone：本提交的改动文件清单（A/M/D 全计；R/C 取新路径——解析口径单源 changed-files.mjs）与命中的 owner 辖区。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emitDevEvent, commitCmdOf, COMMIT_CMD_PREFIX, createCommitRecordIndex } from "../../../server/shared/dev-log.cjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// #1876：auth 证据解析（REQUIREMENTS 指令字段单源判定）——有证据才 confirm，缺省 none 不臆造。
import { parseAuthEvidenceFromRepo, resolveAuth } from "./auth-evidence.mjs";
import { parseNameStatus } from "./changed-files.mjs";
import { classifyCommit } from "./commit-classify.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}

function warn(message) {
  process.stderr.write(`dev-log-producer: ${message}\n`);
}

// owner→目录前缀单源：从 dev-log-ledger.mjs 读取（不自持副本）。
async function loadOwnerZonePrefixes() {
  const { OWNER_ZONE_PREFIXES } = await import("../shared/dev-log-ledger.mjs");
  return OWNER_ZONE_PREFIXES;
}

// classifyCommit 自 PR-198 起住 commit-classify.mjs（钩子与补账器共用单源，见文件头 @context）

try {
  const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
  if (parents.length > 2) process.exit(0); // merge commit 跳过

  const commitMsg = git(["log", "-1", "--pretty=%B"]);
  const reqMatch = commitMsg.match(/#(\d+)/);
  const req = reqMatch ? `#${reqMatch[1]}` : null;

  // -c core.quotepath=false：git 对非 ASCII 路径默认加引号+八进制转义（如中文投影产物
  // "专家团进度总览.md"），不关掉会把引号带进文件名 → owner 前缀匹配失效（误判越界）。
  const statusLines = git(["-c", "core.quotepath=false", "show", "--pretty=format:", "--name-status", "HEAD"]).trim().split("\n").filter(Boolean);
  const files = parseNameStatus(statusLines);

  const topDirs = new Set(files.map((f) => (f.includes("/") ? f.split("/")[0] : f)));
  const cls = classifyCommit({ files, topDirs });

  const OWNER_ZONE_PREFIXES = await loadOwnerZonePrefixes();
  // 按前缀最长匹配分组 owner → files
  const byOwner = new Map();
  for (const f of files) {
    let best = null;
    let bestLen = 0;
    for (const [owner, prefixes] of Object.entries(OWNER_ZONE_PREFIXES)) {
      for (const p of prefixes) {
        if (f.startsWith(p) && p.length > bestLen) {
          best = owner;
          bestLen = p.length;
        }
      }
    }
    if (!best) best = "team-lead"; // 兜底辖区
    if (!byOwner.has(best)) byOwner.set(best, []);
    byOwner.get(best).push(f);
  }
  if (byOwner.size === 0) byOwner.set("team-lead", []);

  const fullHash = git(["rev-parse", "HEAD"]).trim();
  const cmd = commitCmdOf(fullHash);
  const sha = cmd.slice(COMMIT_CMD_PREFIX.length); // 短号，仅用于人读信息行；落账串一律用 cmd

  // 哈希去重（2026-09-27 立法；PR-251 改判据）：本提交已落账即跳过重放——钩子重放/手动补跑/回填器并发时零副作用。
  // 旧写法在此处比对字面串 `git:commit ${sha}"`，与回填器的 7 位拼法互不相认（实测并存 1281 行 7 位／2302 行 8 位），
  // 「已落账」于是只对同拼法的写入者成立。现与回填器共用 createCommitRecordIndex 的前缀包含判据。
  const ENTRIES_DIR = path.resolve(__dirname, "..", "..", "..", "docs", "dev-log", "entries");
  if (createCommitRecordIndex(ENTRIES_DIR).has(fullHash)) {
    warn(`dedup: ${cmd} 已落账，跳过重放`);
    process.exit(0);
  }

  // #1876 auth 解析：REQUIREMENTS 指令证据 → confirm/none（一次解析全 owner 复用）。
  // 解析失败（文件缺失/异常）降级空表 → 全部 none，不阻塞提交事件。
  let authEvidence = new Map();
  try {
    authEvidence = parseAuthEvidenceFromRepo(process.cwd());
  } catch (error) {
    warn(`auth evidence parse degraded to none: ${error.message}`);
  }

  for (const [owner, ownerFiles] of byOwner) {
    const zone = ownerFiles.length
      ? `${ownerFiles[0].substring(0, ownerFiles[0].lastIndexOf("/") + 1)}`
      : "docs/";
    try {
      emitDevEvent({
        owner,
        source: "dev",
        cls,
        // #1876：req 命中指令证据 → confirm；否则 none（保守缺省，升级路径留人工）。
        auth: resolveAuth({ req }, authEvidence),
        req,
        zone: zone || "docs/",
        files: ownerFiles,
        cmd,
        exit: 0,
        duration_ms: null,
        event: "dev.commit.completed",
        level: "info",
      });
    } catch (error) {
      warn(`commit event emit failed for owner "${owner}" (${sha}): ${error.message}`);
    }
  }
} catch (error) {
  warn(`commit event skipped: ${error.message}`);
}
process.exit(0);
