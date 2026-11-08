// Component: Draft-Source-Scanner
// @responsible: 扫描 Vault raw/drafts 目录，返回解析后的草稿文档
// @inputs: vaultPath/知识库/raw/drafts/**/*.md
// @outputs: [{ file, raw, mtimeMs, size, frontmatter, hasBody }]

const fs = require("fs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const path = require("path");
// WP-116 批2（SPEC-083 §二.3）：装载经文档装载端口出口（loadDocument＝宿主 parseEntityDocument
// 同底座委托，null 原型不变）——消费面禁直 require 宿主。
const { loadDocument } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");
const { isExcludedDraftScanPath } = require("./draft-scan-policy.cjs");
const { unwrapReference } = require("../../shared/frontmatter-normalize.cjs");

/**
 * @param {string} vaultPath
 * @returns {Array<{ file: string, raw: string, mtimeMs: number, size: number, frontmatter: object, hasBody: boolean }>}
 */
function scanDraftSources(vaultPath) {
  var draftsDir = articleLifecycle.draftsDir(vaultPath);
  if (!fs.existsSync(draftsDir)) return [];

  // Collect all .md files under drafts/ (with exclusion filtering)
  var draftFiles = [];
  var pending = [draftsDir];
  while (pending.length > 0) {
    var current = pending.pop();
    var entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.name.startsWith(".")) continue;
      var full = path.join(current, entry.name);
      var rel = path.relative(vaultPath, full).split(path.sep).join("/");
      if (isExcludedDraftScanPath(rel)) continue;
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) draftFiles.push(full);
    }
  }

  // Read and parse each draft
  var results = [];
  for (var df = 0; df < draftFiles.length; df++) {
    var absPath = draftFiles[df];
    var relPath = path.relative(vaultPath, absPath).split(path.sep).join("/");
    try {
      var stat = fs.statSync(absPath);
      var raw = fs.readFileSync(absPath, "utf8");
      var doc = loadDocument(raw, absPath);
      var fm = doc.frontmatter || {};
      results.push({
        file: absPath,
        raw: raw,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        relPath: relPath,
        frontmatter: {
          // 投影键＝frontmatter 字段名逐字（键名经文档键源单点，WP-138 R5b）；产出 JSON 键序不变
          [DK.ARTICLE.articleId]: fm[DK.ARTICLE.articleId] || "",
          [DK.ARTICLE.title]: fm[DK.ARTICLE.title] || "",
          [DK.ARTICLE.product]: unwrapReference(fm[DK.ARTICLE.product]),
          [DK.ARTICLE.version]: fm[DK.ARTICLE.version] || "",
          [DK.ARTICLE.module]: unwrapReference(fm[DK.ARTICLE.module]),
          [DK.ARTICLE.articleType]: fm[DK.ARTICLE.articleType] || "",
          // 双拼写回落语义原样（`||` 链）——只换键名来源（WP-138 R5b 等价替换纪律）
          [DK.ARTICLE.docType]: fm[DK.ARTICLE.docType] || fm[DK.ARTICLE.docTypeLegacy] || "",
          [DK.ARTICLE.categoryPath]: fm[DK.ARTICLE.categoryPath] || fm[DK.ARTICLE.categoryPathLegacy] || "",
          [DK.ARTICLE.tags]: Array.isArray(fm[DK.ARTICLE.tags]) ? fm[DK.ARTICLE.tags] : [],
        },
        hasBody: typeof doc.body === "string" && doc.body.trim().length > 0,
      });
    } catch (_) {
      // Skip unreadable files
    }
  }
  return results;
}

module.exports = { scanDraftSources };
