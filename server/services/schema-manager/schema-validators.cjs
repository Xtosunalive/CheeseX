// Component: Schema-Validators
// @responsible: Shared schema validation functions consumed by enums + ontology routes
// @inputs: section data payloads
// @outputs: string[] of human-readable validation errors (empty = valid)
// @context: Schema-Manager

// ADR-008 D1：词条双形态取 id 口径（enums-loader 单源）
var subdomainEntryId = require("../../shared/enums-loader.cjs").subdomainEntryId;

// ── Section metadata ──

// 前端节键 → enums.yaml 顶层键的映射（categories→arch_categories 是唯一错名）。
// 单一事实源：路由校验闸门（validateEnumsPatchPayload）与写回 mutate（writeEnumsPatch）共用，
// 防止「校验按映射后键、写回按原始键」两套口径漂移。
var SECTION_YAML_KEY_MAP = {
  domains: "domains",
  subdomains: "subdomains",
  subdomain_constraints: "subdomain_constraints",
  layers: "layers",
  categories: "arch_categories", // WP-064 修正：恢复原生映射（PR-054/035 设计）——categories 前端键写 arch_categories（fallback 直改＝配置路径；影子写语义见 writeEnums），声明宿主解冻由路由守卫放行实现
  article_types: "article_types",
  doc_types: "doc_types",
  modules: "modules",
  tags: "tags",
  tag_aliases: "tag_aliases",
  disabled_tags: "disabled_tags",
};

var VALID_SECTIONS = Object.keys(SECTION_YAML_KEY_MAP);

var LIFECYCLE_STATUSES = new Set(
  require("../../../contracts/object-meta-model.json").layers.status.enums.lifecycle_status.map(function (entry) { return entry.value; })
);
var ONTOLOGY_ELEMENT_SECTIONS = [
  { key: "node_types", type: "class" },
  { key: "relation_types", type: "relation" },
  { key: "action_types", type: "action" },
  { key: "risk_types", type: "risk" },
  { key: "inference_rules", type: "rule", array: true },
  { key: "constraints", type: "constraint", array: true },
];
var INHERITANCE_RESOLVER = require("../../shared/ontology-inheritance-resolver.cjs");
const ONTOLOGY_LIFECYCLE = require("./ontology-lifecycle-transition.cjs");
var FORBIDDEN_BINDING_KEYS = INHERITANCE_RESOLVER.FORBIDDEN_BINDING_KEYS;

// ── Enums validators ──
//
// PR-052：手写形态口径退役——形态判定单源于 contracts/enums.schema.json（与读侧 server/shared/enums-loader.cjs
// 同一 Ajv 实例族、同一 schema 文件）。本文件保留「跨字段语义规则」（重复值、悬空引用、系统唯一性）——
// 那是 schema 表达不了的业务约束，不是形态判定。validateStringArray/validateStringMap 改为 schema 派生实现，
// 签名与行为（返回 string[] 人读错误、空数组=合法）保持不变，既有调用方与测试零改动。

function validateEnumsShape(enumsLike) {
  return require("../../shared/enums-loader.cjs").validateEnumsStrict(enumsLike);
}

function validateDomains(domains) {
  var errors = [];
  if (typeof domains !== "object" || domains === null || Array.isArray(domains)) {
    errors.push("domains must be a key-value object");
    return errors;
  }
  var keys = Object.keys(domains);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!k || typeof k !== "string" || !k.trim()) {
      errors.push("domains: key must be non-empty string");
    }
    if (typeof domains[k] !== "string" || !domains[k].trim()) {
      errors.push("domains." + k + ": value must be non-empty string");
    }
  }
  return errors;
}

