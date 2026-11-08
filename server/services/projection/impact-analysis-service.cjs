// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// @responsible: 沿图关系执行多跳影响分析并汇集文档、血缘与处置证据。
const { createNodeIdResolver } = require("./node-id-resolver.cjs");
const { createDecisionEvidenceService } = require("../../shared/decision-lineage.cjs");

const { createError: typedError } = require("../../shared/error-factory.cjs");

function resolveImpactEdgeTypes(capabilityRegistry) {
  if (capabilityRegistry && capabilityRegistry.impactEdgeTypes instanceof Set) {
    return capabilityRegistry.impactEdgeTypes;
  }
  throw typedError("INVALID_REGISTRY", "capabilityRegistry with impactEdgeTypes is required");
}

function validateRequest(raw = {}, capabilityRegistry) {
  if (!Array.isArray(raw.seedNodeIds) || raw.seedNodeIds.length < 1 || raw.seedNodeIds.length > 20 || raw.seedNodeIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw typedError("INVALID_QUERY", "seedNodeIds 必须是 1..20 个非空字符串");
  }
  const maxHops = raw.maxHops === undefined ? 2 : raw.maxHops;
  const direction = raw.direction || "downstream";
  const minConfidence = raw.minConfidence === undefined ? 0.5 : raw.minConfidence;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 5 || !["downstream", "upstream", "both"].includes(direction) || typeof minConfidence !== "number" || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw typedError("INVALID_QUERY", "maxHops/direction/minConfidence 参数不合法");
  }
  if (raw.edgeTypes !== undefined && (!Array.isArray(raw.edgeTypes) || raw.edgeTypes.some((type) => typeof type !== "string"))) throw typedError("INVALID_QUERY", "edgeTypes 必须是字符串数组");
  const enableInference = raw.enableInference === true;
  const maxInferenceDepth = raw.maxInferenceDepth === undefined ? 3 : raw.maxInferenceDepth;
  if (enableInference && (!Number.isInteger(maxInferenceDepth) || maxInferenceDepth < 1 || maxInferenceDepth > 3)) {
    throw typedError("INVALID_QUERY", "maxInferenceDepth 必须是 1..3 的整数");
  }
  const edgeTypes = raw.edgeTypes
    ? new Set(raw.edgeTypes)
    : resolveImpactEdgeTypes(capabilityRegistry);
  return { ...raw, maxHops, direction, minConfidence, includeDocuments: raw.includeDocuments !== false, edgeTypes, enableInference, maxInferenceDepth };
}

function normalizeConfidence(edge) {
  const raw = edge.confidence !== undefined ? edge.confidence : edge.properties && edge.properties.confidence;
  if (raw === undefined || raw === null || raw === "") return { value: 0.5, valid: true };
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? { value: raw, valid: true } : { value: 0, valid: false };
}

function normalizeEdge(edge) {
  const confidence = normalizeConfidence(edge);
  const props = edge.properties && typeof edge.properties === "object" && !Array.isArray(edge.properties) ? edge.properties : {};
  const sources = Array.isArray(props.sources) ? props.sources : [];
  const firstSource = sources[0] && typeof sources[0] === "object" ? sources[0] : {};
  return {
    edgeId: typeof (edge.edgeId || edge.edge_id) === "string" ? (edge.edgeId || edge.edge_id) : "",
    source: typeof edge.from === "string" ? edge.from : "",
    target: typeof edge.to === "string" ? edge.to : "",
    type: typeof (edge.relationType || edge.type) === "string" ? (edge.relationType || edge.type) : "RELATES_TO",
    confidence: confidence.value,
    confidenceValid: confidence.valid,
    reviewStatus: typeof (edge.reviewStatus || props.reviewStatus) === "string" ? (edge.reviewStatus || props.reviewStatus) : "pending",
    sourceFile: typeof (edge.sourceFile || props.sourceFile || firstSource.file || firstSource.source_file) === "string" ? (edge.sourceFile || props.sourceFile || firstSource.file || firstSource.source_file) : "",
    sourceHash: typeof (edge.sourceHash || edge.source_hash || props.sourceHash || props.source_hash || firstSource.sourceHash || firstSource.source_hash) === "string" ? (edge.sourceHash || edge.source_hash || props.sourceHash || props.source_hash || firstSource.sourceHash || firstSource.source_hash) : "",
    lineNumber: Number.isInteger(edge.lineNumber) ? edge.lineNumber : Number.isInteger(firstSource.line_number) ? firstSource.line_number : null,
    evidenceHash: typeof (edge.evidenceHash || edge.evidence_hash || props.evidenceHash || props.evidence_hash) === "string" ? (edge.evidenceHash || edge.evidence_hash || props.evidenceHash || props.evidence_hash) : "",
    since: typeof (edge.since || props.since) === "string" ? (edge.since || props.since) : "",
    until: typeof (edge.until || props.until) === "string" ? (edge.until || props.until) : "",
    sourceMethod: typeof (props.source || firstSource.method) === "string" ? (props.source || firstSource.method) : "",
  };
}

