"use strict";

// Component: Type-Contract-Compiler（WP-228／SPEC-101 §四 U1·ADR-021 §1）
// @responsible: 合流编译器——从三源（ontology/fields/object-dictionary＋enums 段）编译只读
//   种类总目录。纯函数：同输入同输出（排序＋固定键序，无时间戳），可删重建逐字节一致。
// @inputs: compileTypeCatalog({ ontology, fields, dictionary, enums })——解析后的对象
// @outputs: 目录对象（形状＝contracts/type-contract.schema.json）；缺类级中文显示名即抛错
//   （缺名＝编译红；装载侧 fail-closed：目录不可用→个体写动作拒绝，读面降级——§3.4 写入从严）
// @context: ADR-021 §1.1 type_id＝现有注册表键（不改名）；§1.4 三标签降 kind、词典卡节点由
//   编译器生成为 system_projection 种类；字段账属主映射沿用解析器口径（类同名直查→
//   KnowledgeArticle→article→实体族→entity），此处只登记不改名。

const GOVERNANCE_LABELS = ["business_object", "config_object", "runtime_view"];

// 字段账属主解析（口径镜像 ontology-inheritance-resolver.cjs:196-204，禁在此另造）
function ownerKeyOf(fields, classId) {
  const classes = (fields && fields.classes) || {};
  if (classes[classId] && Array.isArray(classes[classId].properties)) return classId;
  if (classId === "KnowledgeArticle" && classes.article) return "article";
  if (classes.entity) return "entity";
  return null;
}

// 存储形态与写入门（U1 显式登记表——A 类三种存储形态的执法依据；B/C 类仅登记不做写执法）
// kind 取值域见 contracts/type-contract.schema.json storage.kind 枚举。
const STORAGE_TABLE = {
  FaqCard: { kind: "markdown-individual", write_channel: "/api/individuals/FaqCard" },
  Module: { kind: "yaml-vocabulary", write_channel: "PUT /api/schema/enums", vocabulary_segment: "modules" },
  BusinessDomain: { kind: "yaml-vocabulary", write_channel: "PUT /api/schema/enums", vocabulary_segment: "domains" },
  Subdomain: { kind: "yaml-vocabulary", write_channel: "PUT /api/schema/enums", vocabulary_segment: "subdomains" },
  Product: { kind: "yaml-registry", write_channel: "PUT /api/schema/product-identity", vocabulary_segment: "architecture_projection" },
  ProductVersion: { kind: "yaml-registry", write_channel: "PUT /api/schema/versions", vocabulary_segment: "versions" },
  Plate: { kind: "projection-only", write_channel: null },
  Team: { kind: "projection-only", write_channel: null },
  System: { kind: "vault-document", write_channel: null },
  Entity: { kind: "vault-document", write_channel: null },
  Document: { kind: "vault-document", write_channel: null },
  KnowledgeArticle: { kind: "vault-document", write_channel: "POST /api/articles/upload" },
  Concept: { kind: "vault-document", write_channel: null },
};

// U1 最小屏幕段：导航归属沿用词典 edited_by_tab 的页签→导航映射；renderer 仅文章类定制（B 类）
const SCREEN_TABLE = {
  FaqCard: { nav_region: "region-config-audit", nav_item: "individuals" },
  Module: { nav_region: "region-config-audit", nav_item: "schema" },
  BusinessDomain: { nav_region: "region-config-audit", nav_item: "schema" },
  Subdomain: { nav_region: "region-config-audit", nav_item: "schema" },
  Product: { nav_region: "region-config-audit", nav_item: "schema" },
  ProductVersion: { nav_region: "region-config-audit", nav_item: "schema" },
  KnowledgeArticle: { nav_region: "region-approval-publish", nav_item: "article-workflow", renderer: "custom:article-workflow" },
};