function validateSubdomains(subdomains, mergedDomains) {
  var errors = [];
  if (typeof subdomains !== "object" || subdomains === null || Array.isArray(subdomains)) {
    errors.push("subdomains must be a key-value object");
    return errors;
  }
  var keys = Object.keys(subdomains);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!k || typeof k !== "string" || !k.trim()) {
      errors.push("subdomains: key must be non-empty string");
      continue;
    }
    if (mergedDomains && !Object.prototype.hasOwnProperty.call(mergedDomains, k)) {
      errors.push("subdomains." + k + ": key not found in domains");
    }
    var arr = subdomains[k];
    if (!Array.isArray(arr)) {
      errors.push("subdomains." + k + ": must be an array");
      continue;
    }
    // 用 Set 而非普通对象做去重寄存器：普通对象 obj[k] 会命中原型同名属性，
    // 合法词条 "constructor"/"toString" 会被误判成重复值。
    var seen = new Set();
    for (var j = 0; j < arr.length; j++) {
      var item = arr[j];
      // ADR-008 D1：词条双形态——裸标量（legacy）或 {id,label?,description?} 对象（编辑器/absorb 产出）。
      var entryId = subdomainEntryId(item);
      if (entryId === null) {
        errors.push("subdomains." + k + "[" + j + "]: must be non-empty string or {id,...} entry");
      } else if (item && typeof item === "object" && ((item.label !== undefined && typeof item.label !== "string") || (item.description !== undefined && typeof item.description !== "string"))) {
        errors.push("subdomains." + k + "[" + j + "]: label/description must be strings");
      } else if (seen.has(entryId)) {
        errors.push("subdomains." + k + ": duplicate value '" + entryId + "'");
      } else {
        seen.add(entryId);
      }
    }
  }
  return errors;
}

function validateLayers(layers) {
  var errors = [];
  if (!Array.isArray(layers)) {
    errors.push("layers must be an array");
    return errors;
  }
  // layout 词表与去重寄存器用 Set：普通对象查表会把 "constructor"/"toString"
  // 当成合法 layout（原型同名属性误命中），layer id 同名也会被误判重复。
  // WP-049 余量批：值域从契约 schema 派生（P6「layers layout 三份」收敛——服务端不再手抄第二份）
  var validLayouts = new Set(
    require("../../../contracts/enums.schema.json").properties.layers.items.properties.layout.enum || [],
  );
  var seenIds = new Set();
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (!l || typeof l !== "object") {
      errors.push("layers[" + i + "]: must be an object");
      continue;
    }
    if (!l.id || typeof l.id !== "string" || !l.id.trim()) {
      errors.push("layers[" + i + "].id: required, non-empty string");
    } else if (seenIds.has(l.id)) {
      errors.push("layers[" + i + "].id: duplicate id '" + l.id + "'");
    } else {
      seenIds.add(l.id);
    }
    if (!l.label || typeof l.label !== "string" || !l.label.trim()) {
      errors.push("layers[" + i + "].label: required, non-empty string");
    }
    if (l.layout && !validLayouts.has(l.layout)) {
      errors.push("layers[" + i + "].layout: must be one of " + Array.from(validLayouts).join(", "));
    }
    ["allowed_categories", "allowed_dependencies"].forEach(function (field) {
      if (l[field] !== undefined) errors = errors.concat(validateStringArray(l[field], "layers[" + i + "]." + field));
    });
  }
  return errors;
}

function subdomainValues(subdomains) {
  // ADR-008 D1：词条双形态取 id——裸标量（legacy）或 {id,...} 对象，口径同 enums-loader subdomainEntryId。
  var toId = require("../../shared/enums-loader.cjs").subdomainEntryId;
  var values = new Set();
  if (!subdomains || typeof subdomains !== "object" || Array.isArray(subdomains)) return values;
  Object.values(subdomains).forEach(function (items) {
    if (!Array.isArray(items)) return;
    items.forEach(function (item) { var id = toId(item); if (id) values.add(id); });
  });
  return values;
}

function validateSubdomainConstraints(policies, domains, subdomains, categories) {
  var errors = [];
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) return ["subdomain_constraints must be an object"];
  var knownSubdomains = subdomainValues(subdomains);
  Object.keys(policies).forEach(function (id) {
    var policy = policies[id];
    if (!knownSubdomains.has(id)) errors.push("subdomain_constraints." + id + ": unknown subdomain");
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) return errors.push("subdomain_constraints." + id + ": must be an object");
    if (!Object.prototype.hasOwnProperty.call(domains, policy.domain_id)) errors.push("subdomain_constraints." + id + ".domain_id: unknown domain");
    var categoryErrors = validateStringArray(policy.allowed_categories, "subdomain_constraints." + id + ".allowed_categories");
    errors = errors.concat(categoryErrors);
    (policy.allowed_categories || []).forEach(function (value) { if (!categories.includes(value)) errors.push("subdomain_constraints." + id + ": unknown category '" + value + "'"); });
  });
  return errors;
}

