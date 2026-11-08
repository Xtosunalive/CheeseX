// Component: Entity-Compliance-Service
// @responsible: Aggregate F01-F17 + F02b + F02c + B01-B04 checks on entity source documents — pure, no fs
// @inputs: EntityDocument[], ComplianceRuleSet, EntityIndexes
// @outputs: EntityComplianceResult[], ComplianceSummary
// @context: Vault

const helpers = require("./entity-compliance-helpers.cjs");
const bodyRules = require("./entity-compliance-body-rules.cjs");
const engine = require("./entity-compliance-declarative-engine.cjs");
// WP-138 R2（PR-250）：字段白名单单点化——诊断 view 键域由 field-policy 派生（契约 fields 段单源），
// 原 :30 手写字面量表退役。诊断/写门/渲染三 view 语义差见 field-policy 头注。
const fieldPolicy = require("../../shared/field-policy.cjs");
// RULE_FIELDS 单独解构转出（knip 对「engine.RULE_FIELDS 属性读值」形态不追踪——WP-130 形态修复；
// 行为零变更：同一 require 缓存对象，解构与属性读同源同引用）。
const { RULE_FIELDS } = require("./entity-compliance-declarative-engine.cjs");

const { normalizeString, isKebabCase, isDateString, isSemverLike, finding } = helpers;
const { extractTypedWikilinks, resolveTarget } = bodyRules;

var GROUP_DEFS = [
  { id: "identity", label: "身份" },
  { id: "spatial", label: "空间位置" },
  { id: "version", label: "版本生命周期" },
  { id: "organization", label: "组织" },
  { id: "temporal", label: "时效" },
  { id: "content", label: "内容" },
  { id: "body", label: "Body 关系" },
];

// 声明驱动的不可修改字段集（与 entity-repair-service 的拒写同源）
var IMMUTABLE_FIELDS = new Set(require("../../shared/field-rule-declarations.cjs").FIELD_RULES.filter(function (rule) { return rule.immutable === true; }).map(function (rule) { return rule.field; }));

// 诊断侧白名单（PR-250 单点化）：现值通道键域＋能力位基线＝field-policy 诊断 view（原字面量表退役；
// 与 entity-repair-service 的写门 view 不是同一个集合——写门多别名通道，语义差由 field-policy 声明）
var EDITABLE_FIELDS = fieldPolicy.DIAGNOSIS_FIELDS;

// seq207 诊断不拥有值：字段现值唯一来源=源文档 frontmatter（LSP/Django admin 同构：数据与标注分离）。
// 编辑面渲染读 sourceValues；诊断对象只提供标注（哪错/允许值/格式），不再兼职数据源。
// 键形解析单源（复核 C1，WP-110 随批）：frontmatter 里 kebab 与 snake 两形都可能是持有键，
// 现值通道与能力位必须走同一个解析器——此前 buildSourceValues 只读 kebab 形而 decorateFindings
// 两形都读，结果蛇形键记录「能力位判为锁死」却报不出当前值，抽屉因此给出一个提交必被 422 的空框。
function frontmatterValue(frontmatter, field) {
  var src = frontmatter || {};
  var value = src[field];
  if (value !== undefined && value !== null) return value;
  var alt = src[String(field).replace(/-/g, "_")];
  return alt === undefined ? value : alt;
}

function buildSourceValues(frontmatter) {
  var out = {};
  EDITABLE_FIELDS.forEach(function (field) {
    var value = frontmatterValue(frontmatter, field);
    out[field] = value !== undefined ? value : null;
  });
  return out;
}

// 文章侧：规范化文档字段 → 抽屉字段键的翻译（非新字段清单；键与前端 EDITABLE 锁一致）
function buildArticleSourceValues(document) {
  var doc = document || {};
  return {
    title: doc.title || null,
    article_id: doc.articleId || null,
    product: doc.product || null,
    version: doc.version || null,
    module: doc.module || null,
    article_type: doc.articleType || null,
    "doc-type": doc.docType || null,
    "category-path": doc.categoryPath || null,
    tags: doc.tags || null,
  };
}

