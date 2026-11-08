// @responsible: 扫描 Markdown 文档来源并解析元数据、关系和正式文章目录。
const fs = require("fs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const path = require("path");
const { createDocumentIdentity, createFormalArticleIdentity, normalizeSourcePath, sourceHash } = require("./document-identity.cjs");
const { unwrapReference } = require("../../shared/frontmatter-normalize.cjs");
// WP-116 批2（SPEC-083 §二.3）：严格通道经文档装载端口（宿主纯转发出口）——消费面禁直 require 宿主。
const { parseEntityDocumentStrict } = require("../../shared/document-load-port.cjs");

const SOURCE_ROOTS = [
  { relativePath: "知识库/wiki/entities", documentKind: "entity" },
  { relativePath: "知识库/wiki/sources", documentKind: "source" },
  { relativePath: "知识库/wiki/overview", documentKind: "overview" },
  { relativePath: "知识库/wiki/queries", documentKind: "query" },
  { relativePath: "知识库/wiki/comparisons", documentKind: "comparison" },
  { relativePath: "知识库/wiki/todo", documentKind: "todo" },
];
const LITERAL_ARTIFACT = /^\s*(?:\[["']|\{["'])/;

const { createErrorWithDetails: typedError } = require("../../shared/error-factory.cjs");

function normalizeText(value, field, sourcePath) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number") throw typedError("INVALID_DOCUMENT", `${sourcePath}: ${field} must be scalar`);
  const text = typeof value === "number" ? `${value}` : value.trim();
  if (LITERAL_ARTIFACT.test(text)) throw typedError("INVALID_DOCUMENT", `${sourcePath}: ${field} contains literal artifact`);
  return text;
}

function normalizeStringList(value, field, sourcePath) {
  if (value === null || value === undefined || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => normalizeText(item, field, sourcePath)).filter(Boolean);
}

function normalizeBoolean(value, field, sourcePath) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw typedError("INVALID_DOCUMENT", `${sourcePath}: ${field} must be boolean`);
}

// WP-116（SPEC-083 §二.1）：`---` 切分收口至 yaml-frontmatter 单点——本函数委托严格通道
// （parseEntityDocumentStrict），三态诊断映射为与迁移前逐字相同的 INVALID_DOCUMENT 错误
// （fail-closed 语义保持；返回形状 { frontmatter, body } 不变，消费方零改动）。
function parseMarkdown(raw, sourcePath) {
  const { doc, diagnostics } = parseEntityDocumentStrict(raw, sourcePath);
  if (diagnostics.length > 0) throw typedError("INVALID_DOCUMENT", `${sourcePath}: ${diagnostics[0].message}`);
  return { frontmatter: doc.frontmatter, body: doc.body };
}

function parseRelations(raw, sourcePath) {
  const relations = [];
  const lines = raw.split(/\r?\n/);
  const pattern = /(?:(依赖|关联|文档|引用)::)?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) relations.push({ type: match[1] || "引用", target: match[2].trim(), sourcePath, lineNumber: index + 1 });
  });
  return relations;
}

function searchableText(value) {
  return value.normalize("NFKC").toLowerCase();
}

function tokenize(value) {
  const normalized = searchableText(value);
  const tokens = new Set();
  const compounds = new Set((normalized.match(/[a-z0-9][a-z0-9._-]*/g) || []).map((token) => token.replace(/^[._-]+|[._-]+$/g, "")).filter(Boolean));
  for (const token of compounds) {
    tokens.add(token);
    for (const part of token.split(/[-._]+/).filter(Boolean)) tokens.add(part);
  }
  for (const chunk of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    if (chunk.length === 1) tokens.add(chunk);
    for (let index = 0; index < chunk.length - 1; index += 1) tokens.add(chunk.slice(index, index + 2));
  }
  return [...tokens];
}

function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(absolutePath));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolutePath);
  }
  return files;
}