function validatePolicyReferences(data) {
  var errors = validateSubdomainConstraints(data.subdomain_constraints || {}, data.domains || {}, data.subdomains || {}, data.arch_categories || []);
  var layerIds = (data.layers || []).map(function (layer) { return layer.id; });
  (data.layers || []).forEach(function (layer) {
    if (layer.domain_id && !Object.prototype.hasOwnProperty.call(data.domains || {}, layer.domain_id)) errors.push("layers." + layer.id + ".domain_id: unknown domain");
    (layer.allowed_categories || []).forEach(function (value) { if (!(data.arch_categories || []).includes(value)) errors.push("layers." + layer.id + ": unknown category '" + value + "'"); });
    (layer.allowed_dependencies || []).forEach(function (value) { if (!layerIds.includes(value)) errors.push("layers." + layer.id + ": unknown dependency layer '" + value + "'"); });
  });
  return errors;
}

// PR-052：形态校验改由 contracts/enums.schema.json 派生（原手写遍历口径退役）。
// 语义项（重复值/非空串）仍需逐值判定——schema 只表达类型，不表达唯一性。
function validateStringArray(arr, label) {
  var errors = [];
  if (!Array.isArray(arr)) {
    errors.push(label + " must be an array");
    return errors;
  }
  var seen = new Set();
  for (var i = 0; i < arr.length; i++) {
    var item = arr[i];
    if (typeof item !== "string" || !item.trim()) {
      errors.push(label + "[" + i + "]: must be non-empty string");
    } else if (seen.has(item)) {
      errors.push(label + ": duplicate value '" + item + "'");
    } else {
      seen.add(item);
    }
  }
  return errors;
}

function validateModules(modules) {
  var errors = [];
  if (typeof modules !== "object" || modules === null || Array.isArray(modules)) {
    return ["modules must be a key-value object"];
  }
  var names = Object.keys(modules);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!name.trim()) {
      errors.push("modules: key must be non-empty string");
      continue;
    }
    var definition = modules[name];
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      errors.push("modules." + name + ": must be an object");
      continue;
    }
    var stringFields = ["subdomain", "parent_id", "system", "since", "until"];
    for (var fi = 0; fi < stringFields.length; fi++) {
      var field = stringFields[fi];
      if (definition[field] !== undefined && typeof definition[field] !== "string") {
        errors.push("modules." + name + "." + field + ": must be a string");
      }
    }
    if (definition.products !== undefined) {
      errors = errors.concat(validateStringArray(definition.products, "modules." + name + ".products"));
    }
  }
  // A14（2026-09-13）：4 条模块语义规则后端单源——此前只在前端 ModuleRegistryEditor 自算，后端写回不校验。
  // ① system 非空 ② subdomain 非空 ③ system 与 subdomain 不应相同 ④ system 全库唯一。
  // Map 承载（非普通对象）：system 名恰为 "constructor" 时普通对象会命中原型同名属性，
  // 使 systemOwners[sys] 取到函数再 .push 抛 TypeError——写入口直接 500。
  var systemOwners = new Map();
  for (var mi = 0; mi < names.length; mi++) {
    var mname = names[mi];
    var mdef = modules[mname];
    if (typeof mdef !== "object" || mdef === null) continue;
    if (typeof mdef.system === "string" && mdef.system.trim()) {
      var sys = mdef.system.trim();
      var owners = systemOwners.get(sys);
      if (owners) owners.push(mname); else systemOwners.set(sys, [mname]);
    }
  }
  for (var ri = 0; ri < names.length; ri++) {
    var rname = names[ri];
    var rdef = modules[rname];
    if (typeof rdef !== "object" || rdef === null || Array.isArray(rdef)) continue;
    if (typeof rdef.system !== "string" || !rdef.system.trim()) errors.push("modules." + rname + ".system: must not be empty");
    if (typeof rdef.subdomain !== "string" || !rdef.subdomain.trim()) errors.push("modules." + rname + ".subdomain: must not be empty");
    if (typeof rdef.system === "string" && typeof rdef.subdomain === "string" && rdef.system.trim() && rdef.system.trim() === rdef.subdomain.trim()) {
      errors.push("modules." + rname + ": system must differ from subdomain");
    }
    if (typeof rdef.system === "string" && rdef.system.trim() && systemOwners.get(rdef.system.trim()).length > 1) {
      errors.push("modules." + rname + ".system: duplicate system across modules (" + systemOwners.get(rdef.system.trim()).join(", ") + ")");
    }
  }
  for (var ni = 0; ni < names.length; ni++) {
    var cursor = names[ni], visited = new Set();
    while (Object.prototype.hasOwnProperty.call(modules, cursor) && modules[cursor] && modules[cursor].parent_id) {
      var parentId = modules[cursor].parent_id;
      if (!Object.prototype.hasOwnProperty.call(modules, parentId)) { errors.push("modules." + cursor + ".parent_id: unknown module"); break; }
      if (visited.has(cursor)) { errors.push("modules." + names[ni] + ".parent_id: circular hierarchy"); break; }
      visited.add(cursor);
      cursor = parentId;
    }
  }
  return errors;
}

