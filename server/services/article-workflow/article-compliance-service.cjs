// @responsible: 按文章规则集检查必填字段、枚举、分类、版本与正文合规性。
// Standard-article source checks. Kept separate from entity ontology checks.

// P0-1 方案乙：文章域「必填清单」与「字段→枚举键映射」唯一事实源 = contracts/entity-readiness-rules.json 的 article 段。
// 此处从单一来源读取元信息，规则编排逻辑（A01-A10）仍留在本文件——本文件是规则逻辑唯一实现，无重复。
// 填写要求（hint）同源：文章域与实体域同键同义的字段（tags——两侧均要求「非空 string[]」，文章域写路径
// entity-repair-service.cjs validateChanges 的 article 分支即按非空 string[] 校验）直接引用契约 fields 段的
// hint，禁止在本文件另写第二份填写要求文案。
let ARTICLE_META = { required: [], enumFields: {} };
const FIELD_HINTS = {};
try {
  const readinessRules = require("../../../contracts/entity-readiness-rules.json");
  ARTICLE_META = readinessRules.article || ARTICLE_META;
  for (const [field, meta] of Object.entries(readinessRules.fields || {})) {
    if (meta && typeof meta.hint === "string" && meta.hint) FIELD_HINTS[field] = meta.hint;
  }
}
catch (_e) { /* 契约缺失时回退空集，fail-closed 由调用方枚举校验兜底 */ }

// seq209：字段中文名唯一事实源 = shared/field-labels.mjs 的文章域字典（前后端共用一份；
// node≥22 require(esm) 直吃，照抄 server/shared/version-contract.cjs:11）。
// 中文名不再放 contracts/entity-readiness-rules.json——contracts 目录下的配置前端读不到
// （全仓检索：src/ 下只有测试用 readRepo 读它，生产代码不读），当不了共用落点；
// 契约 article.fields 段只留表单形状（control/required/optionsKey/键序）。
// 含第 4 个漂移键修正：article_id 曾写作「文章身份」，与文章域字典「文章标识」不一致。
const ARTICLE_LABELS = require("../../../shared/field-labels.mjs").FIELD_LABELS.article;

const { validateCategoryPath } = require("../../shared/enums-loader.cjs");
// WP-116 批1（八址键直取收敛）：frontmatter 派生键/闭集成员判定改宿主类型化访问（SPEC-045 D2/D3）
const { docField, docFieldClosedSet } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");

function articleLabel(field) {
  return ARTICLE_LABELS[field] || field;
}

function finding(ruleId, field, label, severity, passed, value, message, hint, allowedValues, metadata) {
  return {
    ruleId, field, label, severity, passed, value: value || null, message,
    hint: hint || "", editable: capabilityFor(field, value),
    ...(allowedValues && allowedValues.length ? { allowedValues } : {}),
    ...(metadata || {}),
  };
}

// D-1b（WP-110）：可改性能力位与写门同源——读 ARTICLE_GATE_RULES 的 immutable 位，不再点名字符串。
// 声明 immutable 且已有非空值 → 用户改不了（服务端 preview/apply 必拒 422），能力位如实 false，
// 抽屉据此渲染只读行（此前照给输入框，填了才被打回＝PR-229 记的「双重死状态」入口）。
// 空值仍可填（锁的是「改」不是「填」）；body 的既有语义（不在修复面编辑）保持。
const { ARTICLE_GATE_RULES = [] } = require("../../shared/field-rule-declarations.cjs");
const ARTICLE_IMMUTABLE_FIELDS = new Set(
  ARTICLE_GATE_RULES.filter((rule) => rule.immutable === true).map((rule) => rule.field),
);
function capabilityFor(field, value) {
  if (field === DK.ARTICLE.body) return false;
  if (ARTICLE_IMMUTABLE_FIELDS.has(field)) return !(typeof value === "string" && value.trim() !== "");
  return true;
}

function requiredText(ruleId, field, label, value, hint) {
  const passed = typeof value === "string" && value.trim().length > 0;
  return finding(ruleId, field, label, "error", passed, value, passed ? "通过" : `${field} 是标准文章必填字段`, hint);
}

