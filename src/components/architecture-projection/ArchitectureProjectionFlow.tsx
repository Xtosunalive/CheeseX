import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFullscreenState } from "@/hooks/useFullscreenState";
import { ReactFlow, ReactFlowProvider, useNodesState, useEdgesState, useReactFlow, Background, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { RELATION_COLORS, DEFAULT_RELATION_COLOR } from "@/lib/topology-types";
import { relationTypeLabel } from "@/lib/ontology";
import type { ProjectionModel, ProjectionFilter, ProjectionFlowNodeData, ProjectionFlowEdgeData, ProjectionSelection } from "./architecture-projection-types";
import ArchProjNode from "./ArchitectureProjectionNode";
import ArchProjToolbar from "./ArchitectureProjectionToolbar";
import ArchProjEvidence from "./ArchitectureProjectionEvidence";
import ArchProjMobile from "./ArchitectureProjectionMobile";

const nodeTypes = { start: ArchProjNode, entity: ArchProjNode, decision: ArchProjNode, implicit: ArchProjNode, ambiguous: ArchProjNode, unresolved: ArchProjNode, missing: ArchProjNode, empty: ArchProjNode, success: ArchProjNode };

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth <= 768);
  useEffect(() => { const h = () => setM(window.innerWidth <= 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

type ProjNode = Node & { data: ProjectionFlowNodeData };
type ProjEdge = Edge & { data?: ProjectionFlowEdgeData };

function layoutDagre(nodes: ProjNode[], edges: ProjEdge[]): ProjNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 120, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: 220, height: 60 });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map(n => {
    const p = g.node(n.id);
    const evidenceType = n.data.evidenceKey?.split(":", 1)[0];
    const laneOffset = n.data.nodeType === "missing" ? 480
      : n.data.nodeType === "unresolved" ? 320
        : (["implicit", "ambiguous"].includes(n.data.nodeType) || evidenceType === "implicit_path") ? 160
          : 0;
    return { ...n, position: { x: p.x - 110 + laneOffset, y: p.y - 30 } };
  });
}

/** 拓扑边视觉：按 relationType 上色 + ontology 中文标签（未登记类型回落灰、显示原始枚举值） */
function styleTopologyEdge(edge: ProjEdge): ProjEdge {
  const d = edge.data;
  if (!d || d.edgeType !== "topology") return edge;
  const color = (d.relationType && RELATION_COLORS[d.relationType]) || DEFAULT_RELATION_COLOR;
  const label = d.relationType ? relationTypeLabel(d.relationType) : "";
  return { ...edge, label, style: { stroke: color, strokeWidth: 2 } };
}

interface Props {
  model: ProjectionModel;
  highlightNodeIds: Set<string> | null;
  onHighlight: (ids: Set<string> | null) => void;
  onNodeClickEvidence: (evidenceKey: string | null) => void;
  /** 枢纽选中回调：entity 节点 / 真实拓扑边点击时抛给 EntityDetailPanel */
  onSelect?: (selection: ProjectionSelection) => void;
}

const TOPOLOGY_NODE_TYPES = new Set(["entity", "empty"]);

