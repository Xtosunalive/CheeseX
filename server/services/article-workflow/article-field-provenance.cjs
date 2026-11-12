"use strict";

// WP-169（SPEC-095 §3.1 首批子集）：字段来源三态标记——自动生成（机械确定性落盘）／人工（既有值）／未提取到（受管无信号）。
// 纯函数模块：不读文件、不写状态；键名用 frontmatter 逐字拼写（DK.ARTICLE 值）。
// B12 先例延续：推测（suggest）永不落盘为确认值，只作为 not-extracted 态上的 suggestion 附注。

const { ARTICLE } = require("../../shared/document-keys.cjs");

// 受管提取集＝草稿提取流程（autoFillDraftFrontmatter）实际管理的字段，单源在此、与管理者同址。
// 双拼写键（doc-type/category-path）归并为规范键输出，legacy 拼写不单独成行。
const MANAGED_FIELDS = Object.freeze([
  ARTICLE.title, ARTICLE.date, ARTICLE.updated, ARTICLE.status,
  ARTICLE.module, ARTICLE.articleType, ARTICLE.docType, ARTICLE.categoryPath, ARTICLE.tags,
].map(String));

// 双拼写别名（WP-138 R5b 等价替换纪律：双查双拼写，值取向与草稿流程一致——canonical 优先）。
const FIELD_ALIASES = Object.freeze({
  [ARTICLE.docType]: [ARTICLE.docTypeLegacy].filter(Boolean),
  [ARTICLE.categoryPath]: [ARTICLE.categoryPathLegacy].filter(Boolean),
});

function resolveValue(frontmatter, field) {
  if (!frontmatter) return undefined;
  const canonical = frontmatter[field];
  if (!isEmptyValue(canonical)) return canonical;
  for (const alias of FIELD_ALIASES[field] || []) {
    const aliasValue = frontmatter[alias];
    if (!isEmptyValue(aliasValue)) return aliasValue;
  }
  return isEmptyValue(canonical) ? canonical : canonical;
}

function isEmptyValue(value) {
  return value === null || value === undefined
    || (typeof value === "string" && !value.trim())
    || (Array.isArray(value) && value.length === 0);
}

// 计算草稿提取时刻的字段来源快照。
// frontmatter：autoFill 运行前的 frontmatter（人工态判定基准）；autoFilled/suggested：autoFill 本次产物（键为拼写）。
function computeDraftProvenance(frontmatter, autoFilled, suggested, autoChanges) {
  const filledSet = new Set(autoFilled || []);
  const provenance = {};
  for (const field of MANAGED_FIELDS) {
    const preexisting = resolveValue(frontmatter, field);
    const hasPreexisting = !isEmptyValue(preexisting);
    if (filledSet.has(field)) {
      // auto 态快照值＝机器本次写入的值（autoChanges），非填前空值——否则合并比对必判漂移
      const written = autoChanges && Object.prototype.hasOwnProperty.call(autoChanges, field)
        ? autoChanges[field] : preexisting;
      provenance[field] = { source: "auto", value: written === undefined ? null : written };
    } else if (hasPreexisting) {
      provenance[field] = { source: "human", value: preexisting };
    } else {
      provenance[field] = { source: "not-extracted", value: null };
      const suggestion = suggested && suggested[field];
      if (suggestion !== undefined && !isEmptyValue(suggestion)) provenance[field].suggestion = suggestion;
    }
  }
  return provenance;
}

// 快照与当前 frontmatter 合并（标准化时刻报告用）：
// 当前值与快照值一致 → 保留快照来源；不一致且非空 → 人工改写；被清空 → 未提取到（机器从不清空字段）。
// 无快照（本特性前的存量文章）→ 保守口径：有值＝人工（机器写入无记录，不得冒认 auto）、无值＝未提取到。
function mergeProvenanceWithCurrent(snapshot, currentFrontmatter) {
  const merged = {};
  for (const field of MANAGED_FIELDS) {
    const current = resolveValue(currentFrontmatter, field);
    const present = !isEmptyValue(current);
    const entry = snapshot && snapshot[field];
    if (!entry) { merged[field] = { source: present ? "human" : "not-extracted" }; continue; }
    if (!present) { merged[field] = { source: "not-extracted" }; continue; }
    const unchanged = entry.value !== undefined && entry.value !== null
      ? JSON.stringify(entry.value) === JSON.stringify(current)
      : false;
    merged[field] = { source: unchanged ? entry.source : "human" };
  }
  return merged;
}

module.exports = { MANAGED_FIELDS, computeDraftProvenance, mergeProvenanceWithCurrent };
