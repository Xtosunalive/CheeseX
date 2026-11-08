// @tests: server/shared/frontmatter-rule-engine.cjs
// SPEC-012 结构收口批——规则引擎类消灭守卫：
//   ① validation-rules.json 声明的全部规则生效（五规则逐一：product/module/article_type/doc-type/category-path）
//   ② 契约新增规则自动生效（无需消费点接线——本类的核心断言）
//   ③ 空闭合集跳过（最小 fixture 不误报）＋非对象/缺 ruleSet 安全面
// 层级：纯单元。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateFrontmatter, loadValidationRules, resetRuleCache } = require("../frontmatter-rule-engine.cjs");
const { buildRuleSet } = require("../enums-loader.cjs");

const FULL_RULESET = buildRuleSet({
  domains: { ops: "运维" },
  subdomains: { ops: ["deploy", "network"] },
  modules: { "ops-deploy": { subdomain: "ops:deploy" }, "ops-network": { subdomain: "ops:network" } }, // 值须为对象（enums.schema.json：模块注册表）
  article_types: ["标准文章"],
  doc_types: ["手册"],
  architecture_projection: { product: "AnyShare", product_aliases: { AS: "AnyShare" } },
});

test("① 声明的五规则全部生效（逐字段）", () => {
  const ok = validateFrontmatter(
    { product: "AnyShare", module: "ops-deploy", article_type: "标准文章", "doc-type": "手册", "category-path": "ops:deploy", date: "2026-11-01", updated: "2026-11-02" },
    FULL_RULESET,
  );
  assert.deepEqual(ok, [], "全合法零违规");

  const bad = validateFrontmatter(
    { product: "Ghost", module: "no-such-module", article_type: "野类型", "doc-type": "野文档", "category-path": "ghost:deploy", date: "2026-11-01", updated: "2026-11-02" },
    FULL_RULESET,
  );
  const fields = bad.map((v) => v.field).sort();
  assert.deepEqual(fields, ["article_type", "category-path", "doc-type", "module", "product"], "五字段各自报违规");
  assert.ok(bad.every((v) => v.ruleId && v.error), "每条违规带 ruleId 与人话 error");
});

