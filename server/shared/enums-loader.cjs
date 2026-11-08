// Component: Enums-Loader
// @responsible: Read TheSchema/enums.yaml into normalized ComplianceRuleSet — pure builder, no fs
// @inputs: parsed enums.yaml object
// @outputs: { archLayers, archCategories, statuses, modules, layerAliases, categoryAliases, wikilinkTypeLabels,
//             subdomainIds, subdomainLabels（ADR-008 D1 词条语义派生）, ... }
// @context: Vault
//
// PR-052：形态判定收敛为 contracts/enums.schema.json 一份事实源；手写形态三元式全部退役。
// PR-053：三步管线（宽容 coerce → 严格校验 → 局部降级）泛化为全 TheSchema 共用引擎
//   server/shared/theschema-loader.cjs（contracts/theschema.registry.json 登记），enums 成为首个实例——
//   本文件只保留 enums 专属的缺省补齐（withDefaults）与纯派生（buildRuleSet / validateCategoryPath），
//   不再持有任何 Ajv 实例与形态判定。口径（A 口径，Master 2026-10-13 裁定）不变：
//   仅 /tag_aliases 的值接受标量字符串（schema x-lenientPaths 声明），其余严格 + 局部降级。
const { normalizeDocument, validateDocumentStrict } = require("./theschema-loader.cjs");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ADR-008 D1 子域词条归一：裸标量（legacy）→ {id}；对象直通（trim id；label/description 原样保留）。
// 确定性无损升级而非降级，痕迹走独立通道 entryNormalization（不混入 normalizationTrail——
// 那是 PR-052「读侧需 coerce 才合法」防线口径，写侧自校验据此告警，混入会把迁移态噪音淹没真信号）。
// 非串非对象条目防御性丢弃（schema 严格层已局部降级脏节点，此处不重复报错）。
// null 值=域预留位语义，原样保留。
function normalizeSubdomainEntries(source) {
  const normalized = {};
  const trail = [];
  if (!isPlainObject(source)) return { normalized, trail };
  for (const domainId of Object.keys(source)) {
    const raw = source[domainId];
    if (raw === null || raw === undefined) { normalized[domainId] = raw; continue; }
    if (!Array.isArray(raw)) { normalized[domainId] = []; continue; }
    const entries = [];
    let coerced = 0;
    for (const item of raw) {
      if (typeof item === "string") {
        if (!item.trim()) continue;
        entries.push({ id: item.trim() });
        coerced += 1;
      } else if (isPlainObject(item) && typeof item.id === "string" && item.id.trim()) {
        entries.push({ id: item.id.trim(), ...(item.label !== undefined ? { label: item.label } : {}), ...(item.description !== undefined ? { description: item.description } : {}) });
      }
    }
    normalized[domainId] = entries;
    if (coerced > 0) trail.push({ path: `subdomains.${domainId}`, from: "scalar-entries", to: "entry-objects", value: coerced });
  }
  return { normalized, trail };
}

// 双形态词条取 id（消费方公共口——读写两侧都可能有 legacy 标量混排）。
function subdomainEntryId(item) {
  if (typeof item === "string") return item.trim();
  if (isPlainObject(item) && typeof item.id === "string") return item.id.trim();
  return null;
}