// PR-052：手写「对象 + 每值须为字符串数组」口径退役——改由 contracts/enums.schema.json 派生。
// 同 schema、同 strict 实例（读侧 enums-loader 的严格侧），确保 API 侧与读侧不再两套判定。
function validateStringMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [label + " must be an object"];
  var errors = [];
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!key || !key.trim()) {
      errors.push(label + ": key must be non-empty string");
      continue;
    }
    var shapeErrors = validateEnumsShape({ [label]: value });
    if (shapeErrors.length) {
      // 只取该键的报错（实例路径为 /<label>/<key>），其余键不牵连
      for (var e = 0; e < shapeErrors.length; e++) {
        if (shapeErrors[e].indexOf("/" + label + "/" + key) === 0) errors.push(shapeErrors[e]);
      }
      continue;
    }
    errors = errors.concat(validateStringArray(value[key], label + "." + key));
  }
  return errors;
}

// ADR-008 波4 兑现（SPEC-017 W3）：删词门禁——被删子域词条须画像零使用（usageCount=0 现算证据）。
// 与 validateRemovedSubdomainReferences（模块引用面）串联：先引用后使用，两道都过才放行。
// TALOS「无删除命令只有归档」原则的词级实例化：在用即拒，死词才可删（删除本身仍留快照可回溯）。
function validateRemovedSubdomainUsage(vaultPath, previousSubdomains, nextSubdomains) {
  var toId = require("../../shared/enums-loader.cjs").subdomainEntryId;
  var previous = subdomainValues(previousSubdomains);
  var next = subdomainValues(nextSubdomains);
  var removed = Array.from(previous).filter(function (value) { return !next.has(value); });
  if (removed.length === 0) return [];
  // 现算画像（R2 响应即弃语义复用）——只查被删词的使用计数
  var profile;
  try {
    profile = require("../schema-profiling/vocabulary-profiling-service.cjs").buildVocabularyProfile({ vaultPath: vaultPath });
  } catch (_e) {
    return []; // 画像不可算（环境缺 vault）不阻断写路径——执法面在真 vault 环境；CI 夹具按既有 skip 惯例
  }
  var usage = new Map(profile.dimensions.subdomain.words.map(function (w) { return [w.word, w.usageCount]; }));
  return removed
    .filter(function (value) { return (usage.get(value) || 0) > 0; })
    .map(function (value) {
      return "subdomains: removed value '" + value + "' is still in use (usageCount=" + usage.get(value) + ")——删词须画像零使用（死词证据前置，ADR-008 波4）";
    });
}

function validateRemovedSubdomainReferences(previousSubdomains, nextSubdomains, modules) {
  var previous = subdomainValues(previousSubdomains);
  var next = subdomainValues(nextSubdomains);
  var removed = Array.from(previous).filter(function (value) { return !next.has(value); });
  var errors = [];
  for (var ri = 0; ri < removed.length; ri++) {
    var value = removed[ri];
    var moduleNames = Object.keys(modules || {}).filter(function (name) {
      return modules[name] && modules[name].subdomain === value;
    });
    if (moduleNames.length > 0) errors.push("subdomains: removed value '" + value + "' is still used by modules: " + moduleNames.join(", "));
  }
  return errors;
}

