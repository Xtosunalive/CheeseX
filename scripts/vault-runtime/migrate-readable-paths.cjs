#!/usr/bin/env node
/**
 * 把哈希路径正式文件迁移到可读物理路径
 * 保留所有frontmatter元数据，不丢内容，自动处理重名
 */
const fs = require("fs");
const path = require("path");
const { buildUniqueReadablePaths } = require("../../server/shared/readable-path-mapper.cjs");
const { parseFrontmatter } = require("../../server/services/governance/vault-watcher-service.cjs");

function walkMd(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function migrate(vaultRoot) {
  const formalRoot = path.join(vaultRoot, "知识库/wiki/articles");
  const files = walkMd(formalRoot);
  const docs = files.map((file) => {
    const content = fs.readFileSync(file, "utf8");
    const fm = parseFrontmatter(content) || {};
    return {
      sourceFile: file,
      title: fm.title || path.basename(file, ".md"),
      arch_category: fm["category-path"] || fm.arch_category || "未分类",
      version: fm.version,
      sourcePath: path.relative(vaultRoot, file).split(path.sep).join("/")
    };
  });
  const withTargets = buildUniqueReadablePaths(docs);
  const results = [];
  for (const doc of withTargets) {
    const targetAbs = path.join(vaultRoot, "知识库/wiki", doc.readablePath);
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    fs.renameSync(doc.sourceFile, targetAbs);
    results.push({ from: doc.sourcePath, to: path.relative(vaultRoot, targetAbs) });
  }
  // 清理空的article-xxx目录
  fs.rmSync(formalRoot, { recursive: true, force: true });
  console.log(`迁移完成，共${results.length}个文件`);
  results.forEach((r) => console.log(`  ${r.from} → ${r.to}`));
}

const vaultArg = process.argv[2] || process.env.VAULT_PATH;
if (!vaultArg) {
  console.error("用法: node migrate-readable-paths.cjs <vault路径>");
  process.exit(1);
}
migrate(path.resolve(vaultArg));
