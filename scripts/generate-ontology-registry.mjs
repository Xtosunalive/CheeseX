#!/usr/bin/env node
// generate-ontology-registry.mjs — 前端本体注册表生成器（WP-049 余量批恢复：曾声明的生成器
// 不在仓——P6「声明的生成器不在仓」债根除）。数据单源＝TheSchema（经词表装载端口读取）：
//   - ENTITY_TYPES ← enums.category_map 规范值去重（ADR-006：arch-categories 退役为派生视图后，
//     分类唯一权威在别名表规范值——arch_categories 字段已空置）
//   - CATEGORY_ALIASES ← enums.category_map（英文/中文别名→canonical，数据承载）
//   - RELATION_TYPES ← ontology.relation_types（字段驼峰化映射，见 FIELD_MAP）
//   - RELATION_ALIASES ← ontology aliases 字段＋机械派生（snake(name) 与去下划线变体）
//   - GRAPH_DATABASE_RELATION_TYPES ← ontology graph_database 标志（数据承载）
//   - CATEGORY_CLASSES ← ontology node_types.<类>.category 反转（分类→类集——编辑器以分类名
//     查询类名定义域时的翻译面，WP-049 余量批修复「分类名对类名域」口径漂移）
// 用法：node scripts/generate-ontology-registry.mjs [--vault <vault 根>] [--out <目标 ts>]
//   缺省 out＝src/lib/generated/ontology-registry.ts；vault 取 --vault＞VAULT_PATH＞KB_VAULT（缺省即拒）。
// @outputs: 目标 TS 文件重写（生成物——勿手改；改数据经 TheSchema 写协议）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { loadVocabBundle } = require("../server/shared/vocab-load-port.cjs");

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const vault = optionValue(args, "--vault") || process.env.VAULT_PATH || process.env.KB_VAULT;
if (!vault || !fs.existsSync(vault)) {
  console.error("generate-ontology-registry: vault 未解析（--vault 或 VAULT_PATH/KB_VAULT）——fail-closed 不猜");
  process.exit(1);
}
const out = optionValue(args, "--out") || path.join(ROOT, "src", "lib", "generated", "ontology-registry.ts");

const bundle = loadVocabBundle(vault, { files: ["enums", "ontology"] });
const enumsFile = bundle.files.enums;
const ontologyFile = bundle.files.ontology;
if (!enumsFile || enumsFile.state !== "present" || !ontologyFile || ontologyFile.state !== "present") {
  console.error("generate-ontology-registry: enums/ontology 缺件（信封装载）——生成中止");
  process.exit(1);
}
const enums = enumsFile.data || {};
const relations = (ontologyFile.data && ontologyFile.data.relation_types) || {};

// 字段映射（snake→camel；label_cn→label、source_types→domain、target_types→range）
const FIELD_MAP = {
  label_cn: "label",
  source_types: "domain",
  target_types: "range",
  description: "description",
  semantic_role: "semanticRole",
  candidate_enabled: "candidateEnabled",
  fact_encoding: "factEncoding",
  projected: "projected",
  versionable: "versionable",
  impact_propagation: "impactPropagation",
  legacy_policy: "legacyPolicy",
  assertion_policies: "assertionPolicies",
};
const POLICY_FIELD_MAP = {
  source_kind: "sourceKind",
  producer: "producer",
  decision_mode: "decisionMode",
  required_evidence: "requiredEvidence",
  working_projection: "workingProjection",
  formal_consumers: "formalConsumers",
};
// 工作投影缺省派生（数据不承载——按裁定模式决定投影口径；显式声明优先）
const WORKING_PROJECTION_DEFAULTS = {
  reviewed: "approved_only",
  inherit_source_approval: "approved_only",
  deterministic: "approved_only",
  derived_only: "never",
  forbidden: "never",
};
function withWorkingProjectionDefaults(policies) {
  return (Array.isArray(policies) ? policies : []).map((policy) => {
    if (policy && policy.workingProjection === undefined && policy.decisionMode && WORKING_PROJECTION_DEFAULTS[policy.decisionMode]) {
      return { ...policy, workingProjection: WORKING_PROJECTION_DEFAULTS[policy.decisionMode] };
    }
    return policy;
  });
}

function mapKeys(value, map) {
  if (Array.isArray(value)) return value.map((item) => mapKeys(item, map));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[map[key] || key] = mapKeys(inner, map);
    return out;
  }
  return value;
}

const relationTypes = {};
for (const [name, def] of Object.entries(relations || {})) {
  const entry = {};
  for (const [sourceKey, targetKey] of Object.entries(FIELD_MAP)) {
    if (def[sourceKey] !== undefined) {
      entry[targetKey] = mapKeys(def[sourceKey], POLICY_FIELD_MAP);
      if (sourceKey === "assertion_policies") entry[targetKey] = withWorkingProjectionDefaults(entry[targetKey]);
    }
  }
  relationTypes[name] = entry;
}

// 别名注册表：机械面（snake(name)＋去下划线变体）＋数据面（aliases 字段——非机械英文口语与中文短名）
const relationAliases = {};
for (const [name, def] of Object.entries(relations || {})) {
  const snake = name.toLowerCase();
  for (const alias of [snake, ...(Array.isArray(def.aliases) ? def.aliases : [])]) {
    relationAliases[alias] = name;
    if (alias.includes("_")) relationAliases[alias.replace(/_/g, "")] = name; // 机械 nospace 变体
  }
}

const graphDatabaseTypes = Object.entries(relations || {})
  .filter(([, def]) => def && def.graph_database === true)
  .map(([name]) => name);

// 分类→类集（反转 node_types.<类>.category；无 category 声明的类不参与翻译）
const categoryClasses = {};
const nodeTypes = (ontologyFile.data && ontologyFile.data.node_types) || {};
for (const [className, def] of Object.entries(nodeTypes)) {
  const category = def && def.category;
  if (typeof category === "string" && category) {
    (categoryClasses[category] = categoryClasses[category] || []).push(className);
  }
}

const categoryAliases = enums.category_map && typeof enums.category_map === "object" ? enums.category_map : {};
const entityTypes = [...new Set(Object.values(categoryAliases))];

const parts = [
  "// Generated by scripts/generate-ontology-registry.mjs. Do not edit by hand.",
  "// Source: TheSchema/enums.yaml + TheSchema/ontology.yaml (from configured Vault)",
  "",
  `export const ENTITY_TYPES = ${JSON.stringify(entityTypes, null, 2)} as const;`,
  "",
  `export const CATEGORY_ALIASES = ${JSON.stringify(categoryAliases, null, 2)} as const;`,
  "",
  `export const RELATION_TYPES = ${JSON.stringify(relationTypes, null, 2)} as const;`,
  "",
  `export const RELATION_ALIASES = ${JSON.stringify(relationAliases, null, 2)} as const;`,
  "",
  `export const GRAPH_DATABASE_RELATION_TYPES = ${JSON.stringify(graphDatabaseTypes, null, 2)} as const;`,
  "",
  `export const CATEGORY_CLASSES = ${JSON.stringify(categoryClasses, null, 2)} as const;`,
  "",
];

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, parts.join("\n"));
console.log(`generate-ontology-registry: ${out}（relations=${Object.keys(relationTypes).length}，aliases=${Object.keys(relationAliases).length}，graphdb=${graphDatabaseTypes.length}）`);
