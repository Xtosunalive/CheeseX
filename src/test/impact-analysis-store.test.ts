import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/features/impact-analysis/impact-analysis-api";
import { useImpactAnalysisStore } from "@/features/impact-analysis/impact-analysis-store";

const result = { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), downstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], meta: { totalNodesAffected: 0, maxDepth: 0, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] } };
describe("impact analysis store", () => {
  beforeEach(() => { vi.restoreAllMocks(); useImpactAnalysisStore.getState().reset(); });
  it("uses deterministic defaults and analyzes", async () => { vi.spyOn(api, "runImpactAnalysis").mockResolvedValue(result); useImpactAnalysisStore.getState().setSeedNodeIds(["a"]); await useImpactAnalysisStore.getState().analyze(); expect(api.runImpactAnalysis).toHaveBeenCalledWith(expect.objectContaining({ maxHops: 2, direction: "downstream", minConfidence: 0.5 })); expect(useImpactAnalysisStore.getState().result).toEqual(result); });
  it("does not request without a seed and exposes errors", async () => { const mock = vi.spyOn(api, "runImpactAnalysis").mockRejectedValue(new Error("broken")); await useImpactAnalysisStore.getState().analyze(); expect(mock).not.toHaveBeenCalled(); useImpactAnalysisStore.getState().setSeedNodeIds(["a"]); await useImpactAnalysisStore.getState().analyze(); expect(useImpactAnalysisStore.getState().error).toBe("broken"); });
  it("defaults enableInference=false and passes inference params when enabled", () => {
    expect(useImpactAnalysisStore.getState().enableInference).toBe(false);
    expect(useImpactAnalysisStore.getState().maxInferenceDepth).toBe(3);
    useImpactAnalysisStore.getState().setEnableInference(true);
    useImpactAnalysisStore.getState().setMaxInferenceDepth(2);
    expect(useImpactAnalysisStore.getState().enableInference).toBe(true);
    expect(useImpactAnalysisStore.getState().maxInferenceDepth).toBe(2);
  });
  it("sends enableInference/maxInferenceDepth when enabled", async () => {
    const mock = vi.spyOn(api, "runImpactAnalysis").mockResolvedValue(result);
    useImpactAnalysisStore.getState().setSeedNodeIds(["a"]);
    useImpactAnalysisStore.getState().setEnableInference(true);
    useImpactAnalysisStore.getState().setMaxInferenceDepth(2);
    await useImpactAnalysisStore.getState().analyze();
    expect(mock).toHaveBeenCalledWith(expect.objectContaining({ enableInference: true, maxInferenceDepth: 2 }));
  });
  it("loads a registered version and includes its exact scope", async () => {
    vi.spyOn(api, "fetchImpactProductVersions").mockResolvedValue({ releaseId: `release-${"c".repeat(64)}`, sourceCommit: "d".repeat(40), items: [{ product: "AnyShare", version: "7.0.6.8", label: "7.0.6.8", status: "released", sourceMode: "snapshot" }] });
    const analyze = vi.spyOn(api, "runImpactAnalysis").mockResolvedValue(result);
    await useImpactAnalysisStore.getState().loadVersionScope();
    expect(useImpactAnalysisStore.getState()).toMatchObject({ versionReleaseId: `release-${"c".repeat(64)}`, versionSourceCommit: "d".repeat(40) });
    useImpactAnalysisStore.getState().setSeedNodeIds(["a"]);
    await useImpactAnalysisStore.getState().analyze();
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ product: "AnyShare", version: "7.0.6.8" }));
  });
});