function ArchProjFlowInner({ model, highlightNodeIds, onHighlight, onNodeClickEvidence, onSelect }: Props) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<ProjectionFilter>("all");
  const [overlay, setOverlay] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFs] = useFullscreenState();
  const [fsOk, setFsOk] = useState(true);
  useEffect(() => { setFsOk(typeof document !== "undefined" && !!document.documentElement.requestFullscreen); }, []);

  const allN = useMemo<ProjNode[]>(() => layoutDagre(model.nodes as ProjNode[], model.edges as ProjEdge[]), [model]);
  // seq212：默认只显拓扑层（entity/empty）；缺口叠加开关打开时诊断节点按 filter 加回
  const fn = useMemo<ProjNode[]>(() => {
    const base = allN.filter(n => TOPOLOGY_NODE_TYPES.has(n.data.nodeType));
    if (!overlay) return base;
    const diag = allN.filter(n => {
      if (TOPOLOGY_NODE_TYPES.has(n.data.nodeType)) return false;
      if (filter === "all") return true;
      if (filter === "implicit" && n.data.nodeType === "ambiguous") return true;
      return n.data.nodeType === filter;
    });
    return [...base, ...diag];
  }, [allN, overlay, filter]);
  const fe = useMemo<ProjEdge[]>(() => {
    const nids = new Set(fn.map(n => n.id));
    return (model.edges as ProjEdge[]).filter(e => nids.has(e.source) && nids.has(e.target)).map(styleTopologyEdge);
  }, [fn, model.edges]);
  const [ns, setNs, onNC] = useNodesState<ProjNode>([]);
  const [es, setEs, onEC] = useEdgesState<ProjEdge>([]);
  useEffect(() => { setNs(fn); }, [fn, setNs]);
  useEffect(() => { setEs(fe); }, [fe, setEs]);
  useEffect(() => { if (!isMobile) { const t = setTimeout(() => fitView({ padding: 0.2 }), 100); return () => clearTimeout(t); } }, [isMobile, fn, fitView]);

  const onNCB = useCallback((_event: React.MouseEvent, node: Node) => {
    const n = node as unknown as ProjNode;
    const ids: string[] = n.data?.pathNodeIds || (n.data?.sourceNodeId ? [n.data.sourceNodeId] : []);
    if (ids.length > 0) onHighlight(new Set(ids));
    // seq212：entity 节点（拓扑层）点击 → 抛给枢纽三上下文侧栏；诊断节点保留证据面板行为
    if (n.data?.nodeType === "entity" && onSelect && n.data?.sourceNodeId) {
      onSelect({ kind: "node", nodeId: n.data.sourceNodeId });
      return;
    }
    if (n.data?.evidenceKey) { setSel(n.data.evidenceKey); onNodeClickEvidence(n.data.evidenceKey); }
  }, [onHighlight, onNodeClickEvidence, onSelect]);
  const onECB = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const e = edge as unknown as ProjEdge;
    // 真实拓扑边点击 → 抛给枢纽（边详情：从哪来/含义/两端实体）
    if (e.data?.edgeType === "topology" && onSelect && e.data.edgeId) {
      onSelect({ kind: "edge", edgeId: e.data.edgeId });
    }
  }, [onSelect]);
  const clear = useCallback(() => { onHighlight(null); setSel(null); onNodeClickEvidence(null); }, [onHighlight, onNodeClickEvidence]);

  const toggleFs = useCallback(async () => {
    if (!containerRef.current) return;
    try { if (!document.fullscreenElement) { await containerRef.current.requestFullscreen(); } else { await document.exitFullscreen(); } } catch { /* degraded */ }
  }, []);

  const counts = { implicit: model.meta.implicitCount, unresolved: model.meta.unresolvedCount, missing: model.meta.missingCount };
  const hasGaps = counts.implicit + counts.unresolved + counts.missing > 0;
  const evidence = sel && model.evidenceIndex.has(sel) ? model.evidenceIndex.get(sel)! : null;

  if (isMobile) return <ArchProjMobile model={model} selectedEvidence={sel} onEvidence={setSel} onHighlight={onHighlight} onClear={clear} />;

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-lg bg-surface-root ring-1 ring-border-thin" style={{ height: isFs ? "100vh" : 600 }}>
      <ArchProjToolbar filter={filter} onFilterChange={setFilter} counts={counts} onZoomIn={() => zoomIn()} onZoomOut={() => zoomOut()} onFitView={() => fitView({ padding: 0.2 })} onToggleFullscreen={toggleFs} isFullscreen={isFs} fullscreenAvailable={fsOk} onClearHighlight={clear} hasHighlight={highlightNodeIds !== null && highlightNodeIds.size > 0} overlayEnabled={overlay} onToggleOverlay={hasGaps ? () => setOverlay(v => !v) : undefined} />
      {/* Master 2026-10-29「点进去突然变大」：稀疏图（实体1/关系0）被 fitView 放到 maxZoom=2 顶格——上限钉 1，小图不再放大，大图缩小看全貌不变 */}
      <ReactFlow nodes={ns} edges={es} onNodesChange={onNC} onEdgesChange={onEC} nodeTypes={nodeTypes} onNodeClick={onNCB} onEdgeClick={onECB} onPaneClick={clear} fitView minZoom={0.1} maxZoom={1} nodesConnectable={false} edgesReconnectable={false} proOptions={{ hideAttribution: true }}><Background color="var(--grid-line)" /></ReactFlow>
      {evidence && <ArchProjEvidence evidence={evidence} onClose={clear} onHighlight={(ids) => onHighlight(new Set(ids))} onClearHighlight={() => onHighlight(null)} />}
    </div>
  );
}

export default function ArchProjFlow(props: Props) {
  return <ReactFlowProvider><ArchProjFlowInner {...props} /></ReactFlowProvider>;
}
