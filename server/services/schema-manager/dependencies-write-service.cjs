// Component: Dependencies-Write-Service
// @responsible: 读写 TheSchema/dependencies.yaml 的版本范围关系规则。
// @inputs: dependencies.yaml、ontology.yaml、semantic_architecture.json、master_graph.json
// @outputs: 依赖规则列表、诊断、revision 与可选实体/关系类型候选
// @context: Schema-Manager

const crypto = require("crypto");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const vaultPaths = require("../../vault-paths.cjs");
const { readFrozenArtifact } = require("../../shared/frozen-artifact-reader.cjs"); // PR-084：SA 经读侧唯一咽喉（零值形状，永不 null）
const { compareVersion, normalizeVersion } = require("../../shared/version-contract.cjs");
// PR-053：TheSchema yaml 形态收口走通用咽喉（contracts/theschema.registry.json 登记的唯一形态源）
const { normalizeDocument } = require("../../shared/theschema-loader.cjs");
// SPEC-012 wave-2 图族：主图真身迁 derived-index.db——原文行读（vault 图投影停读）
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
const { readGraphArtifactText } = require("../../shared/persistence/graph-artifact-ingest.cjs");

function readMasterGraphFromStore(vaultPath) {
  try {
    const raw = readGraphArtifactText(getDerivedIndexStore(vaultPath));
    return raw === null ? null : JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function revision(raw) {
  return "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
}

const { createError: serviceError } = require("../../shared/error-factory.cjs");

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return YAML.parse(fs.readFileSync(filePath, "utf8")) || {};
  } catch (_error) {
    return {};
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
  } catch (_error) {
    return {};
  }
}

