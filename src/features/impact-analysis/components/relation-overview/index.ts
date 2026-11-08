import type { ImpactEdge } from "@/features/impact-analysis/impact-analysis-types";
import { RELATION_OVERVIEW_COPY } from "../../impact-analysis-copy";

export type RelationOverviewData = {
  edgeId: string;
  source: string;
  target: string;
  relationType: string;
  sourcePath?: string;
  sourceLine?: number | null;
  evidenceHash?: string | null;
  sourceHash?: string | null;
  since?: string | null;
  until?: string | null;
  reason?: string;
  decision?: string;
  freshness?: "fresh" | "stale" | "unknown";
  releaseId?: string;
  sourceCommit?: string;
};

export function relationOverviewFromImpactEdge(edge: ImpactEdge, identity: { releaseId?: string; sourceCommit?: string } = {}): RelationOverviewData {
  const lineage = edge.lineage;
  return {
    edgeId: edge.edgeId || `${edge.source}|${edge.type}|${edge.target}`,
    source: edge.source,
    target: edge.target,
    relationType: edge.type,
    sourcePath: lineage?.source.path || edge.sourceFile,
    sourceLine: edge.lineNumber,
    evidenceHash: edge.evidenceHash,
    sourceHash: lineage?.source.contentHash || edge.sourceHash,
    since: edge.since,
    until: edge.until,
    reason: lineage?.rule.reasonCode,
    decision: lineage ? `${lineage.decision.kind === "manual" ? RELATION_OVERVIEW_COPY.DECISION_MANUAL : RELATION_OVERVIEW_COPY.DECISION_AUTO} · ${lineage.decision.operatorId}` : undefined,
    freshness: lineage?.freshness.status as RelationOverviewData["freshness"],
    ...identity,
  };
}

export { RelationOverview } from "./RelationOverview";

export { freshnessView } from "./freshness";
