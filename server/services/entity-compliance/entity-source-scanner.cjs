// Component: Entity-Source-Scanner
// @responsible: 扫描 Vault entity Markdown 并返回统一的源文档视图。
// @inputs: vaultPath/知识库/wiki/entities/*.md
// @outputs: file/raw/doc/id/title 列表
// @context: Vault

const fs = require("fs");
const path = require("path");
// WP-116 批2（SPEC-083 §二.3）：装载经文档装载端口出口（loadDocument＝宿主 parseEntityDocument
// 同底座委托，null 原型不变）——消费面禁直 require 宿主。
const { loadDocument } = require("../../shared/document-load-port.cjs");
const { normalizeFrontmatterFields } = require("../../shared/frontmatter-normalize.cjs");

function scanEntities(vaultPath) {
  const dir = path.join(vaultPath, "知识库", "wiki", "entities");
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file);
    }
  };
  visit(dir);
  return files.sort().map((file) => {
      const stat = fs.statSync(file);
      const raw = fs.readFileSync(file, "utf8");
      const doc = loadDocument(raw, file);
      // N1/#829 延伸：实体路径同样需剥 wikilink 引用（[[X]] → X）。
      // entity-source-scanner 是 N1 收敛时的遗漏面——module/product 若为 [[主模块]]，
      // 会原样进 entity-compliance 枚举比较导致误报"模块无值"（#827 同类根因）。
      // 复用 shared/frontmatter-normalize.cjs 唯一实现（SSOT，规则 8）。
      const frontmatter = normalizeFrontmatterFields(doc.frontmatter || {}, ["module", "product"]);
      return {
        file,
        raw,
        doc,
        frontmatter,
        id: String(frontmatter["architecture-node-id"] || frontmatter.architecture_node_id || "").trim(),
        title: String(frontmatter.title || "").trim(),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    });
}

module.exports = { scanEntities };
