// Component: Graph-Relation-Ctx
// @responsible: 构建 graph-fact 关系校验上下文（从 main.cjs 提取，规则 2 行数上限）
const path = require("node:path");
const fs = require("node:fs");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");

function buildGraphRelationCtx(vPath, readGraph, logger) {
  const fallback = { wikilinkTypeLabels: {}, relationTypes: {}, masterGraph: { nodes: [] } };
  try {
    const loading = require("../schema-manager/compliance-rule-set-service.cjs");
    const ruleSet = loading.loadRuleSetForVault(vPath);
    // WP-049 余量批：ontology 经装载端口（data＝同一收口；缺件→{} 保持）
    const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");
    const ofile = loadVocabBundle(vPath, { files: ["ontology"] }).files.ontology;
    const ontData = ofile && ofile.state === "present" ? ofile.data : {};
    const master = readGraph ? readGraph() : null;
    return {
      wikilinkTypeLabels: (ruleSet && ruleSet.wikilinkTypeLabels) || {},
      relationTypes: (ontData && ontData.relation_types) || {},
      masterGraph: master && Array.isArray(master.nodes) ? master : { nodes: [] },
    };
  } catch (error) {
    if (logger && typeof logger.warn === "function") logger.warn({ event: "graph-relation-ctx-build-failed", error: error && error.message });
    return fallback;
  }
}

module.exports = { buildGraphRelationCtx };