function enumText(ruleId, field, label, value, allowedValues) {
  const text = typeof value === "string" ? value.trim() : "";
  const passed = Boolean(text) && (!allowedValues.length || allowedValues.includes(text));
  const message = !text ? `${field} 是标准文章必填字段` : passed ? "通过" : `${field} 不在 Schema 可用值中`;
  return finding(ruleId, field, label, "error", passed, text, message, allowedValues.length ? `可用值：${allowedValues.join("、")}` : "", allowedValues);
}

function managedEnumText(ruleId, field, label, value, allowedValues, metadata) {
  const text = typeof value === "string" ? value.trim() : "";
  const configured = allowedValues.length > 0;
  const passed = Boolean(text) && configured && allowedValues.includes(text);
  const message = !configured ? `${field} 尚未配置录入规则` : !text ? `${field} 是标准文章必填字段` : passed ? "通过" : `${field} 不在录入规则可用值中`;
  return finding(ruleId, field, label, "error", passed, text, message, configured ? `可用值：${allowedValues.join("、")}` : "", allowedValues, metadata);
}

function categoryFinding(document, ruleSet) {
  const value = document.categoryPath || "";
  // PR-046→WP-040（Master 2026-10-29「2A」）：A08 两段式结构化校验（domain:subdomain，topic 段退役）——
  // 与 article-validator-lib.cjs 单一语义对齐（SPEC-022 Node 单源），校验器单实现（shared/enums-loader.validateCategoryPath）。
  // fail-closed 语义保持：ruleSet 未配置（domains 空）时报「尚未配置录入规则」，不回退自由文本。
  const configured = ruleSet && ruleSet.domains && typeof ruleSet.domains === "object" && Object.keys(ruleSet.domains).length > 0;
  const categoryError = configured ? validateCategoryPath(value, ruleSet) : "category-path 尚未配置录入规则";
  const pairs = ruleSet.categoryPaths || [];
  return finding("A08", DK.ARTICLE.categoryPath, articleLabel(DK.ARTICLE.categoryPath), "error", categoryError === null, value,
    categoryError === null ? "通过" : categoryError,
    pairs.length ? "格式 domain:subdomain；可用组合：" + pairs.join("、") : "",
    pairs);
}

// WP-040（Master 2026-10-29 裁③）：product 校验仍对闭合集（A03 语义——别名值合法），
// 但 finding.allowedValues（下拉选项面）只列主产品名（canonicalProducts）——别名不再作为可选项平铺。
function productFinding(document, ruleSet) {
  const closed = ruleSet.products || [];
  const canonical = ruleSet.canonicalProducts && ruleSet.canonicalProducts.length > 0 ? ruleSet.canonicalProducts : closed;
  // WP-116 批1：A03 闭集成员判定改宿主 docFieldClosedSet（六态＋闭集）——document.product 是
  // frontmatter 派生域值（经 normalizeText/unwrapReference），非原始 frontmatter 面，故以单字段
  // 包装显式喂宿主：文档携带 frontmatter 时宿主不会截胡到原始键面；值归一（trim）与原 text 产出逐字一致。
  const productProbe = docFieldClosedSet({ [DK.ARTICLE.product]: document.product }, DK.ARTICLE.product, closed);
  const text = typeof productProbe.value === "string" ? productProbe.value : "";
  const configured = closed.length > 0;
  const passed = productProbe.ok === true && Boolean(text) && configured;
  const message = !configured ? "product 尚未配置录入规则" : !text ? "product 是标准文章必填字段" : passed ? "通过" : "product 不在录入规则可用值中";
  return finding("A03", DK.ARTICLE.product, articleLabel(DK.ARTICLE.product), "error", passed, text, message, configured ? "可用值：" + canonical.join("、") : "", canonical);
}

