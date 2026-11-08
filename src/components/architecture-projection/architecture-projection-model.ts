import type { ProjectionModel, ProjectionFlowNodeData, ProjectionFlowEdgeData, ProjectionEvidence, ProjectionOptions } from "./architecture-projection-types";
import { TERM } from "@/constants/term-const";
import { ARCH_PROJECTION_COPY, archProjCandidateEdge, archProjStartLabel } from "../components-copy";

// ── stable ID generators ──

export function stableNodeId(nodeType: string, key: string): string {
  return `proj-${nodeType}-${encodeURIComponent(key)}`;
}

export function stableEdgeId(source: string, target: string): string {
  return `proj-edge-${encodeURIComponent(source)}->${encodeURIComponent(target)}`;
}

export function stableEvidenceKey(type: string, key: string): string {
  return `${type}:${encodeURIComponent(key)}`;
}

// ── DTO input types ──

interface DTOStats {
  seedComponentIds?: string[];
  seedCount?: number;
  implicitPaths?: Array<{ seedA: string; seedB: string; path: string[]; ambiguous?: boolean; alternateCount?: number }>;
  unresolvedPairs?: Array<{ nodeA: string; nodeB: string }>;
  missingSeeds?: string[];
  dataFreshness?: { fresh: boolean; ageHours: number; updatedAt: string; version: string };
}

interface DTONode {
  id: string;
  label?: string;
  category?: string;
  degree?: number;
}

/** 真实拓扑边（形状对齐 TopoEdge；悬空端点在构建时安全跳过） */
interface DTOEdge {
  edgeId?: string;
  source: string;
  target: string;
  type?: string;
  sourceFile?: string;
  lineNumber?: number;
  reviewStatus?: string;
  properties?: Record<string, unknown>;
}

interface DTOTopology {
  nodes?: DTONode[];
  edges?: DTOEdge[];
}

// ── helpers ──

function nodeLabel(id: string, topology: DTOTopology): string {
  return (topology.nodes || []).find(n => n.id === id)?.label || id;
}

function mkNode(id: string, type: string, data: ProjectionFlowNodeData, pos: { x: number; y: number }): ProjectionModel["nodes"][0] {
  return { id, type, position: pos, data };
}

function mkEdge(id: string, source: string, target: string, data?: ProjectionFlowEdgeData): ProjectionModel["edges"][0] {
  return { id, source, target, data };
}

// ── builders（缺口诊断层，showGaps 叠加时使用——能力保留，seq212 前为默认渲染） ──

function buildStartNode(seedCount: number) {
  return mkNode(stableNodeId("start", "root"), "start", { nodeType: "start", label: archProjStartLabel(seedCount) }, { x: 0, y: 0 });
}

function buildDecisionNode(key: string, label: string, evidenceKey: string) {
  return mkNode(stableNodeId("decision", key), "decision", { nodeType: "decision", label, evidenceKey }, { x: 0, y: 0 });
}

function buildImplicitPathChain(ip: { seedA: string; seedB: string; path: string[]; ambiguous?: boolean; alternateCount?: number }, idx: number, topo: DTOTopology): { nodes: ProjectionModel["nodes"]; edges: ProjectionModel["edges"]; ev: ProjectionEvidence } {
  const { seedA, seedB, path, ambiguous, alternateCount } = ip;
  const altCount = alternateCount || 1;
  const ns: ProjectionModel["nodes"] = [];
  const es: ProjectionModel["edges"] = [];
  const decId = stableNodeId("decision", `implicit-${idx}`);
  const evidenceKey = stableEvidenceKey("implicit_path", `${seedA}:${seedB}:${idx}`);
  ns.push(buildDecisionNode(`implicit-${idx}`, `${TERM.GAP_INDIRECT}?`, evidenceKey));
  const pathNodeIds: string[] = [];
  for (const nid of path) {
    const nType = ambiguous ? "ambiguous" : "implicit";
    const n = mkNode(stableNodeId(nType, `${nid}-${idx}`), nType, {
      nodeType: nType, label: nodeLabel(nid, topo), sourceNodeId: nid, pathNodeIds: [nid],
      alternateCount: ambiguous ? altCount : undefined,
      evidenceKey,
    }, { x: 0, y: 0 });
    ns.push(n); pathNodeIds.push(nid);
  }
  if (ns.length > 0) es.push(mkEdge(stableEdgeId(decId, ns[0].id), decId, ns[0].id, { edgeType: "implicit", label: TERM.GAP_INDIRECT }));
  for (let i = 1; i < ns.length; i++) es.push(mkEdge(stableEdgeId(ns[i-1].id, ns[i].id), ns[i-1].id, ns[i].id, { edgeType: ambiguous ? "ambiguous" : "implicit", label: ambiguous ? archProjCandidateEdge(altCount) : TERM.GAP_INDIRECT }));
  for (const seed of [seedA, seedB]) {
    const eid = stableNodeId("entity", seed);
    es.push(mkEdge(stableEdgeId(eid, decId), eid, decId, { edgeType: "connected", label: "" }));
  }
  const ev: ProjectionEvidence = { type: "implicit_path", label: `${TERM.GAP_INDIRECT}: ${seedA} → ${seedB}`, sourceNodeId: seedA, targetNodeId: seedB, pathNodeIds, isImplicit: true, isAmbiguous: ambiguous, alternateCount: altCount };
  return { nodes: ns, edges: es, ev };
}

