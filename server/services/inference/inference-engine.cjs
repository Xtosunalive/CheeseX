// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// @responsible: 基于本体能力执行图推理、置信度追踪及冲突裁决消费。
const { createNodeIdResolver } = require("../projection/node-id-resolver.cjs");

const MAX_DEPTH = 3;
const MAX_TARGETS = 500;
const MAX_TRACES_PER_TARGET = 10;

const { createError: typedError } = require("../../shared/error-factory.cjs");
function roundConfidence(value) { return Math.round(value * 1e12) / 1e12; }
function confidenceBand(value) { return value >= 0.85 ? "HIGH" : value >= 0.5 ? "MEDIUM" : "LOW"; }

function normalizeEdge(raw) {
  const props = raw && raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties) ? raw.properties : {};
  const confidenceRaw = raw && raw.confidence !== undefined ? raw.confidence : props.confidence;
  const confidenceExplicit = !(confidenceRaw === undefined || confidenceRaw === null || confidenceRaw === "");
  // C9（SPEC-027）：confidenceExplicit 区分「边原生显式值」与「无值 0.5 兜底」——回退链四槽判据
  const confidence = confidenceExplicit ? confidenceRaw : 0.5;
  const validConfidence = typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
  return {
    source: raw && typeof raw.from === "string" ? raw.from : "",
    target: raw && typeof raw.to === "string" ? raw.to : "",
    type: raw && typeof (raw.relationType || raw.type) === "string" ? (raw.relationType || raw.type) : "",
    confidence: validConfidence ? confidence : 0,
    confidenceExplicit,
    // NEW-1（红队二轮）：结构判据透传——resolver 适配器据此保持「结构边不参与建议与置信度」在引擎面成立
    structural: props.source === "auto-discovered",
    confidenceValid: validConfidence,
    reviewStatus: typeof (props.reviewStatus || raw.reviewStatus) === "string" ? (props.reviewStatus || raw.reviewStatus) : "pending",
    sourceFile: typeof (raw.sourceFile || props.sourceFile) === "string" ? (raw.sourceFile || props.sourceFile) : "",
    lineNumber: Number.isInteger(raw.lineNumber) ? raw.lineNumber : null,
  };
}

function traceHop(edge) {
  return {
    fromNodeId: edge.source,
    toNodeId: edge.target,
    edgeType: edge.type,
    edgeConfidence: edge.confidence,
    edgeSource: edge.sourceFile,
    edgeSourceType: "entity-wikilink",
    edgeReviewStatus: edge.reviewStatus,
  };
}

function edgeDto(edge) {
  return {
    source: edge.source, target: edge.target, type: edge.type, confidence: edge.confidence,
    reviewStatus: edge.reviewStatus, sourceFile: edge.sourceFile, lineNumber: edge.lineNumber,
  };
}

function inferredEdge(ruleId, source, target, type, chain, sourceEdges, relationWeight) {
  const confidence = roundConfidence(sourceEdges.reduce((value, edge) => value * edge.confidence, 1) * sourceEdges.reduce((value) => value * relationWeight, 1));
  return {
    source, target, type, confidence, reviewStatus: "pending", sourceFile: "", lineNumber: null,
    inferred: true, inferenceRule: ruleId, inferenceChain: chain, confidenceBand: confidenceBand(confidence),
    trace: { conclusion: `${source} -[${type}]-> ${target}`, pathConfidence: confidence, confidenceBand: confidenceBand(confidence), hops: sourceEdges.map(traceHop) },
  };
}

function generateInferredEdges(edges, ontology) {
  const output = [];
  const seen = new Set();
  function add(item) {
    const key = `${item.inferenceRule}\0${item.source}\0${item.target}\0${item.type}`;
    if (!seen.has(key) && item.source !== item.target) { seen.add(key); output.push(item); }
  }
  for (const rule of ontology.rules) {
    if (rule.id === "transitive_dependency") {
      // Only DEPENDS_ON edges participate in transitive closure
      const depRel = ontology.relations.get("DEPENDS_ON");
      if (!depRel || !depRel.registeredForInference) continue;
      const deps = edges.filter((edge) => edge.type === "DEPENDS_ON" && edge.reviewStatus !== "rejected" && edge.confidenceValid);
      for (const first of deps) for (const second of deps) if (first.target === second.source) {
        add(inferredEdge(rule.id, first.source, second.target, "DEPENDS_ON", [first.source, first.target, second.target], [first, second], depRel.weight));
      }
    }
    if (rule.id === "document_covers_related") {
      const docRel = ontology.relations.get("DOCUMENTS");
      const refRel = ontology.relations.get("REFERENCES");
      if (!docRel || !docRel.registeredForInference || !refRel || !refRel.registeredForInference) continue;
      const documents = edges.filter((edge) => edge.type === "DOCUMENTS" && edge.reviewStatus !== "rejected" && edge.confidenceValid);
      const references = edges.filter((edge) => edge.type === "REFERENCES" && edge.reviewStatus !== "rejected" && edge.confidenceValid);
      for (const first of documents) for (const second of references) if (first.target === second.source) {
        const confidence = roundConfidence(first.confidence * docRel.weight * second.confidence * refRel.weight);
        const item = inferredEdge(rule.id, first.source, second.target, "REFERENCES", [first.source, first.target, second.target], [first, second], 1);
        item.confidence = confidence; item.confidenceBand = confidenceBand(confidence); item.trace.pathConfidence = confidence; item.trace.confidenceBand = confidenceBand(confidence);
        add(item);
      }
    }
  }
  return output.slice(0, MAX_TARGETS);
}