function scanEntries(vaultPath, entries) {
  const documents = [];
  const invalid = [];
  const identityPaths = new Map();
  for (const entry of entries) {
    const root = entry.definition;
    for (const filePath of entry.files) {
      const sourcePath = normalizeSourcePath(entry.sourcePath || path.relative(vaultPath, filePath));
      try {
        const stat = fs.statSync(filePath);
        const raw = fs.readFileSync(filePath, "utf8");
        const { frontmatter, body } = parseMarkdown(raw, sourcePath);
        const identity = root.documentKind === "standard-article"
          ? createFormalArticleIdentity(frontmatter, sourcePath)
          : createDocumentIdentity(frontmatter, sourcePath);
        if (identityPaths.has(identity.documentId)) {
          throw typedError("DUPLICATE_DOCUMENT_ID", `Duplicate document identity ${identity.documentId}`, { sourcePaths: [identityPaths.get(identity.documentId), sourcePath] });
        }
        identityPaths.set(identity.documentId, sourcePath);
        const title = normalizeText(frontmatter.title, "title", sourcePath) || path.basename(filePath, ".md");
        const relations = parseRelations(raw, sourcePath);
        documents.push({
          ...identity,
          documentKind: root.documentKind,
          title,
          sourcePath,
          sourceHash: sourceHash(raw),
          graphNodeIds: [],
          graphStatus: "pending-extraction",
          product: unwrapReference(normalizeText(frontmatter.product, "product", sourcePath)),
          version: normalizeText(frontmatter.version, "version", sourcePath),
          module: root.documentKind === "entity"
            ? normalizeStringList(frontmatter.module, "module", sourcePath)
            : unwrapReference(normalizeText(frontmatter.module, "module", sourcePath)),
          articleType: normalizeText(frontmatter.article_type, "article_type", sourcePath),
          docType: normalizeText(frontmatter["doc-type"] !== undefined ? frontmatter["doc-type"] : frontmatter.doc_type, "doc-type", sourcePath),
          categoryPath: normalizeText(frontmatter["category-path"] !== undefined ? frontmatter["category-path"] : frontmatter.category_path, "category-path", sourcePath),
          created: normalizeText(frontmatter.created, "created", sourcePath),
          hasBody: body.trim().length > 0,
          nodeId: identity.architectureNodeId || path.basename(filePath, ".md"),
          nodeLabel: title,
          arch_component: normalizeBoolean(frontmatter.arch_component, "arch_component", sourcePath),
          arch_status: normalizeText(frontmatter.arch_status, "arch_status", sourcePath),
          status: normalizeText(frontmatter.status, "status", sourcePath),
          arch_layer: normalizeText(frontmatter.arch_layer, "arch_layer", sourcePath),
          arch_category: normalizeText(frontmatter.arch_category, "arch_category", sourcePath),
          arch_subdomain: normalizeText(frontmatter.arch_subdomain, "arch_subdomain", sourcePath),
          tags: normalizeStringList(frontmatter.tags, "tags", sourcePath),
          relations,
          searchText: searchableText(`${raw}\n${body}\n${relations.map((item) => item.target).join(" ")}`),
          _raw: raw,
          _mtimeMs: stat.mtimeMs,
          _size: stat.size,
        });
      } catch (error) {
        if (error.code === "DUPLICATE_DOCUMENT_ID") throw error;
        invalid.push({ sourcePath, message: error.message });
      }
    }
  }
  return { documents, invalid };
}

function collectRootEntries(vaultPath, definitions) {
  let anyRootExists = false;
  const entries = definitions.map((definition) => {
    const absolutePath = path.join(vaultPath, definition.relativePath);
    const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();
    if (exists) anyRootExists = true;
    return { definition, files: exists ? listMarkdownFiles(absolutePath) : [] };
  }).filter((entry) => entry.files.length > 0);
  return { entries, anyRootExists };
}

function scanDocumentSources({ vaultPath } = {}) {
  // ADR063 空态三值：受管根全部缺失=配置错误 fail-closed；目录存在但空=合法空态（刷新为空快照）。
  const { entries, anyRootExists } = collectRootEntries(vaultPath, SOURCE_ROOTS);
  if (!entries.length) {
    if (!anyRootExists) throw typedError("DOCUMENT_INDEX_UNAVAILABLE", `No governed document source found under: ${path.join(vaultPath, "知识库")}`);
    return { documents: [], invalid: [] };
  }
  return scanEntries(vaultPath, entries);
}

function scanFormalReleaseSources({ vaultPath } = {}) {
  const definitions = [
    ...SOURCE_ROOTS,
    { relativePath: "知识库/wiki/articles", documentKind: "standard-article" },
  ];
  const { entries, anyRootExists } = collectRootEntries(vaultPath, definitions);
  if (!entries.length) {
    if (!anyRootExists) throw typedError("DOCUMENT_INDEX_UNAVAILABLE", `No governed document source found under: ${path.join(vaultPath, "知识库")}`);
    return { documents: [], invalid: [] };
  }
  return scanEntries(vaultPath, entries);
}

function scanCandidateArticleSources({ vaultPath } = {}) {
  const absolutePath = articleLifecycle.workingDir(vaultPath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) return { documents: [], invalid: [] };
  return scanEntries(vaultPath, [{ definition: { documentKind: "candidate" }, files: listMarkdownFiles(absolutePath) }]);
}

function scanFormalArticleCatalog({ vaultPath } = {}) {
  const formal = scanFormalReleaseSources({ vaultPath });
  const candidates = scanCandidateArticleSources({ vaultPath });
  const owners = new Map(candidates.documents
    .filter((document) => document.articleId)
    .map((document) => [document.articleId, document]));
  const invalid = [...formal.invalid, ...candidates.invalid];
  const articles = formal.documents
    .filter((document) => document.documentKind === "standard-article")
    .map((document) => {
      const owner = owners.get(document.articleId);
      if (!owner) {
        invalid.push({
          sourcePath: document.sourcePath,
          message: `Formal article ${document.articleId} has no active owner source`,
        });
        return null;
      }
      const ownerDocument = parseMarkdown(owner._raw, owner.sourcePath);
      const associations = Array.isArray(ownerDocument.frontmatter.architecture_associations)
        ? ownerDocument.frontmatter.architecture_associations.filter((item) => item && typeof item === "object" && !Array.isArray(item))
        : [];
      return {
        articleId: document.articleId,
        title: document.title,
        ownerSourcePath: owner.sourcePath,
        sourceHash: owner.sourceHash,
        product: document.product || owner.product,
        version: document.version || owner.version,
        componentIds: [...new Set(associations.map((item) => normalizeText(item.component_id, "component_id", owner.sourcePath)).filter(Boolean))].sort(),
        associations,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.articleId.localeCompare(right.articleId));
  return { articles, invalid };
}

module.exports = { SOURCE_ROOTS, normalizeText, normalizeStringList, parseMarkdown, parseRelations, scanCandidateArticleSources, scanDocumentSources, scanFormalArticleCatalog, scanFormalReleaseSources, listMarkdownFiles, searchableText, tokenize };