function decorateFindings(findings, ruleSet, frontmatter) {
  var subdomain = normalizeString((frontmatter || {}).arch_subdomain || "");
  var policy = subdomain && ruleSet.subdomainConstraints ? ruleSet.subdomainConstraints[subdomain] : null;
  // SPEC-020 波 2：值域源切至解析物（fields.yaml 配方派生）；缺失回落 buildRuleSet 现行值（等价性测试锁死两侧一致）。
  // status 按 entity scope 取（实体侧 free 无闭合集 → null → 回落现行值，行为不变）。
  var resolvedRecord = function (name, scope) {
    return (ruleSet.resolvedDomains || []).find(function (record) {
      return record.name === name && (!scope || (record.scope || []).indexOf(scope) !== -1);
    }) || null;
  };
  var resolvedValues = function (name, scope, fallback) {
    var record = resolvedRecord(name, scope);
    return record && Array.isArray(record.values) ? record.values : fallback;
  };
  var allowedByField = {
    arch_layer: resolvedValues("arch_layer", "entity", ruleSet.archLayers || []),
    arch_category: policy && Array.isArray(policy.allowed_categories) && policy.allowed_categories.length ? policy.allowed_categories : resolvedValues("arch_category", "entity", ruleSet.archCategories || []),
    arch_subdomain: resolvedValues("arch_subdomain", "entity", ruleSet.subdomainIds || []),
    module: resolvedValues("module", "entity", ruleSet.moduleNames || []),
    status: resolvedValues("status", "entity", ruleSet.statuses || []),
  };
  return findings.map(function (item) {
    var allowedValues = allowedByField[item.field] || [];
    // seq197 P3b：kebabcase 字段形状单源下发（engine.fieldKebabPattern → KEBAB_RE.source），
    // 前端修复表单改消费此值（EntityRepairDrawer 硬编码字面量退役）。
    var shapePattern = engine.fieldKebabPattern(item.field);
    // D-1（WP-108）：能力位＝声明的 immutable 且该记录已有非空值 → 不再可编辑（前端据此渲染只读，
    // 不再让用户输入一个必被服务端 422 打回的值）。键形解析与 buildSourceValues 同一函数（复核 C1）。
    const immutableHere = IMMUTABLE_FIELDS.has(item.field) && normalizeString(frontmatterValue(frontmatter, item.field)) !== "";
    return Object.assign({}, item, {
      editable: EDITABLE_FIELDS.has(item.field) && !immutableHere,
    }, allowedValues.length ? { allowedValues: allowedValues } : {}, shapePattern ? { pattern: shapePattern } : {});
  });
}

function buildGroups(findings) {
  var groups = [];
  for (var gi = 0; gi < GROUP_DEFS.length; gi++) {
    var gd = GROUP_DEFS[gi];
    groups.push({
      id: gd.id,
      label: gd.label,
      checks: findings.filter(function (f) { return f._group === gd.id; }),
    });
  }
  return groups;
}