function createInferenceEngine({ ontology, conflictDetector, conflictStore, decisionConsumer, resolveEdgeConfidence: defaultResolveEdgeConfidence = null } = {}) {
  if (!ontology || !(ontology.relations instanceof Map) || !Array.isArray(ontology.rules)) throw typedError("INVALID_ONTOLOGY", "normalized inference ontology required");

  function infer({ graph, seedNodeIds, minConfidence = 0.3, maxInferenceDepth = MAX_DEPTH, candidateConclusions = [], decision = null, sourceRevision = null, resolveEdgeConfidence = null } = {}) {
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) throw typedError("GRAPH_UNAVAILABLE", "graph unavailable");
    if (!Array.isArray(seedNodeIds) || !seedNodeIds.length) throw typedError("INVALID_QUERY", "seedNodeIds required");
    if (typeof minConfidence !== "number" || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) throw typedError("INVALID_QUERY", "minConfidence invalid");
    const depthLimit = Number.isInteger(maxInferenceDepth) ? Math.min(MAX_DEPTH, Math.max(1, maxInferenceDepth)) : MAX_DEPTH;
    const nodeIds = new Set(graph.nodes.filter((node) => node && typeof node.id === "string").map((node) => node.id));
    const resolver = createNodeIdResolver(graph.nodes, graph.connections);
    const seeds = [...new Set(seedNodeIds.map((id) => resolver.resolveNodeId(id)).filter(Boolean))];
    if (!seeds.length) throw typedError("SEED_NOT_FOUND", "seed nodes not found");
    let edges = graph.connections.map(normalizeEdge).filter((edge) => edge.source && edge.target);
    // C9 四槽回退链终序：relations.yaml 档位 > 边原生显式值 > 现算建议 > 0.5 兜底——resolver 由装配层
    // 以 confidence-suggestion-service.annotateEdge 承载（band 覆盖优先：wikilink 恒 1.0 也被档位置顶）；
    // resolver 缺省/失败＝既有行为（native > 0.5）不变——fail-safe
    const edgeConfidenceResolver = resolveEdgeConfidence || defaultResolveEdgeConfidence;
    if (typeof edgeConfidenceResolver === "function") {
      edges = edges.map((edge) => {
        try {
          const resolved = edgeConfidenceResolver(edge);
          // R2（红队）：resolver 值域 0..1 复查＋confidenceValid 重算——越界/非有限＝fail-safe 弃用
          return resolved && typeof resolved.confidence === "number" && Number.isFinite(resolved.confidence)
            && resolved.confidence >= 0 && resolved.confidence <= 1
            ? { ...edge, confidence: resolved.confidence, confidenceValid: true, confidenceSource: resolved.confidenceSource || null }
            : edge;
        } catch { return edge; }
      });
    }
    const filtered = new Map();
    const suspended = new Map();
    let truncated = false;
    const records = new Map();
    const queue = seeds.map((nodeId) => ({ nodeId, hop: 0, confidence: 1, nodePath: [nodeId], hops: [], stopAfterArrival: false }));
    function addFiltered(edge, reason) { filtered.set(`${edge.source}\0${edge.target}\0${edge.type}\0${reason}`, { edge: edgeDto(edge), reason }); }

    while (queue.length) {
      const current = queue.shift();
      if (current.hop >= depthLimit || current.stopAfterArrival) continue;
      for (const edge of edges) {
        const relation = ontology.relations.get(edge.type);
        if (!relation || !relation.registeredForInference) { if (edge.source === current.nodeId || edge.target === current.nodeId) addFiltered(edge, "UNREGISTERED_RELATION"); continue; }
        if (!edge.confidenceValid) { if (edge.source === current.nodeId || edge.target === current.nodeId) addFiltered(edge, "INVALID_CONFIDENCE"); continue; }
        if (edge.reviewStatus === "rejected") { if (edge.source === current.nodeId || edge.target === current.nodeId) addFiltered(edge, "REJECTED"); continue; }

        // ── Capability-driven traversal decisions (replacing hardcoded A/B/C/D modes) ──
        const { impactPropagation } = relation;
        let nextId = null;
        let stopAfterArrival = false;

        if (impactPropagation === "reverse") {
          // Reverse propagation: impact flows from target back to source
          // (e.g. DEPENDS_ON, STORES_IN, BACKS_UP, INDEXES, ENCRYPTS)
          if (edge.target === current.nodeId) nextId = edge.source;
          // BACKS_UP: forward direction blocked (ADR009 R11)
          else if (edge.source === current.nodeId && edge.type === "BACKS_UP") {
            addFiltered(edge, "BACKUP_FORWARD_BLOCKED"); continue;
          }
        } else if (impactPropagation === "forward_stop") {
          // Forward then stop: impact travels source→target, no further propagation
          // (CONNECTS_TO per ADR009 R13)
          if (edge.source === current.nodeId) {
            nextId = edge.target;
            stopAfterArrival = true;
          }
        } else if (edge.type === "RELATED") {
          // RELATED: always suspended pending review (ADR009 R10)
          if (edge.source === current.nodeId || edge.target === current.nodeId) {
            suspended.set(`${edge.source}\0${edge.target}`, { edge: edgeDto(edge), reason: "SUSPEND_PENDING_REVIEW" });
            continue;
          }
        } else if (impactPropagation === "forward") {
          if (edge.source === current.nodeId) nextId = edge.target;
        } else if (impactPropagation === "none") {
          if (edge.source === current.nodeId || edge.target === current.nodeId) addFiltered(edge, "NO_IMPACT_PROPAGATION");
          continue;
        } else {
          addFiltered(edge, "UNKNOWN_IMPACT_PROPAGATION");
          continue;
        }

        if (!nextId || !nodeIds.has(nextId) || current.nodePath.includes(nextId)) continue;
        const confidence = roundConfidence(current.confidence * edge.confidence * relation.weight);
        if (confidence < minConfidence) { addFiltered(edge, "LOW_CONFIDENCE"); continue; }
        const hop = current.hop + 1;
        const trace = { nodeIds: [...current.nodePath, nextId], hops: [...current.hops, traceHop(edge)], pathConfidence: confidence, confidenceBand: confidenceBand(confidence) };
        const record = records.get(nextId);
        if (!record && records.size >= MAX_TARGETS) { truncated = true; continue; }
        if (record && record.hop < hop) continue;
        if (record && record.traces.length >= MAX_TRACES_PER_TARGET) { truncated = true; continue; }
        const nextRecord = record || { nodeId: nextId, hop, confidence, confidenceBand: confidenceBand(confidence), traces: [] };
        nextRecord.traces.push(trace);
        if (confidence > nextRecord.confidence) { nextRecord.confidence = confidence; nextRecord.confidenceBand = confidenceBand(confidence); }
        records.set(nextId, nextRecord);
        queue.push({ nodeId: nextId, hop, confidence, nodePath: trace.nodeIds, hops: trace.hops, stopAfterArrival });
      }
    }

    const inferredEdges = generateInferredEdges(edges, ontology);
    const existing = conflictStore && typeof conflictStore.list === "function" ? conflictStore.list() : [];
    const conflicts = typeof conflictDetector === "function" ? conflictDetector({ rules: ontology.rules, candidateConclusions, existing }) : [];
    if (conflicts.length && conflictStore && typeof conflictStore.upsertDetected === "function") conflictStore.upsertDetected(conflicts);
    const decisionResult = decisionConsumer && typeof decisionConsumer.consume === "function"
      ? decisionConsumer.consume({ candidates: candidateConclusions, decision, sourceRevision })
      : null;
    return {
      affected: [...records.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
      inferredEdges,
      filteredEdges: [...filtered.values()].sort((a, b) => `${a.edge.source}:${a.edge.target}:${a.reason}`.localeCompare(`${b.edge.source}:${b.edge.target}:${b.reason}`)),
      suspended: [...suspended.values()],
      conflicts,
      meta: { maxInferenceDepth: depthLimit, truncated: truncated || inferredEdges.length >= MAX_TARGETS, inferredEdgeCount: inferredEdges.length, decisionStatus: decisionResult ? decisionResult.status : null, writeAllowed: decisionResult ? decisionResult.writeAllowed : null },
    };
  }

  return { infer };
}

module.exports = { createInferenceEngine, confidenceBand };
