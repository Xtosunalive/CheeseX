import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ImpactHopGroup as HopGroup } from "@/features/impact-analysis/impact-analysis-types";
import { ImpactRelationLineage } from "./ImpactLineage";

import { relationTypeLabel } from "@/lib/ontology";
import { IMPACT_HOP_GROUP_COPY, IMPACT_RISK_LABELS, impactHopLayerSuffix } from "../impact-analysis-copy";

export function ImpactHopGroup({ direction, group, expanded, onToggle, onNodeClick }: { direction: string; group: HopGroup; expanded: boolean; onToggle: () => void; onNodeClick: (nodeIds: string[]) => void }) {
  return <section className="rounded-lg ring-1 ring-border-thin"><button className="flex w-full items-center gap-2 p-3 text-left text-sm" onClick={onToggle}>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<span className="flex-1">{direction === "downstream" ? IMPACT_HOP_GROUP_COPY.DOWNSTREAM : IMPACT_HOP_GROUP_COPY.UPSTREAM}{impactHopLayerSuffix(group.hop)}</span><Badge variant="secondary">{group.nodes.length}</Badge></button>
    {expanded && <div className="border-t border-border-thin">{group.nodes.map((node) => { const path = node.paths[0]; const edge = path?.edges[path.edges.length - 1]; return <div key={node.nodeId} className="border-b border-border-thin last:border-b-0"><button className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-card" onClick={() => onNodeClick(path?.nodeIds || [node.nodeId])}><span className="flex-1 text-sm text-text-main/80">{node.label}</span><span className="text-xs text-text-hint">{edge ? relationTypeLabel(edge.type) : ""}</span><span className="text-xs text-text-hint">{path ? path.confidence.toFixed(2) : ""}</span><Badge variant={node.risk === "HIGH" ? "destructive" : "outline"}>{IMPACT_RISK_LABELS[node.risk] || IMPACT_HOP_GROUP_COPY.RISK_UNGRADED}</Badge></button>{edge && <ImpactRelationLineage edge={edge} />}</div>; })}</div>}
  </section>;
}
