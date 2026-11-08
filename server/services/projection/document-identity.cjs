// @responsible: 生成文档及正式文章的稳定身份、规范路径与内容哈希。
const crypto = require("crypto");

const { createError: typedError } = require("../../shared/error-factory.cjs");

function normalizeIdentityValue(value, field, sourcePath) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw typedError("INVALID_DOCUMENT_IDENTITY", `${sourcePath}: ${field} must be a scalar`);
  }
  return `${value}`.trim();
}

function normalizeSourcePath(sourcePath) {
  return `${sourcePath || ""}`.replace(/\\/g, "/").replace(/^\.\//, "");
}

function createDocumentIdentity(frontmatter, sourcePath) {
  const normalizedPath = normalizeSourcePath(sourcePath);
  const articleId = normalizeIdentityValue(frontmatter.article_id, "article_id", normalizedPath);
  const architectureNodeId = normalizeIdentityValue(
    frontmatter["architecture-node-id"] !== undefined ? frontmatter["architecture-node-id"] : frontmatter.architecture_node_id,
    "architecture-node-id",
    normalizedPath,
  );
  if (articleId) return { documentId: `article:${articleId}`, articleId, architectureNodeId, identitySource: "article_id" };
  if (architectureNodeId) return { documentId: `entity:${architectureNodeId}`, articleId: "", architectureNodeId, identitySource: "architecture-node-id" };
  return { documentId: `path:${normalizedPath}`, articleId: "", architectureNodeId: "", identitySource: "sourcePath" };
}

function createFormalArticleIdentity(frontmatter, sourcePath) {
  const identity = createDocumentIdentity(frontmatter, sourcePath);
  if (identity.identitySource !== "article_id") {
    throw typedError("FORMAL_ARTICLE_ID_REQUIRED", `${normalizeSourcePath(sourcePath)}: formal article requires article_id`);
  }
  return identity;
}

function sourceHash(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${value}`, "utf8");
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

module.exports = { createDocumentIdentity, createFormalArticleIdentity, normalizeSourcePath, sourceHash };
