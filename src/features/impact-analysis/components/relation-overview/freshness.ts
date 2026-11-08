import { CircleHelp, ShieldCheck, TriangleAlert } from "lucide-react";
import { RELATION_FRESHNESS_COPY } from "../../impact-analysis-copy";

// 数据新鲜度展示映射（唯一定义，RelationOverview/ImpactLineage 共用）；status 缺省时落入待确认分支
export function freshnessView(status: string | undefined) {
  if (status === "fresh") return { label: RELATION_FRESHNESS_COPY.FRESH_LABEL, detail: RELATION_FRESHNESS_COPY.FRESH_DETAIL, tone: "text-status-fact", Icon: ShieldCheck };
  if (status === "stale") return { label: RELATION_FRESHNESS_COPY.STALE_LABEL, detail: RELATION_FRESHNESS_COPY.STALE_DETAIL, tone: "text-status-warn", Icon: TriangleAlert };
  return { label: RELATION_FRESHNESS_COPY.UNKNOWN_LABEL, detail: RELATION_FRESHNESS_COPY.UNKNOWN_DETAIL, tone: "text-text-hint", Icon: CircleHelp };
}