// PR-054/035（写前语义闸）：mergedData 自本批起为写后全量 doc（原先仅 domains）——
// subdomain_constraints 的形态＋语义校验在写路径生效（validateSubdomainConstraints 本体
// 已有，此前仅 boot 自检③面调用，脏值落盘后才发现）。存量调用方 schema-boot-selfcheck 同批改传全量 doc。
function validateSection(key, value, mergedData) {
  switch (key) {
    case "domains":    return validateDomains(value);
    case "subdomains": return validateSubdomains(value, mergedData && mergedData.domains);
    case "subdomain_constraints":
      return validateSubdomainConstraints(
        value,
        (mergedData && mergedData.domains) || {},
        (mergedData && mergedData.subdomains) || [],
        (mergedData && mergedData.arch_categories) || []
      );
    case "layers":     return validateLayers(value);
    case "categories": return validateStringArray(value, "categories");
    case "article_types": return validateStringArray(value, "article_types");
    case "doc_types": return validateStringArray(value, "doc_types");
    case "modules": return validateModules(value);
    case "tags": return validateStringMap(value, "tags");
    case "tag_aliases": return validateStringMap(value, "tag_aliases");
    case "disabled_tags": return validateStringArray(value, "disabled_tags");
    default:           return ["unknown section: " + key];
  }
}

// ── Ontology validators ──

function lifecycleStatus(definition) {
  return definition && definition.lifecycle_status !== undefined ? definition.lifecycle_status : "approved";
}

