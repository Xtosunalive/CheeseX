// @tests: article-compliance-service versionFinding 文案自解释（2026-10-14 Master 报障定性后的改进）
// @tests: ＋D-1b（WP-110）文章诊断能力位 editable 从 ARTICLE_GATE_RULES 声明派生（锁改不锁填／未声明不误锁／body 语义不破）
// product 缺失 → 阻断（fail-closed 不变）＋文案指明因果（旧「尚未配置录入规则」不自解释）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkArticleCompliance } = require("../article-compliance-service.cjs");

// 文档形态沿 entity-field-labels-backend.test 先例（扁平字段＋sourcePath——非 frontmatter 包装）
function docWith(fields) {
  return {
    sourcePath: "知识库/raw/precleaned/version-hint-probe.md",
    title: "t", articleId: "a1", module: "m", articleType: "x", docType: "d",
    categoryPath: "ops:deploy:topic", tags: [], hasBody: true, ...fields,
  };
}

test("product 缺失 → version 阻断且文案指明因果（先补 product）", () => {
  const result = checkArticleCompliance(docWith({ product: "", version: "7.0.6.7" }), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } });
  const checks = (result.groups || []).reduce((acc, g) => acc.concat(g.checks || []), []);
  const version = checks.find((f) => f.field === "version");
  assert.ok(version, "version finding 应存在");
  assert.equal(version.passed, false, "product 缺失时 version 保持阻断（fail-closed）");
  assert.match(version.message, /product 未填/, "文案须指明因果而非「尚未配置录入规则」");
  assert.match(version.hint, /versions\.yaml|先补齐 product/, "提示须给出动作指引");
});

test("product 有值 → 闭包照常校验（回归锚）", () => {
  const result = checkArticleCompliance(docWith({ product: "As", version: "7.0.6.7" }), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] }, versionsByProduct: { As: ["7.0.6.7"] } });
  const checks = (result.groups || []).reduce((acc, g) => acc.concat(g.checks || []), []);
  const version = checks.find((f) => f.field === "version");
  assert.equal(version.passed, true, "闭包内版本应通过");
});

// D-1b（WP-110）：文章诊断的能力位（editable）改从 ARTICLE_GATE_RULES 声明表派生。
// 旧判据 `field !== "body"` 会把「服务端必拒 422」的字段宣称成可编辑——前端因此照给输入框，
// 用户填完才被拒（PR-229 记的「双重死状态」入口）。以下四条分别钉：派生生效／空值仍可填／
// 未声明字段不误锁／body 既有语义不破。
function checksOf(result) {
  return (result.groups || []).reduce((acc, g) => acc.concat(g.checks || []), []);
}

test("D-1b 能力位与声明表 join：声明 immutable 的字段有值时 editable=false（按声明遍历，不抄字段名清单）", () => {
  const { ARTICLE_GATE_RULES = [] } = require("../../../shared/field-rule-declarations.cjs");
  const declared = ARTICLE_GATE_RULES.filter((rule) => rule.immutable === true).map((rule) => rule.field);
  assert.ok(declared.includes("article_id"), "本包立法在位：article_id 已纳 immutable 声明");
  const checks = checksOf(checkArticleCompliance(docWith({}), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } }));
  for (const field of declared) {
    const item = checks.find((f) => f.field === field);
    assert.ok(item, `声明字段 ${field} 应产出 finding`);
    assert.equal(item.value, "a1", `${field} 夹具现值非空（锁的前提）`);
    assert.equal(item.editable, false, `声明 immutable＋有现值 → ${field} 能力位必须 false（旧点名判据在此翻红）`);
  }
});

test("D-1b 反面对照一：现值为空的不可改字段仍可填（锁的是改，不是填）", () => {
  const checks = checksOf(checkArticleCompliance(docWith({ articleId: "" }), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } }));
  const item = checks.find((f) => f.field === "article_id");
  assert.equal(item.editable, true, "空身份应可补填，否则新建/补齐路径被自己锁死");
});

test("D-1b 反面对照二：未声明 immutable 的字段照常可编辑（title 有值也不锁）", () => {
  const checks = checksOf(checkArticleCompliance(docWith({}), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } }));
  const title = checks.find((f) => f.field === "title");
  assert.equal(title.editable, true, "未声明字段不得被派生连带锁死");
});

test("D-1b 回归锚：body 的既有不可编辑语义保持（改判据来源不改判据）", () => {
  const checks = checksOf(checkArticleCompliance(docWith({}), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } }));
  const body = checks.find((f) => f.field === "body");
  assert.equal(body.editable, false, "body 仍不在修复面编辑");
});

