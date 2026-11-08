// @tests: src/features/entity-compliance/entity-compliance-store.ts
// 2026-10-14 Master 报障回归——修复写回成功后必须重检当前视图：
// 写回成功但列表/抽屉仍显旧值、需手动浏览器刷新才见回填（对齐异常工作台 B1 的
// onBatchApplied→reconcileAndLoad 同款语义）。层级：纯单元（store＋mock api）。
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/features/entity-compliance/entity-compliance-api", () => ({
  fetchEntityCheckOne: vi.fn(),
  fetchEntityCompliance: vi.fn(),
  previewEntityRepair: vi.fn(),
  applyEntityRepair: vi.fn(),
}));

import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";
import { fetchEntityCompliance, applyEntityRepair } from "@/features/entity-compliance/entity-compliance-api";

const compliancePayload = (blockerCount: number) => ({
  generatedAt: "2026-10-14T10:00:00Z",
  summary: { blockerCount },
  items: [
    { sourceKey: "知识库/wiki/entities/uu.md", title: "uu", fileName: "uu.md", blockerCount, sourceExists: true },
  ],
  // EntityCheckData 契约必填组（contracts/http-api.openapi.json）：total/limit/offset＋readiness 必填七键
  total: 1,
  limit: 50,
  offset: 0,
  readiness: { ready: true, totalArchComponents: 0, blockerEntities: 0, blockerCount: 0, warningCount: 0, warningDetails: [], blockingSourceKeys: [] },
});

describe("entity-compliance store: apply 修复写回后重检", () => {
  beforeEach(() => {
    useEntityComplianceStore.setState({ data: null, selectedEntity: null, repairOpen: false, preview: null, repairStatus: "idle", repairError: null });
    vi.mocked(fetchEntityCompliance).mockReset().mockResolvedValue(compliancePayload(3));
    vi.mocked(applyEntityRepair).mockReset().mockResolvedValue({} as never);
  });

  it("apply 成功后自动 refreshAll——列表反映修复后现实（不再需要手动浏览器刷新）", async () => {
    const store = useEntityComplianceStore.getState();
    await store.refreshAll();
    expect(fetchEntityCompliance).toHaveBeenCalledTimes(1);

    // 模拟修复预览已就位 → apply：写回后阻断从 3 → 0
    vi.mocked(fetchEntityCompliance).mockResolvedValue(compliancePayload(0));
    useEntityComplianceStore.setState({ preview: { sourceKey: "知识库/wiki/entities/uu.md" } as never, repairStatus: "preview_ready" });
    await store.submitApply();

    expect(applyEntityRepair).toHaveBeenCalledTimes(1);
    expect(fetchEntityCompliance, "apply 成功后必须重检当前视图").toHaveBeenCalledTimes(2);
    expect(useEntityComplianceStore.getState().data?.summary?.blockerCount, "列表数据已更新为修复后").toBe(0);
    expect(useEntityComplianceStore.getState().repairStatus).toBe("applied");
  });

  it("apply 失败不触发重检（保留现场供用户改完重试）", async () => {
    const store = useEntityComplianceStore.getState();
    await store.refreshAll();
    vi.mocked(applyEntityRepair).mockRejectedValue(new Error("409") as never);
    useEntityComplianceStore.setState({ preview: { sourceKey: "知识库/wiki/entities/uu.md" } as never, repairStatus: "preview_ready" });
    await store.submitApply();
    expect(fetchEntityCompliance, "失败路径不得覆盖现场").toHaveBeenCalledTimes(1);
    expect(useEntityComplianceStore.getState().repairStatus).toBe("preview_ready");
  });
});