function readDependencies(vaultPath) {
  const filePath = vaultPaths.getDependenciesFilePath(vaultPath);
  const raw = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "# 版本范围关系规则\n" + "dependencies: []\n";
  let doc;
  try {
    doc = YAML.parseDocument(raw);
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (error) {
    throw serviceError("YAML_PARSE_FAILED", error.message, 500);
  }
  // PR-053：dependencies.yaml 形态收口——脏规则局部降级（数组位留 null，listDependencies 过滤），不升级 500。
  // CST doc 保留原样供写侧写回；data 为规范化视图。
  const normalized = normalizeDocument("dependencies", doc.toJSON() || {});
  return {
    filePath,
    raw,
    revision: revision(raw),
    doc,
    data: normalized.data,
    normalizationTrail: normalized.normalizationTrail,
    degradedNodes: normalized.degradedNodes,
  };
}

function readRelationTypeOptions(vaultPath) {
  const ontology = normalizeDocument("ontology", readYamlFile(vaultPaths.getOntologyFilePath(vaultPath))).data;
  const relationTypes = ontology.relation_types || {};
  return Object.keys(relationTypes).map((id) => ({
    id,
    label: relationTypes[id] && relationTypes[id].label_cn ? relationTypes[id].label_cn : id,
    versionable: Boolean(relationTypes[id] && relationTypes[id].versionable),
  }));
}

function optionFromNode(node) {
  const id = String(node.id || "").trim();
  if (!id) return null;
  const label = String(node.name || node.label || node.title || id).trim();
  return { id, label: label || id };
}

function readEntityOptions(vaultPath) {
  const map = new Map();
  try {
    // PR-082：SA 读派生库通用槽；PR-084：经读侧唯一咽喉（无数据＝零值形状 components=[]，
    // 此前 null 靠 TypeError 落 catch 充当判空——散布判空的病态形，随咽喉退役）
    const semantic = readFrozenArtifact(vaultPath, "sa");
    const components = Array.isArray(semantic.components) ? semantic.components : [];
    components.forEach((component) => {
      const option = optionFromNode(component);
      if (option) map.set(option.id, { ...option, scope: "architecture-component" });
    });
  } catch (_error) { /* best-effort: 失败静默可接受 */ }
  try {
    // SPEC-012 wave-2：图节点选项改读库原文行（无图 → 只剩 SA 组件选项，与旧文件缺席同构）
    const master = readMasterGraphFromStore(vaultPath);
    const nodes = Array.isArray(master?.nodes) ? master.nodes : [];
    nodes.forEach((node) => {
      const option = optionFromNode(node);
      if (option && !map.has(option.id)) map.set(option.id, { ...option, scope: "graph-entity" });
    });
  } catch (_error) { /* best-effort: 失败静默可接受 */ }
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function readLayerPolicyContext(vaultPath) {
  const enums = normalizeDocument("enums", readYamlFile(vaultPaths.getEnumsFilePath(vaultPath))).data;
  const policies = new Map((enums.layers || []).map((layer) => [String(layer.id || ""), new Set(layer.allowed_dependencies || [])]));
  const semantic = readFrozenArtifact(vaultPath, "sa"); // PR-084：零值形状，无需 || 兜底
  const entityLayers = new Map();
  (semantic.components || []).forEach((component) => {
    const id = String(component.id || "").trim();
    const layer = String(component.layer || component.arch_layer || "").trim();
    if (id && layer) entityLayers.set(id, layer);
  });
  return { policies, entityLayers };
}

function readTopologyEdgeKeys(vaultPath) {
  // SPEC-012 wave-2：拓扑边键集改读库原文行（无图 → null，与旧文件缺席同构）
  const master = readMasterGraphFromStore(vaultPath);
  if (!master) return null;
  if (!Array.isArray(master.connections)) return new Set();
  return new Set(master.connections.map((connection) => {
    const source = typeof connection.from === "string" ? connection.from : typeof connection.source === "string" ? connection.source : "";
    const target = typeof connection.to === "string" ? connection.to : typeof connection.target === "string" ? connection.target : "";
    const type = typeof connection.relationType === "string" ? connection.relationType : typeof connection.type === "string" ? connection.type : "";
    return [source.trim(), type.trim().toUpperCase(), target.trim()].join("\u0000");
  }).filter((key) => !key.startsWith("\u0000") && !key.endsWith("\u0000")));
}

function normalizeRule(row, index) {
  const source = String(row && row.source != null ? row.source : "").trim();
  const target = String(row && row.target != null ? row.target : "").trim();
  const type = String(row && row.type != null ? row.type : "DEPENDS_ON").trim().toUpperCase();
  const since = row && row.since != null ? String(row.since).trim() : "";
  const until = row && row.until != null && row.until !== "" ? String(row.until).trim() : null;
  const origin = row && row.origin === "auto" ? "auto" : "manual";
  const key = [source, target, type || "DEPENDS_ON", since || "", until || ""].join("\u0000");
  return {
    id: "dep-" + index + "-" + shortHash(key),
    source,
    target,
    type: type || "DEPENDS_ON",
    since,
    until,
    origin,
  };
}

function validVersion(value) {
  if (!value) return true;
  try { normalizeVersion(value); return true; } catch (_error) { return false; }
}

function diagnostic(severity, code, message, index, field) {
  return { severity, code, message, index, field };
}

function validateRules(items, context) {
  const diagnostics = [];
  const relationSet = new Set(context.relationTypeOptions.map((item) => item.id));
  const entitySet = new Set(context.entityOptions.map((item) => item.id));
  const topologyEdgeKeys = context.topologyEdgeKeys;
  const seen = new Map();
  items.forEach((item, index) => {
    if (!item.source) diagnostics.push(diagnostic("error", "SOURCE_REQUIRED", "源实体必填", index, "source"));
    if (!item.target) diagnostics.push(diagnostic("error", "TARGET_REQUIRED", "目标实体必填", index, "target"));
    if (item.source && item.target && item.source === item.target) diagnostics.push(diagnostic("error", "SELF_DEPENDENCY", "源实体和目标实体不能相同", index, "target"));
    if (!item.type) diagnostics.push(diagnostic("error", "TYPE_REQUIRED", "关系类型必填", index, "type"));
    if (item.origin !== "auto" && item.origin !== "manual") diagnostics.push(diagnostic("error", "INVALID_ORIGIN", "来源必须是 auto 或 manual", index, "origin"));
    else if (relationSet.size > 0 && !relationSet.has(item.type)) diagnostics.push(diagnostic("error", "UNKNOWN_RELATION_TYPE", "关系类型未在实体与关系规则中定义", index, "type"));
    if (item.source && entitySet.size > 0 && !entitySet.has(item.source)) diagnostics.push(diagnostic("warning", "UNKNOWN_SOURCE_ENTITY", "源实体未出现在当前架构组件或图谱实体中", index, "source"));
    if (item.target && entitySet.size > 0 && !entitySet.has(item.target)) diagnostics.push(diagnostic("warning", "UNKNOWN_TARGET_ENTITY", "目标实体未出现在当前架构组件或图谱实体中", index, "target"));
    if (item.since && !validVersion(item.since)) diagnostics.push(diagnostic("error", "INVALID_SINCE_VERSION", "生效版本必须是 X.Y 到 X.Y.Z.W 格式的精确版本号", index, "since"));
    if (item.until && !validVersion(item.until)) diagnostics.push(diagnostic("error", "INVALID_UNTIL_VERSION", "失效版本必须是 X.Y 到 X.Y.Z.W 格式的精确版本号", index, "until"));
    if (item.since && item.until && validVersion(item.since) && validVersion(item.until) && compareVersion(item.since, item.until) >= 0) {
      diagnostics.push(diagnostic("error", "INVALID_VERSION_RANGE", "生效版本必须早于失效版本", index, "until"));
    }
    if (topologyEdgeKeys && item.source && item.target && item.type) {
      const topologyKey = [item.source, item.type, item.target].join("\u0000");
      if (!topologyEdgeKeys.has(topologyKey)) diagnostics.push(diagnostic("error", "MISSING_TOPOLOGY_EDGE", "依赖规则只能富化 entity 类型化 wikilink 已生成的拓扑关系", index));
    }
    if (item.type === "DEPENDS_ON" && context.layerPolicies) {
      const sourceLayer = context.layerPolicies.entityLayers.get(item.source);
      const targetLayer = context.layerPolicies.entityLayers.get(item.target);
      const allowed = sourceLayer ? context.layerPolicies.policies.get(sourceLayer) : null;
      if (sourceLayer && targetLayer && allowed && !allowed.has(targetLayer)) {
        diagnostics.push(diagnostic("error", "LAYER_DEPENDENCY_FORBIDDEN", "分层规则禁止 " + sourceLayer + " 依赖 " + targetLayer, index, "target"));
      }
    }
    const key = [item.source, item.target, item.type, item.since || "", item.until || ""].join("\u0000");
    if (seen.has(key)) diagnostics.push(diagnostic("error", "DUPLICATE_RULE", "重复的版本范围规则", index));
    else seen.set(key, index);
  });
  return diagnostics;
}

function buildContext(vaultPath) {
  return {
    relationTypeOptions: readRelationTypeOptions(vaultPath),
    entityOptions: readEntityOptions(vaultPath),
    topologyEdgeKeys: readTopologyEdgeKeys(vaultPath),
    layerPolicies: readLayerPolicyContext(vaultPath),
  };
}

function makeResponse(vaultPath, current, items) {
  const context = buildContext(vaultPath);
  const diagnostics = validateRules(items, context);
  return {
    items,
    diagnostics,
    revision: current.revision,
    sourceFile: displayTheSchemaPath(vaultPath, "dependencies.yaml"),
    managedScope: "architecture-component-or-graph-entity-id",
    relationTypeOptions: context.relationTypeOptions,
    entityOptions: context.entityOptions,
    summary: {
      total: items.length,
      errors: diagnostics.filter((item) => item.severity === "error").length,
      warnings: diagnostics.filter((item) => item.severity === "warning").length,
    },
  };
}

function listDependencies(vaultPath) {
  const current = readDependencies(vaultPath);
  const rows = Array.isArray(current.data.dependencies) ? current.data.dependencies.filter(Boolean) : [];
  const items = rows.map(normalizeRule);
  return makeResponse(vaultPath, current, items);
}

function assertWritableItems(items) {
  if (!Array.isArray(items)) throw serviceError("VALIDATION_ERROR", "items must be an array", 400);
  return items.map(normalizeRule);
}

function validateDependencyPayload(vaultPath, items) {
  const normalized = assertWritableItems(items);
  const current = readDependencies(vaultPath);
  return makeResponse(vaultPath, current, normalized);
}

module.exports = {
  listDependencies,
  validateDependencyPayload,
  normalizeRule,
  validateRules,
  revision,
};
