// Component: Article-Lifecycle-Paths
// @responsible: 文章生命周期路径角色唯一运行时单源——根路径/前缀判定/目录构造从此取用，
//   server 侧禁止裸拼四族路径（check:article-lifecycle 静态执法）。
// @inputs: contracts/article-lifecycle.json（角色根路径唯一事实源）
// @outputs: 角色根常量＋isUnderXxx 判定＋xxxDir 目录构造（vaultPath 前置参纯工具，无副作用）
// @context: SPEC-013 文章生命周期单份收敛（Master 2026-10-15 裁「一篇＝标准文章×1＋原文归档×1」；
//   TALOS file-rules 同构先例）。与 article-manifest-paths 分层：彼管 manifest key 归一化，本模块管路径角色。

"use strict";

const path = require("path");

const CONTRACT = require("../../contracts/article-lifecycle.json");

function role(id) {
  const found = CONTRACT.roles.find((r) => r.id === id);
  if (!found) throw new Error(`article-lifecycle 契约缺角色: ${id}`);
  return found;
}

const DRAFT_ROOT = role("draft").root;                       // 知识库/raw/drafts
const SUBMISSION_DRAFT_PREFIX = `${role("draft").submission_dir}/`; // 知识库/raw/drafts/投稿/
const WORKING_ROOT = role("standard-working").root;          // 知识库/raw/precleaned
const FORMAL_ROOT = role("standard-formal").root;            // 知识库/wiki/articles
const ARCHIVE_ROOT = role("source-archive").root;            // 知识库/raw/archive
// 无「知识库/」前缀的正式区段（存量消费方以 wiki/articles/ 子串识正式路径——manifest-lineage 等）
const FORMAL_SEGMENT = `${FORMAL_ROOT.replace(/^知识库\//, "")}/`;

// SPEC-028 可变性档：角色 → 档位（契约角色行 mutability 字段单源派生）
const ROLE_MUTABILITY = Object.fromEntries(CONTRACT.roles.map((r) => [r.id, r.mutability]));
const READ_ONLY_EVIDENCE = "read-only-evidence";

function isUnder(relPath, root) {
  return typeof relPath === "string" && relPath.startsWith(`${root}/`);
}

/** 目录构造（vaultPath 须绝对路径——生产装配形态） */
function draftsDir(vaultPath) { return path.join(vaultPath, ...DRAFT_ROOT.split("/")); }
function submissionDraftsDir(vaultPath) { return path.join(vaultPath, ...SUBMISSION_DRAFT_PREFIX.replace(/\/$/, "").split("/")); }
function workingDir(vaultPath) { return path.join(vaultPath, ...WORKING_ROOT.split("/")); }
function formalArticlesDir(vaultPath) { return path.join(vaultPath, ...FORMAL_ROOT.split("/")); }
function archiveDir(vaultPath, lane) { return lane ? path.join(vaultPath, ...ARCHIVE_ROOT.split("/"), lane) : path.join(vaultPath, ...ARCHIVE_ROOT.split("/")); }
/** 正式文章源路径（vault 相对）：知识库/wiki/articles/<域>/<articleId目录>/<文件>（SPEC-030 派②位置维——域=category-path 首段） */
function formalSourcePath(domainSegment, dirName, fileName) { return `${FORMAL_ROOT}/${domainSegment}/${dirName}/${fileName}`; }
/** 正式区域子目录绝对路径（发布时 mkdir recursive） */
function formalDomainDir(vaultPath, domainSegment) { return path.join(formalArticlesDir(vaultPath), domainSegment); }

/**
 * 域段解析（SPEC-030 派②位置维）：category-path（两段式 域:子域，WP-040）→ 物理目录段。
 * 值域校验 fail-closed：首段不在受管域集 → 抛错（域值单源=enums domains，禁自由造目录）。
 * 物理层只用域段（一层）；子域/主题留 frontmatter 供检索。
 */
