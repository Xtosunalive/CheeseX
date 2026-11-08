// Component: Property-Governance-Service — 6-check property governance engine.
// @responsible: 对架构组件属性执行六类纯计算治理检查。
// @inputs: Entity 属性、图谱节点、枚举与 manifest
// @outputs: CheckResultItem 检查结果列表
// @context: Vault
// Ported from 架构图系统/scripts/audit-arch-components.py + new checks for module governance.
// Pure computation, no side effects — receives parsed JSON, returns CheckResultItem[].

const { inspectFormalDocumentNode } = require("../projection/formal-document-node.cjs");

// WP-030/PR-145：可渲染实体标签集单源 contracts/graph-admission.json（契约缺失回退内置缺省）
var GRAPH_ADMISSION = { entityLabels: ["ArchitectureComponent", "Module"] };
try { GRAPH_ADMISSION = require("../../../contracts/graph-admission.json"); } catch (_e) { /* 契约缺失回退内置缺省 */ }

// seq203（审计族 W 收尾 + 规则 2 拆分）：checkFormat/FIELDS_TO_SCAN 单源迁移至
// ./property-format-scan.cjs（词表唯一事实源），此处 require 并在 module.exports 原面兼容——
// 前端 FormatArtifactCard.PROPOSAL_FIELDS 为其投影（− "label"），由
// server/services/__tests__/property-gov-wordlist-projection.test.cjs 锁死，改词表必须双端同步。
var { checkFormat: checkFormat, FIELDS_TO_SCAN: FIELDS_TO_SCAN } = require("./property-format-scan.cjs");

// ── normalizeString: Rule 9 — explicit normalization, no bare casts ──
function normalizeString(val) {
  if (typeof val === "string") return val.trim();
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) {
    var first = val[0];
    if (typeof first === "string") {
      var cleaned = first.replace(/^\[?'?|'?\]?$/g, "").trim();
      return cleaned;
    }
    return val.length > 0 ? normalizeString(val[0]) : "";
  }
  return "";
}

// ── normalizeFilePath: SA sourcePath may be absolute, graph file_path is relative ──
function normalizeFilePath(rawPath) {
  if (!rawPath) return "";
  var s = String(rawPath).trim();
  // Strip leading segments up to and including "知识库/"
  var kbIdx = s.indexOf("知识库/");
  if (kbIdx >= 0) s = s.slice(kbIdx);
  // Strip leading user-home directory prefix
  if (s.indexOf("/Users/") === 0) {
    var parts = s.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "知识库") {
        s = parts.slice(i).join("/");
        break;
      }
    }
  }
  return s;
}

// ── Check 1 & 2: module presence and validity ──

/**
 * @param {string|null|undefined} moduleValue — raw module from SA component
 * @param {string[]} validModules — known module list
 * @returns {{ missing_module: {passed:boolean}, invalid_module: {passed:boolean, value:string, validModules:string[]} }}
 */
function checkModule(moduleValue, validModules) {
  validModules = Array.isArray(validModules) ? validModules : [];
  var m = normalizeString(moduleValue);

  var missing = { passed: true };
  var invalid = { passed: true, value: m, validModules: validModules };

  if (!m) {
    missing.passed = false;
    return { missing_module: missing, invalid_module: invalid };
  }

  if (validModules.indexOf(m) < 0) {
    invalid.passed = false;
  }

  return { missing_module: missing, invalid_module: invalid };
}

// ── Check 3: property freshness ──

/**
 * @param {string} sourcePath — SA component sourcePath
 * @param {Object} manifestFiles — extract_manifest.json files{} {path: {mtime_ns, size}}
 * @param {string} generatedAt — manifest generatedAt ISO timestamp
 * @returns {{ stale_property: {passed:boolean, articleMtime:string, propertyExtractedAt:string} }}
 */
