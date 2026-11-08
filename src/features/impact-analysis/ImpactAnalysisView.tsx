import { useEffect } from "react";
import { ImpactAnalysisPanel, ImpactPathGraph } from "./components";
import { useLoadTopology } from "@/lib/topology-store";
import { useImpactAnalysisStore } from "./impact-analysis-store";
import { getNavQueryParam } from "@/lib/navigation";
import { PageContainer } from "@/components/page-container";
import { Panel } from "@/components/panel";

export function ImpactAnalysisView() {
  const setSeedNodeIds = useImpactAnalysisStore((state) => state.setSeedNodeIds);
  const analyze = useImpactAnalysisStore((state) => state.analyze);
  const seedNodeIds = useImpactAnalysisStore((state) => state.seedNodeIds);
  const maxHops = useImpactAnalysisStore((state) => state.maxHops);
  const direction = useImpactAnalysisStore((state) => state.direction);
  const minConfidence = useImpactAnalysisStore((state) => state.minConfidence);
  const result = useImpactAnalysisStore((state) => state.result);
  const product = useImpactAnalysisStore((state) => state.product);
  const version = useImpactAnalysisStore((state) => state.version);
  const loadVersionScope = useImpactAnalysisStore((state) => state.loadVersionScope);
  const loadTopology = useLoadTopology();

  useEffect(() => { void loadVersionScope(); }, [loadVersionScope]);
  useEffect(() => { void loadTopology(); }, [loadTopology]);

  useEffect(() => {
    const seed = getNavQueryParam("seed");
    if (seed) setSeedNodeIds([seed]);
  }, [setSeedNodeIds]);

  useEffect(() => {
    if (!seedNodeIds.length) return;
    const timer = window.setTimeout(() => void analyze(), 300);
    return () => window.clearTimeout(timer);
  }, [seedNodeIds, maxHops, direction, minConfidence, product, version, analyze]);

  return (
    <PageContainer>
      <Panel>
        <ImpactAnalysisPanel />
        {result && <ImpactPathGraph result={result} />}
      </Panel>
    </PageContainer>
  );
}