function ontologyEntries(data, section) {
  var value = data && data[section.key];
  if (section.array) {
    if (!Array.isArray(value)) return [];
    return value.map(function (definition, index) {
      return {
        id: definition && typeof definition.id === "string" ? definition.id : null,
        definition: definition,
        locator: section.key + "[" + index + "]",
      };
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).map(function (id) {
    return { id: id, definition: value[id], locator: section.key + "." + id };
  });
}

function ontologyEntryMap(entries) {
  var map = new Map();
  entries.forEach(function (entry) { if (entry.id) map.set(entry.id, entry); });
  return map;
}

function findOntologyElement(data, id) {
  for (var i = 0; i < ONTOLOGY_ELEMENT_SECTIONS.length; i++) {
    var entry = ontologyEntryMap(ontologyEntries(data, ONTOLOGY_ELEMENT_SECTIONS[i])).get(id);
    if (entry) return { entry: entry, section: ONTOLOGY_ELEMENT_SECTIONS[i] };
  }
  return null;
}

function validateElementLifecycles(payload, errors) {
  ONTOLOGY_ELEMENT_SECTIONS.forEach(function (section) {
    ontologyEntries(payload, section).forEach(function (entry) {
      var definition = entry.definition;
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) return;
      if (!LIFECYCLE_STATUSES.has(lifecycleStatus(definition))) {
        errors.push(entry.locator + ".lifecycle_status: must be one of " + Array.from(LIFECYCLE_STATUSES).join(", "));
      }
      if (definition.retirement !== undefined && (!definition.retirement || typeof definition.retirement !== "object" || Array.isArray(definition.retirement))) {
        errors.push(entry.locator + ".retirement: must be an object");
      }
    });
  });
}

function validateRetirementChains(payload, mergedData, previousData, errors) {
  ONTOLOGY_ELEMENT_SECTIONS.forEach(function (section) {
    var entries = ontologyEntries(mergedData, section);
    var byId = ontologyEntryMap(entries);
    var payloadById = ontologyEntryMap(ontologyEntries(payload, section));
    var previousById = ontologyEntryMap(ontologyEntries(previousData, section));
    entries.forEach(function (entry) {
      var definition = entry.definition;
      if (!definition || lifecycleStatus(definition) !== "retired") return;
      if (!entry.id) {
        errors.push(entry.locator + ".id: required for retired element");
        return;
      }
      var retirement = definition.retirement;
      if (retirement === undefined) {
        errors.push(entry.locator + ".retirement.reason: required non-empty string for retired element");
        errors.push(entry.locator + ".retirement.replaced_by: required non-empty string for retired element");
        return;
      }
      if (!retirement || typeof retirement !== "object" || Array.isArray(retirement)) return;
      if (typeof retirement.reason !== "string" || !retirement.reason.trim()) {
        errors.push(entry.locator + ".retirement.reason: required non-empty string for retired element");
      }
      if (typeof retirement.replaced_by !== "string" || !retirement.replaced_by.trim()) {
        errors.push(entry.locator + ".retirement.replaced_by: required non-empty string for retired element");
        return;
      }
      var replacementId = retirement.replaced_by;
      if (replacementId === entry.id) {
        errors.push(entry.locator + ".retirement.replaced_by: self-reference is forbidden");
        return;
      }
      var directTarget = byId.get(replacementId);
      if (!directTarget) {
        var otherType = findOntologyElement(mergedData, replacementId);
        errors.push(entry.locator + ".retirement.replaced_by: " + (otherType
          ? "must reference the same element type (got " + otherType.section.type + ")"
          : "unknown replacement '" + replacementId + "'"));
        return;
      }

      var payloadEntry = payloadById.get(entry.id);
      var previousEntry = previousById.get(entry.id);
      var isRetirementWrite = Boolean(payloadEntry) && (previousData
        ? !previousEntry || lifecycleStatus(previousEntry.definition) !== "retired" || !previousEntry.definition.retirement || previousEntry.definition.retirement.replaced_by !== retirement.replaced_by
        : payload !== mergedData);
      if (isRetirementWrite && lifecycleStatus(directTarget.definition) !== "approved") {
        errors.push(entry.locator + ".retirement.replaced_by: retirement target must be approved at write time");
      }

      var visited = new Set([entry.id]);
      var cursorId = replacementId;
      var cursor = directTarget;
      while (cursor) {
        if (visited.has(cursorId)) {
          errors.push(entry.locator + ".retirement.replaced_by: replacement cycle detected");
          break;
        }
        visited.add(cursorId);
        var status = lifecycleStatus(cursor.definition);
        if (status === "approved") break;
        if (status !== "retired") {
          errors.push(entry.locator + ".retirement.replaced_by: replacement chain has no approved terminal");
          break;
        }
        var nextRetirement = cursor.definition.retirement;
        var nextId = nextRetirement && typeof nextRetirement.replaced_by === "string" ? nextRetirement.replaced_by : "";
        if (!nextId) break;
        if (nextId === cursorId) break;
        var next = byId.get(nextId);
        if (!next) {
          errors.push(entry.locator + ".retirement.replaced_by: replacement chain is dangling at '" + nextId + "'");
          break;
        }
        cursorId = nextId;
        cursor = next;
      }
    });
  });
}

function validateClassHierarchy(payload, mergedData, errors) {
  var nodeTypes = mergedData.node_types || {};
  var payloadNodes = payload.node_types || {};
  Object.keys(payloadNodes).forEach(function (id) {
    var definition = payloadNodes[id];
    if (!definition || typeof definition !== "object" || Array.isArray(definition) || definition.subClassOf === undefined) return;
    var visited = new Set([id]);
    var parentId = definition.subClassOf;
    while (typeof parentId === "string" && parentId.trim()) {
      if (visited.has(parentId)) {
        errors.push("node_types." + id + ".subClassOf: inheritance cycle detected");
        break;
      }
      visited.add(parentId);
      var parent = Object.prototype.hasOwnProperty.call(nodeTypes, parentId) ? nodeTypes[parentId] : undefined;
      if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
        errors.push("node_types." + id + ".subClassOf: unknown parent class '" + parentId + "'");
        break;
      }
      if (lifecycleStatus(definition) === "approved" && lifecycleStatus(parent) !== "approved") {
        errors.push("node_types." + id + ".subClassOf: approved class parent chain must contain only approved classes");
        break;
      }
      parentId = parent.subClassOf;
    }
  });
}