test("D-1b 复核回件 C4：能力位是下发通道，文章诊断每条 finding 都带 boolean editable（漏键＝前端默认按可编辑）", () => {
  const checks = checksOf(checkArticleCompliance(docWith({}), { domains: { ops: "运维" }, subdomains: { ops: ["deploy"] } }));
  assert.ok(checks.length > 0, "诊断面确有 finding（空洞通过自检）");
  const missing = checks.filter((f) => typeof f.editable !== "boolean").map((f) => f.field);
  assert.deepEqual(missing, [], "不得有 finding 漏发能力位");
});

// ── WP-116 批1（八址键直取收敛）：越界键 → 显式分支非静默 ──
test("WP-116 A03/A04：保留名 product 经闭集/版本表宿主访问 → 显式阻断不炸（普通对象夹具）", () => {
  const ruleSet = { domains: { ops: "运维" }, products: ["As"], versionsByProduct: { As: ["7.0.6.7"] } };
  for (const product of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    const checks = checksOf(checkArticleCompliance(docWith({ product, version: "1.0.0" }), ruleSet));
    const productFinding = checks.find((f) => f.field === "product");
    assert.equal(productFinding.passed, false, `${product} → A03 显式阻断（闭集外非静默）`);
    assert.equal(productFinding.value, product, "finding.value=派生值原文（语义逐字保持）");
    assert.match(productFinding.message, /不在录入规则可用值中/);
    const versionFinding = checks.find((f) => f.field === "version");
    assert.equal(versionFinding.passed, false, `${product} → A04 显式阻断（旧裸取版本表撞函数值时此处直接 TypeError）`);
    assert.equal(versionFinding.message, "version 尚未配置录入规则", "保留名产品无注册版本 → 空表语义（不再误配函数值）");
  }
  // 对照：在册产品照常过（宿主化不误伤）
  const ok = checksOf(checkArticleCompliance(docWith({ product: "As", version: "7.0.6.7" }), ruleSet));
  assert.equal(ok.find((f) => f.field === "product").passed, true);
  assert.equal(ok.find((f) => f.field === "version").passed, true);
});

test("WP-116 A03 归一与未配置面：trim 归一/必填文案/未配置文案逐字保持", () => {
  const ruleSet = { domains: { ops: "运维" }, products: ["As"], versionsByProduct: { As: ["7.0.6.7"] } };
  const trimmed = checksOf(checkArticleCompliance(docWith({ product: " As ", version: "7.0.6.7" }), ruleSet));
  assert.equal(trimmed.find((f) => f.field === "product").passed, true, "trim 归一后命中闭集（docFieldClosedSet 归一同旧 text.trim）");
  const missing = checksOf(checkArticleCompliance(docWith({ product: "", version: "1.0.0" }), ruleSet));
  assert.match(missing.find((f) => f.field === "product").message, /product 是标准文章必填字段/, "空值 → 必填文案（非「不在可用值中」）");
  const unconfigured = checksOf(checkArticleCompliance(docWith({ product: "As", version: "7.0.6.7" }), { domains: { ops: "运维" } }));
  assert.match(unconfigured.find((f) => f.field === "product").message, /product 尚未配置录入规则/, "products 未配置 → 配置面文案");
  assert.equal(unconfigured.find((f) => f.field === "product").passed, false);
});

test("WP-116 A11 字典必填：frontmatter 字段经宿主六态——保留名不再假绿；缺失四态/trim 语义逐字保持", () => {
  const ruleSet = { resolvedDomains: [
    { name: "constructor", required: "是", scope: ["article"], values: [] },
    { name: "arch_layer", required: "是", scope: ["article"], values: ["L1"] },
  ] };
  const doc = docWith({});
  doc.frontmatter = { title: "t" }; // 普通对象 frontmatter——旧裸取 doc.frontmatter["constructor"] 命中 Object.prototype → 误判已填（假绿）
  const hostile = checksOf(checkArticleCompliance(doc, ruleSet)).find((f) => f.field === "constructor");
  assert.equal(hostile.passed, false, "保留名字典字段：宿主 hasOwn → 显式缺失（旧裸取假绿）");
  assert.equal(hostile.value, null);
  for (const raw of [undefined, "", [], null]) {
    const probe = docWith({});
    probe.frontmatter = raw === undefined ? {} : { arch_layer: raw };
    const item = checksOf(checkArticleCompliance(probe, ruleSet)).find((f) => f.field === "arch_layer");
    assert.equal(item.passed, false, `arch_layer=${JSON.stringify(raw)} → 缺失阻断（四态语义逐字保持）`);
  }
  const present = docWith({});
  present.frontmatter = { arch_layer: " L1 " };
  const item = checksOf(checkArticleCompliance(present, ruleSet)).find((f) => f.field === "arch_layer");
  assert.equal(item.passed, true, "在册非空值照常过");
  assert.equal(item.value, "L1", "finding.value=trim 后原值（逐字保持）");
});
