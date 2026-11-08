import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useSetActiveEntityId, useAdmittedNodes } from "@/lib/topology-store";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";
import { RelationOverview, relationOverviewFromImpactEdge } from "@/features/impact-analysis/components/relation-overview";
import type { ImpactAnalysisResult, ImpactPath } from "@/features/impact-analysis/impact-analysis-types";

import { relationTypeLabel } from "@/lib/ontology";
import { nodeNameLabel } from "@/lib/domain";
import { IMPACT_PATH_GRAPH_COPY, impactEdgeBasisAria, impactOpenEntityTitle, impactPathCountText } from "../impact-analysis-copy";

export function ImpactPathGraph({ result }: { result: ImpactAnalysisResult }) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const setActiveEntityId = useSetActiveEntityId();
  const admittedNodes = useAdmittedNodes();
  const setHubOpen = useHubDrawerState((state) => state.setOpen);
  const paths = [result.downstream, result.upstream].flatMap((direction) => direction.byHop).flatMap((group) => group.nodes).flatMap((node) => node.paths);
  const unique = [...new Map(paths.map((path) => [path.nodeIds.join("\u0000"), path])).values()];
  // WP-134 波1 直读收口：受影响了「多少架构组件」是服务端遍历口径（impact-analysis-service.cjs:222
  // affected = 两侧 byHop 节点集合的 size），契约 required 字段 meta.totalNodesAffected；前端不再从
  // path.nodeIds 重建第二个集合来数同一事实。绘制上限闸门同取该口径（宁可不画也不显示两套数）。
  const affectedNodeCount = result.meta.totalNodesAffected;
  const visible = affectedNodeCount > 500 ? [] : unique;
  const labels = new Map(admittedNodes.map((node) => [node.id, nodeNameLabel(node)]));
  for (const direction of [result.downstream, result.upstream]) for (const group of direction.byHop) for (const node of group.nodes) labels.set(node.nodeId, nodeNameLabel(node));
  const labelFor = (nodeId: string) => nodeNameLabel(labels.get(nodeId));
  const openEntity = (nodeId: string) => { setActiveEntityId(nodeId); setHubOpen(true); };
  return <section aria-label={IMPACT_PATH_GRAPH_COPY.TITLE} className="space-y-3 border-t border-border-thin pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-text-main">{IMPACT_PATH_GRAPH_COPY.TITLE}</h2><p className="mt-0.5 text-xs text-text-hint">{impactPathCountText(unique.length, affectedNodeCount)}</p></div>{result.meta.truncated && <span className="text-xs text-status-warn">{IMPACT_PATH_GRAPH_COPY.TRUNCATED}</span>}</div>
    {affectedNodeCount > 500 ? <p className="py-8 text-center text-sm text-status-warn">{IMPACT_PATH_GRAPH_COPY.TOO_MANY_NODES}</p> : visible.length === 0 ? <p className="py-8 text-center text-sm text-text-hint">{IMPACT_PATH_GRAPH_COPY.NO_PATHS}</p> : <div className="space-y-2 overflow-x-auto pb-1">{visible.map((path: ImpactPath, index) => {
      const selectedEdge = path.edges.find((edge) => (edge.edgeId || `${edge.source}|${edge.type}|${edge.target}`) === selectedEdgeId);
      return <div key={`${path.nodeIds.join("-")}-${index}`} className="min-w-max rounded-lg bg-surface-root ring-1 ring-border-thin"><div className="flex items-center px-3 py-2">{path.nodeIds.map((nodeId, nodeIndex) => {
        const edge = path.edges[nodeIndex];
        const edgeId = edge?.edgeId || (edge ? `${edge.source}|${edge.type}|${edge.target}` : "");
        return <div key={`${nodeId}-${nodeIndex}`} className="flex items-center"><button type="button" onClick={() => openEntity(nodeId)} className="max-w-52 truncate rounded-md bg-surface-hover px-2.5 py-1.5 text-xs text-text-main hover:bg-accent-bg" title={impactOpenEntityTitle(labelFor(nodeId))}>{labelFor(nodeId)}</button>{nodeIndex < path.nodeIds.length - 1 && edge && <button type="button" onClick={() => setSelectedEdgeId((current) => current === edgeId ? null : edgeId)} className="flex items-center gap-1 px-2 text-xs text-text-hint hover:text-text-main" aria-label={impactEdgeBasisAria(labelFor(edge.source), labelFor(edge.target))}><ArrowRight className="h-4 w-4" />{relationTypeLabel(edge.type)}</button>}</div>;
      })}</div>{selectedEdge && <RelationOverview relation={relationOverviewFromImpactEdge(selectedEdge, { releaseId: result.releaseId, sourceCommit: result.sourceCommit })} defaultOpen />}</div>;
    })}</div>}
  </section>;
}
