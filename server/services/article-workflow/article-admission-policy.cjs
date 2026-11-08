// @responsible: 构造文章候选并判定准入阻断项与标准化警告。
const path = require("path");
const { createDocumentIdentity } = require("../projection/document-identity.cjs");
const { checkArticleCompliance } = require("./article-compliance-service.cjs");
const { loadArticleRuleSet } = require("../schema-manager/compliance-rule-set-service.cjs");
const { normalizeStringList, normalizeText, parseMarkdown } = require("../projection/document-source-scanner.cjs");
const { unwrapReference } = require("../../shared/frontmatter-normalize.cjs");
// WP-116 批1（八址键直取收敛）：注册表键直取改宿主类型化访问（SPEC-045 D2/D3）
const { docField, loadDocument } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");

const FORBIDDEN_PLACEHOLDERS = new Set(["通用", "1.0"]);
// 占位判定（注册表感知）：通用/1.0 仅在**未注册为现役身份**时视为占位——versions.yaml products 为
// 产品身份单源（A03/SPEC-020）。原无条件硬编码与注册表互斥：注册表说现役、硬编码说永久禁止，
// 正式文章在"仅保留名可注册"的空库态无路可走（2026-10-29 实录）。
function placeholderBlockers(document, ruleSet) {
  const blockers = [];
  const versionsByProduct = (ruleSet && ruleSet.versionsByProduct) || {};
  if (FORBIDDEN_PLACEHOLDERS.has(document.product) && !Object.prototype.hasOwnProperty.call(versionsByProduct, document.product)) {
    blockers.push({ ruleId: "A03-P", field: "product", message: "正式文章不能使用占位产品（保留名须经「产品版本」注册表登记为现役）" });
  }
  // WP-116 批1：注册产品键直取改宿主六态（hasOwn 语义）——document.product 是 frontmatter 派生值，
  // 保留名（constructor 族）不再命中原型面撞出函数值致 :20 `.includes` 炸；:16 的 own 守卫语义保持；
  // 现役注册表（null 原型）与测试夹具（普通对象）同正确，非在册键统一空版本集（原 `|| []` 同语义）。
  const registeredProbe = docField(versionsByProduct, document.product);
  const registeredVersions = registeredProbe.state === "present" && registeredProbe.value ? registeredProbe.value : [];
  if (FORBIDDEN_PLACEHOLDERS.has(document.version) && !registeredVersions.includes(document.version)) {
    blockers.push({ ruleId: "A04-P", field: "version", message: "正式文章不能使用占位版本（保留值须经「产品版本」注册表登记）" });
  }
  return blockers;
}

// 复用 shared/frontmatter-normalize.unwrapReference（N1 SSOT）：
// normalizeText 先做类型/字面量校验，unwrapReference 再剥 wikilink。
function referenceText(value, field, sourcePath) {
  const text = normalizeText(Array.isArray(value) ? value[0] : value, field, sourcePath);
  return unwrapReference(text);
}

function candidateDocument(raw, sourcePath) {
  const { frontmatter, body } = parseMarkdown(raw, sourcePath);
  const identity = createDocumentIdentity(frontmatter, sourcePath);
  return {
    ...identity,
    // PR-151 修复①：原始 frontmatter 随候选传递——字典必填派生检查（A11-*）按字段名取原始值，
    // 不受下方已映射字段清单限制（字典将来新增必填字段无需改此处）。
    frontmatter,
    title: normalizeText(frontmatter[DK.ARTICLE.title], DK.ARTICLE.title, sourcePath) || path.basename(sourcePath, ".md"),
    sourcePath,
    product: referenceText(frontmatter[DK.ARTICLE.product], DK.ARTICLE.product, sourcePath),
    version: normalizeText(frontmatter[DK.ARTICLE.version], DK.ARTICLE.version, sourcePath),
    module: referenceText(frontmatter[DK.ARTICLE.module], DK.ARTICLE.module, sourcePath),
    articleType: normalizeText(frontmatter[DK.ARTICLE.articleType], DK.ARTICLE.articleType, sourcePath),
    // 双拼写回落语义原样（`!== undefined` 链）——只换键名来源（WP-138 R5b 等价替换纪律）
    docType: normalizeText(frontmatter[DK.ARTICLE.docType] !== undefined ? frontmatter[DK.ARTICLE.docType] : frontmatter[DK.ARTICLE.docTypeLegacy], DK.ARTICLE.docType, sourcePath),
    categoryPath: normalizeText(frontmatter[DK.ARTICLE.categoryPath] !== undefined ? frontmatter[DK.ARTICLE.categoryPath] : frontmatter[DK.ARTICLE.categoryPathLegacy], DK.ARTICLE.categoryPath, sourcePath),
    tags: normalizeStringList(frontmatter[DK.ARTICLE.tags], DK.ARTICLE.tags, sourcePath),
    hasBody: body.trim().length > 0,
  };
}

