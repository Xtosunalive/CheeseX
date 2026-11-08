import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";
import * as api from "@/features/entity-compliance/entity-compliance-api";

vi.mock("@/features/entity-compliance/entity-compliance-api", () => ({
  fetchEntityCompliance: vi.fn(),
  previewEntityRepair: vi.fn(),
  applyEntityRepair: vi.fn(),
}));

const entity = {
  entityId: "svc", title: "Service", fileName: "svc.md", sourceKey: "知识库/wiki/entities/svc.md",
  sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:x" }, blockerCount: 1, warningCount: 0, infoCount: 0,
  groups: [],
};
const readiness = { ready: true, totalArchComponents: 1, blockerEntities: 0, blockerCount: 0, warningCount: 0, warningDetails: [], blockingSourceKeys: [] };

describe("entity repair store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntityComplianceStore.setState({ selectedEntity: null, repairChanges: {}, relationPatch: null, preview: null, applyResult: null, repairStatus: "idle", repairError: null });
    vi.mocked(api.fetchEntityCompliance).mockResolvedValue({ generatedAt: "2026-07-24T00:00:00.000Z", readiness, items: [entity], total: 1, limit: 50, offset: 0, summary: {} });
  });

  it("requires preview and applies the confirmed edit directly to the formal Vault", async () => {
    vi.mocked(api.previewEntityRepair).mockResolvedValue({ previewId: "p1", sourceKey: entity.sourceKey, beforeFrontmatter: "old", afterFrontmatter: "new", changedFields: ["module"], postCheck: { blockerCount: 0, warningCount: 0 }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    vi.mocked(api.applyEntityRepair).mockResolvedValue({ entityId: "svc", writtenFields: ["module"], backupPath: "", sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:x" } });

    const store = useEntityComplianceStore.getState();
    store.openRepair(entity);
    useEntityComplianceStore.getState().setRepairField("module", ["Core"]);
    await useEntityComplianceStore.getState().loadPreview();
    expect(api.previewEntityRepair).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: entity.sourceKey, sourceRevision: entity.sourceRevision, changes: { module: ["Core"] } }));
    expect(useEntityComplianceStore.getState().repairStatus).toBe("preview_ready");

    await useEntityComplianceStore.getState().submitApply();
    expect(api.applyEntityRepair).toHaveBeenCalledWith("p1");
    // 2026-10-14 修复语义：写回成功即重检当前视图（Master 报障——旧「不重拉、手动刷新才见回填」退役）
    expect(api.fetchEntityCompliance).toHaveBeenCalledOnce();
    expect(useEntityComplianceStore.getState().repairStatus).toBe("applied");
    expect(useEntityComplianceStore.getState().applyResult?.writtenFields).toEqual(["module"]);
  });

  it("invalidates preview when edits change", () => {
    useEntityComplianceStore.setState({ preview: { previewId: "old" } as never, repairStatus: "preview_ready" });
    useEntityComplianceStore.getState().setRepairField("status", "有效");
    expect(useEntityComplianceStore.getState().preview).toBeNull();
    expect(useEntityComplianceStore.getState().repairStatus).toBe("idle");
  });

  it("refreshes the list and open repair with the same source revision", async () => {
    const fresh = {
      ...entity,
      sourceRevision: { mtimeMs: 2, size: 12, contentHash: "sha256:fresh" },
      blockerCount: 0,
    };
    useEntityComplianceStore.getState().openRepair(entity);
    useEntityComplianceStore.setState({
      data: { generatedAt: "2026-07-24T00:00:00.000Z", readiness, items: [entity], total: 1, limit: 50, offset: 0, summary: { blockerCount: 1 } },
    });
    vi.mocked(api.fetchEntityCompliance).mockResolvedValue({
      generatedAt: "2026-07-24T00:01:00.000Z", readiness,
      items: [fresh], total: 1, limit: 50, offset: 0, summary: { blockerCount: 0 },
    });

    await useEntityComplianceStore.getState().refreshAll({ announce: true });

    expect(api.fetchEntityCompliance).toHaveBeenCalledOnce();
    expect(useEntityComplianceStore.getState().data?.items[0].sourceRevision?.contentHash).toBe("sha256:fresh");
    expect(useEntityComplianceStore.getState().selectedEntity?.sourceRevision?.contentHash).toBe("sha256:fresh");
    expect(useEntityComplianceStore.getState().refreshSummary).toBe("Service：阻断 1 → 0");
    expect(useEntityComplianceStore.getState().lastCheckedAt).toBe("2026-07-24T00:01:00.000Z");
  });
});