test("② 契约新增规则自动生效（无需消费点接线——本类核心断言）", () => {
  // 临时换契约：追加一条新规则（A99 demo-field），引擎零改动即生效
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fm-engine-"));
  const backup = fs.readFileSync(loadValidationRulesPath(), "utf-8");
  try {
    const rules = JSON.parse(backup);
    rules.rules.push({ id: "A99", field: "demo-field", type: "enum", required: true, enumSource: "enums.yaml#doc_types", description: "测试注入" });
    fs.writeFileSync(loadValidationRulesPath(), JSON.stringify(rules, null, 2));
    resetRuleCache();
    const violations = validateFrontmatter({ "demo-field": "野值" }, FULL_RULESET);
    assert.ok(violations.some((v) => v.field === "demo-field"), "新契约规则须自动生效（类消灭②）");
  } finally {
    fs.writeFileSync(loadValidationRulesPath(), backup);
    resetRuleCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("③ 空闭合集跳过（最小 fixture 不误报）＋安全面", () => {
  const minimal = buildRuleSet({ domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } });
  const violations = validateFrontmatter({ date: "2026-11-01", updated: "2026-11-02" }, minimal);
  assert.deepEqual(violations, [], "无闭合集的规则跳过（fixture 场景零误报）");
  assert.deepEqual(validateFrontmatter(null, FULL_RULESET), []);
  assert.deepEqual(validateFrontmatter({ product: "AnyShare" }, null), []);
});

// 引擎契约路径经模块导出 RULES_PATH；此处复用（防硬编码第二份路径）
function loadValidationRulesPath() {
  return require("../frontmatter-rule-engine.cjs").RULES_PATH;
}

// ── WP-156：分类治理规则四类（A09-A16）——语义对齐退役 validate_classification.py（Python 基线转录，对拍钉）。
// 引擎与真契约耦合（loadValidationRules 读 contracts/validation-rules.json 13 条）——测试 fm 须喂全字段：
// 其余规则的合法基线（LEGAL_BASE）保证「只让目标字段违规」。
const GOV_FULL = buildRuleSet({
  domains: { tech: "技术" },
  subdomains: { tech: ["api"] },
  modules: { "tech-api": { subdomain: "tech:api" } },
  article_types: ["标准文章"],
  doc_types: ["手册"],
  architecture_projection: { product: "测试产品", product_aliases: {} },
  tags: { 分类法: ["图谱", "安装部署"] },
  lifecycle: { status: ["灰度", "在线", "退役", "已驳回"], review_cycle: ["30d", "90d", "180d", "365d"], default_status: "灰度" },
});
const LEGAL_BASE = {
  product: "测试产品",
  module: "tech-api",
  article_type: "标准文章",
  "doc-type": "手册",
  "category-path": "tech:api",
  date: "2026-11-01",
  updated: "2026-11-02",
};

test("④ A09 tags（enum-list）：数组逐项查白名单、缺失跳过、闭合集空全报（对齐退役 fail-closed 语义）", () => {
  const bad = validateFrontmatter({ ...LEGAL_BASE, tags: ["图谱", "乱写的tag"] }, GOV_FULL);
  assert.deepEqual(
    bad.map((v) => v.error),
    ["tag 非法：'乱写的tag'（不在分类法白名单中）"],
    "合法项不报、非法项逐字文案（Python 基线）",
  );
  const scalar = validateFrontmatter({ ...LEGAL_BASE, tags: "图谱" }, GOV_FULL);
  assert.deepEqual(scalar, [], "标量合法 tag 视为单元素数组通过");
  const noTags = validateFrontmatter({ ...LEGAL_BASE }, GOV_FULL);
  assert.deepEqual(noTags.map((v) => v.field), [], "tags 缺失跳过（非进门必填）");
  const emptyClosure = buildRuleSet({
    domains: { tech: "技术" }, subdomains: { tech: ["api"] },
    modules: { "tech-api": { subdomain: "tech:api" } }, article_types: ["标准文章"], doc_types: ["手册"],
    architecture_projection: { product: "测试产品", product_aliases: {} }, tags: {},
    lifecycle: { status: ["在线"], review_cycle: ["30d"], default_status: "在线" },
  });
  const allBad = validateFrontmatter({ ...LEGAL_BASE, tags: ["任何值"] }, emptyClosure);
  assert.equal(allBad.filter((v) => v.ruleId === "A09").length, 1, "闭合集空＝无合法 tag——任何值即违规（fail-closed，与既有 enum 分支空集跳过相反，契约 A09 逐条定形）");
});

test("⑤ A10/A11 status与review-cycle（enum，缺失跳过）：errorTemplate 渲染 {values} 排序文案（契约序）", () => {
  const bad = validateFrontmatter({ ...LEGAL_BASE, status: "有效", "review-cycle": "7d" }, GOV_FULL);
  assert.deepEqual(
    bad.map((v) => v.error),
    [
      "status 非法：'有效'（合法值：在线, 已驳回, 灰度, 退役）",
      "review-cycle 非法：'7d'（合法值：180d, 30d, 365d, 90d）",
    ],
    "文案与退役 Python 侧逐字一致（含 {values} 排序）；顺序＝契约条目序（A10→A11）",
  );
  const clean = validateFrontmatter({ ...LEGAL_BASE }, GOV_FULL);
  assert.deepEqual(clean.filter((v) => ["status", "review-cycle"].includes(v.field)), [], "治理状态缺失跳过（非进门必填）");
});

test("⑥ A12/A13 date与updated（required＋格式）：缺失/格式错/合法三态", () => {
  const missing = validateFrontmatter(
    { ...LEGAL_BASE, date: undefined, updated: undefined },
    GOV_FULL,
  );
  assert.deepEqual(
    missing.map((v) => v.error),
    ["date 必填", "updated 必填"],
  );
  const malformed = validateFrontmatter({ ...LEGAL_BASE, date: "abc", updated: "2026/11/01" }, GOV_FULL);
  assert.deepEqual(
    malformed.map((v) => v.error),
    ["date 格式错误：'abc'（应为 YYYY-MM-DD）", "updated 格式错误：'2026/11/01'（应为 YYYY-MM-DD）"],
  );
  assert.deepEqual(validateFrontmatter({ ...LEGAL_BASE }, GOV_FULL), [], "基线全合法零违规（其余 11 条规则同过——同源对拍的静默面）");
});

test("⑦ A14 expires（expiry-date，运行时动态判定）：过期报/格式错报/未来/缺失四态", () => {
  const expired = validateFrontmatter({ ...LEGAL_BASE, expires: "2020-01-01" }, GOV_FULL);
  assert.deepEqual(expired.map((v) => v.error), ["文档已过期：expires=2020-01-01"]);
  const malformed = validateFrontmatter({ ...LEGAL_BASE, expires: "不是日期" }, GOV_FULL);
  assert.deepEqual(malformed.map((v) => v.error), ["expires 格式错误：'不是日期'"]);
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  assert.deepEqual(validateFrontmatter({ ...LEGAL_BASE, expires: future }, GOV_FULL), [], "未来日期通过");
  assert.deepEqual(validateFrontmatter({ ...LEGAL_BASE }, GOV_FULL), [], "expires 选填缺失跳过");
});

test("⑧ A15/A16 废弃字段：键出现即报（含空值），缺失跳过；replacement 文案逐字", () => {
  const bad = validateFrontmatter({ ...LEGAL_BASE, category: "", type: null }, GOV_FULL);
  assert.deepEqual(
    bad.map((v) => v.error),
    ["废弃字段：'category'（应使用 'category-path'）", "废弃字段：'type'（应使用 'doc-type'）"],
    "键存在即旧写法（值无所谓——对齐退役 Python `if field in fm`）",
  );
  assert.deepEqual(validateFrontmatter({ ...LEGAL_BASE }, GOV_FULL), [], "无废弃键零违规");
});

test("⑨ 同源对拍：一篇全违规 fm 的违规集＝退役 Python 基线逐条转录（dirty.md 语义）", () => {
  const dirty = { ...LEGAL_BASE, "category-path": "deploy:install", tags: ["乱写的tag", "测试报告"], status: "有效", "review-cycle": "7d", expires: "2020-01-01", category: "旧分类", type: "旧类型", date: undefined, updated: undefined };
  delete dirty.date;
  delete dirty.updated;
  const got = validateFrontmatter(dirty, GOV_FULL);
  const byField = {};
  for (const v of got) (byField[v.field] = byField[v.field] || []).push(v.error);
  assert.ok(byField["category-path"].some((e) => e.includes("domain 'deploy' 不在 enums.yaml domains 中")), "category-path domain 违规（Node 权威实现文案原句）");
  assert.deepEqual(byField.tags, ["tag 非法：'乱写的tag'（不在分类法白名单中）", "tag 非法：'测试报告'（不在分类法白名单中）"]);
  assert.deepEqual(byField.status, ["status 非法：'有效'（合法值：在线, 已驳回, 灰度, 退役）"]);
  assert.deepEqual(byField["review-cycle"], ["review-cycle 非法：'7d'（合法值：180d, 30d, 365d, 90d）"]);
  assert.deepEqual(byField.expires, ["文档已过期：expires=2020-01-01"]);
  assert.deepEqual(byField.category, ["废弃字段：'category'（应使用 'category-path'）"]);
  assert.deepEqual(byField.type, ["废弃字段：'type'（应使用 'doc-type'）"]);
  assert.deepEqual(byField.date, ["date 必填"], "dirty 无 date——必填违规（Python 基线同）");
  assert.deepEqual(byField.updated, ["updated 必填"], "dirty 无 updated——必填违规（Python 基线同）");
});