function checkAdmissionBlockers(vaultPath, raw, sourcePath) {
  const document = candidateDocument(raw, sourcePath);
  const ruleSet = loadArticleRuleSet(vaultPath);
  const result = checkArticleCompliance(document, ruleSet);
  const blockers = result.groups.flatMap((group) => group.checks).filter((finding) => !finding.passed && finding.severity === "error");
  blockers.push(...placeholderBlockers(document, ruleSet));
  return { document, blockers };
}

// 标准化校验：ERROR（blocker）阻断标准化；WARNING 不阻断，进入待处理问题。
function checkStandardizationFindings(vaultPath, raw, sourcePath) {
  const document = candidateDocument(raw, sourcePath);
  const ruleSet = loadArticleRuleSet(vaultPath);
  const result = checkArticleCompliance(document, ruleSet);
  const failed = result.groups.flatMap((group) => group.checks).filter((finding) => !finding.passed);
  const blockers = failed.filter((finding) => finding.severity === "error");
  // P3-L（2026-10-07）：两域词形并存——实体域 SSOT 常量 WARN:"warn"（entity-compliance-severity.cjs，
  // 禁手写执法），文章域统计口径 "warning"。收集端兼容两词形，单向统一会破坏实体域 SSOT。
  const warnings = failed.filter((finding) => finding.severity === "warn" || finding.severity === "warning");
  // 数据质量 WARNING：不阻断检索与阅读，仅形成待处理问题。
  // WP-116（SPEC-083 §二.4）：W01 正文长度预检的三横复切退役——body 一律取自文档装载宿主。
  // 语义逐字对齐：宿主对无 frontmatter/未闭合件 body=原文（原 frontmatterEnd<0 分支同款）、
  // 有件 body=闭合边界后段（与原 :80-81 同一边界定位式：换行接三横的首次出现起再进 4 字符）；
  // trim 由宿主与此处各做一次（幂等），W01 阈值判断不变。退化输入（raw 非 string）在
  // parseMarkdown 层已按批 1 声明改宽容（批 1 提交文），本处不再抛 TypeError，属该声明的下游一致化。
  const bodyText = loadDocument(raw, sourcePath).body.trim();
  if (bodyText.length > 0 && bodyText.length < 20) {
    warnings.push({ ruleId: "W01", field: "body", severity: "warn", message: "正文内容过短，建议补充更完整的知识内容" });
  }
  blockers.push(...placeholderBlockers(document, ruleSet));
  return { document, blockers, warnings };
}

function assertCandidateCanBeApproved(vaultPath, raw, sourcePath) {
  const { document, blockers } = checkAdmissionBlockers(vaultPath, raw, sourcePath);
  if (blockers.length > 0) {
    const error = new Error("标准文章候选仍有准入阻断，请先在待处理问题中修复");
    error.code = "ARTICLE_ADMISSION_BLOCKED";
    error.status = 409;
    error.details = { articleId: document.articleId || null, sourcePath, blockers };
    throw error;
  }
  return document;
}

module.exports = { assertCandidateCanBeApproved, candidateDocument, checkAdmissionBlockers, checkStandardizationFindings };
