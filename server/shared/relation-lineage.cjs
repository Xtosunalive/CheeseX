// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Component: Relation-Lineage
// @responsible: 纯结构校验——判定图谱边的血缘字段是否完整，与 fresh/stale 影响分析无关。
// @inputs: 图谱边对象（connections/edges）
// @outputs: 每条边的 trusted/valid/lineageKind/missingFields 结构判定
// @context: Canvas
//
// 无状态、无 fs、无 vaultPath。供 analysis(graph-provenance) 与 publication(article-graph-batch)
// 共同消费，因此落在 shared，避免 publication 直接依赖 analysis 服务。

function firstSource(edge) {
  const properties = edge && typeof edge.properties === "object" && !Array.isArray(edge.properties) ? edge.properties : {};
  const sources = Array.isArray(properties.sources) ? properties.sources : [];
  return sources.find((item) => item && typeof item === "object" && !Array.isArray(item)) || {};
}

function inspectRelationLineage(edge = {}) {
  const properties = edge && typeof edge.properties === "object" && !Array.isArray(edge.properties) ? edge.properties : {};
  const source = firstSource(edge);
  const reviewStatus = edge.reviewStatus || properties.reviewStatus || "none";
  const edgeId = edge.edgeId || `${edge.from || edge.source || "?"}|${edge.relationType || edge.type || "?"}|${edge.to || edge.target || "?"}`;
  if (reviewStatus !== "approved") return { edgeId, trusted: false, valid: true, lineageKind: "untrusted", missingFields: [] };

  const sourcePath = edge.sourceFile || edge.sourcePath || properties.sourceFile || properties.sourcePath || source.file || source.path || "";
  if (sourcePath) {
    const sourceHash = edge.sourceHash || edge.source_hash || properties.sourceHash || properties.source_hash || source.source_hash || source.sourceHash || "";
    const lineNumber = edge.lineNumber || edge.line_number || properties.lineNumber || properties.line_number || source.line_number || source.lineNumber || null;
    const evidenceHash = edge.evidenceHash || edge.evidence_hash || properties.evidenceHash || properties.evidence_hash || source.evidence_hash || source.evidenceHash || "";
    const missingFields = [];
    if (!sourceHash) missingFields.push("sourceHash");
    if (!Number.isInteger(lineNumber) || lineNumber < 1) missingFields.push("lineNumber");
    if (!evidenceHash) missingFields.push("evidenceHash");
    return { edgeId, trusted: true, valid: missingFields.length === 0, lineageKind: "source", sourcePath, missingFields };
  }

  const ruleId = properties.ruleId || properties.rule_id || edge.ruleId || edge.rule_id || "";
  const ruleRevision = properties.ruleRevision || properties.rule_revision || edge.ruleRevision || edge.rule_revision || "";
  const inputs = properties.inputCoordinates || properties.input_coordinates || edge.inputCoordinates || edge.input_coordinates || [];
  const missingFields = [];
  if (!ruleId) missingFields.push("ruleId");
  if (!ruleRevision) missingFields.push("ruleRevision");
  if (!Array.isArray(inputs) || inputs.length === 0) missingFields.push("inputCoordinates");
  return { edgeId, trusted: true, valid: missingFields.length === 0, lineageKind: "derived", sourcePath: "", missingFields };
}

function collectMissingRelationLineage(graph = {}) {
  const connections = Array.isArray(graph.connections) ? graph.connections : Array.isArray(graph.edges) ? graph.edges : [];
  return connections.map(inspectRelationLineage).filter((item) => item.trusted && !item.valid);
}

module.exports = { collectMissingRelationLineage, firstSource, inspectRelationLineage };
