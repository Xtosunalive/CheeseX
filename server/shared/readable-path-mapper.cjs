/**
 * 可读物理路径生成器
 * 纯函数，不碰IO，所有结果可重复计算
 * 哈希仅存于frontmatter元数据，不出现在文件路径中
 */

function sanitizeNamePart(input) {
  if (typeof input !== "string" || !input.trim()) return "未命名";
  return input
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function categorySegments(doc) {
  const cat = doc.arch_category || doc.category || doc.arch_subdomain || "未分类";
  if (Array.isArray(cat)) return cat.map(sanitizeNamePart);
  return String(cat).split("/").map(sanitizeNamePart).filter(Boolean);
}

function buildFileName(doc) {
  const title = sanitizeNamePart(doc.title);
  const version = doc.version ? sanitizeNamePart(doc.version) : "";
  return version ? `${title}-${version}.md` : `${title}.md`;
}

/**
 * 生成单个文档的可读物理相对路径
 */
function buildReadablePhysicalPath(doc) {
  return [...categorySegments(doc), buildFileName(doc)].join("/");
}

/**
 * 批量生成唯一可读路径，重名自动加序号，保证不覆盖
 */
function buildUniqueReadablePaths(documents = []) {
  const used = new Set();
  return documents.map((doc) => {
    let path = buildReadablePhysicalPath(doc);
    let counter = 1;
    const base = path.replace(/\.md$/, "");
    while (used.has(path)) {
      path = `${base}-${counter}.md`;
      counter += 1;
    }
    used.add(path);
    return { ...doc, readablePath: path };
  });
}

// 兼容旧接口
function buildPathMap(documents = []) {
  const withPaths = buildUniqueReadablePaths(documents);
  const physicalToLogical = new Map();
  const logicalToPhysical = new Map();
  withPaths.forEach((doc) => {
    const physical = doc.sourcePath || doc.readablePath;
    physicalToLogical.set(physical, doc.readablePath);
    logicalToPhysical.set(doc.readablePath, physical);
  });
  return {
    physicalToLogical,
    logicalToPhysical,
    logicalPaths: withPaths.map((d) => d.readablePath)
  };
}

function toLogicalPath(physicalPath, pathMap) {
  if (!pathMap || !(pathMap.physicalToLogical instanceof Map)) return physicalPath;
  return pathMap.physicalToLogical.get(physicalPath) || physicalPath;
}

function toPhysicalPath(logicalPath, pathMap) {
  if (!pathMap || !(pathMap.logicalToPhysical instanceof Map)) return logicalPath;
  return pathMap.logicalToPhysical.get(logicalPath) || logicalPath;
}

function getDownloadFileName(path) {
  if (typeof path !== "string") return "文档.md";
  const parts = path.split("/");
  return parts[parts.length - 1] || "文档.md";
}

module.exports = {
  sanitizeNamePart,
  buildReadablePhysicalPath,
  buildUniqueReadablePaths,
  buildPathMap,
  toLogicalPath,
  toPhysicalPath,
  getDownloadFileName
};
