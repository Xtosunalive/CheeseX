// @responsible: 从枚举、版本注册表和本体能力加载文章及完整合规规则集。
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");
const { buildRuleSet } = require("../../shared/enums-loader.cjs");
// Version registry read is a shared query contract; admission consumes it without importing
// the analysis-owned version-registry service (which retains the write commands).
const { readVersionRegistry } = require("../../shared/version-registry-reader.cjs");
const { buildCapabilityRegistry } = require("../../shared/relation-capability-selector.cjs");
// PR-053：ontology.yaml 形态收口走 TheSchema 通用咽喉
const { normalizeDocument } = require("../../shared/theschema-loader.cjs");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");

// SPEC-020 波 2：解析物装载（resolved-domains.json 派生物——配方解释的唯一机器面）。
// 缺失/损坏 → null（消费方回落 buildRuleSet 现行值并记 warn；提交/CI 面由第 32 号门禁兜底拦漂移）。
function loadResolvedDomains(vaultPath, logger) {
  const artifactPath = path.join(resolveTheSchemaDir(vaultPath), "resolved-domains.json");
  try {
    if (!fs.existsSync(artifactPath)) {
      console.warn({ event: "resolved-domains-missing", path: artifactPath, reason: "解析物缺失——消费方回落注册表面，跑 npm run project:resolved-domains 补齐" });
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (!Array.isArray(parsed && parsed.byField)) {
      console.warn({ event: "resolved-domains-load-failed", error: "byField 非数组" });
      return null;
    }
    return parsed.byField;
  } catch (error) {
    console.warn({ event: "resolved-domains-load-failed", error: error.message });
    return null;
  }
}

function loadRuleSetForVault(vaultPath) {
  // WP-049 余量批：词表经装载端口（raw＝旧裸 parse 同形；data＝同引擎收口）
  const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");
  const vocab = loadVocabBundle(vaultPath, { files: ["enums", "ontology"] });
  const enumsFile = vocab.files.enums;
  let ruleSet = buildRuleSet({});
  if (enumsFile && enumsFile.state === "present") ruleSet = buildRuleSet(enumsFile.raw || {});
  const registry = readVersionRegistry(vaultPath);
  ruleSet.resolvedDomains = loadResolvedDomains(vaultPath);
  ruleSet.products = Object.keys(registry.products || {}).sort((left, right) => left.localeCompare(right));
  // WP-050 D1：规则集映射 null 原型——内容 product 键（constructor 族）原型命中不可表达
  ruleSet.versionsByProduct = Object.assign(Object.create(null), Object.fromEntries(ruleSet.products.map((product) => {
    const definition = registry.products[product] || {};
    const versions = Array.isArray(definition.versions) ? definition.versions.map((entry) => entry.id).filter(Boolean) : [];
    return [product, versions];
  })));
  // Load ontology-derived relation capabilities for writeback gating（实体关系域）
  const versionableRelations = new Set();
  const wikilinkRelations = new Set();
  let relationConsumerMode = "capability";
  const ontologyFile = vocab.files.ontology;
  if (ontologyFile && ontologyFile.state === "present") {
    const ontology = ontologyFile.data;
    const registry = buildCapabilityRegistry(ontology);
    relationConsumerMode = registry.mode;
    for (const [type, def] of registry.relations) {
      if (def.registeredForInference && def.factEncoding === "typed_wikilink") {
        wikilinkRelations.add(type);
        if (def.versionable) versionableRelations.add(type);
      }
    }
  }
  ruleSet.versionableRelations = versionableRelations;
  ruleSet.wikilinkRelations = wikilinkRelations;
  ruleSet.allRegisteredVersions = Object.values(ruleSet.versionsByProduct || {}).flat();
  ruleSet.relationConsumerMode = relationConsumerMode;
  return ruleSet;
}

// 文章标准化专用轻量规则加载：只 enums + version registry，不加载 ontology/capability。
// 文章标准化的合规检查（A03/A05/A06/A07/category/version）只消费 enums 枚举与版本注册表，
// 与实体关系写回域的 capability registry 无关——旧实现复用 loadRuleSetForVault 把 ontology
// capability 校验错误耦合进文章链路，导致"proposal tree 旧 ontology 缺 capability 字段"误报阻断。
// 砍掉该耦合：文章标准化不再触碰 ontology（无版本契约错位问题）。
function loadArticleRuleSet(vaultPath) {
  // WP-049 余量批：同上，经装载端口
  const { readVocabDoc } = require("../../shared/vocab-load-port.cjs");
  let ruleSet = buildRuleSet(readVocabDoc(vaultPath, "enums"));
  const registry = readVersionRegistry(vaultPath);
  ruleSet.resolvedDomains = loadResolvedDomains(vaultPath);
  ruleSet.products = Object.keys(registry.products || {}).sort((left, right) => left.localeCompare(right));
  // WP-050 D1：规则集映射 null 原型——内容 product 键（constructor 族）原型命中不可表达
  ruleSet.versionsByProduct = Object.assign(Object.create(null), Object.fromEntries(ruleSet.products.map((product) => {
    const definition = registry.products[product] || {};
    const versions = Array.isArray(definition.versions) ? definition.versions.map((entry) => entry.id).filter(Boolean) : [];
    return [product, versions];
  })));
  ruleSet.allRegisteredVersions = Object.values(ruleSet.versionsByProduct || {}).flat();
  return ruleSet;
}

module.exports = { loadRuleSetForVault, loadArticleRuleSet };
