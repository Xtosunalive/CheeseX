// Component: Frontmatter-Rule-Engine
// @responsible: SPEC-012 结构收口批——frontmatter 受管字段校验的规则引擎单点：消费
//   contracts/validation-rules.json 声明＋enums-loader ruleSet 枚举面，一次校验全部声明规则。
//   watch 即时校验经此取用；「新规则进契约自动生效、无需在各消费点接线」这一类问题构造性消灭
//   （原 watcher 手挂 A08 一条——新增规则要记得接线，漏接即静默失防）。
// @inputs: contracts/validation-rules.json（声明）；buildRuleSet 产出的枚举面
// @outputs: validateFrontmatter(fm, ruleSet) → [{ ruleId, field, error }]
// @context: watcher 即时校验（④类痕迹消费）；规则语义与写侧 422（PR-049）同源同表
//
// 枚举面解析（enumSource 后缀 → ruleSet 键）：modules→moduleNames、article_types→articleTypes、
// doc_types→docTypes、products→products。空集跳过该规则（fail-open：无闭合集可校——
// 最小 fixture 场景不误报；真实 vault 的 ruleSet 来自真实 enums.yaml，面面俱到必校验）。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateCategoryPath } = require("./enums-loader.cjs");

const RULES_PATH = path.resolve(__dirname, "..", "..", "contracts", "validation-rules.json");
let cachedRules = null;

function loadValidationRules() {
  if (cachedRules) return cachedRules;
  const raw = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
  cachedRules = Array.isArray(raw.rules) ? raw.rules : [];
  return cachedRules;
}

/** 测试缝：换契约后清缓存。 */
function resetRuleCache() {
  cachedRules = null;
}

const ENUM_SURFACE = {
  "enums.yaml#modules": "moduleNames",
  "enums.yaml#article_types": "articleTypes",
  "enums.yaml#doc_types": "docTypes",
  "enums.yaml#products": "products",
  // WP-156：分类治理规则四类上契约（值域全部既有词表面——formalTags/statuses buildRuleSet 既有，reviewCycles 本包补派生）
  "enums.yaml#tags": "formalTags",
  "enums.yaml#lifecycle.status": "statuses",
  "enums.yaml#lifecycle.review_cycle": "reviewCycles",
};

/** WP-156：契约条目 errorTemplate 渲染——{field}/{value}/{values}/{replacement} 占位；
 *  {values}＝闭合集排序列表（对齐退役 Python 侧 sorted 文案）。无模板时保持既有文案（向后兼容）。 */
function renderRuleMessage(template, rule, value, closure) {
  if (!template) return null;
  return template
    .replace("{field}", rule.field)
    .replace("{value}", String(value))
    .replace("{values}", (Array.isArray(closure) ? [...closure].sort() : []).join(", "))
    .replace("{replacement}", rule.replacement || "");
}

/**
 * 按 validation-rules.json 声明校验一份 frontmatter。
 * @param {object} fm 解析后的 frontmatter 键值（字符串标量）
 * @param {object} ruleSet buildRuleSet 产出
 * @returns {Array<{ruleId: string, field: string, error: string}>}
 */
function validateFrontmatter(fm, ruleSet) {
  const violations = [];
  if (!fm || typeof fm !== "object" || !ruleSet) return violations;
  for (const rule of loadValidationRules()) {
    if (!rule || typeof rule.field !== "string") continue;
    const value = fm[rule.field];
    if (rule.type === "structured-two-part") {
      if (typeof value === "string" && value) {
        const err = validateCategoryPath(value, ruleSet);
        if (err) violations.push({ ruleId: rule.id, field: rule.field, error: err });
      } else if (rule.required) {
        violations.push({ ruleId: rule.id, field: rule.field, error: `${rule.field} 必填` });
      }
      continue;
    }
    if (rule.type === "enum" || rule.type === "managed-enum") {
      const surfaceKey = ENUM_SURFACE[rule.enumSource];
      const surface = surfaceKey ? ruleSet[surfaceKey] : null;
      const closure = Array.isArray(surface) ? surface : null;
      if (closure && closure.length > 0) {
        if (typeof value !== "string" || !value) {
          if (rule.required !== false) violations.push({ ruleId: rule.id, field: rule.field, error: `${rule.field} 必填` });
        } else if (!closure.includes(value)) {
          const rendered = renderRuleMessage(rule.errorTemplate, rule, value, closure);
          violations.push({ ruleId: rule.id, field: rule.field, error: rendered || `${rule.field} 值 "${value}" 不在闭合枚举内` });
        }
      }
      continue;
    }
    // WP-156：enum-list——标量或数组逐项查闭合集（tags 形态）；缺失跳过；闭合集为空＝无合法值，
    // 任何值即违规（对齐退役 Python validate_tags fail-closed 语义——与既有 enum 分支的空集 fail-open 相反，契约逐条定形）。
    if (rule.type === "enum-list") {
      const surfaceKey = ENUM_SURFACE[rule.enumSource];
      const surface = surfaceKey ? ruleSet[surfaceKey] : null;
      const closure = Array.isArray(surface) ? surface : [];
      const items = value === undefined || value === null || value === ""
        ? []
        : Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (!closure.includes(item)) {
          const rendered = renderRuleMessage(rule.errorTemplate, rule, item, closure);
          violations.push({ ruleId: rule.id, field: rule.field, error: rendered || `${rule.field} 值 "${item}" 不在闭合枚举内` });
        }
      }
      continue;
    }
    // WP-156：required——非空必填＋可选 formatRegex（date/updated 语义：缺失「必填」、非空不合格式报「格式错误」）。
    if (rule.type === "required") {
      const v = value === undefined || value === null ? "" : String(value).trim();
      if (!v) {
        violations.push({ ruleId: rule.id, field: rule.field, error: `${rule.field} 必填` });
      } else if (rule.formatRegex && !new RegExp(rule.formatRegex).test(v)) {
        violations.push({ ruleId: rule.id, field: rule.field, error: `${rule.field} 格式错误：'${v}'（${rule.formatHint || "格式不符"}）` });
      }
      continue;
    }
    // WP-156：expiry-date——选填；出现时须可解析为日期且不早于当前时刻（过期即违规——运行时动态判定）。
    if (rule.type === "expiry-date") {
      const v = value === undefined || value === null ? "" : String(value).trim();
      if (!v) continue;
      const parsed = Date.parse(v.slice(0, 10));
      if (Number.isNaN(parsed)) {
        const rendered = renderRuleMessage(rule.errorTemplate, rule, v) || `${rule.field} 格式错误：'${v}'`;
        violations.push({ ruleId: rule.id, field: rule.field, error: rendered });
      } else if (parsed < Date.now()) {
        const rendered = renderRuleMessage(rule.expiredTemplate, rule, v) || `文档已过期：${rule.field}=${v}`;
        violations.push({ ruleId: rule.id, field: rule.field, error: rendered });
      }
      continue;
    }
    // WP-156：deprecated-field——frontmatter 出现该字段即提示废弃（应使用 replacement），无值也报（键存在即旧写法）。
    if (rule.type === "deprecated-field") {
      if (value !== undefined) {
        const rendered = renderRuleMessage(rule.errorTemplate, rule, value) || `废弃字段：'${rule.field}'（应使用 '${rule.replacement}'）`;
        violations.push({ ruleId: rule.id, field: rule.field, error: rendered });
      }
      continue;
    }
  }
  return violations;
}

module.exports = { validateFrontmatter, loadValidationRules, resetRuleCache, RULES_PATH };
