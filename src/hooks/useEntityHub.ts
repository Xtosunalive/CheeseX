// 实体全景数据聚合 hook。
// 聚合档案、直接关系、影响范围与治理缺口。
// impact summary (API), compliance gaps (gaps[]) for a given entity.
import { useState, useEffect, useMemo } from "react";
import { useAdmittedNodes, useAdmittedEdges, useGapItems } from "@/lib/topology-store";
import { runImpactAnalysis } from "@/features/impact-analysis/impact-analysis-api";
import type { ImpactAnalysisResult } from "@/features/impact-analysis/impact-analysis-types";
import type { TopoNode, TopoEdge } from "@/features/dashboard/dashboard-types";
import type { GapItem } from "@/features/gap-engine/gap-types";
import { TERM } from "@/constants/term-const";

type LabeledTopoEdge = TopoEdge & { sourceLabel: string; targetLabel: string };

export interface EntityHubData {
  /** Entity profile from admittedNodes, or null if not found */
  profile: TopoNode | null;
  /** 直接关系：外向关系与被依赖关系 */
  oneHop: { outgoing: LabeledTopoEdge[]; incoming: LabeledTopoEdge[] };
  /** Compliance gaps targeting this entity */
  gaps: GapItem[];
  /** Impact analysis result (lightweight: maxHops=1, minConfidence=0.3) */
  impact: ImpactAnalysisResult | null;
  /** Whether the impact analysis API call is in flight */
  impactLoading: boolean;
}

export function useEntityHub(entityId: string | null): EntityHubData {
  const nodes = useAdmittedNodes();
  const edges = useAdmittedEdges();
  const allGaps = useGapItems();
  const [impact, setImpact] = useState<ImpactAnalysisResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  // Profile — find in admittedNodes by id
  const profile = useMemo<TopoNode | null>(() => {
    if (!entityId) return null;
    return nodes.find((n) => n.id === entityId) ?? null;
  }, [nodes, entityId]);

  // 当前实体作为源或目标的直接关系
  const oneHop = useMemo(() => {
    if (!entityId) return { outgoing: [] as LabeledTopoEdge[], incoming: [] as LabeledTopoEdge[] };
    const nodeLabels = new Map(nodes.map((node) => [node.id, node.label || TERM.UNNAMED_ENTITY]));
    const enrich = (edge: TopoEdge): LabeledTopoEdge => ({
      ...edge,
      sourceLabel: nodeLabels.get(edge.source) || TERM.UNNAMED_ENTITY,
      targetLabel: nodeLabels.get(edge.target) || TERM.UNNAMED_ENTITY,
    });
    return {
      outgoing: edges.filter((edge) => edge.source === entityId).map(enrich),
      incoming: edges.filter((edge) => edge.target === entityId).map(enrich),
    };
  }, [edges, entityId, nodes]);

  // Compliance gaps targeting this entity
  const gaps = useMemo(() => {
    if (!entityId) return [] as GapItem[];
    return allGaps.filter((g) => g.targetId === entityId);
  }, [allGaps, entityId]);

  // Impact analysis — lightweight fetch on entityId change
  useEffect(() => {
    if (!entityId) {
      setImpact(null);
      return;
    }
    let cancelled = false;
    setImpactLoading(true);
    runImpactAnalysis({
      seedNodeIds: [entityId],
      maxHops: 1,
      direction: "both",
      minConfidence: 0.3,
      includeDocuments: false,
      // 契约必填；与后端默认一致（impact-analysis-service：enableInference 缺省 false，depth 仅推理开启时生效）
      enableInference: false,
      maxInferenceDepth: 3,
    })
      .then((result) => {
        if (!cancelled) setImpact(result);
      })
      .catch(() => {
        if (!cancelled) setImpact(null);
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  return { profile, oneHop, gaps, impact, impactLoading };
}
