import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImpactProductVersions, runImpactAnalysis } from "@/features/impact-analysis/impact-analysis-api";
import type { ImpactAnalysisRequest } from "@/features/impact-analysis/impact-analysis-types";

afterEach(() => vi.restoreAllMocks());

// 契约默认值（ImpactAnalysisRequest @default：maxHops=2 / direction=downstream / minConfidence=0.5 / includeDocuments=true / enableInference=false / maxInferenceDepth=3）
const contractRequest: ImpactAnalysisRequest = {
  seedNodeIds: ["a"], maxHops: 2, direction: "downstream", minConfidence: 0.5, includeDocuments: true, enableInference: false, maxInferenceDepth: 3,
};

describe("impact analysis API", () => {
  it("posts a contract request and unwraps the result", async () => {
    const data = { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), downstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], meta: { totalNodesAffected: 0, maxDepth: 0, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data, trace_id: "t" }) }); vi.stubGlobal("fetch", fetchMock);
    expect(await runImpactAnalysis(contractRequest)).toEqual(data);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(contractRequest);
  });
  it("surfaces API failures", async () => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); await expect(runImpactAnalysis(contractRequest)).rejects.toThrow("offline"); });
  it("loads registered product versions through the shared contract", async () => {
    const items = [{ product: "AnyShare", version: "7.0.6.8", label: "7.0.6.8", status: "released", sourceMode: "snapshot" }];
    const registry = { releaseId: `release-${"c".repeat(64)}`, sourceCommit: "d".repeat(40), items };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: registry, trace_id: "t" }) }));
    expect(await fetchImpactProductVersions()).toEqual(registry);
  });
});