// 词典专属卡（无节点种类对应）的定键表——ADR-021 §1.1：只存在于词典的新种类由 U1 定键。
// type_id 为本表新定蛇形键；vocabulary_segment 指向 enums.yaml 段或注册表文件名。
const DICTIONARY_ONLY = {
  "0866f383-9128-415b-b119-d31c25163ec2": { type_id: "arch_layer", segment: "layers", storage: "yaml-vocabulary" },
  "07955c25-6850-4906-b1c9-4c3ff36bb6e3": { type_id: "arch_category", segment: "arch_categories", storage: "yaml-vocabulary" },
  "67ad9163-b172-4207-bdc9-cd1abb4822f8": { type_id: "tag_vocabulary", segment: "tags", storage: "yaml-vocabulary" },
  "65ece684-3770-4cdd-b9a8-aa19bca38926": { type_id: "disabled_tag", segment: "tags", storage: "yaml-vocabulary" },
  "7a9e7361-d746-4d9f-a50d-05d22764ae8f": { type_id: "concept_vocabulary", segment: "domains", storage: "yaml-vocabulary" },
  "8638b7d3-ec85-42f5-8116-7e5e93dd1173": { type_id: "article_field_value_domain", segment: null, storage: "yaml-vocabulary" },
  "6d704bce-150a-4217-85c0-1579999c7729": { type_id: "subdomain_constraint", segment: "subdomain_constraints", storage: "yaml-vocabulary" },
  "4b05a42e-e9af-4bdf-8997-c53c8b25f28e": { type_id: "dependency_version_range", segment: "dependencies", storage: "yaml-registry" },
  "1242551d-e453-4e63-b21d-5715b86ab994": { type_id: "graph_projection_config", segment: "architecture_projection", storage: "yaml-vocabulary" },
  "f212819f-9a97-482f-9d46-4baa3775e474": { type_id: "field_dictionary", segment: "fields", storage: "yaml-registry" },
  "c54f6781-1669-4576-ba6e-c504c1b8f927": { type_id: "knowledge_ontology", segment: "ontology", storage: "yaml-registry" },
  "92bd5bd8-3cc4-4e00-a659-941fa7303a9e": { type_id: "relation_type", segment: "ontology", storage: "yaml-registry" },
  "092cc25c-4d84-4af3-980a-14faae69f8dc": { type_id: "discovered_value", segment: null, storage: "projection-only" },
};

const GENERIC_ACTIONS = ["individuals.config", "individuals.create", "individuals.list", "individuals.read", "individuals.update", "individuals.retire"];

function entryShell(typeId, displayName) {
  return {
    type_id: typeId,
    display_name: displayName,
    aliases: [],
    family: "object",
    kind: null,
    parent_type_id: null,
    system_projection: false,
    keys: null,
    properties: [],
    relations: [],
    actions: [],
    screen: null,
    storage: { kind: "projection-only", write_channel: null },
    lifecycle_status: "approved",
    sources: { ontology: null, fields_owner: null, dictionary_id: null, vocabulary_segment: null },
  };
}

