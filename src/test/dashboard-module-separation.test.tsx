import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/features/dashboard/DashboardView";

const stores = vi.hoisted(() => ({
  load: vi.fn(),
  reviewLoad: vi.fn(),
  propertyLoad: vi.fn(),
}));

vi.mock("@/lib/topology-store", () => ({
  useAdmittedNodes: () => [{ category: "服务" }],
  useAdmittedEdges: () => [],
  useKnowledgeNodes: () => [{ category: "服务" }],
  useKnowledgeEdges: () => [],
  useTopologyStats: () => ({ dataFreshness: { fresh: true, ageHours: 0, updatedAt: "2026-07-16T00:00:00Z", version: "1" } }),
  useTopologyLoading: () => false,
  useTopologyError: () => null,
  useTopologyErrorCode: () => null,
  useLoadTopology: () => stores.load,
  useUnresolvedGapCount: () => 0,
}));
vi.mock("@/lib/review-data-store", () => ({
  useReviewPendingCount: () => 0,
  useReviewStore: (selector: (state: { load: () => void }) => unknown) => selector({ load: stores.reviewLoad }),
}));
vi.mock("@/lib/property-data-store", () => ({
  usePropertyDataStore: (selector: (state: { summary: { blockerCount: number; warningCount: number }; load: () => void }) => unknown) => selector({ summary: { blockerCount: 0, warningCount: 0 }, load: stores.propertyLoad }),
}));
// 模块表面统一为 Panel；断言其表面类（Panel 是模块外层 div 的唯一子元素）
const PANEL_SURFACE = ["rounded-xl", "bg-surface-card", "ring-1", "ring-border-thin"];
function panelSurface(moduleEl: HTMLElement): HTMLElement {
  return moduleEl.firstElementChild as HTMLElement;
}

describe("DashboardView module layout", () => {
  it("renders review status and sync history as separate sibling cards", () => {
    const { container } = render(<DashboardView />);
    const topologySummary = container.querySelector<HTMLElement>('[data-dashboard-module="topology-summary"]');
    const reviewStatus = container.querySelector<HTMLElement>('[data-dashboard-module="review-status"]');
    const syncLog = container.querySelector<HTMLElement>('[data-dashboard-module="sync-log"]');

    expect(topologySummary).not.toBeNull();
    expect(reviewStatus).not.toBeNull();
    expect(syncLog).not.toBeNull();
    // 三个模块是兄弟（同一父容器）
    expect(topologySummary?.parentElement).toBe(reviewStatus?.parentElement);
    expect(topologySummary?.parentElement).toBe(syncLog?.parentElement);
    expect(within(topologySummary as HTMLElement).getByText("实体类别分布")).toBeInTheDocument();
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——副标题仍在
    // 页题已裁删（ce337ad4）
    expect(within(topologySummary as HTMLElement).queryByText("架构图关系审核状态")).not.toBeInTheDocument();
    expect(within(topologySummary as HTMLElement).queryByText("最近管道生成结果")).not.toBeInTheDocument();
    expect(within(reviewStatus as HTMLElement).getByText("架构图关系审核状态")).toBeInTheDocument();
    expect(within(reviewStatus as HTMLElement).getByText("0 待审核")).toBeInTheDocument();
    expect(within(reviewStatus as HTMLElement).queryByText(/全部待审核/)).not.toBeInTheDocument();
    expect(screen.getByText("全部待审核关系")).toBeInTheDocument();
    expect(screen.getByText("架构图关系")).toBeInTheDocument();
    // 统计卡（Statistic）统一表面：surface-card，不落到 surface-root
    screen.getAllByTestId("statistic").forEach((card) => {
      expect(card).toHaveClass("rounded-xl", "ring-1", "ring-border-thin", "bg-surface-card");
      expect(card).not.toHaveClass("bg-surface-root");
    });
    expect(within(reviewStatus as HTMLElement).queryByText("0 待审")).not.toBeInTheDocument();
    // 三个模块的表面（Panel）统一为 surface-card
    for (const moduleEl of [topologySummary, reviewStatus, syncLog]) {
      expect(panelSurface(moduleEl as HTMLElement)).toHaveClass(...PANEL_SURFACE);
    }
    expect(within(syncLog as HTMLElement).getByText("最近管道生成结果")).toBeInTheDocument();
    expect(within(syncLog as HTMLElement).getByText(/最近生成/)).toBeInTheDocument();
  });

  it("omits duplicate summary hints from review and gap stat cards", () => {
    const { queryByText } = render(<DashboardView />);

    expect(queryByText("来自审核 API")).not.toBeInTheDocument();
    expect(queryByText(/个待处理$/)).not.toBeInTheDocument();
    expect(queryByText("已全部处理")).not.toBeInTheDocument();
  });
});
