import { create } from "zustand";
import { IMPACT_REQUEST_COPY } from "./impact-analysis-copy";
import { fetchImpactProductVersions, runImpactAnalysis } from "./impact-analysis-api";
import type { ImpactAnalysisResult, ImpactDirection, ImpactProductVersion } from "./impact-analysis-types";
import { requestFailed, requestIdle, requestLoading, requestSettled, type RequestSlice, type RequestStatus } from "@/lib/request-status";

type State = {
  seedNodeIds: string[]; maxHops: number; direction: ImpactDirection; minConfidence: number;
  enableInference: boolean; maxInferenceDepth: number;
  versions: ImpactProductVersion[]; product: string; version: string;
  /** 版本范围加载（次级读请求，整片切片） */
  scope: RequestSlice;
  versionReleaseId: string | null; versionSourceCommit: string | null;
  /** 主请求＝影响分析 */
  result: ImpactAnalysisResult | null; status: RequestStatus; error: string | null; requestVersion: number;
  expandedHops: Record<string, boolean>;
  setSeedNodeIds: (ids: string[]) => void; setMaxHops: (value: number) => void;
  setDirection: (value: ImpactDirection) => void; setMinConfidence: (value: number) => void;
  setEnableInference: (value: boolean) => void; setMaxInferenceDepth: (value: number) => void;
  loadVersionScope: () => Promise<void>; setVersionScope: (product: string, version: string) => void;
  toggleHop: (key: string) => void; analyze: () => Promise<void>; reset: () => void;
};

const defaults = { seedNodeIds: [] as string[], maxHops: 2, direction: "downstream" as ImpactDirection, minConfidence: 0.5, enableInference: false, maxInferenceDepth: 3, versions: [] as ImpactProductVersion[], product: "", version: "", scope: requestIdle(), versionReleaseId: null as string | null, versionSourceCommit: null as string | null, result: null, ...requestIdle(), requestVersion: 0, expandedHops: { "downstream-1": true, "upstream-1": true } };

export const useImpactAnalysisStore = create<State>((set, get) => ({
  ...defaults,
  setSeedNodeIds: (seedNodeIds) => set({ seedNodeIds }),
  setMaxHops: (maxHops) => set({ maxHops }),
  setDirection: (direction) => set({ direction }),
  setMinConfidence: (minConfidence) => set({ minConfidence }),
  setEnableInference: (enableInference) => set({ enableInference }),
  setMaxInferenceDepth: (maxInferenceDepth) => set({ maxInferenceDepth }),
  loadVersionScope: async () => {
    set({ scope: requestLoading() });
    try {
      const registry = await fetchImpactProductVersions();
      const versions = registry.items;
      const current = versions.find((item) => item.product === get().product && item.version === get().version);
      const preferred = current || versions.slice().reverse().find((item) => item.status !== "deprecated") || versions[versions.length - 1];
      set({ versions, product: preferred?.product || "", version: preferred?.version || "", versionReleaseId: registry.releaseId, versionSourceCommit: registry.sourceCommit, scope: requestSettled(versions.length === 0) });
    } catch (error) {
      set({ versions: [], versionReleaseId: null, versionSourceCommit: null, scope: requestFailed(error, IMPACT_REQUEST_COPY.VERSIONS_LOAD_FAILED) });
    }
  },
  setVersionScope: (product, version) => set({ product, version }),
  toggleHop: (key) => set((state) => ({ expandedHops: { ...state.expandedHops, [key]: !state.expandedHops[key] } })),
  analyze: async () => {
    const { seedNodeIds, maxHops, direction, minConfidence, enableInference, maxInferenceDepth, product, version: targetVersion } = get();
    if (!seedNodeIds.length) return;
    const version = get().requestVersion + 1;
    set({ ...requestLoading(), requestVersion: version });
    try {
      const result = await runImpactAnalysis({ seedNodeIds, maxHops, direction, minConfidence, includeDocuments: true, enableInference, maxInferenceDepth, ...(product && targetVersion ? { product, version: targetVersion } : {}) });
      if (get().requestVersion === version) set({ result, ...requestSettled() });
    } catch (error) {
      if (get().requestVersion === version) set(requestFailed(error, IMPACT_REQUEST_COPY.ANALYSIS_FAILED));
    }
  },
  reset: () => set({ ...defaults, scope: requestIdle(), expandedHops: { ...defaults.expandedHops } }),
}));