function buildEntityIndexes(entities) {
  // 索引键来自文档内容（标题/ID/别名/文件名），普通 {} 会让 constructor/toString 等键命中
  // Object.prototype（误判重复、查不到、甚至 TypeError）——一律用无原型字典。
  var idCount = Object.create(null);
  var titleCount = Object.create(null);
  var titleLookup = Object.create(null);
  var filenameLookup = Object.create(null);
  var duplicateIds = new Set();
  // 撞键持有者（id → [{title, fileName, sourcePath}]）——写门拒时要能点名「被谁占着」，
  // 只说「已被使用」用户无从下手（PR-232 修法要求「拒写并点名冲突」）。
  var idOwners = Object.create(null);
  var duplicateTitles = new Set();
  var ids = Object.create(null);
  // 2026-10-08 裁决 2（别名接线）：aliases 索引——检索归一（aliasLookup）与 F17 别名防撞
  // （duplicateAliases=撞车值集，aliasOwners=值→持有者列表供提示定位）。
  var aliasLookup = Object.create(null);
  var aliasOwners = Object.create(null);
  var duplicateAliases = new Set();

  for (var i = 0; i < entities.length; i++) {
    var e = entities[i];
    var fm = e.frontmatter || {};
    var nid = normalizeString(fm["architecture-node-id"] || fm["architecture_node_id"] || "");
    var title = normalizeString(fm.title || "");
    var fn = e.fileName || "";

    if (nid) {
      if (idCount[nid]) {
        idCount[nid]++;
        duplicateIds.add(nid);
      } else {
        idCount[nid] = 1;
      }
      ids[nid] = true;
      if (!idOwners[nid]) idOwners[nid] = [];
      idOwners[nid].push({ title: normalizeString(fm.title || ""), fileName: fn, sourcePath: e.sourcePath || "" });
    }

    if (title) {
      if (titleCount[title]) {
        titleCount[title]++;
        duplicateTitles.add(title);
      } else {
        titleCount[title] = 1;
      }
      if (!titleLookup[title]) titleLookup[title] = { id: nid, sourcePath: e.sourcePath };
    }
    if (fn && !filenameLookup[fn]) filenameLookup[fn] = { id: nid, sourcePath: e.sourcePath };

    var titleNoSpaces = title.replace(/\s+/g, "");
    if (titleNoSpaces && titleNoSpaces !== title && !titleLookup[titleNoSpaces]) {
      titleLookup[titleNoSpaces] = { id: nid, sourcePath: e.sourcePath };
    }
  }

  // 正名索引须完整，别名防撞才不依赖扫描顺序。
  for (const entity of entities) {
    const fm = entity.frontmatter || {};
    const nid = normalizeString(fm["architecture-node-id"] || fm["architecture_node_id"] || "");
    const title = normalizeString(fm.title || "");
    var aliasList = Array.isArray(fm.aliases) ? fm.aliases.map(normalizeString).filter(Boolean)
      : (typeof fm.aliases === "string" && fm.aliases.trim() ? [normalizeString(fm.aliases)] : []);
    for (var a = 0; a < aliasList.length; a++) {
      var alias = aliasList[a];
      // 检索归一：别名可解析 wikilink 目标（不参与连线寻址——见 resolveTarget 单源）
      if (!aliasLookup[alias]) aliasLookup[alias] = { id: nid, sourcePath: entity.sourcePath, aliasOf: title };
      // F17 防撞素材：别名撞他人正名 / 别名互相撞 / 同实体内重复别名
      if (titleLookup[alias] && titleLookup[alias].id !== nid) duplicateAliases.add(alias);
      if (aliasOwners[alias]) {
        if (aliasOwners[alias].indexOf(title) < 0) aliasOwners[alias].push(title);
        duplicateAliases.add(alias);
      } else {
        aliasOwners[alias] = [title];
      }
    }
  }

  return { ids: ids, idOwners: idOwners, titleLookup: titleLookup, filenameLookup: filenameLookup, duplicateIds: duplicateIds, duplicateTitles: duplicateTitles, aliasLookup: aliasLookup, aliasOwners: aliasOwners, duplicateAliases: duplicateAliases };
}

function checkEntityCompliance(entity, ruleSet, indexes) {
  var fm = entity.frontmatter || {};
  var body = entity.body || "";
  ruleSet = ruleSet || {};
  indexes = indexes || { ids: Object.create(null), titleLookup: Object.create(null), filenameLookup: Object.create(null), duplicateIds: new Set(), duplicateTitles: new Set() };

  // #940: 使用声明式引擎一次报全（error/warn/info 三级诊断 → 转 legacy finding）
  // 2026-09-12 引擎重写：F02b/F02c 唯一性已声明化进引擎（rules.json + compositeRules(indexes)），
  // 此处不再隐藏增补（声明逃逸收敛——审查档案 D1 第一批）。
  var allFindings = engine.runAllDiagnostics(entity, ruleSet, indexes).map(engine.diagnosticToFinding);

  allFindings = decorateFindings(allFindings, ruleSet, fm);

  var passedCount = 0;
  for (var i = 0; i < allFindings.length; i++) if (allFindings[i].passed) passedCount++;
  var totalChecks = allFindings.length;
  var score = totalChecks > 0 ? Math.round((passedCount / totalChecks) * 100) : 100;

  // #940: error=阻断（旧 blocker），warn=质量建议（旧 warning），info=参考
  var blockerCount = 0, warningCount = 0, infoCount = 0;
  for (var j = 0; j < allFindings.length; j++) {
    if (allFindings[j].passed) continue;
    if (allFindings[j].severity === "error" || allFindings[j].severity === "blocker") blockerCount++;
    else if (allFindings[j].severity === "warn" || allFindings[j].severity === "warning") warningCount++;
    else infoCount++;
  }

  return {
    entityId: normalizeString(fm["architecture-node-id"] || fm["architecture_node_id"] || ""),
    title: normalizeString(fm.title || ""),
    fileName: entity.fileName || "",
    sourcePath: entity.sourcePath || "",
    score: score,
    totalChecks: totalChecks,
    blockerCount: blockerCount,
    warningCount: warningCount,
    infoCount: infoCount,
    module: normalizeString(fm.module || fm.modules || ""),
    groups: buildGroups(allFindings),
    sourceValues: buildSourceValues(fm),
  };
}

