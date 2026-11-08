// Component: Frontmatter-Normalize
// @responsible: 统一 Obsidian frontmatter 引用型字段（wikilink [[X]]）的剥离逻辑，SSOT。
// @context: Vault
//
// 背景（REQUIREMENTS #827/#828，N1 规范化单源化）：
// "wikilink 剥离"曾在 4 处独立实现（article-admission-policy.referenceText /
// article-workflow-service.wikilinkText / draft-source-scanner.unwrapWikilink /
// document-source-scanner 未剥），行为漂移导致缺实体误报"模块无值"。
// 本模块为唯一实现；调用方如仍需 LITERAL_ARTIFACT 等 normalize 校验，在各自层叠加
// （normalizeText 保留在 document-source-scanner，避免校验行为扩散）。
//
// grep 门禁（check:frontmatter-ssot）：断言剥离正则 /^\[\[([^\]]+)\]\]$/ 只在本文件出现。

/**
 * 剥离 Obsidian wikilink 引用：[[X]] → X。
 * - 数组取首元素（frontmatter 单值字段可能是 [X] 或 X）
 * - 非字符串返回空串（与 draft-source-scanner 既有行为一致）
 * - 剥离后 trim（消除 [[ X ]] 内空白）
 * @param {unknown} value
 * @returns {string}
 */
function unwrapReference(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  const match = text.match(/^\[\[([^\]]+)\]\]$/);
  return match ? match[1].trim() : text;
}

/**
 * 统一剥离 frontmatter 引用型字段（product/module 等）。
 * 与 unwrapReference 等价，命名更明确；供需要"整批归一化"的调用方使用。
 * @param {Record<string, unknown>} frontmatter
 * @param {string[]} fields 需要剥离 wikilink 的字段名
 * @returns {Record<string, unknown>} 新对象（不改原 frontmatter）
 */
function normalizeFrontmatterFields(frontmatter, fields) {
  const source = frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter) ? frontmatter : {};
  const result = { ...source };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = unwrapReference(result[field]);
    }
  }
  return result;
}

/**
 * 剥离路径型 wikilink 引用（source_file 等，可能单侧括号）：[[X / X]] / [[X]] → X。
 * 与 unwrapReference（严格整串 [[X]]）不同——路径字段的历史数据可能是未闭合括号，
 * 需容错剥离任意侧。归入 SSOT 避免等价实现逃逸（#875 逆向核查 N1 逃逸点）。
 * @param {string} value
 * @returns {string}
 */
function unwrapPathReference(value) {
  const text = typeof value === "string" ? value : "";
  return text.replace(/^\[\[|\]\]$/g, "");
}

module.exports = { unwrapReference, unwrapPathReference, normalizeFrontmatterFields };