function buildUnresolvedNode(pair: { nodeA: string; nodeB: string }, idx: number): { node: ProjectionModel["nodes"][0]; ev: ProjectionEvidence } {
  const [nodeA, nodeB] = [pair.nodeA, pair.nodeB].sort((a, b) => a.localeCompare(b));
  const normalizedPair = { nodeA, nodeB };
  const evidenceKey = stableEvidenceKey("unresolved_pair", `${nodeA}:${nodeB}`);
  const n = mkNode(stableNodeId("unresolved", String(idx)), "unresolved", {
    nodeType: "unresolved", label: `${nodeA} ⨯ ${nodeB}`, pairNodes: normalizedPair,
    pathNodeIds: [nodeA, nodeB], evidenceKey,
  }, { x: 0, y: 0 });
  return { node: n, ev: { type: "unresolved_pair", label: `${TERM.GAP_UNRELATED}: ${nodeA} ⨯ ${nodeB}`, sourceNodeId: nodeA, targetNodeId: nodeB, pathNodeIds: [nodeA, nodeB], pairNodes: normalizedPair } };
}

function buildMissingNode(seedId: string, idx: number): { node: ProjectionModel["nodes"][0]; ev: ProjectionEvidence } {
  const n = mkNode(stableNodeId("missing", String(idx)), "missing", {
    nodeType: "missing", label: seedId, sourceNodeId: seedId, pathNodeIds: [seedId],
    evidenceKey: stableEvidenceKey("missing_seed", seedId),
  }, { x: 0, y: 0 });
  return { node: n, ev: { type: "missing_seed", label: `${TERM.GAP_MISSING_COMPONENT}: ${seedId}`, sourceNodeId: seedId } };
}

function buildTerminalNode(state: "empty" | "success") {
  if (state === "success") return mkNode(stableNodeId("success", "complete"), "success", { nodeType: "success", label: ARCH_PROJECTION_COPY.COMPLETE_MARK, evidenceKey: stableEvidenceKey("success", "complete") }, { x: 0, y: 0 });
  return mkNode(stableNodeId("empty", "no-seeds"), "empty", { nodeType: "empty", label: ARCH_PROJECTION_COPY.NO_COMPONENTS }, { x: 0, y: 0 });
}

// ── 拓扑层（seq212 默认）：全部节点建 entity、真实边互联、provenance 透传 ──

function buildTopologyLayer(topology: DTOTopology): Pick<ProjectionModel, "nodes" | "edges"> & { nodeCount: number; edgeCount: number } {
  const nodes: ProjectionModel["nodes"] = [];
  const edges: ProjectionModel["edges"] = [];
  const flowIdBySource = new Map<string, string>();
  for (const n of topology.nodes || []) {
    const flowId = stableNodeId("entity", n.id);
    flowIdBySource.set(n.id, flowId);
    nodes.push(mkNode(flowId, "entity", {
      nodeType: "entity", label: n.label || n.id, sourceNodeId: n.id, pathNodeIds: [n.id],
      category: n.category, degree: n.degree,
    }, { x: 0, y: 0 }));
  }
  const seenEdgeIds = new Set<string>();
  let edgeCount = 0;
  for (const edge of topology.edges || []) {
    const sourceFlowId = flowIdBySource.get(edge.source);
    const targetFlowId = flowIdBySource.get(edge.target);
    // 悬空边（端点不在节点集内）安全跳过——不崩、不渲染
    if (!sourceFlowId || !targetFlowId) continue;
    let id = edge.edgeId ? `proj-edge-${encodeURIComponent(edge.edgeId)}` : stableEdgeId(sourceFlowId, targetFlowId);
    let dedupe = 2;
    while (seenEdgeIds.has(id)) { id = `${id}#${dedupe++}`; }
    seenEdgeIds.add(id);
    edges.push(mkEdge(id, sourceFlowId, targetFlowId, {
      edgeType: "topology",
      label: edge.type || "",
      relationType: edge.type,
      edgeId: edge.edgeId,
      sourceFile: edge.sourceFile,
      lineNumber: edge.lineNumber,
      reviewStatus: edge.reviewStatus,
      properties: edge.properties,
    }));
    edgeCount += 1;
  }
  return { nodes, edges, nodeCount: nodes.length, edgeCount };
}

