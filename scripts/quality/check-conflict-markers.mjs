#!/usr/bin/env node
// check-conflict-markers.mjs — 合并冲突标记检查面（WP-021；gate-governance 域）。
// 背景：2026-10-26 两次登记簿带七字符起始标记被推送——第一次靠 pre-commit 的 JSON 解析偶然拦下
//（只对 JSON 文件有效），第二次靠人肉 grep。本检查面＝文本文件通用的机器防线。
// @responsible: quality-gate-engineer 辖区
// @inputs: --staged（暂存面，pre-commit 默认）｜--files <路径…>（指定面）｜--all（全仓跟踪文本文件）
// @outputs: conflict_markers=ok|FAIL violations=N（FAIL 逐文件:行号 列标记行）；退出码 0/1
// @context: 七字符起止标记两侧夹内容（MARKERS 常量定义）；只报起止两串（成对出现，防误报分隔线）。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 字面标记用拼接构造——本检查器扫源码文本，字面量会自咬（首跑自证实录）
const MARKERS = ["<" + "<" + "<" + "<" + "<" + "<" + "<", ">" + ">" + ">" + ">" + ">" + ">" + ">"];
const TEXT_EXTS = new Set([".md", ".json", ".yaml", ".yml", ".cjs", ".mjs", ".js", ".ts", ".tsx", ".py", ".sh", ".css", ".html", ".txt", ".svg"]);

function parseArgs(argv) {
  const out = { staged: false, all: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--staged") out.staged = true;
    else if (argv[i] === "--all") out.all = true;
    else if (argv[i] === "--files") { out.files = argv.slice(i + 1); break; }
  }
  return out;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function scanText(content) {
  const hits = [];
  content.split("\n").forEach((line, i) => {
    for (const m of MARKERS) {
      if (line.includes(m)) { hits.push({ line: i + 1, marker: m, text: line.trim().slice(0, 80) }); break; }
    }
  });
  return hits;
}

function collectFiles(args) {
  if (args.files.length) return args.files.filter((f) => fs.existsSync(f));
  if (args.all) return git(["ls-files"]).split("\n");
  // staged：变更过（A/M/R）的暂存文件——D（删除）无内容可扫
  const names = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n").filter(Boolean);
  return names;
}

export function main(argv, { cwd = process.cwd() } = {}) {
  const args = parseArgs(argv);
  const files = collectFiles(args);
  const violations = [];
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (ext && !TEXT_EXTS.has(ext)) continue; // 二进制/未知扩展跳过（文本判定保守）
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    let content;
    try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
    for (const hit of scanText(content)) {
      violations.push(`${rel}:${hit.line} ${hit.marker} ${hit.text}`);
    }
  }
  if (violations.length) {
    console.error(`conflict_markers=FAIL violations=${violations.length}`);
    for (const v of violations) console.error(`  ${v}`);
    console.error("处置：合并冲突标记残留即提交＝带病推送。重解该文件冲突后重新暂存；如系合法内容（本检查器误报），按 spec 走豁免登记。");
    return 1;
  }
  console.log(`conflict_markers=ok files=${files.length}`);
  return 0;
}

const isDirect = process.argv[1] && path.basename(process.argv[1]) === "check-conflict-markers.mjs";
if (isDirect) process.exit(main(process.argv.slice(2)));