// 缺省节（派生前的空值补齐）——形态已由 schema 保证合法，缺省项在此统一补空后交给纯派生逻辑。
function withDefaults(data) {
  const source = isPlainObject(data) ? data : {};
  const proj = isPlainObject(source.architecture_projection) ? source.architecture_projection : {};
  const lifecycle = isPlainObject(source.lifecycle) ? source.lifecycle : {};
  return {
    domains: isPlainObject(source.domains) ? { ...source.domains } : {},
    subdomains: isPlainObject(source.subdomains) ? { ...source.subdomains } : {},
    subdomain_constraints: isPlainObject(source.subdomain_constraints) ? { ...source.subdomain_constraints } : {},
    arch_categories: Array.isArray(source.arch_categories) ? source.arch_categories.slice() : [],
    article_types: Array.isArray(source.article_types) ? source.article_types.slice() : [],
    doc_types: Array.isArray(source.doc_types) ? source.doc_types.slice() : [],
    tags: isPlainObject(source.tags) ? { ...source.tags } : {},
    tag_aliases: isPlainObject(source.tag_aliases) ? { ...source.tag_aliases } : {},
    disabled_tags: Array.isArray(source.disabled_tags) ? source.disabled_tags.slice() : [],
    layers: Array.isArray(source.layers) ? source.layers.filter(Boolean) : [],
    modules: isPlainObject(source.modules) ? { ...source.modules } : {},
    lifecycle: {
      status: Array.isArray(lifecycle.status) ? lifecycle.status.slice() : [],
      review_cycle: Array.isArray(lifecycle.review_cycle) ? lifecycle.review_cycle.slice() : [],
      default_status: typeof lifecycle.default_status === "string" ? lifecycle.default_status : "",
    },
    architecture_projection: {
      product: typeof proj.product === "string" ? proj.product : "",
      version: typeof proj.version === "string" ? proj.version : "",
      product_aliases: isPlainObject(proj.product_aliases) ? { ...proj.product_aliases } : {},
      layer_aliases: isPlainObject(proj.layer_aliases) ? { ...proj.layer_aliases } : {},
      category_aliases: isPlainObject(proj.category_aliases) ? { ...proj.category_aliases } : {},
      subdomain_aliases: isPlainObject(proj.subdomain_aliases) ? { ...proj.subdomain_aliases } : {},
      projected_relation_types: Array.isArray(proj.projected_relation_types) ? proj.projected_relation_types.slice() : [],
      wikilink_type_labels: isPlainObject(proj.wikilink_type_labels) ? { ...proj.wikilink_type_labels } : {},
    },
  };
}

/**
 * 读侧形态收口（PR-052 首个实例，PR-053 起委托 TheSchema 通用引擎）。
 * 宽容转化 → 严格校验 → 局部降级 在 theschema-loader.cjs，这里补 enums 专属缺省节。
 *
 * @param {object} enums - parsed enums.yaml content
 * @param {object} [options] - { warn } 降级日志回调（注入以保持本模块无 logger/fs 依赖）
 * @returns {{ data: object, normalizationTrail: object[], degradedNodes: object[] }}
 */
function normalizeEnums(enums, options) {
  if (!isPlainObject(enums)) return { data: {}, normalizationTrail: [], degradedNodes: [], entryNormalization: [] };
  const { data, normalizationTrail, degradedNodes } = normalizeDocument("enums", enums, options);
  // ADR-008 D1：词条归一在 enums 专属层（withDefaults 同层），不侵入 theschema-loader 通用引擎（PR-053 分层）；
  // 痕迹独立通道，不混入 normalizationTrail（PR-052 防线口径不变）。
  const entryResult = normalizeSubdomainEntries(data.subdomains);
  data.subdomains = entryResult.normalized;
  return { data: withDefaults(data), normalizationTrail, degradedNodes, entryNormalization: entryResult.trail };
}

/**
 * Build a normalized ComplianceRuleSet from parsed enums.yaml.
 * All callers must pass the already-parsed object — this module does NOT read files.
 * 签名向后兼容：内部先过形态收口 normalizeEnums，之后只做纯派生（不再有任何形态判定）。
 *
 * @param {object} enums - parsed enums.yaml content
 * @param {object} [options] - { warn } 降级日志回调（PR-052 局部降级痕迹）
 * @returns {object} normalized ruleSet
 */
