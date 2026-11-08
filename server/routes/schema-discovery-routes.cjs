// Component: Schema-Discovery-Routes
// @responsible: 发现 Entity 野生骨架值并安全升级为正式值。
// @inputs: Entity frontmatter、enums.yaml、formal absorb request
// @outputs: GET /api/schema/discovery、POST /api/schema/discovery/absorb
// @context: Schema-Manager

const { sendJSON } = require("../shared/api-envelope.cjs");
const articleLifecycle = require("../shared/article-lifecycle-paths.cjs");
const { buildRuleSet, normalizeSubdomainEntries, subdomainEntryId } = require("../shared/enums-loader.cjs");
const { scanEntities } = require("../services/entity-compliance/entity-source-scanner.cjs");
const { readEnums } = require("../shared/schema-config.cjs");
const { registerRetiredRoutes } = require("../shared/retired-route-registrar.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1：absorb 经统一执行工厂——原 handler 逻辑原样迁入执行器 schema-discovery.absorb。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
// 波2（SPEC-007 §3.1）：词表画像接线——波1 引擎（vocabulary-profiling-service）消费面。
// verifiedThreshold 查询参数透传（2026-10-08 22:06 Master 阈值裁决：默认 1、页面配置项可调）。
const { buildVocabularyProfile, DEFAULT_VERIFIED_THRESHOLD } = require("../services/schema-profiling/vocabulary-profiling-service.cjs");
// 波3（SPEC-008 §3.1）：规则信号——波1 mining 服务消费面（anomaly issues 现算，R2 不落盘）。
const { mineRuleCandidates, DEFAULT_MIN_COUNT } = require("../services/schema-profiling/rule-signal-mining-service.cjs");
// ADR-007 A1/A4/A5：实体生长传感器（文章 wikilink → 候选/提及计数/孤儿）
const { scanEntityCandidates, scanOrphanEntities } = require("../services/entity-growth/entity-growth-scanner.cjs");
const { buildEntityIndexes } = require("../services/entity-compliance/entity-compliance-service.cjs");
// PR-088 接线一（Master 2026-10-21「立契应进生长架构接线」）：子域×类别组合候选——实体现算＋观察账本史
const { buildMatrixCandidates } = require("../services/schema-profiling/matrix-candidates.cjs");

const FIELDS = ["layers", "categories", "subdomains", "tags"];

// G1'：tags 扫描面——文章（precleaned）与实体的 frontmatter tags 均纳入。
// 受控集 = enums.tags 全部值 ∪ tag_aliases 全部键（别名也算"已知"）——
// 野生 tag 不在受控集 → 进待沉淀队列，由人在配置页分配（正式标签/别名），不自动吞。
const fs = require("node:fs");
const path = require("node:path");
// WP-116 批1（SPEC-083 §二.1）：手写 `^---\n…\n---` 切分退役——frontmatter 切分唯一宿主
// （document-load-port），tags 值经 docField 六态取值；逐值归一（trim/去引号/滤空）口径不变。
const { loadDocument, docField } = require("../shared/document-load-port.cjs");

function scanArticleTags(vaultPath, buckets, controlledTags) {
  const dirs = [articleLifecycle.workingDir(vaultPath), articleLifecycle.draftsDir(vaultPath)];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const file = path.join(dir, name);
      let tags = null;
      try {
        const raw = fs.readFileSync(file, "utf8");
        const doc = loadDocument(raw, file);
        const probe = docField(doc, "tags");
        // 行内式/块列表式 → YAML 数组（仅原始值项；嵌套数组=行内 wikilink 的 YAML 解析形态，
        // 旧正则下为不可解析的垃圾值，不收）；标量（含逗号串/数字/布尔）按旧口径拆逗号——
        // 空串拆出空项、null/缺键/对象形态不产 tags，均由下方 !Array.isArray 分支滤除
        if (Array.isArray(probe.value) && !probe.value.some((item) => Array.isArray(item) || (item && typeof item === "object"))) {
          tags = probe.value;
        } else if (typeof probe.value === "string" || typeof probe.value === "number" || typeof probe.value === "boolean") {
          tags = String(probe.value).split(",");
        }
      } catch { continue; }
      if (!Array.isArray(tags)) continue;
      for (const value of tags) {
        const v = String(value || "").trim().replace(/^['"]|['"]$/g, "");
        if (!v || controlledTags.has(v)) continue;
        const current = buckets.tags.get(v) || { value: v, count: 0, files: [] };
        current.count += 1;
        current.files.push(file);
        buckets.tags.set(v, current);
      }
    }
  }
}

function frontendEnums(data) {
  return {
    domains: data.domains || {},
    // ADR-008 D1：响应侧输出归一后词条对象数组（label 随词条可达前端编辑器）。
    subdomains: normalizeSubdomainEntries(data.subdomains).normalized,
    layers: data.layers || [],
    categories: data.arch_categories || [],
  };
}

function discoveryData(vaultPath) {
  const data = readEnums(vaultPath);
  const rules = buildRuleSet(data);
  const configs = {
    layers: { source: "arch_layer", valid: new Set(rules.archLayers || []), aliases: rules.layerAliases || {} },
    categories: { source: "arch_category", valid: new Set(rules.archCategories || []), aliases: rules.categoryAliases || {} },
    subdomains: { source: "arch_subdomain", valid: new Set(rules.subdomainIds || []), aliases: rules.subdomainAliases || {} },
    tags: { source: "tags", valid: new Set(rules.formalTags || []), aliases: rules.tagAliases || {} },
  };
  // G1'：tags 受控集 = 正式标签 ∪ 别名键（tag_aliases 的键也算已知——别名指向规范标签）
  const controlledTags = new Set(configs.tags.valid);
  for (const aliasKey of Object.keys(configs.tags.aliases)) controlledTags.add(aliasKey);

  const buckets = { layers: new Map(), categories: new Map(), subdomains: new Map(), tags: new Map() };
  for (const entity of scanEntities(vaultPath)) {
    const fm = entity.doc.frontmatter || {};
    for (const field of FIELDS) {
      if (field === "tags") {
        // G1'：实体侧 tags（数组或逗号分隔字符串）——野生值进待沉淀队列
        const rawTags = fm.tags;
        const list = Array.isArray(rawTags) ? rawTags : (typeof rawTags === "string" ? rawTags.split(",").map((s) => s.trim()) : []);
        for (const value of list) {
          const v = String(value || "").trim().replace(/^['"]|['"]$/g, "");
          if (!v || controlledTags.has(v)) continue;
          const current = buckets.tags.get(v) || { value: v, count: 0, files: [] };
          current.count += 1;
          current.files.push(entity.file);
          buckets.tags.set(v, current);
        }
        continue;
      }
      const config = configs[field];
      const value = typeof fm[config.source] === "string" ? fm[config.source].trim() : "";
      if (!value) continue;
      // PR-052：别名目标是数组形态（enums.schema.json 唯一契约，读侧已把标量 coerce 成数组）。
      // 归一取首个正式目标；数组本身不再直接当 canonical 去匹配 valid 集。
      const aliasTargets = Object.hasOwn(config.aliases, value) ? config.aliases[value] : undefined;
      const aliasTarget = Array.isArray(aliasTargets) ? aliasTargets.find((t) => typeof t === "string" && t.trim()) : aliasTargets;
      const canonical = aliasTarget || value;
      if (config.valid.has(canonical)) continue;
      const current = buckets[field].get(value) || { value, count: 0, files: [] };
      current.count += 1;
      current.files.push(entity.file);
      buckets[field].set(value, current);
    }
  }
  // G1'：文章侧 tags 扫描（precleaned + drafts）
  scanArticleTags(vaultPath, buckets, controlledTags);

  const discovery = {};
  const counts = { total: 0 };
  for (const field of FIELDS) {
    discovery[field] = Array.from(buckets[field].values()).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    counts[field] = discovery[field].length;
    counts.total += counts[field];
  }
  // G6（#1840）：aliasEnabled 诞生时（3fbbf535 MVP 基线）门禁的是 discovery 批量 alias 吸收的 403 拦截；
  // E3' ADR043 重构后该拦截已移除，且 #1840 已落地 tags 的 alias 分配通道（discoveryEdit assignMode=alias）
  // ——别名机制实际在工作。僵尸 false 信号与事实不符（虚报状态），改为如实报告。

  // ADR-007 MVP：实体生长信号（A1 候选 / A4 提及计数 / A5 孤儿）——现算派生物（R2），不落盘。
  // 复用合规链同一套实体索引（buildEntityIndexes）与 wikilink 解析器（B02/B04 同源）。
  const entities = scanEntities(vaultPath).map(function (e) {
    const fm = (e.doc && e.doc.frontmatter) || {};
    return { fileName: path.basename(e.file || ""), sourcePath: e.file || "", frontmatter: fm };
  });
  const indexes = buildEntityIndexes(entities);
  const growth = scanEntityCandidates({ vaultPath, indexes });
  const entityCandidates = growth.candidates;
  const entityMentions = growth.entityMentions;
  const orphanEntities = scanOrphanEntities(indexes, entityMentions);

  // 实体总目（guide⑥「文件即登记+派生总目」的机制兑现——Curriculum 同构）：
  // 全部实体按 module/域分组 + 提及计数现算。纯派生（R2），数据源=文件本身。
  const mentionByName = new Map(entityMentions.map((m) => [m.name, m.mentionCount]));
  // 分组键来自实体 module：普通 {} 会让 constructor 等键命中原型属性，.push 直接 TypeError。
  const groups = Object.create(null);
  for (const e of entities) {
    const groupName = String(e.frontmatter.module || "未分组").trim() || "未分组";
    (groups[groupName] = groups[groupName] || []).push({
      name: e.frontmatter.title || e.fileName,
      origin: e.frontmatter.origin || "seed",
      mentionCount: mentionByName.get(e.frontmatter.title) || 0,
    });
  }
  const entityCatalog = Object.entries(groups)
    .map(([group, items]) => ({ group, count: items.length, items: items.sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));

  return { discovery, counts, aliasEnabled: true, entityCandidates, entityMentions, orphanEntities, entityCatalog };
}

// 波2（SPEC-007 §3.1）：响应增量扩展 vocabularyProfile——波1 引擎现算产物（R2 响应即弃）。
// verifiedThreshold 透传（22:06 Master 裁决）：正整数生效；非法/缺省回落服务默认（宽进不硬拒——观察工具）。
function parseVerifiedThreshold(rawQuery) {
  const raw = typeof rawQuery === "string" ? rawQuery : "";
  const n = Number(raw);
  if (raw !== "" && Number.isInteger(n) && n >= 1 && n <= 99) return n;
  return DEFAULT_VERIFIED_THRESHOLD;
}

// 波3b（Master 02:57「规则也配置阈值」令）：信号门槛透传——同类违规 ≥N 次才出信号（minCount）。
// 与 verifiedThreshold 同款宽进语义（正整数 1-99，非法/缺省回落默认 2）。
function parseMinCount(rawQuery) {
  const raw = typeof rawQuery === "string" ? rawQuery : "";
  const n = Number(raw);
  if (raw !== "" && Number.isInteger(n) && n >= 1 && n <= 99) return n;
  return DEFAULT_MIN_COUNT;
}

function withVocabularyProfile(base, vaultPath, verifiedThreshold) {
  const { dimensions, summary } = buildVocabularyProfile({ vaultPath, verifiedThreshold });
  return { ...base, vocabularyProfile: { dimensions, summary } };
}

function validateFormalRequest(payload, data) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Request body must be an object";
  if (!FIELDS.includes(payload.field) || typeof payload.value !== "string" || !payload.value.trim()) return "field and non-empty value are required";
  if (payload.mode !== "formal") return "mode must be formal";
  if (payload.field === "subdomains" && (typeof payload.domain !== "string" || !payload.domain.trim())) return "domain is required for formal subdomain";
  if (payload.field === "subdomains" && !Object.prototype.hasOwnProperty.call(data.domains || {}, payload.domain)) return "domain must exist in domains";
  return null;
}

function validateAliasItems(items, data) {
  if (!Array.isArray(items) || !items.length) return "items must be a non-empty array";
  const aliases = data.architecture_projection || {};
  for (const item of items) {
    if (!item || !FIELDS.includes(item.field) || item.mode !== "alias") return "every item must contain a valid field and mode=alias";
    if (typeof item.value !== "string" || !item.value.trim() || typeof item.aliasTarget !== "string" || !item.aliasTarget.trim()) return "value and aliasTarget are required";
    if (!isFormalValue(data, item.field, item.aliasTarget.trim())) return "INVALID_ALIAS_TARGET";
    if (isFormalValue(data, item.field, item.value.trim())) return "SCHEMA_VALUE_CONFLICT";
    const key = item.field === "layers" ? "layer_aliases" : item.field === "categories" ? "category_aliases" : "subdomain_aliases";
    if (aliases[key] && Object.prototype.hasOwnProperty.call(aliases[key], item.value.trim())) return "SCHEMA_VALUE_CONFLICT";
  }
  return null;
}

function isFormalValue(data, field, value) {
  // ADR008 D39：arch_layers 已退役（由 layers 派生）；正式值只认 layers（TD-2 单源化）
  if (field === "layers") return (data.layers || []).some((item) => item && item.id === value);
  if (field === "categories") return (data.arch_categories || []).includes(value);
  // ADR-008 D1：词条双形态取 id（裸标量 legacy｜{id,...} 对象）。
  return Object.values(data.subdomains || {}).some((items) => Array.isArray(items) && items.some((item) => subdomainEntryId(item) === value));
}

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  const schemaWriteService = deps.schemaWriteService;

  // ── WP-048 W1-A 执行器：既有 handler 逻辑原样迁入（错误语义逐条保留） ──
  const __exec_schema_discovery_absorb = function (ctx) {
    try {
      if (!schemaWriteService || typeof schemaWriteService.discoveryEdit !== "function") throw createError("SCHEMA_WRITE_UNAVAILABLE", "Schema 直接写回服务不可用", 503);
      return schemaWriteService.discoveryEdit(ctx.body);
    } catch (e) {
      if (e && e.code) throw e;
      throw createError(e.code || "DISCOVERY_WRITE_FAILED", e.message, e.status || 500, e.details);
    }
  };
  registerActionExecutor("schema-discovery.absorb", __exec_schema_discovery_absorb);;
  // 波3（SPEC-008 §3.1）：anomaly issues 注入（main.cjs 传 anomaly workbench list()——issues 源）
  const anomalyListIssues = deps.anomalyListIssues || null;
  // 波2（SPEC-007 §3.2）：?verifiedThreshold=N 透传（22:06 Master 阈值裁决的页面配置项）。
  // 波3b：?minCount=N 信号门槛透传（Master 02:57 令——与实体阈值同款页面配置项）。
  registerRoute("GET", "/api/schema/discovery", function (req, res) {
    const url = new URL(req.url || "/api/schema/discovery", "http://127.0.0.1");
    const verifiedThreshold = parseVerifiedThreshold(url.searchParams.get("verifiedThreshold"));
    const minCount = parseMinCount(url.searchParams.get("minCount"));
    const base = withVocabularyProfile(discoveryData(vaultPath), vaultPath, verifiedThreshold);
    // 波3：ruleCandidates 现算挂载（无 anomaly 源时缺省空信号——渐进语义）；门槛透传
    if (anomalyListIssues) {
      const rc = mineRuleCandidates(anomalyListIssues(), { minCount });
      base.ruleCandidates = { ...rc, minCount };
    }
    // PR-088 接线一：组合候选挂载——与词表/实体/规则候选并列进同一裁定通道（absorb field=policy 收口）。
    // 与 vocabularyProfile 同款现算（R2 响应即弃）；失败不吞（与波2 先例一致，假信息比没信息糟）。
    base.matrixCandidates = buildMatrixCandidates({ vaultPath, enumsData: readEnums(vaultPath) });
    return sendJSON(res, 200, base);
  });

  // E3' ADR043：POST /api/schema/discovery/absorb 恢复为直接写回（schema-write-service.discoveryEdit）
  registerRoute("POST", "/api/schema/discovery/absorb", function (req, res) {
    return executeAction({ actionId: "schema.discovery.absorb", executor: __exec_schema_discovery_absorb, request: req, reply: res });
  });
}

module.exports = { register, discoveryData, frontendEnums, isFormalValue, validateAliasItems, validateFormalRequest, parseVerifiedThreshold, parseMinCount, withVocabularyProfile };
