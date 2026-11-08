import { apiFetchEnvelope } from "@/lib/api";
import { IMPACT_REQUEST_COPY } from "./impact-analysis-copy";
import type { ImpactAnalysisRequest, ImpactAnalysisResult, ImpactProductVersionList } from "./impact-analysis-types";

export async function fetchImpactProductVersions(): Promise<ImpactProductVersionList> {
  const envelope = await apiFetchEnvelope<ImpactProductVersionList>("/api/kg/product-versions");
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || IMPACT_REQUEST_COPY.VERSIONS_LOAD_FAILED);
  return envelope.data;
}

export async function runImpactAnalysis(request: ImpactAnalysisRequest): Promise<ImpactAnalysisResult> {
  const envelope = await apiFetchEnvelope<ImpactAnalysisResult>("/api/kg/impact-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || IMPACT_REQUEST_COPY.ANALYSIS_FAILED);
  return envelope.data;
}
