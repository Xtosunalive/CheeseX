// Component: Schema-Config
// @responsible: Read small TheSchema configuration fragments for Electron services.
// @inputs: Vault 路径下的 enums.yaml 与 schema 配置
// @outputs: 架构产品、版本与枚举配置对象
// @context: Vault
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
// PR-053：enums.yaml 读侧统一走 TheSchema 通用咽喉（形态判定不再散落）
const { normalizeDocument } = require("./theschema-loader.cjs");

function readEnums(vaultPath) {
  // WP-049 余量批：读侧经词表装载端口（data＝同一 normalizeDocument 收口；缺件→{} 保持）
  try {
    const { loadVocabBundle } = require("./vocab-load-port.cjs");
    const file = loadVocabBundle(vaultPath, { files: ["enums"] }).files.enums;
    return file && file.state === "present" ? file.data : {};
  } catch (_e) {
    return {};
  }
}

// ── ADR-009：主体注册表读侧＋合层视角 ──
const { createError: serviceError } = require("./error-factory.cjs");
const { resolveTheSchemaDir } = require("./theschema-root.cjs");
// 默认视角（无 subject）零破坏：readEnums 原行为不变；合层=显式 { subject } 才发生。
function readSubjects(vaultPath) {
  var file = path.join(resolveTheSchemaDir(vaultPath), "subjects.yaml");
  if (!fs.existsSync(file)) return { schema_version: 1, subjects: [] };
  try {
    return normalizeDocument("subjects", YAML.parse(fs.readFileSync(file, "utf-8")) || {}).data;
  } catch (_e) {
    return { schema_version: 1, subjects: [] };
  }
}

// 词条按 id 去重合并（主体层优先）；tags 族按键并（主体组优先）；标量映射主体覆盖。
function mergeSubjectEnums(base, subjectEnums) {
  var merged = { ...base };
  var has = function (obj, k) { return Object.prototype.hasOwnProperty.call(obj || {}, k); };
  if (has(subjectEnums, "subdomains")) {
    var subs = { ...(base.subdomains || {}) };
    Object.keys(subjectEnums.subdomains || {}).forEach(function (domainId) {
      var subjectEntries = subjectEnums.subdomains[domainId] || [];
      var baseEntries = subs[domainId] || [];
      var seen = new Set(subjectEntries.map(function (e) { return e && e.id; }).filter(Boolean));
      subs[domainId] = subjectEntries.concat(baseEntries.filter(function (e) { return !(e && seen.has(e.id)); }));
    });
    merged.subdomains = subs;
  }
  if (has(subjectEnums, "modules")) merged.modules = { ...(base.modules || {}), ...subjectEnums.modules };
  if (has(subjectEnums, "tags")) merged.tags = { ...(base.tags || {}), ...subjectEnums.tags };
  if (has(subjectEnums, "tag_aliases")) merged.tag_aliases = { ...(base.tag_aliases || {}), ...subjectEnums.tag_aliases };
  if (has(subjectEnums, "disabled_tags")) merged.disabled_tags = Array.from(new Set([].concat(base.disabled_tags || [], subjectEnums.disabled_tags || [])));
  if (has(subjectEnums, "arch_categories")) {
    merged.arch_categories = subjectEnums.arch_categories; // 主体覆盖（声明式保底段）
  }
  if (has(subjectEnums, "subdomain_layer_map")) merged.subdomain_layer_map = { ...(base.subdomain_layer_map || {}), ...subjectEnums.subdomain_layer_map };
  if (has(subjectEnums, "architecture_projection")) {
    merged.architecture_projection = { ...(base.architecture_projection || {}), ...subjectEnums.architecture_projection };
  }
  return merged;
}