function resolveDomainSegment(categoryPath, allowedDomains) {
  const raw = typeof categoryPath === "string" ? categoryPath.trim() : "";
  const first = raw.split(":")[0].trim();
  if (!first) throw new Error("category-path 缺失——正式区落位需要域段（SPEC-030 派②）");
  if (Array.isArray(allowedDomains) && allowedDomains.length > 0 && !allowedDomains.includes(first)) {
    throw new Error(`category-path 首段 '${first}' 不在受管域值集（SPEC-030 派②：域目录单源=enums domains）`);
  }
  return first;
}

/** 角色判定（vault 相对路径；斜杠归一化由调用方负责——与既有 startsWith 语义一致） */
function isUnderDraft(relPath) { return isUnder(relPath, DRAFT_ROOT); }

// ── WP-066（SPEC-059）：生命周期状态化转移——状态守卫（替代路径前缀守卫）──
/** 物理路径 → 生命周期状态 id（契约 roles 单源派生）。不在任何角色根下 → null。 */
function stateOf(relPath) {
  const rel = normalizeRel(relPath);
  for (const role of CONTRACT.roles) {
    if (isUnder(rel, role.root)) return role.id;
  }
  return null;
}

function normalizeRel(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** 状态化转移守卫：文件存在但状态≠起点 → 409 LIFECYCLE_STATE_MISMATCH（携带 current/expected）。
 *  缺件由调用方既有 404 面承载（本函数不做存在性检查）。 */
function assertTransitionState(relPath, expectedState) {
  const current = stateOf(relPath);
  if (current !== expectedState) {
    const error = new Error("生命周期状态不匹配：文件当前处于 " + (current || "未受管") + " 态，此转移要求 " + expectedState + " 起点");
    error.code = "LIFECYCLE_STATE_MISMATCH";
    error.status = 409;
    error.details = { currentState: current, expectedState };
    throw error;
  }
  return current;
}
function isSubmissionDraft(relPath) { return typeof relPath === "string" && relPath.startsWith(SUBMISSION_DRAFT_PREFIX); }
function isUnderWorking(relPath) { return isUnder(relPath, WORKING_ROOT); }
function isUnderFormal(relPath) { return isUnder(relPath, FORMAL_ROOT); }
function isUnderArchive(relPath) { return isUnder(relPath, ARCHIVE_ROOT); }
function hasFormalSegment(value) { return typeof value === "string" && value.includes(FORMAL_SEGMENT); }

/**
 * 可变性档解析（SPEC-028）：vault 相对路径 → 所在角色档位；四角色根外返回 null（不执法）。
 * 归档 lane 子目录（知识库/raw/archive/投稿/…）随 source-archive 根命中。
 */
function resolveMutability(relPath) {
  if (typeof relPath !== "string" || relPath === "") return null;
  const rel = relPath.replace(/\\/g, "/");
  if (isUnderFormal(rel)) return ROLE_MUTABILITY["standard-formal"];
  if (isUnderArchive(rel)) return ROLE_MUTABILITY["source-archive"];
  if (isUnderWorking(rel)) return ROLE_MUTABILITY["standard-working"];
  if (isUnderDraft(rel)) return ROLE_MUTABILITY.draft;
  return null;
}

module.exports = {
  DRAFT_ROOT, SUBMISSION_DRAFT_PREFIX, WORKING_ROOT, FORMAL_ROOT, ARCHIVE_ROOT, FORMAL_SEGMENT,
  draftsDir, submissionDraftsDir, workingDir, formalArticlesDir, formalDomainDir, archiveDir, formalSourcePath,
  resolveDomainSegment,
  isUnderDraft, isSubmissionDraft, isUnderWorking, isUnderFormal, isUnderArchive, hasFormalSegment,
  ROLE_MUTABILITY, READ_ONLY_EVIDENCE, resolveMutability, stateOf, assertTransitionState };
