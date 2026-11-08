import type { ImpactAnalysisResult, ImpactEdge } from "@/features/impact-analysis/impact-analysis-types";
import { RelationOverview, freshnessView, relationOverviewFromImpactEdge } from "@/features/impact-analysis/components/relation-overview";
import { IMPACT_LINEAGE_COPY, IMPACT_SHARED_COPY } from "../impact-analysis-copy";

function hashLabel(value: string | null | undefined) {
  if (!value) return IMPACT_SHARED_COPY.UNRECORDED;
  return value.length > 24 ? `${value.slice(0, 20)}...` : value;
}

export function ImpactAnalysisLineage({ result }: { result: ImpactAnalysisResult }) {
  if (!result.lineage) return null;
  const view = freshnessView(result.lineage.freshness.status);
  const Icon = view.Icon;
  return <section aria-label={IMPACT_LINEAGE_COPY.ARIA} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-border-thin py-3 text-xs">
    <span className={`inline-flex items-center gap-1.5 font-medium ${view.tone}`}><Icon className="h-4 w-4" />{view.label}</span>
    <span className="text-text-sub">{view.detail}</span>
    <span className="text-text-hint">{IMPACT_LINEAGE_COPY.SCOPE_PREFIX}{result.lineage.scope.product} {result.lineage.scope.version}</span>
    <span className="font-mono text-text-hint" title={result.lineage.source.contentHash || ""}>{IMPACT_LINEAGE_COPY.GRAPH_HASH_PREFIX}{hashLabel(result.lineage.source.contentHash)}</span>
    <span className="font-mono text-text-hint" title={result.releaseId}>{IMPACT_LINEAGE_COPY.RELEASE_PREFIX}{hashLabel(result.releaseId)} · {hashLabel(result.sourceCommit)}</span>
  </section>;
}

export function ImpactRelationLineage({ edge }: { edge: ImpactEdge }) {
  if (!edge.lineage) return null;
  return <RelationOverview relation={relationOverviewFromImpactEdge(edge)} />;
}