// ── main ──

export function buildProjectionModel(stats: DTOStats, topology: DTOTopology, options: ProjectionOptions = {}): ProjectionModel {
  const showGaps = options.showGaps ?? false;
  const evIdx = new Map<string, ProjectionEvidence>();
  const nodes: ProjectionModel["nodes"] = [];
  const edges: ProjectionModel["edges"] = [];
  const sc = stats.seedCount ?? 0;
  const im = stats.implicitPaths || [];
  const up = stats.unresolvedPairs || [];
  const ms = stats.missingSeeds || [];
  const sids = stats.seedComponentIds || [];
  const hasDiag = im.length > 0 || up.length > 0 || ms.length > 0;
  const isComplete = sc > 0 && !hasDiag;

  // ① 拓扑层（默认渲染）：设计本意即"读 topology 实时生成图"（05-consumption-verification-pages.md §7）
  const topoLayer = buildTopologyLayer(topology);
  nodes.push(...topoLayer.nodes);
  edges.push(...topoLayer.edges);

  // 空态节点（与 showGaps 无关——拓扑层为空必有 empty 终态，防止画布静默空白）：
  // 节点本体照常渲染；label 置空（WP-146 裁决2：写在图表数据文件里的节点标签属于图表数据，
  // 不再作为页面文案上屏——渲染侧跳过空 label）
  if (topoLayer.nodeCount === 0) {
    nodes.push(mkNode(stableNodeId("empty", "no-seeds"), "empty", { nodeType: "empty", label: "" }, { x: 0, y: 0 }));
    if (!showGaps) {
      return { nodes, edges, evidenceIndex: evIdx, meta: { seedCount: sc, implicitCount: im.length, unresolvedCount: up.length, missingCount: ms.length, isComplete: false, nodeCount: 0, edgeCount: 0 } };
    }
  }

  // ② 缺口诊断叠加层（showGaps，默认关——能力保留，seq212 前为默认渲染）
  if (showGaps) {
    nodes.push(buildStartNode(sc));
    const decEx = buildDecisionNode("exists", ARCH_PROJECTION_COPY.EXISTS_DECISION, stableEvidenceKey("decision", "exists"));
    nodes.push(decEx);
    const existing = sids.filter(id => (topology.nodes || []).some(n => n.id === id));
    for (const sid of existing) { edges.push(mkEdge(stableEdgeId(decEx.id, stableNodeId("entity", sid)), decEx.id, stableNodeId("entity", sid), { edgeType: "connected", label: ARCH_PROJECTION_COPY.EDGE_EXISTS })); }
    for (let i = 0; i < ms.length; i++) { const r = buildMissingNode(ms[i], i); nodes.push(r.node); edges.push(mkEdge(stableEdgeId(decEx.id, r.node.id), decEx.id, r.node.id, { edgeType: "missing", label: TERM.GAP_MISSING_COMPONENT, evidenceKey: r.node.data.evidenceKey })); evIdx.set(r.node.data.evidenceKey!, r.ev); }
    for (let i = 0; i < im.length; i++) { const r = buildImplicitPathChain(im[i], i, topology); nodes.push(...r.nodes); edges.push(...r.edges); evIdx.set(r.nodes[0].data.evidenceKey!, r.ev); }
    for (let i = 0; i < up.length; i++) { const r = buildUnresolvedNode(up[i], i); nodes.push(r.node); edges.push(mkEdge(stableEdgeId(decEx.id, r.node.id), decEx.id, r.node.id, { edgeType: "unresolved", label: TERM.GAP_UNRELATED, evidenceKey: r.node.data.evidenceKey })); evIdx.set(r.node.data.evidenceKey!, r.ev); }

    if (isComplete) {
      const succ = buildTerminalNode("success");
      nodes.push(succ);
      const lastEnt = nodes.filter(n => n.data.nodeType === "entity").pop();
      if (lastEnt) edges.push(mkEdge(stableEdgeId(lastEnt.id, succ.id), lastEnt.id, succ.id, { edgeType: "connected", label: ARCH_PROJECTION_COPY.EDGE_DONE }));
      evIdx.set("success:complete", { type: "success", label: ARCH_PROJECTION_COPY.COMPLETE_EVIDENCE, dataFreshness: stats.dataFreshness });
    }
  }

  return { nodes, edges, evidenceIndex: evIdx, meta: { seedCount: sc, implicitCount: im.length, unresolvedCount: up.length, missingCount: ms.length, isComplete, nodeCount: topoLayer.nodeCount, edgeCount: topoLayer.edgeCount } };
}
