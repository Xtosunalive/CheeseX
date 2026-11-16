// 第 1 批接线钉（2026-11-17，目标 IA 工作台量值带前置依赖）：
// ① 96 待审计数上提——EdgeReviewPanel load 成功后回写 review-data-store.pendingCount（未知口径：初始 null）；
// ② 199 阻断/警告聚合——property-store.load 恢复持有 check 端点 summary。
// 两钉钉数据流（store 态），不钉 UI（量值卡由工作台批挂载消费）。
import { render } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeReviewPanel } from "@/features/review/EdgeReviewPanel";
import { useReviewDataStore } from "@/lib/review-data-store";
import { usePropertyStore } from "@/features/property-gov/property-store";
import { fetchCheckResults } from "@/features/property-gov/property-api";

vi.mock("@/features/review/review-api", () => ({
  fetchPendingReview: vi.fn().mockResolvedValue({
    edges: [
      { edgeId: "e1", sourceLabel: "Alpha", targetLabel: "Gamma", type: "DEPENDS_ON", reviewStatus: "pending" },
      { edgeId: "e2", sourceLabel: "Beta", targetLabel: "Gamma", type: "DEPENDS_ON", reviewStatus: "pending" },
      { edgeId: "e3", sourceLabel: "Alpha", targetLabel: "Delta", type: "REFERENCES", reviewStatus: "approved" },
    ],
    workingRevision: `sha256:${"a".repeat(64)}`,
  }),
  reviewEdge: vi.fn(),
  fetchReviewHistory: vi.fn().mockResolvedValue({ records: [] }),
}));
vi.mock("@/lib/topology-store", () => ({
  useAdmittedEdges: () => [],
  useAdmittedNodes: () => [],
  useKnowledgeEdges: () => [],
  useKnowledgeNodes: () => [],
}));
vi.mock("@/lib/domain/entity-repair-api", () => ({
  previewEntityRepair: vi.fn(),
  applyEntityRepair: vi.fn(),
  extractRepairBlockers: vi.fn(() => []),
  fieldLabel: (k: string) => k,
}));
vi.mock("@/features/property-gov/property-api", () => ({
  fetchCheckResults: vi.fn(),
  applyPropertyRepair: vi.fn(),
  refreshProperty: vi.fn(),
}));

describe("工作台量值带接线（第 1 批）", () => {
  afterEach(() => {
    useReviewDataStore.setState({ pendingCount: null });
    usePropertyStore.setState({ summary: null });
  });

  it("96：EdgeReviewPanel load 后 pending 计数上提共享源（真零≠未知：初始 null，加载后为数字）", async () => {
    expect(useReviewDataStore.getState().pendingCount).toBeNull();
    render(<EdgeReviewPanel />);
    await waitFor(() => expect(useReviewDataStore.getState().pendingCount).toBe(2));
  });

  it("199：property-store.load 恢复持有 check 端点 summary（阻断/警告聚合供工作台带消费）", async () => {
    expect(usePropertyStore.getState().summary).toBeNull();
    vi.mocked(fetchCheckResults).mockResolvedValue({
      summary: { totalComponents: 3, blockerCount: 1, warningCount: 2, healthyCount: 0, coverageRatio: 0 },
      total: 0, limit: 50, offset: 0,
      items: [], workingRevisions: {},
    } as never);
    await usePropertyStore.getState().load();
    expect(usePropertyStore.getState().summary?.blockerCount).toBe(1);
    expect(usePropertyStore.getState().summary?.warningCount).toBe(2);
  });
});
