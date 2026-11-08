// @responsible: 规范化文章来源路径并判定 Manifest 来源的排除与匹配类型。
const EXCLUDED_SOURCE_PATTERNS = [
  { pattern: /^知识库\/TheSchema\//, reason: "TheSchema 参考文件，非知识文章" },
  { pattern: /^TheSchema\//, reason: "TheSchema 参考文件（normalized）" },
  { pattern: /\/README\.md$/i, reason: "导航索引页面" },
  { pattern: /\/index\.md$/i, reason: "导航索引页面" },
  { pattern: /\/\.template-/, reason: "模板文件" },
  { pattern: /^知识库\/architecture\//, reason: "架构数据文件" },
  { pattern: /^知识库\/raw\//, reason: "候选与投稿内容，未进入正式知识准入" },
  { pattern: /^raw\//, reason: "候选与投稿内容（normalized）" },
  { pattern: /^\.ledger\//, reason: "配置目录" },
  { pattern: /^\.obsidian\//, reason: "配置目录" },
  { pattern: /^\.github\//, reason: "配置目录" },
  { pattern: /^\.claude\//, reason: "配置目录" },
];

function normalizeSourcePath(rawPath, vaultPath) {
  let value = String(rawPath || "").replace(/\\/g, "/").trim();
  if (vaultPath) {
    const vaultBase = String(vaultPath).replace(/\\/g, "/").replace(/\/+$/, "");
    if (value.startsWith(`${vaultBase}/`)) value = value.slice(vaultBase.length + 1);
    if (value.startsWith(vaultBase)) value = value.slice(vaultBase.length);
  }
  return value.replace(/^知识库\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function isSourceExcluded(sourcePath) {
  const value = String(sourcePath || "").replace(/\\/g, "/").trim();
  if (!value) return { excluded: false };
  const rule = EXCLUDED_SOURCE_PATTERNS.find((item) => item.pattern.test(value));
  return rule ? { excluded: true, reason: rule.reason } : { excluded: false };
}

function classifySourceMatch(normalizedPath, inferenceFile) {
  const value = String(inferenceFile || "").replace(/\\/g, "/").trim();
  if (!value) return "none";
  if (value.includes("*") || value.includes("module:") || (!value.endsWith(".md") && !value.includes("wiki/") && !value.includes("raw/"))) return "synthetic";
  if (value === normalizedPath) return "exact";
  if (normalizedPath.endsWith(value) || value.endsWith(normalizedPath)) return "suffix";
  const normalizedBase = normalizedPath.split("/").pop();
  const valueBase = value.split("/").pop();
  return normalizedBase && valueBase && normalizedBase === valueBase ? "suffix" : "none";
}

module.exports = { classifySourceMatch, isSourceExcluded, normalizeSourcePath };