function validateActiveRelationReferences(mergedData, errors) {
  var nodeTypes = mergedData.node_types || {};
  var relationTypes = mergedData.relation_types || {};
  Object.keys(nodeTypes).forEach(function (id) {
    var definition = nodeTypes[id];
    if (!definition || lifecycleStatus(definition) !== "approved" || !Array.isArray(definition.allows_relations)) return;
    definition.allows_relations.forEach(function (relationId, index) {
      var relation = Object.prototype.hasOwnProperty.call(relationTypes, relationId) ? relationTypes[relationId] : undefined;
      if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
        errors.push("node_types." + id + ".allows_relations[" + index + "]: unknown relation type '" + relationId + "'");
      } else if (lifecycleStatus(relation) !== "approved") {
        errors.push("node_types." + id + ".allows_relations[" + index + "]: relation type '" + relationId + "' must be approved");
      }
    });
  });
}

function validateNodeType(key, value, allRelationKeys, errors, fieldDefinitions) {
  if (!key || typeof key !== "string" || !key.trim()) {
    errors.push("node_types: key must be non-empty string");
    return;
  }
  if (!value || typeof value !== "object") {
    errors.push("node_types." + key + ": must be an object");
    return;
  }
  if (!value.description || typeof value.description !== "string") {
    errors.push("node_types." + key + ".description: required string");
  }
  // Q1（PR-020 批3 顺带修）：domain→category 改名第 5 处漏项——本校验器自改名后一直零调用故未暴露；
  // 真实 Vault 11 节点全带 category（ontology.yaml 实测），保持 required string 语义不变。
  if (!value.category || typeof value.category !== "string") {
    errors.push("node_types." + key + ".category: required string");
  }
  if (!value.color || typeof value.color !== "string") {
    errors.push("node_types." + key + ".color: required string");
  }
  if (!value.icon || typeof value.icon !== "string") {
    errors.push("node_types." + key + ".icon: required string");
  }
  if (value.subClassOf !== undefined && (typeof value.subClassOf !== "string" || !value.subClassOf.trim())) {
    errors.push("node_types." + key + ".subClassOf: must be a non-empty string");
  } else if (value.subClassOf === key) {
    errors.push("node_types." + key + ".subClassOf: self-reference is forbidden");
  }
  if (value.data_properties !== undefined) {
    if (!value.data_properties || typeof value.data_properties !== "object" || Array.isArray(value.data_properties)) {
      errors.push("node_types." + key + ".data_properties: must be an object");
    } else {
      Object.keys(value.data_properties).forEach(function (field) {
        var binding = value.data_properties[field];
        var locator = "node_types." + key + ".data_properties." + field;
        if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
          errors.push(locator + ": must be an object");
          return;
        }
        FORBIDDEN_BINDING_KEYS.forEach(function (forbidden) {
          if (Object.prototype.hasOwnProperty.call(binding, forbidden)) {
            errors.push(locator + "." + forbidden + ": field definitions remain owned by fields.yaml and their registries");
          }
        });
        if (!fieldDefinitions) {
          errors.push(locator + ": fields.yaml snapshot is required to validate class bindings");
        } else if (!fieldDefinitions.has(field)) {
          errors.push(locator + ": unknown field in fields.yaml");
        }
      });
    }
  }
  if (value.allows_relations === undefined && typeof value.subClassOf === "string" && value.subClassOf.trim()) return;
  if (!Array.isArray(value.allows_relations)) {
    errors.push("node_types." + key + ".allows_relations: must be an array");
  } else {
    for (var i = 0; i < value.allows_relations.length; i++) {
      var rel = value.allows_relations[i];
      if (typeof rel !== "string") {
        errors.push("node_types." + key + ".allows_relations[" + i + "]: must be a string");
      } else if (allRelationKeys.length && !allRelationKeys.includes(rel)) {
        errors.push("node_types." + key + ".allows_relations[" + i + "]: unknown relation type '" + rel + "'");
      }
    }
  }
}