function compileTypeCatalog({ ontology, fields, dictionary, enums } = {}) {
  if (!ontology || !fields || !dictionary) {
    throw new Error("[type-catalog] 需要 ontology/fields/dictionary 三源（enums 可缺省）");
  }
  const nodeTypes = ontology.node_types || {};
  const actionsByClass = new Map();
  for (const [actionId, def] of Object.entries(ontology.action_types || {})) {
    if (!def || def.class_id === undefined) continue;
    if (def.lifecycle_status !== undefined && def.lifecycle_status !== "approved") continue;
    if (!actionsByClass.has(def.class_id)) actionsByClass.set(def.class_id, []);
    actionsByClass.get(def.class_id).push(actionId);
  }
  const cardsById = new Map((dictionary.core_objects || []).map((c) => [c.object_id, c]));

  const entries = [];
  const missing = [];

  for (const [classId, def] of Object.entries(nodeTypes)) {
    if (GOVERNANCE_LABELS.includes(classId)) continue; // 降级为标签（§1.4）——不进种类目录
    const displayName = def.display_name || null;
    if (!displayName) { missing.push(classId); continue; }
    const e = entryShell(classId, displayName);
    e.family = "object";
    e.kind = def.contract_kind || null;
    e.parent_type_id = def.subClassOf || null;
    e.lifecycle_status = def.lifecycle_status || "approved";
    e.sources.ontology = classId;
    e.sources.dictionary_id = def.dictionary_id || null;

    const owner = ownerKeyOf(fields, classId);
    e.sources.fields_owner = owner;
    if (owner) {
      const keys = ((fields.keys || {})[owner]) || null;
      e.keys = keys
        ? { owner, primary: [].concat(keys.primary || []), display: keys.display || null, incremental: keys.incremental || null }
        : { owner, primary: [], display: null, incremental: null };
      const props = ((fields.classes || {})[owner] || {}).properties || [];
      e.properties = props.map((p) => ({ name: p.name, display: p.display || p.name }));
    }
    e.relations = Array.isArray(def.allows_relations) ? def.allows_relations.slice() : [];
    e.actions = [...(actionsByClass.get(classId) || []).sort(), ...GENERIC_ACTIONS];

    const st = STORAGE_TABLE[classId] || { kind: "vault-document", write_channel: null };
    e.storage = { kind: st.kind, write_channel: st.write_channel };
    e.sources.vocabulary_segment = st.vocabulary_segment || null;
    if (SCREEN_TABLE[classId]) e.screen = { renderer: "generic", ...SCREEN_TABLE[classId] };
    entries.push(e);
  }

  if (missing.length) {
    throw new Error(`[type-catalog] 下列种类缺类级中文显示名（display_name），目录拒绝生成：${missing.join(", ")}`);
  }

  // 词典卡节点＝系统生成的只读种类（治理关系的目标端点，替换三个标签节点）
  const cardEntry = entryShell("object_dictionary_card", "对象词典卡（系统生成）");
  cardEntry.family = "dictionary-card";
  cardEntry.system_projection = true;
  cardEntry.storage = { kind: "projection-only", write_channel: null };
  entries.push(cardEntry);

  // 词典专属卡：按定键表生成值域/注册表/视图类条目
  const mappedNodeKinds = new Set(
    Object.values(nodeTypes).map((d) => d && d.dictionary_id).filter(Boolean)
  );
  const pending = [];
  for (const card of dictionary.core_objects || []) {
    if (mappedNodeKinds.has(card.object_id)) continue;
    const rule = DICTIONARY_ONLY[card.object_id];
    if (!rule) { pending.push(`${card.canonical_name}(${card.object_id})`); continue; }
    const e = entryShell(rule.type_id, card.canonical_name);
    e.family = card.object_kind === "runtime_view" ? "view" : (rule.storage === "yaml-registry" ? "registry" : "value-type");
    e.kind = card.object_kind || null;
    e.aliases = (card.aliases || []).map((a) => a.alias);
    e.storage = { kind: rule.storage, write_channel: null };
    e.sources.dictionary_id = card.object_id;
    e.sources.vocabulary_segment = rule.segment;
    e.lifecycle_status = card.lifecycle_status || "approved";
    entries.push(e);
  }

  entries.sort((a, b) => (a.type_id < b.type_id ? -1 : a.type_id > b.type_id ? 1 : 0));

  const labels = {};
  for (const label of GOVERNANCE_LABELS) {
    const def = nodeTypes[label];
    labels[label] = { display_name: (def && def.display_name) || label };
  }

  return {
    catalog_version: 1,
    generated_by: "node scripts/generate-type-catalog.mjs（装载期现编译为正典；文件副本仅对账快照）",
    entries,
    labels,
    meta: {
      compiled_at_runtime: false,
      pending_dictionary_entries: pending.sort(),
      notes: "三源仍可写（ADR-021 §1.3）；本目录只读、可删重建；屏幕段 U1 只含导航，列表/表单/详情属 U3。",
    },
  };
}

module.exports = { compileTypeCatalog, GENERIC_ACTIONS, GOVERNANCE_LABELS };