// 合层读（ADR-009 D3）：元层 ∪ 挂载主体层（主体优先）。未挂载/paused/未知主体 → 明确错误（fail-closed，不静默回落元层）。
function readEnumsForSubject(vaultPath, subject) {
  var base = readEnums(vaultPath);
  if (subject === undefined || subject === null || subject === "") return base;
  var registry = readSubjects(vaultPath);
  var row = (registry.subjects || []).find(function (s) { return s && s.id === subject; });
  if (!row) throw serviceError("SUBJECT_UNKNOWN", "主体 '" + subject + "' 未在 subjects.yaml 注册", 404);
  if (row.status !== "mounted") {
    throw serviceError("SUBJECT_NOT_MOUNTED", "主体 '" + subject + "' status=" + row.status + "（paused=归档挂起，重挂载先置 mounted）", 409);
  }
  var subjectFile = path.join(resolveTheSchemaDir(vaultPath), "subjects", subject, "enums.yaml");
  if (!fs.existsSync(subjectFile)) return base; // mounted 但无主体层文件=纯元层视角（合法轻形态）
  var subjectEnums = normalizeDocument("subject-enums", YAML.parse(fs.readFileSync(subjectFile, "utf-8")) || {}).data;
  return mergeSubjectEnums(base, subjectEnums);
}

function normalizePathPart(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("architecture_projection." + label + " is required");
  }
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function getArchitectureProduct(vaultPath) {
  var envProduct = process.env.ARCH_PRODUCT || process.env.PRODUCT_NAME || "";
  if (envProduct.trim()) return normalizePathPart(envProduct, "product");
  var enums = readEnums(vaultPath);
  var projection = enums.architecture_projection || {};
  return normalizePathPart(projection.product || projection.product_name, "product");
}

function getArchitectureVersion(vaultPath) {
  var envVersion = process.env.ARCH_VERSION || process.env.ARCH_BRANCH || "";
  if (envVersion.trim()) return normalizePathPart(envVersion, "version");
  var enums = readEnums(vaultPath);
  var projection = enums.architecture_projection || {};
  return normalizePathPart(projection.version || projection.branch, "version");
}

// ADR-009 元层态（SPEC-016 归档清空产品身份后合法）：读取链容缺——无产品身份返回 null（上层按
// 「未配置」呈现），写链仍走 getArchitectureProduct 的 require 校验（fail-closed 留在写侧）。
function getArchitectureProductOrNull(vaultPath) {
  try { return getArchitectureProduct(vaultPath); } catch (_e) { return null; }
}
function getArchitectureVersionOrNull(vaultPath) {
  try { return getArchitectureVersion(vaultPath); } catch (_e) { return null; }
}

function resolveArchitectureProduct(vaultPath, value) {
  var requested = normalizePathPart(value, "product");
  // PR-170（2026-11-01 Master「空态返回空汇总」批）：双空身份是合法空态（ADR-009 D5）——
  // 别名归一是「相对身份锚点」的语义，无锚点即无可归一，原样通过；原实现在此抛
  // product is required 致注册表所有读面（entity-check 规则集/版本表）在空态集体 500。
  // fail-closed 语义不变：写侧身份设定口（IDENTITY_ANCHOR_IMMUTABLE 等）仍走严格取值。
  var canonical = getArchitectureProductOrNull(vaultPath);
  if (!canonical) return requested;
  if (requested.toLocaleLowerCase("en-US") === canonical.toLocaleLowerCase("en-US")) return canonical;
  var enums = readEnums(vaultPath);
  var projection = enums.architecture_projection || {};
  var aliases = projection.product_aliases && typeof projection.product_aliases === "object" && !Array.isArray(projection.product_aliases)
    ? projection.product_aliases
    : {};
  for (var alias of Object.keys(aliases)) {
    var target = typeof aliases[alias] === "string" ? aliases[alias].trim() : "";
    if (alias.trim().toLocaleLowerCase("en-US") === requested.toLocaleLowerCase("en-US")
      && target.toLocaleLowerCase("en-US") === canonical.toLocaleLowerCase("en-US")) return canonical;
  }
  return requested;
}

module.exports = {
  getArchitectureProduct,
  getArchitectureVersion,
  readEnums,
  readSubjects,
  readEnumsForSubject,
  getArchitectureProductOrNull,
  getArchitectureVersionOrNull,
  resolveArchitectureProduct,
};