function buildRuleSet(enums, options) {
  if (!isPlainObject(enums)) return emptyRuleSet();

  const { data, normalizationTrail, degradedNodes } = normalizeEnums(enums, options);

  // arch_layers: 从 layers 派生（ADR008 D39：layers 唯一权威，arch_layers 为派生视图）
  // 仅包含 entity_layer != false 的层（排除 plate 等机器聚合容器层）
  const archLayers = data.layers
    .filter((layer) => layer.entity_layer !== false)
    .map((layer) => layer.id)
    .filter(Boolean);

  // arch_categories 派生（ADR-006）：subdomain_constraints 唯一权威，arch_categories 为派生视图（与 ADR008 D39 layers→arch_layers 同款）。
  // 保底语义：矩阵非空 → union(所有子域.allowed_categories)；矩阵空/未配置 → 回退读 enums.arch_categories
  // ——真实 vault subdomain_constraints 为预留位（2026-10-08 盘点），回退保现状行为不变；矩阵配置后派生自动生效，双维护消失。
  const declaredCategories = data.arch_categories;

  // lifecycle statuses
  const lifecycle = data.lifecycle;
  const statuses = lifecycle.status;
  // 新建文档默认状态：Vault lifecycle.default_status 显式指定；缺省回退 status 首项（原则 7——默认值跟随 Vault 词表，不硬编码）。
  const defaultStatus = lifecycle.default_status.trim() ? lifecycle.default_status.trim() : (statuses[0] || "");

  const subdomainIds = [];
  const subdomainLabels = {};
  const categoryPaths = [];
  const domains = data.domains;
  Object.keys(data.subdomains).forEach(function (domainId) {
    const subdomainsOfDomain = data.subdomains[domainId];
    // YAML 空值（键后无内容）解析为 null —— 既定语义：域存在性按键判定，无子域即空串，不作形态异常
    // ADR-008 D1：normalizeEnums 已归一为词条对象，此处取 .id；label 进 subdomainLabels（无 label 不入）。
    for (const entry of subdomainsOfDomain || []) {
      const subdomainId = entry.id;
      if (!subdomainId || !subdomainId.trim()) continue;
      if (!subdomainIds.includes(subdomainId)) subdomainIds.push(subdomainId);
      if (typeof entry.label === "string" && entry.label.trim()) subdomainLabels[subdomainId] = entry.label.trim();
      // PR-046（SPEC-022 单源化改向）：category-path 契约实现 = article-validator-lib.cjs——
      // domain:subdomain 两段式（WP-040——topic 段退役；domain/subdomain 闭合枚举）。
      // categoryPaths 只登记闭合的 domain:subdomain 组合（冒分），topic 由写方补充，不做点分双口径。
      if (Object.prototype.hasOwnProperty.call(domains, domainId)) categoryPaths.push(domainId + ":" + subdomainId);
    }
  });

  const matrixCategories = [];
  Object.keys(data.subdomain_constraints).forEach(function (sdId) {
    for (const cat of data.subdomain_constraints[sdId].allowed_categories) {
      if (cat.trim() && !matrixCategories.includes(cat.trim())) matrixCategories.push(cat.trim());
    }
  });
  const archCategories = matrixCategories.length > 0 ? matrixCategories : declaredCategories;

  const formalTags = Object.values(data.tags).flat().filter((tag) => !disabledTagSet(data).has(tag));
  // WP-156：review-cycle 闭合面——normalize 层 lifecycle.review_cycle 既有（A11 enumSource 消费）
  const reviewCycles = lifecycle.review_cycle;
  const proj = data.architecture_projection;

  return {
    archLayers,
    archCategories,
    subdomainIds,
    subdomainLabels,
    categoryPaths,
    domains,
    subdomains: data.subdomains,
    subdomainConstraints: data.subdomain_constraints,
    reviewCycles,
    statuses,
    defaultStatus,
    moduleNames: Object.keys(data.modules),
    articleTypes: data.article_types,
    docTypes: data.doc_types,
    // SPEC-012 结构收口批：A03 products 闭合集派生（architecture_projection.product＋product_aliases 键）
    products: [proj.product, ...Object.keys(proj.product_aliases || {})].filter(Boolean),
    // WP-040（Master 2026-10-29 裁③）：选项面只列主产品名——闭合集（校验容别名）与下拉选项分家
    canonicalProducts: [proj.product].filter(Boolean),
    formalTags,
    tagAliases: data.tag_aliases,
    disabledTags: data.disabled_tags,
    layerAliases: proj.layer_aliases,
    categoryAliases: proj.category_aliases,
    subdomainAliases: proj.subdomain_aliases,
    projectedRelationTypes: proj.projected_relation_types,
    wikilinkTypeLabels: buildWikilinkTypeLabels(proj),
    // PR-052：形态收口痕迹（宽容不静默）——health 痕迹与写侧非规范自校验共用
    normalizationTrail,
    degradedNodes: degradedNodes.map((node) => node.path),
  };
}