function validateRelationType(key, value, allNodeKeys, errors) {
  if (!key || typeof key !== "string" || !key.trim()) {
    errors.push("relation_types: key must be non-empty string");
    return;
  }
  if (!value || typeof value !== "object") {
    errors.push("relation_types." + key + ": must be an object");
    return;
  }
  if (!value.description || typeof value.description !== "string") {
    errors.push("relation_types." + key + ".description: required string");
  }
  if (!value.label_cn || typeof value.label_cn !== "string") {
    errors.push("relation_types." + key + ".label_cn: required string");
  }
  if (typeof value.versionable !== "boolean") {
    errors.push("relation_types." + key + ".versionable: must be boolean");
  }
  if (typeof value.weight_default !== "number" || isNaN(value.weight_default)) {
    errors.push("relation_types." + key + ".weight_default: must be a number");
  }
  if (!Array.isArray(value.weight_range) || value.weight_range.length !== 2) {
    errors.push("relation_types." + key + ".weight_range: must be an array of 2 numbers");
  }
  if (!Array.isArray(value.source_types)) {
    errors.push("relation_types." + key + ".source_types: must be an array");
  } else if (allNodeKeys.length) {
    for (var j = 0; j < value.source_types.length; j++) {
      if (!allNodeKeys.includes(value.source_types[j])) {
        errors.push("relation_types." + key + ".source_types[" + j + "]: unknown node type '" + value.source_types[j] + "'");
      }
    }
  }
  if (!Array.isArray(value.target_types)) {
    errors.push("relation_types." + key + ".target_types: must be an array");
  } else if (allNodeKeys.length) {
    for (var k = 0; k < value.target_types.length; k++) {
      if (!allNodeKeys.includes(value.target_types[k])) {
        errors.push("relation_types." + key + ".target_types[" + k + "]: unknown node type '" + value.target_types[k] + "'");
      }
    }
  }
}

function validateOntologyPayload(payload, mergedData, previousData, fields) {
  var errors = [];
  errors.push.apply(errors, ONTOLOGY_LIFECYCLE.assertElementTransitions(previousData, payload));
  ONTOLOGY_ELEMENT_SECTIONS.forEach(function (section) {
    if (!section.array) return;
    var seen = new Set();
    ontologyEntries(mergedData, section).forEach(function (entry) {
      if (!entry.id) return;
      if (seen.has(entry.id)) errors.push(entry.locator + ".id: duplicate id '" + entry.id + "'");
      seen.add(entry.id);
    });
  });
  if (errors.length) return errors;
  var fieldDefinitions;
  try {
    fieldDefinitions = INHERITANCE_RESOLVER.fieldDefinitionsOf(fields);
  } catch (error) {
    errors.push("fields.yaml: " + error.message);
  }
  validateElementLifecycles(payload, errors);
  validateClassHierarchy(payload, mergedData, errors);
  validateActiveRelationReferences(mergedData, errors);
  validateRetirementChains(payload, mergedData, previousData, errors);
  var allNodeKeys = Object.keys(mergedData.node_types || {});
  var allRelationKeys = Object.keys(mergedData.relation_types || {});
  if (payload.node_types) {
    for (var nk in payload.node_types) {
      if (!allNodeKeys.includes(nk)) allNodeKeys.push(nk);
    }
  }
  if (payload.relation_types) {
    for (var rk in payload.relation_types) {
      if (!allRelationKeys.includes(rk)) allRelationKeys.push(rk);
    }
  }
  if (payload.node_types) {
    var ntKeys = Object.keys(payload.node_types);
    for (var i = 0; i < ntKeys.length; i++) {
      validateNodeType(ntKeys[i], payload.node_types[ntKeys[i]], allRelationKeys, errors, fieldDefinitions);
    }
  }
  if (payload.relation_types) {
    var rtKeys = Object.keys(payload.relation_types);
    for (var j = 0; j < rtKeys.length; j++) {
      validateRelationType(rtKeys[j], payload.relation_types[rtKeys[j]], allNodeKeys, errors);
    }
  }
  return errors;
}

module.exports = {
  validateRemovedSubdomainUsage,
  VALID_SECTIONS,
  SECTION_YAML_KEY_MAP,
  validateDomains,
  validateSubdomains,
  validateLayers,
  validateStringArray,
  validateStringMap,
  validateModules,
  validateSubdomainConstraints,
  validatePolicyReferences,
  validateRemovedSubdomainReferences,
  validateSection,
  validateNodeType,
  validateRelationType,
  validateOntologyPayload,
  // PR-183 附加条件同咽喉执法需要：退役三件套与替代链校验、生命周期形状校验（与路由同一实现，非第二份判据）
  validateElementLifecycles,
  validateRetirementChains,
};
