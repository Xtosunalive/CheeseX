#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildFileName } = require("../../server/shared/readable-path-mapper.cjs");
const { loadDocument } = require("../../server/shared/document-load-port.cjs");
const articleLifecycle = require("../../server/shared/article-lifecycle-paths.cjs");
const DK = require("../../server/shared/document-keys.cjs");

function markdownFiles(root) {
  const files = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file);
    }
  };
  visit(root);
  return files.sort();
}

function sha256(raw) { return crypto.createHash("sha256").update(raw).digest("hex"); }

function buildPlan(vaultRoot) {
  const formalRoot = articleLifecycle.formalArticlesDir(vaultRoot);
  const files = markdownFiles(formalRoot);
  const reserved = new Set(files.map((file) => path.relative(formalRoot, file).normalize("NFC").toLocaleLowerCase()));
  const identities = new Map();
  const moves = [];
  for (const source of files) {
    const raw = fs.readFileSync(source, "utf8");
    const fm = loadDocument(raw, source).frontmatter || {};
    const id = typeof fm[DK.ARTICLE.articleId] === "string" ? fm[DK.ARTICLE.articleId].trim() : "";
    if (id && identities.has(id)) throw new Error(`正式文件 article_id 重复: ${identities.get(id)} / ${source}`);
    if (id) identities.set(id, source);
    if (!/^[0-9a-f]{64}\.md$/.test(path.basename(source))) continue;
    if (!id || !fm.title) throw new Error(`旧正式文件身份或标题缺失: ${source}`);
    const domain = path.relative(formalRoot, source).split(path.sep)[0];
    if (!domain || domain === "..") throw new Error(`正式文件不在域目录: ${source}`);
    const base = buildFileName({ title: fm.title, version: fm.version }).replace(/\.md$/, "");
    let target;
    for (let suffix = 0; ; suffix += 1) {
      target = path.join(formalRoot, domain, `${base}${suffix ? `-${suffix}` : ""}.md`);
      const key = path.relative(formalRoot, target).normalize("NFC").toLocaleLowerCase();
      if (!reserved.has(key)) { reserved.add(key); break; }
    }
    moves.push({ from: path.relative(vaultRoot, source).split(path.sep).join("/"), to: path.relative(vaultRoot, target).split(path.sep).join("/"), hash: sha256(raw), articleId: id, mode: fs.statSync(source).mode & 0o777 });
  }
  return { vaultRoot, planHash: sha256(JSON.stringify(moves)), moves };
}

function applyPlan(plan, expectedPlanHash) {
  if (!expectedPlanHash || expectedPlanHash !== plan.planHash) throw new Error("迁移计划哈希不匹配，请重新预览");
  const done = [];
  try {
    for (const move of plan.moves) {
      const source = path.join(plan.vaultRoot, move.from);
      const target = path.join(plan.vaultRoot, move.to);
      if (sha256(fs.readFileSync(source)) !== move.hash || fs.existsSync(target)) throw new Error(`迁移前文件已变化或目标已存在: ${move.from}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(source, target);
      done.push(move);
      fs.chmodSync(target, 0o644);
    }
  } catch (error) {
    for (const move of done.reverse()) {
      const source = path.join(plan.vaultRoot, move.from);
      const target = path.join(plan.vaultRoot, move.to);
      if (fs.existsSync(target) && !fs.existsSync(source) && sha256(fs.readFileSync(target)) === move.hash) {
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.renameSync(target, source);
        fs.chmodSync(source, move.mode);
      }
    }
    throw error;
  }
  return { ...plan, applied: done.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const vaultIndex = args.indexOf("--vault");
  const hashIndex = args.indexOf("--plan-hash");
  if (vaultIndex < 0 || !args[vaultIndex + 1]) {
    console.error("用法: node migrate-readable-paths.cjs --vault <绝对路径> [--apply --plan-hash <预览哈希>]");
    process.exitCode = 2;
  } else {
    try {
      const vaultRoot = path.resolve(args[vaultIndex + 1]);
      const plan = buildPlan(vaultRoot);
      const result = args.includes("--apply") ? applyPlan(plan, hashIndex >= 0 ? args[hashIndex + 1] : "") : plan;
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = { buildPlan, applyPlan };