function disabledTagSet(data) {
  return new Set(data.disabled_tags);
}

function emptyRuleSet() {
  return {
    archLayers: [],
    archCategories: [],
    products: [],
    subdomainIds: [],
    subdomainLabels: {},
    categoryPaths: [],
    domains: {},
    subdomains: {},
    subdomainConstraints: {},
    statuses: [],
    defaultStatus: "",
    moduleNames: [],
    articleTypes: [],
    docTypes: [],
    formalTags: [],
    reviewCycles: [],
    tagAliases: {},
    disabledTags: [],
    layerAliases: {},
    categoryAliases: {},
    subdomainAliases: {},
    projectedRelationTypes: [],
    wikilinkTypeLabels: {},
    normalizationTrail: [],
    degradedNodes: [],
  };
}

/**
 * Build the mapping from Chinese wikilink type labels to normalized relation types.
 * These are the recognized "xxx" in "xxx::[[target]]" body wikilinks.
 */
function buildWikilinkTypeLabels(proj) {
  const configured = proj.wikilink_type_labels;
  // WP-050 D1：标签表 null 原型——正文连线前缀（toString::[[X]] 等）直取不可表达，回落 unknown
  const result = Object.create(null);
  for (const label of Object.keys(configured)) {
    const relationType = configured[label];
    if (label.trim() && relationType.trim()) {
      result[label.trim()] = relationType.trim();
    }
  }
  return result;
}

// PR-046：category-path 结构化校验——与 article-validator-lib.cjs（SPEC-022 Node 单源）
// 单一语义对齐（此前 Node 用点分两段闭合枚举、Python 用冒分三段式，两套执法面互斥，发布链死锁）。
// WP-040 两段式裁定（Master 2026-10-29「2A」）：契约收敛为 domain:subdomain——domain/subdomain 为
// enums.yaml 闭合枚举；topic 段退役（每篇一值不承担分类职能，与标题/article_id 重复；物理目录只取域段，
// SPEC-030 派②不变）。禁历史排错口径 troubleshoot。返回 null=通过，否则返回人读错误文案（A08/PATCH 共用，禁止第二实现）。
function validateCategoryPath(value, ruleSet) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "category-path 是标准文章必填字段";
  const parts = text.split(":");
  if (parts.length !== 2) return "category-path '" + text + "' 格式非法，应为 domain:subdomain";
  const domain = parts[0];
  const subdomain = parts[1];
  if (domain === "troubleshoot" || subdomain === "troubleshoot") {
    return "category-path '" + text + "' 使用历史排错口径；请改为 ops:<合法subdomain>，如 ops:maintain";
  }
  const domains = ruleSet ? ruleSet.domains : {};
  if (!Object.prototype.hasOwnProperty.call(domains, domain)) {
    return "category-path domain '" + domain + "' 不在 enums.yaml domains 中";
  }
  const domainSubdomains = ruleSet && ruleSet.subdomains && typeof ruleSet.subdomains === "object" ? (ruleSet.subdomains[domain] || []) : [];
  // ADR-008 D1：ruleSet.subdomains 为归一后词条对象数组（标量已 normalizeEnums 归一）。
  const knownIds = domainSubdomains.map((entry) => subdomainEntryId(entry)).filter(Boolean);
  if (!knownIds.includes(subdomain)) {
    return "category-path subdomain '" + subdomain + "' 不在 " + domain + " 合法子域中；合法值：" + knownIds.join("、");
  }
  return null;
}

/**
 * PR-052 写侧用：严格形态校验（不做 coerce——对自己写出的要严格）。PR-053 起委托通用引擎。
 * @returns {string[]} 人读错误文案（空数组=合法）
 */
function validateEnumsStrict(enums) {
  return validateDocumentStrict("enums", enums);
}

module.exports = { buildRuleSet, emptyRuleSet, validateCategoryPath, normalizeEnums, validateEnumsStrict, normalizeSubdomainEntries, subdomainEntryId };