function versionFinding(document, ruleSet) {
  const product = typeof document.product === "string" ? document.product.trim() : "";
  const versionsByProduct = ruleSet.versionsByProduct || {};
  const productKey = Object.keys(versionsByProduct).find((candidate) => candidate.toLocaleLowerCase("en-US") === product.toLocaleLowerCase("en-US")) || product;
  // WP-116 批1：产品→版本表键直取改宿主六态（hasOwn 语义）——productKey 回落 user 值时
  // 保留名（constructor 族）不再命中原型面（原裸取会撞出函数值，下游 .includes 直接炸）；
  // 现役注册表（null 原型）与测试夹具（普通对象）同正确；非在册键统一空版本集（原 `|| []` 同语义）。
  const versionsProbe = docField(versionsByProduct, productKey);
  const allowedValues = versionsProbe.state === "present" && versionsProbe.value ? versionsProbe.value : [];
  // 2026-10-14 文案自解释：product 缺失时 version 闭包失去锚点（按产品登记于 versions.yaml）——
  // 旧文案「尚未配置录入规则」让人以为要配规则，实际是 product 未填；阻断语义不变（fail-closed）。
  if (!product) {
    return finding("A04", DK.ARTICLE.version, articleLabel(DK.ARTICLE.version), "error", false, document.version,
      "version 录入规则按产品闭包——product 未填，无法校验",
      "version 的可用值按产品登记（versions.yaml）；请先补齐 product 字段", "", { allowedValuesByProduct: versionsByProduct });
  }
  return managedEnumText("A04", DK.ARTICLE.version, articleLabel(DK.ARTICLE.version), document.version, allowedValues, { allowedValuesByProduct: versionsByProduct });
}

// A 系专属检查已覆盖的字段（check.field 键集）——字典必填派生检查跳过这些键，避免同字段双检双报。
// WP-138 R5b：键名经文档键源单点（DK.ARTICLE）；与契约 article.fields 的差集（arch_layer/arch_category
// 走 A11 字典派生）语义不变，只是键名来源收口。
const A_RULE_COVERED_FIELDS = new Set([
  DK.ARTICLE.title, DK.ARTICLE.articleId, DK.ARTICLE.product, DK.ARTICLE.version, DK.ARTICLE.module,
  DK.ARTICLE.articleType, DK.ARTICLE.docType, DK.ARTICLE.categoryPath, DK.ARTICLE.tags, DK.ARTICLE.body,
]);

// 字典必填派生检查（PR-151 修复①）：必填轴接 SPEC-020 字典必填集（ruleSet.resolvedDomains：
// required=是 ∧ scope 含 article）——与完整校验器 article-validator-lib 同一数据源，「标准化 0 错、
// 发布闸门拦必填」的假绿类由此消灭。A01-A10 未覆盖的必填字段（今日=arch_layer/arch_category，
// 明日=字典新增必填）自动生成检查，无需逐字段登记。
// 口径对齐：只检存在性（与 article-validator-lib 必填检查逐字同语义），值域闭包（record.values）
// 仅作 allowedValues 展示面（修复表单选项）——值域执法在 Web 写入口（updateCandidateFields），
// 不在标准化侧加严，防「补齐入口放行、标准化拦」的反向双口径。
// 解析物缺失（resolvedDomains=null）→ 不生成检查、回落旧行为（与 article-validator-lib 裸库软化同口径）。
function dictionaryRequiredFindings(document, ruleSet) {
  const records = ruleSet && Array.isArray(ruleSet.resolvedDomains) ? ruleSet.resolvedDomains : null;
  if (!records) return [];
  const findings = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || typeof record.name !== "string" || !record.name) continue;
    if (record.required !== "是") continue;
    if (!(Array.isArray(record.scope) ? record.scope : []).includes("article")) continue;
    if (A_RULE_COVERED_FIELDS.has(record.name)) continue;
    const field = record.name;
    // WP-116 批1：frontmatter 字典必填键直取改宿主六态——field 来自字典登记（record.name），
    // 裸取时保留名（constructor 族）会命中原型面把「缺失」误判「已填」（假绿）；docField hasOwn
    // 语义 + 缺面（frontmatter 缺席/非对象）回落 doc-absent → undefined，缺失判定四分支逐字同语义。
    const raw = docField(document.frontmatter || null, field).value;
    const missing = raw === null || raw === undefined
      || (typeof raw === "string" && raw.trim() === "")
      || (Array.isArray(raw) && raw.length === 0);
    const allowedValues = Array.isArray(record.values) ? record.values.filter((value) => typeof value === "string" && value.trim()) : [];
    findings.push(finding(`A11-${field}`, field, articleLabel(field), "error", !missing,
      typeof raw === "string" ? raw.trim() : null,
      missing ? `${field} 是标准文章必填字段（字段字典必填）` : "通过",
      FIELD_HINTS[field] || "", allowedValues.length ? allowedValues : undefined));
  }
  return findings;
}