function checkAllEntities(entities, ruleSet) {
  var indexes = buildEntityIndexes(entities);
  var results = [];
  for (var i = 0; i < entities.length; i++) results.push(checkEntityCompliance(entities[i], ruleSet, indexes));
  return results;
}

function isWorkbenchIssueFinding(finding) {
  if (!finding || finding.passed !== false) return false;
  // 建议性 advisory 规则（B01 类型化关系缺失 / B03 文档引用缺失）不进 workbench——
  // 它们无明确可执行修复动作；B02 unresolved 目标可执行（补创建实体/改链接）才进。
  if (finding.ruleId === "B01" || finding.ruleId === "B03") return false;
  if (finding.severity === "error" || finding.severity === "blocker") return true;
  if (typeof finding.field === "string" && finding.field.trim()) return true;
  return finding.ruleId === "B02" && Array.isArray(finding.unresolvedTargets) && finding.unresolvedTargets.length > 0;
}

function buildSummary(results) {
  var totalEntities = results.length;
  var healthyCount = 0, blockerEntityCount = 0, warningEntityCount = 0, infoEntityCount = 0;
  var totalBlocker = 0, totalWarning = 0, totalInfo = 0, scoreSum = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    scoreSum += r.score;
    totalBlocker += r.blockerCount;
    totalWarning += r.warningCount;
    totalInfo += r.infoCount;
    if (r.blockerCount === 0) healthyCount++;
    if (r.blockerCount > 0) blockerEntityCount++;
    if (r.warningCount > 0) warningEntityCount++;
    if (r.infoCount > 0) infoEntityCount++;
  }

  return {
    totalEntities: totalEntities,
    healthyCount: healthyCount,
    blockerEntityCount: blockerEntityCount,
    warningEntityCount: warningEntityCount,
    infoEntityCount: infoEntityCount,
    blockerCount: totalBlocker,
    warningCount: totalWarning,
    infoCount: totalInfo,
    averageScore: totalEntities > 0 ? Math.round((scoreSum / totalEntities) * 10) / 10 : 0,
  };
}

function filterResults(results, filter, query) {
  var filtered = results;
  if (filter && filter !== "all") {
    filtered = results.filter(function (r) {
      switch (filter) {
        case "blocker": return r.blockerCount > 0;
        case "warning": return r.blockerCount === 0 && r.warningCount > 0;
        case "info": return r.blockerCount === 0 && r.warningCount === 0 && r.infoCount > 0;
        case "healthy": return r.blockerCount === 0 && r.warningCount === 0 && r.infoCount === 0;
        default: return true;
      }
    });
  }
  if (query) {
    var q = query.toLowerCase();
    filtered = filtered.filter(function (r) {
      return (r.entityId || "").toLowerCase().indexOf(q) >= 0 ||
             (r.title || "").toLowerCase().indexOf(q) >= 0 ||
             (r.fileName || "").toLowerCase().indexOf(q) >= 0 ||
             (r.sourcePath || "").toLowerCase().indexOf(q) >= 0 ||
             (r.sourceKey || "").toLowerCase().indexOf(q) >= 0 ||
             (r.module || "").toLowerCase().indexOf(q) >= 0;
    });
  }
  return filtered;
}

module.exports = Object.assign({}, helpers, bodyRules, {
  EDITABLE_FIELDS: EDITABLE_FIELDS,
  // 字段展示元数据单源（原则 6）：转出声明式引擎同源读到的 contracts/entity-readiness-rules.json
  // fields 段（label 中文名 + hint 填写要求）。缺失实体模板（CREATE 分支）与补齐抽屉一律从此派生，
  // 路由内不得再保留字段名/中文名/填写要求的字面量副本。
  RULE_FIELDS,
  buildSourceValues: buildSourceValues,
  buildArticleSourceValues: buildArticleSourceValues,
  buildEntityIndexes: buildEntityIndexes,
  checkEntityCompliance: checkEntityCompliance,
  checkAllEntities: checkAllEntities,
  isWorkbenchIssueFinding: isWorkbenchIssueFinding,
  buildSummary: buildSummary,
  filterResults: filterResults,
  // 注：legacy checkF*/checkB* 单条 exports 已删除（死链收敛，对标 ESLint RuleTester——
  // 测试用 scripts/quality/__tests__/helpers/entity-rule-tester.mjs，生产唯一入口 checkEntityCompliance）
});