function checkFreshness(sourcePath, manifestFiles, generatedAt) {
  if (!sourcePath || !manifestFiles) {
    return { stale_property: { passed: true, articleMtime: "N/A", propertyExtractedAt: generatedAt || "N/A" } };
  }

  var normPath = normalizeFilePath(sourcePath);
  var fileEntry = manifestFiles[normPath];

  if (!fileEntry) {
    var altPath = normPath.replace(/^知识库\//, "");
    fileEntry = manifestFiles[altPath];
  }

  if (!fileEntry || !fileEntry.mtime_ns) {
    return { stale_property: { passed: true, articleMtime: "N/A", propertyExtractedAt: generatedAt || "N/A" } };
  }

  var articleMtimeMs = Math.floor(fileEntry.mtime_ns / 1000000);
  var articleMtime = new Date(articleMtimeMs).toISOString();

  if (!generatedAt) {
    return { stale_property: { passed: true, articleMtime: articleMtime, propertyExtractedAt: "N/A" } };
  }

  var generatedMs = new Date(generatedAt).getTime();
  var stale = articleMtimeMs > generatedMs;

  return {
    stale_property: {
      passed: !stale,
      articleMtime: articleMtime,
      propertyExtractedAt: generatedAt,
    },
  };
}

// ── Check 4: mount matching ──

/**
 * Build graph indexes from master_graph nodes.
 * Ported from audit-arch-components.py:325-354
 */
function buildGraphIndexes(graphNodes) {
  // 键来自图谱节点（id/architecture-node-id），普通 {} 会让 constructor/toString 等键
  // 命中 Object.prototype——查表时会误判「已挂载」（假绿），一律用无原型字典。
  var nodeById = Object.create(null);
  var archIdToNodeId = Object.create(null);
  var degree = Object.create(null);

  if (!Array.isArray(graphNodes)) return { nodeById: nodeById, archIdToNodeId: archIdToNodeId, degree: degree };

  for (var i = 0; i < graphNodes.length; i++) {
    var node = graphNodes[i];
    if (!node || !node.id) continue;
    var nid = String(node.id).trim();
    if (!nid) continue;

    nodeById[nid] = node;

    var props = node.properties;
    if (props && typeof props === "object") {
      var archId = props["architecture-node-id"] || props["architecture_node_id"];
      if (archId && String(archId).trim()) {
        archIdToNodeId[String(archId).trim()] = nid;
      }
    }
  }

  return { nodeById: nodeById, archIdToNodeId: archIdToNodeId, degree: degree };
}

/**
 * Check if SA component sourcePath can be matched to a master_graph node.
 * Ported from audit-arch-components.py:357-369
 */
function checkMount(component, graphNodes) {
  var indexes = buildGraphIndexes(graphNodes);
  var nodeById = indexes.nodeById;
  var archIdToNodeId = indexes.archIdToNodeId;

  var compId = component.id || "";
  var sourcePath = component.sourcePath || "";

  // Strategy 1: direct node ID match
  if (nodeById[compId]) {
    return { mount_mismatch: { passed: true, matchedEntityId: compId } };
  }

  // Strategy 2: architecture-node-id → node_id mapping
  if (archIdToNodeId[compId]) {
    return { mount_mismatch: { passed: true, matchedEntityId: archIdToNodeId[compId] } };
  }

  // Strategy 3: sourcePath → file_path match
  if (sourcePath) {
    var normPath = normalizeFilePath(sourcePath);
    var nodeIds = Object.keys(nodeById);
    for (var i = 0; i < nodeIds.length; i++) {
      var node = nodeById[nodeIds[i]];
      var props = node.properties;
      if (props && typeof props === "object") {
        var fp = props.file_path || props.filePath || "";
        if (fp) {
          var normFp = normalizeFilePath(fp);
          if (normPath === normFp || normPath.indexOf(normFp) >= 0 || normFp.indexOf(normPath) >= 0) {
            return { mount_mismatch: { passed: true, matchedEntityId: node.id } };
          }
        }
      }
    }
  }

  return { mount_mismatch: { passed: false, matchedEntityId: null } };
}

// ── Check 5: mount diagnostic ──

function checkDiagnostic(component, graphNodes, graphEdges) {
  var compId = component.id || "";
  var entityCount = 0;
  var edgeCount = 0;

  if (Array.isArray(graphNodes)) {
    for (var i = 0; i < graphNodes.length; i++) {
      var n = graphNodes[i];
      if (!n) continue;
      var props = n.properties || {};
      var archId = props["architecture-node-id"] || props["architecture_node_id"] || "";
      if (archId === compId || n.id === compId) entityCount++;
    }
  }

  if (Array.isArray(graphEdges)) {
    for (var i = 0; i < graphEdges.length; i++) {
      var e = graphEdges[i];
      if (!e) continue;
      if (e.from === compId || e.to === compId || e.source === compId || e.target === compId) edgeCount++;
    }
  }

  return {
    mount_diagnostic: {
      entityCount: entityCount,
      edgeCount: edgeCount,
      missingEntityIds: entityCount === 0 ? [compId] : [],
    },
  };
}

// ── Check 6: format artifact detection ──

// ── Check 7: Document node → module entity existence ──

/**
 * For each Document node in the graph, check whether its module property
 * references an entity node (Module or ArchitectureComponent) that exists
 * in the same graph. Documents with a module that has no corresponding
 * entity are flagged as blocker — the knowledge node must be created first.
 */
function checkDocumentModuleEntity(docNode, graphNodes, validModules) {
  validModules = Array.isArray(validModules) ? validModules : [];
  var admission = inspectFormalDocumentNode(docNode);
  if (!admission.applicable) return { document_module_entity: { passed: true, applicable: false, moduleName: "", reason: admission.reason, docFilePath: admission.sourcePath } };
  var moduleName = (docNode.properties && docNode.properties.module) ? String(docNode.properties.module).trim() : "";
  var props = docNode.properties || {};
  var title = props.title || docNode.label || "";
  var filePath = props.file_path || props.sourcePath || "";

  if (!moduleName) {
    return {
      document_module_entity: {
        passed: true,
        moduleName: "",
        moduleInEnums: false,
        hasEntity: false,
        matchedEntityId: null,
        docTitle: title,
        docFilePath: filePath,
        reason: "文档未声明 module 属性",
      },
    };
  }

  var moduleInEnums = validModules.indexOf(moduleName) >= 0;

  if (!moduleInEnums) {
    return {
      document_module_entity: {
        passed: false,
        moduleName: moduleName,
        moduleInEnums: false,
        hasEntity: false,
        matchedEntityId: null,
        docTitle: title,
        docFilePath: filePath,
        reason: "module 值 '" + moduleName + "' 不在枚举列表，无法匹配实体",
      },
    };
  }

  // Search for entity node whose label matches the module name
  var hasEntity = false;
  var matchedNodeId = null;
  for (var i = 0; i < graphNodes.length; i++) {
    var n = graphNodes[i];
    if (!n || !n.id) continue;
    var nLabels = n.labels || [];
    var isEntityType = GRAPH_ADMISSION.entityLabels.some(function (l) { return nLabels.indexOf(l) >= 0; });
    if (!isEntityType) continue;
    if (n.label === moduleName) {
      hasEntity = true;
      matchedNodeId = n.id;
      break;
    }
    if (n.properties && n.properties.module === moduleName) {
      hasEntity = true;
      matchedNodeId = n.id;
      break;
    }
  }

  return {
    document_module_entity: {
      passed: hasEntity,
      moduleName: moduleName,
      moduleInEnums: true,
      hasEntity: hasEntity,
      matchedEntityId: matchedNodeId,
      docTitle: title,
      docFilePath: filePath,
      reason: hasEntity ? "已匹配知识实体" : "module 值在枚举中合法，但图谱中不存在对应的知识实体节点",
    },
  };
}

// ── Aggregate: checkAll ──

function checkAll(components, manifest, graphNodes, graphEdges, validModules) {
  validModules = Array.isArray(validModules) ? validModules : [];
  components = components || [];
  var manifestFiles = (manifest && manifest.files) ? manifest.files : {};
  var generatedAt = (manifest && manifest.generatedAt) ? manifest.generatedAt : null;
  var results = [];

  for (var i = 0; i < components.length; i++) {
    var c = components[i];
    if (!c) continue;

    var moduleChecks = checkModule(c.module, validModules);
    var freshnessCheck = checkFreshness(c.sourcePath, manifestFiles, generatedAt);
    var mountCheck = checkMount(c, graphNodes);
    var diagnosticCheck = checkDiagnostic(c, graphNodes, graphEdges);
    var formatCheck = checkFormat(c);

    results.push({
      componentId: c.id || "",
      label: c.label || c.id || "",
      module: c.module || null,
      archLayer: c.arch_layer || c.layer || "",
      sourcePath: c.sourcePath || "",
      sourcePathExists: !!c.sourcePath,
      checks: Object.assign({},
        moduleChecks,
        freshnessCheck,
        mountCheck,
        diagnosticCheck,
        formatCheck,
      ),
    });
  }

  // ── Check 7: Document nodes — module entity existence ──
  var docNodes = [];
  for (var j = 0; j < (graphNodes || []).length; j++) {
    var gn = graphNodes[j];
    if (gn && gn.labels && gn.labels.indexOf("Document") >= 0) {
      docNodes.push(gn);
    }
  }
  for (var k = 0; k < docNodes.length; k++) {
    var dn = docNodes[k];
    var docModCheck = checkDocumentModuleEntity(dn, graphNodes || [], validModules);
    var dm = docModCheck.document_module_entity;
    var docModuleVal = dm.moduleName || null;

    results.push({
      componentId: dn.id || "",
      label: dm.docTitle || dn.label || dn.id || "",
      module: docModuleVal,
      archLayer: "",
      sourcePath: dm.docFilePath || "",
      sourcePathExists: true,
      checks: {
        missing_module: { passed: true },
        invalid_module: { passed: true, value: "", validModules: validModules },
        stale_property: { passed: true, articleMtime: "N/A", propertyExtractedAt: "N/A" },
        mount_mismatch: { passed: true, matchedEntityId: null },
        mount_diagnostic: { entityCount: 0, edgeCount: 0, missingEntityIds: [] },
        format_artifact: { passed: true, artifacts: [] },
        document_module_entity: dm,
      },
    });
  }

  return results;
}

// ── Severity classification：单源在 ./property-severity.cjs（seq193 拆分，file-size 棘轮）──

// ── Summary builder ──

function buildSummary(results) {
  var total = results.length;
  var blockerCount = 0;
  var warningCount = 0;
  var healthyCount = 0;
  var hasModule = 0;

  for (var i = 0; i < results.length; i++) {
    var c = results[i].checks;
    var severity = classifyComponentSeverity(c);

    if (severity === "blocker") blockerCount++;
    else if (severity === "warning") warningCount++;
    else healthyCount++;

    if (c.missing_module.passed && c.invalid_module.passed) hasModule++;
  }

  return {
    totalComponents: total,
    blockerCount: blockerCount,
    warningCount: warningCount,
    healthyCount: healthyCount,
    coverageRatio: total > 0 ? Math.round((hasModule / total) * 100) / 100 : 0,
  };
}

// ── Filter helper ──

function filterResults(results, filter, q) {
  var filtered = results;

  if (filter && filter !== "all") {
    filtered = results.filter(function (r) {
      var c = r.checks;
      switch (filter) {
        case "blocker": return classifyComponentSeverity(c) === "blocker";
        case "warning": return classifyComponentSeverity(c) === "warning";
        case "missing_module": return !c.missing_module.passed;
        case "invalid_module": return !c.invalid_module.passed;
        case "stale": return !c.stale_property.passed;
        case "mount_mismatch": return !c.mount_mismatch.passed;
        case "format_artifact": return !c.format_artifact.passed;
        case "document_module_entity": return c.document_module_entity && !c.document_module_entity.passed;
        default: return true;
      }
    });
  }

  if (q) {
    var query = q.toLowerCase();
    filtered = filtered.filter(function (r) {
      return (r.label || "").toLowerCase().indexOf(query) >= 0 ||
             (r.sourcePath || "").toLowerCase().indexOf(query) >= 0 ||
             (r.componentId || "").toLowerCase().indexOf(query) >= 0;
    });
  }

  return filtered;
}

var { classifyComponentSeverity } = require("./property-severity.cjs");

module.exports = {
  checkModule: checkModule,
  FIELDS_TO_SCAN: FIELDS_TO_SCAN,
  checkFreshness: checkFreshness,
  checkMount: checkMount,
  checkDiagnostic: checkDiagnostic,
  checkFormat: checkFormat,
  checkDocumentModuleEntity: checkDocumentModuleEntity,
  checkAll: checkAll,
  buildSummary: buildSummary,
  filterResults: filterResults,
  classifyComponentSeverity: classifyComponentSeverity,
  normalizeFilePath: normalizeFilePath,
  buildGraphIndexes: buildGraphIndexes,
};
