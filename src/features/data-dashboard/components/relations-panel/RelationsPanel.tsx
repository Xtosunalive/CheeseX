// RelationsPanel — 节点间关系总览
import { ArrowRight } from "lucide-react";
import { sliceWithRest } from "@/lib/format";
import { useKnowledgeEdges, useKnowledgeNodes } from "@/lib/topology-store";
import { relationTypeLabel } from "@/lib/ontology";
import { nodeNameLabel } from "@/lib/domain";
import { EmptyState } from "@/components/empty-state";
import { TERM } from "@/constants/term-const";
import { RELATIONS_PANEL_COPY, ddRelationCount } from "@/features/data-dashboard/data-dashboard-copy";

export function RelationsPanel() {
  const rawEdges = useKnowledgeEdges();
  const nodes = useKnowledgeNodes();
  const edges = rawEdges.map((e) => ({ source: e.source, target: e.target, type: e.type }));
  const nodeLabels = new Map(nodes.map((node) => [node.id, nodeNameLabel(node)]));

  if (edges.length === 0) {
    // 无关系边时，若仍有知识节点（如孤立 Concept 实体），展示为"知识概念"浏览器
    // （对齐知识图谱闭环：新知识先进宽门暴露，孤立概念无需关系即可浏览）
    if (nodes.length > 0) {
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-text-main">{RELATIONS_PANEL_COPY.CONCEPTS_HEADING}</h3>
            <p className="text-xs text-text-hint mt-0.5">{RELATIONS_PANEL_COPY.CONCEPTS_HINT}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {nodes.map((n) => (
              <NodeChip key={n.id} label={nodeNameLabel(n)} layer={n.category} accent="blue" />
            ))}
          </div>
        </div>
      );
    }
    return (
      // WP-145 N1：面板体整块空态改走 EmptyState 介质（bare＋保留原 h-32 区域尺寸）；渲染条件不变
      <EmptyState bare className="flex h-32 items-center justify-center" title={RELATIONS_PANEL_COPY.EMPTY_NODES} />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-main">{TERM.RELATION_OVERVIEW}</h3>
        <p className="text-xs text-text-hint mt-0.5">{RELATIONS_PANEL_COPY.OVERVIEW_HINT}</p>
      </div>

      <TopologyViz edges={edges} nodes={nodes.map((n) => ({ id: n.id, label: n.label, layer: n.category }))} />

      <span className="text-xs text-text-hint">{RELATIONS_PANEL_COPY.ALL_RELATIONS_PREFIX}<span className="text-text-sub">{edges.length}</span>)</span>
      <div className="space-y-1">
        {edges.map((e, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg ring-1 px-4 py-2.5 ring-border-thin bg-surface-root">
            <span className="text-xs text-text-main">{nodeNameLabel(nodeLabels.get(e.source))}</span>
            <span className="flex items-center gap-1 rounded bg-surface-hover px-2 py-0.5 text-xs text-text-hint">
              {relationTypeLabel(e.type)}
              <ArrowRight className="h-3 w-3" />
            </span>
            <span className="text-xs text-text-main">{nodeNameLabel(nodeLabels.get(e.target))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopologyViz({ edges, nodes }: { edges: { source: string; target: string; type: string }[]; nodes: { id: string; label: string; layer?: string }[] }) {
  const { visible: shown, rest: restEdges } = sliceWithRest(edges, 3);
  return (
    <div className="rounded-lg ring-1 ring-border-thin bg-surface-root p-6 flex flex-wrap items-center justify-center gap-4 min-h-[120px]">
      {shown.map((e, i) => {
        const src = nodes.find((n) => n.id === e.source);
        const tgt = nodes.find((n) => n.id === e.target);
        return (
          <div key={i} className="flex items-center gap-3">
            <NodeChip label={nodeNameLabel(src)} layer={src?.layer} accent="blue" />
            <div className="flex flex-col items-center">
              <span className="text-xs bg-purple-2 text-purple-10 px-2 py-0.5 rounded-sm">{relationTypeLabel(e.type)}</span>
              <div className="w-12 h-px bg-border-thin relative mt-1">
                <ArrowRight className="absolute -right-1 -top-[5px] h-3 w-3 text-text-hint" />
              </div>
            </div>
            <NodeChip label={nodeNameLabel(tgt)} layer={tgt?.layer} accent="emerald" />
          </div>
        );
      })}
      {restEdges > 0 && <span className="text-xs text-text-hint font-mono">+{ddRelationCount(restEdges)}</span>}
    </div>
  );
}

function NodeChip({ label, layer, accent }: { label: string; layer?: string; accent: "blue" | "emerald" }) {
  const color = accent === "blue" ? "text-blue-9" : "text-status-fact";
  return (
    <div className="rounded-lg ring-1 ring-border-thin bg-surface-root px-3 py-2 text-center">
      <span className={`block text-xs font-medium ${color}`}>{label}</span>
      {layer && <span className="text-xs text-text-hint">{TERM.LAYER}：{layer}</span>}
    </div>
  );
}