function checkArticleCompliance(document, ruleSet) {
  // 枚举键映射从 article.enumFields 单一来源派生（P0-1 方案乙），ruleSet 提供枚举候选值（来自 enums.yaml）。
  const enumKey = (field) => (ARTICLE_META.enumFields || {})[field] || "";
  const identityChecks = [
    requiredText("A01", DK.ARTICLE.title, articleLabel(DK.ARTICLE.title), document.title, "填写标准文章标题"),
    finding("A02", DK.ARTICLE.articleId, articleLabel(DK.ARTICLE.articleId), "error", document.identitySource === "article_id", document.articleId, document.identitySource === "article_id" ? "通过" : "article_id 是标准文章稳定身份，不能使用路径回退", "例如 mysql-force-primary"),
    productFinding(document, ruleSet),
    versionFinding(document, ruleSet),
  ];
  const classificationChecks = [
    enumText("A05", DK.ARTICLE.module, articleLabel(DK.ARTICLE.module), document.module, ruleSet[enumKey(DK.ARTICLE.module)] || []),
    enumText("A06", DK.ARTICLE.articleType, articleLabel(DK.ARTICLE.articleType), document.articleType, ruleSet[enumKey(DK.ARTICLE.articleType)] || []),
    enumText("A07", DK.ARTICLE.docType, articleLabel(DK.ARTICLE.docType), document.docType, ruleSet[enumKey(DK.ARTICLE.docType)] || []),
    categoryFinding(document, ruleSet),
    ...dictionaryRequiredFindings(document, ruleSet),
  ];
  const contentChecks = [
    // hint 引用契约 fields.tags.hint（与实体域同键同义），不再本文件硬编码第二份填写要求文案。
    finding("A09", DK.ARTICLE.tags, articleLabel(DK.ARTICLE.tags), "error", Array.isArray(document.tags) && document.tags.length > 0, document.tags, Array.isArray(document.tags) && document.tags.length > 0 ? "通过" : "tags 必须是非空列表", FIELD_HINTS[DK.ARTICLE.tags]),
    finding("A10", DK.ARTICLE.body, articleLabel(DK.ARTICLE.body), "error", document.hasBody === true, null, document.hasBody === true ? "通过" : "标准文章正文不能为空", "补充文章正文内容"),
  ];
  const checks = [...identityChecks, ...classificationChecks, ...contentChecks];
  const blockerCount = checks.filter((item) => !item.passed && item.severity === "error").length;
  const warningCount = checks.filter((item) => !item.passed && item.severity === "warning").length;
  const infoCount = checks.filter((item) => !item.passed && item.severity === "info").length;
  const passedCount = checks.filter((item) => item.passed).length;
  return {
    entityId: document.articleId || document.documentId || "", title: document.title, fileName: document.sourcePath.split("/").pop() || "",
    sourcePath: document.sourcePath, sourceKey: document.sourcePath, sourceExists: true, sourceType: "standard-article",
    architectureIntent: "ordinary", score: Math.round((passedCount / checks.length) * 100), totalChecks: checks.length,
    blockerCount, warningCount, infoCount, module: document.module || "",
    groups: [
      // 分组名（不是字段中文名）：A01-A04 归为「文章身份」一组，与 article_id 字段的中文名「文章标识」是两回事。
      { id: "article_identity", label: "文章身份", checks: identityChecks },
      { id: "article_classification", label: "文章分类", checks: classificationChecks },
      { id: "article_content", label: "文章内容", checks: contentChecks },
    ],
  };
}

module.exports = { checkArticleCompliance };
