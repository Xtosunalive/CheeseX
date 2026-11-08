import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAnomalies } from "@/features/anomaly-workbench/anomaly-workbench-api";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";

afterEach(() => vi.unstubAllGlobals());

describe("anomaly workbench API", () => {
  beforeEach(() => useAnomalyWorkbenchStore.setState({ issues: [], selectedIssueId: null, status: "idle", error: null, refreshing: false, lastCheckedAt: null, refreshSummary: null }));
  it("unwraps a successful API envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { generatedAt: "2026-07-19T00:00:00.000Z", issues: [], total: 0 },
        trace_id: "tr_test",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAnomalies()).resolves.toEqual({
      generatedAt: "2026-07-19T00:00:00.000Z",
      issues: [],
      total: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/anomalies", { cache: "no-store" });
  });

  it("reports what changed after an explicit source recheck", async () => {
    useAnomalyWorkbenchStore.setState({ issues: [{ issueId: "resolved-1" } as never], selectedIssueId: "resolved-1", status: "success" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-07-20T01:02:03.000Z", issues: [{ issueId: "current-1" }], total: 1 }, trace_id: "tr_refresh" }),
    }));

    await useAnomalyWorkbenchStore.getState().load({ announce: true });

    expect(useAnomalyWorkbenchStore.getState()).toMatchObject({
      selectedIssueId: "current-1",
      refreshing: false,
      lastCheckedAt: "2026-07-20T01:02:03.000Z",
      refreshSummary: "列表已刷新：新增 1 项，移除 1 项，当前 1 项待处理",
    });
  });

  it("reports when a previously unresolved relation target becomes recognized", async () => {
    useAnomalyWorkbenchStore.setState({
      issues: [{ issueId: "b02", proposedAction: { unresolvedTargets: ["anybackup", "ghost"] } } as never],
      selectedIssueId: "b02",
      status: "success",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-07-20T01:03:00.000Z", issues: [{ issueId: "b02", proposedAction: { unresolvedTargets: ["ghost"] } }, { issueId: "anybackup-F01" }], total: 2 }, trace_id: "tr_targets" }),
    }));

    await useAnomalyWorkbenchStore.getState().load({ announce: true });

    expect(useAnomalyWorkbenchStore.getState().refreshSummary).toBe("列表已刷新：已识别 anybackup；仍有 1 个关系目标待处理；新增 1 项问题，移除 0 项问题");
  });

  it("prefers a field-completion issue when entering the workbench", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-07-20T01:04:00.000Z", issues: [
        { issueId: "relation-warning", issueKind: "unrecognized_entity", proposedAction: { type: "entity-relation-repair" } },
        { issueId: "article-id", issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "article_id" } },
      ], total: 2 } }),
    }));
    useAnomalyWorkbenchStore.setState({ selectedIssueId: "relation-warning" });

    await useAnomalyWorkbenchStore.getState().load({ preferActionable: true });

    expect(useAnomalyWorkbenchStore.getState().selectedIssueId).toBe("article-id");
  });

  it("reloads the active queue after a confirmed source write", async () => {
    useAnomalyWorkbenchStore.setState({ issues: [{ issueId: "relation-1" } as never], selectedIssueId: "relation-1", status: "success" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { issueId: "relation-1", status: "confirmed" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, data: { generatedAt: "2026-07-25T00:00:00.000Z", issues: [], total: 0 } }) });
    vi.stubGlobal("fetch", fetchMock);

    await useAnomalyWorkbenchStore.getState().operate("confirm", { previewId: "preview-1" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/anomalies/relation-1/confirm", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/anomalies", { cache: "no-store" });
    expect(useAnomalyWorkbenchStore.getState()).toMatchObject({ issues: [], selectedIssueId: null, status: "empty" });
  });
});