function emptyDirection() { return { byHop: [], terminalNodeIds: [], documentRefs: [] }; }
function riskForHop(hop) { return hop === 1 ? "LOW" : hop === 2 ? "MEDIUM" : "HIGH"; }

function relationRule(edge) {
  if (edge.sourceMethod === "entity-wikilink+yaml") return { ruleId: "typed-wikilink.dependency-rule", reasonCode: "SOURCE_RELATION_WITH_VERSION_RULE" };
  if (edge.sourceMethod === "entity-wikilink") return { ruleId: "typed-wikilink.edge", reasonCode: "SOURCE_RELATION" };
  if (edge.sourceMethod === "auto-discovered") return { ruleId: "taxonomy.auto-discovered", reasonCode: "DERIVED_STRUCTURE" };
  return { ruleId: edge.reviewStatus === "approved" ? "review.approved-edge" : "graph.relation", reasonCode: edge.reviewStatus === "approved" ? "APPROVED_RELATION" : "RELATION_TRAVERSAL" };
}

function unknownFreshness() {
  return { status: "unknown", checkedAt: new Date().toISOString(), changedFields: [] };
}

function createImpactAnalysisService({ getGraph, getNodeDocuments, getDocumentsByGraphNodeIds, inferenceEngine, decisionEvidenceService, graphProvenanceService, changeDispositionService, getVersionStatus, capabilityRegistry } = {}) {
  const evidenceService = decisionEvidenceService || createDecisionEvidenceService();
  function analyze(rawRequest) {
    const request = validateRequest(rawRequest, capabilityRegistry);
    const graph = typeof getGraph === "function" ? getGraph() : null;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) throw typedError("GRAPH_UNAVAILABLE", "master graph 不可用");
    const nodes = graph.nodes.filter((node) => node && typeof node.id === "string");
    const initialGraphContext = graphProvenanceService && typeof graphProvenanceService.inspectGraph === "function"
      ? graphProvenanceService.inspectGraph([])
      : { contentHash: null, freshness: unknownFreshness() };
    const edges = graph.connections.map((rawEdge) => {
      const edge = normalizeEdge(rawEdge);
      const lineageInspection = graphProvenanceService && typeof graphProvenanceService.inspectRelationLineage === "function"
        ? graphProvenanceService.inspectRelationLineage(rawEdge)
        : null;
      const sourceContext = edge.sourceFile && graphProvenanceService && typeof graphProvenanceService.inspectSource === "function"
        ? graphProvenanceService.inspectSource(edge.sourceFile, edge.sourceHash || null)
        : initialGraphContext;
      const rule = relationRule(edge);
      return {
        ...edge,
        lineageInspection,
        lineage: evidenceService.build({
          source: {
            kind: edge.sourceFile ? "vault-document" : "derived-graph",
            // WP-060（SPEC-054）：fallback 标注真实来源（derived-index 库 master_graph 工件）——
            // 旧值为迁移前文件时代路径（显示层遗留）；sourcePath/sourceFile 在场时优先
            path: sourceContext.sourcePath || edge.sourceFile || "derived-index:master_graph",
            contentHash: edge.sourceHash || sourceContext.contentHash,
            lineNumber: edge.lineNumber,
            // WP-051 I-C：回退坐标经身份入口（含 | 段不撞）；edgeId 在场时优先透传
          coordinate: `relation:${edge.edgeId || require("../../shared/identity-port.cjs").makeId("edge", [edge.source, edge.type, edge.target, edge.evidenceHash || ""])}`,
          },
          rule: { ...rule, ruleRevision: "runtime:impact-analysis-v2" },
          // PR-082：AnyShare 硬编码回退清理——无产品身份（元层态）时不携带 scope（lineage 侧可选）
          ...((rawRequest?.product || rawRequest?.version) ? { scope: { product: rawRequest.product, version: rawRequest.version } } : {}),
          freshness: sourceContext.freshness || unknownFreshness(),
        }),
      };
    }).filter((edge) => edge.source && edge.target);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const resolver = createNodeIdResolver(nodes, graph.connections);
    const resolvedSeeds = [...new Set(request.seedNodeIds
      .map((id) => resolver.anchorImpactSeed(id).nodeId)
      .filter(Boolean))];
    if (!resolvedSeeds.length) {
      throw typedError("SEED_NOT_FOUND", `未找到可唯一匹配的种子节点: ${request.seedNodeIds.join(", ")}`);
    }

    const filtered = new Map();
    let truncated = false;
    function addFiltered(edge, reason) { filtered.set(`${edge.source}\0${edge.target}\0${edge.type}\0${reason}`, { edge: stripInternal(edge), reason }); }
    // WP-006 第2项：风险分类随边输出（riskKind 语义＝ADR009 R11-R15：data/recovery/searchability/confidentiality/dependency；非骨架类为 null）
    function riskKindFor(type) {
      const entry = capabilityRegistry && capabilityRegistry.relations instanceof Map ? capabilityRegistry.relations.get(type) : null;
      return entry && typeof entry.riskKind === "string" ? entry.riskKind : null;
    }

    function stripInternal(edge) {
      const { confidenceValid: _confidenceValid, lineageInspection: _lineageInspection, ...dto } = edge;
      dto.riskKind = riskKindFor(edge.type);
      return dto;
    }

    function traverse(direction) {
      const outgoing = direction === "downstream";
      const adjacency = new Map();
      for (const edge of edges) {
        const key = outgoing ? edge.source : edge.target;
        if (!adjacency.has(key)) adjacency.set(key, []);
        adjacency.get(key).push(edge);
      }
      const records = new Map();
      const queue = resolvedSeeds.map((seed) => ({ nodeId: seed, hop: 0, nodeIds: [seed], edges: [], confidence: 1 }));
      const terminal = new Set();
      while (queue.length) {
        const current = queue.shift();
        if (current.hop >= request.maxHops) { if (current.hop > 0) terminal.add(current.nodeId); continue; }
        let traversed = false;
        for (const edge of adjacency.get(current.nodeId) || []) {
          let reason = null;
          // Impact edge types are now capability-driven (no hardcoded IMPACT_EDGE_TYPES)
          if (!request.edgeTypes.has(edge.type)) reason = "EDGE_TYPE";
          else if (!edge.confidenceValid) reason = "INVALID_CONFIDENCE";
          else if (edge.reviewStatus === "rejected") reason = "REJECTED";
          else if (edge.lineageInspection?.trusted && !edge.lineageInspection.valid) reason = "MISSING_LINEAGE";
          else if (edge.lineageInspection?.trusted && edge.lineage.freshness.status === "stale") reason = "STALE_SOURCE";
          else if (edge.lineageInspection?.trusted && edge.lineage.freshness.status !== "fresh") reason = "UNVERIFIED_FRESHNESS";
          else if (edge.confidence < request.minConfidence) reason = "LOW_CONFIDENCE";
          if (reason) { addFiltered(edge, reason); continue; }
          const nextId = outgoing ? edge.target : edge.source;
          if (!nodeById.has(nextId) || current.nodeIds.includes(nextId)) continue;
          const hop = current.hop + 1;
          const existing = records.get(nextId);
          if (existing && existing.hop < hop) continue;
          if (!existing && records.size >= 500) { truncated = true; continue; }
          const path = { nodeIds: [...current.nodeIds, nextId], edges: [...current.edges, stripInternal(edge)], confidence: current.confidence * edge.confidence };
          const record = existing || { hop, paths: [] };
          if (record.paths.length >= 10) { truncated = true; continue; }
          record.paths.push(path); records.set(nextId, record); traversed = true;
          queue.push({ nodeId: nextId, hop, ...path });
        }
        if (!traversed && current.hop > 0) terminal.add(current.nodeId);
      }

      const grouped = new Map();
      for (const [nodeId, record] of records) {
        if (!grouped.has(record.hop)) grouped.set(record.hop, []);
        const node = nodeById.get(nodeId);
        grouped.get(record.hop).push({ nodeId, label: typeof node.label === "string" ? node.label : nodeId, hop: record.hop, risk: riskForHop(record.hop), paths: record.paths });
      }
      const documentRefs = [];
      if (request.includeDocuments && typeof getDocumentsByGraphNodeIds === "function") {
        const documents = getDocumentsByGraphNodeIds([...records.keys()]);
        for (const document of documents) documentRefs.push({ ...document, relativePath: document.sourcePath });
      } else if (request.includeDocuments && typeof getNodeDocuments === "function") {
        const seen = new Set();
        for (const nodeId of records.keys()) {
          try {
            const response = getNodeDocuments(nodeId);
            for (const document of response.result.documents || []) if (!seen.has(document.relativePath)) { seen.add(document.relativePath); documentRefs.push(document); }
          } catch (_error) { /* Missing document binding is not a traversal failure. */ }
        }
      }
      return {
        byHop: [...grouped.entries()].sort(([a], [b]) => a - b).map(([hop, impactNodes]) => ({ hop, nodes: impactNodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId)) })),
        terminalNodeIds: [...terminal].sort(), documentRefs,
      };
    }

    const downstream = request.direction === "upstream" ? emptyDirection() : traverse("downstream");
    const upstream = request.direction === "downstream" ? emptyDirection() : traverse("upstream");
    const affected = new Set([...downstream.byHop, ...upstream.byHop].flatMap((group) => group.nodes.map((node) => node.nodeId)));
    const sourcePaths = [...new Set([...resolvedSeeds, ...affected].map((nodeId) => {
      const properties = nodeById.get(nodeId)?.properties;
      return properties && typeof (properties.file_path || properties.source_path) === "string" ? (properties.file_path || properties.source_path) : "";
    }).filter(Boolean))];
    const analysisContext = graphProvenanceService && typeof graphProvenanceService.inspectGraph === "function"
      ? graphProvenanceService.inspectGraph(sourcePaths)
      : initialGraphContext;
    const allHops = [...downstream.byHop, ...upstream.byHop].map((group) => group.hop);
    const meta = {
      totalNodesAffected: affected.size,
      maxDepth: allHops.length ? Math.max(...allHops) : 0,
      traversalEdgesFiltered: filtered.size,
      truncated,
      resolvedSeedNodeIds: resolvedSeeds,
      impactEdgeTypes: [...request.edgeTypes].sort(),
      explanation: { ruleId: "impact-analysis.traverse", reasonCode: "RELATION_TRAVERSAL", sourceKind: "master-graph" },
    };
    const analysisLineage = evidenceService.build({
      source: { kind: "master-graph", path: "derived-index:master_graph", contentHash: analysisContext.contentHash, coordinate: `impact:${resolvedSeeds.join(",")}` }, // WP-060：真实来源标注（原文件时代遗留路径）
      rule: { ruleId: "impact-analysis.traverse", ruleRevision: "runtime:impact-analysis-v2", reasonCode: "RELATION_TRAVERSAL" },
      // PR-082：AnyShare 硬编码回退清理——无产品身份（元层态）时不携带 scope（lineage 侧可选）
          ...((rawRequest?.product || rawRequest?.version) ? { scope: { product: rawRequest.product, version: rawRequest.version } } : {}),
      freshness: analysisContext.freshness || unknownFreshness(),
    });
    const reasoning = request.enableInference && changeDispositionService && typeof changeDispositionService.evaluate === "function" && rawRequest?.product && rawRequest?.version
      ? changeDispositionService.evaluate({ affectedVersions: [{
        product: rawRequest.product,
        version: rawRequest.version,
        status: typeof getVersionStatus === "function" ? getVersionStatus(rawRequest.product, rawRequest.version) || "draft" : "draft",
        componentIds: [...new Set([...resolvedSeeds, ...affected])],
        removed: [],
        paths: [...downstream.byHop, ...upstream.byHop].flatMap((group) => group.nodes.flatMap((node) => node.paths || [])),
        documents: [...downstream.documentRefs, ...upstream.documentRefs],
        stale: analysisContext.freshness?.status === "stale",
        pendingReview: [...filtered.values()].some((item) => item.edge?.reviewStatus === "pending"),
      }] })
      : null;

    // WP-006 第2项：影响面按风险分类汇总（遍历到的边按 riskKind 计数）
    const riskBreakdown = {};
    for (const directionResult of [downstream, upstream]) {
      for (const group of directionResult.byHop) {
        for (const node of group.nodes) {
          for (const path of node.paths || []) {
            for (const edge of path.edges || []) {
              const kind = edge.riskKind || riskKindFor(edge.type);
              if (kind) riskBreakdown[kind] = (riskBreakdown[kind] || 0) + 1;
            }
          }
        }
      }
    }

    // ── Inference integration ──
    if (request.enableInference) {
      if (!inferenceEngine || typeof inferenceEngine.infer !== "function") {
        meta.inferenceUnavailable = true;
      } else {
        try {
          const inferenceResult = inferenceEngine.infer({
            graph,
            seedNodeIds: resolvedSeeds,
            minConfidence: request.minConfidence,
            maxInferenceDepth: request.maxInferenceDepth,
          });
          meta.inferredEdgeCount = inferenceResult.meta ? inferenceResult.meta.inferredEdgeCount : 0;
          meta.maxInferenceDepth = inferenceResult.meta ? inferenceResult.meta.maxInferenceDepth : request.maxInferenceDepth;
          if (inferenceResult.meta && inferenceResult.meta.truncated) meta.truncated = true;
          return { downstream, upstream, filteredEdges: [...filtered.values()], inferredEdges: inferenceResult.inferredEdges || [], meta, lineage: analysisLineage, reasoning, riskBreakdown };
        } catch (error) {
          meta.inferenceError = error.message;
        }
      }
    }

    return { downstream, upstream, filteredEdges: [...filtered.values()], meta, lineage: analysisLineage, reasoning, riskBreakdown };
  }
  return { analyze };
}

module.exports = { createImpactAnalysisService };
