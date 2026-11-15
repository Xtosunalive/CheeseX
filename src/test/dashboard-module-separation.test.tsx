import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/features/dashboard/DashboardView";

const stores = vi.hoisted(() => ({
  load: vi.fn(),
  reviewLoad: vi.fn(),
  propertyLoad: vi.fn(),
  /** 2026-11-15 MAIC 首页尾差批：评审状态行改为 pending>0 才渲染的链接——fixture 边可变以便两态钉 */
  edges: [] as { type?: string; reviewStatus?: string; category?: string }[],
}));

vi.mock("@/lib/topology-store", () => ({
  useAdmittedNodes: () => [{ category: "服务" }],
  useAdmittedEdges: () => stores.edges,
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
// 模块表面统一为 Panel；断言其表面类（Panel 是模块外层 div 的唯一子元素）
const PANEL_SURFACE = ["rounded-xl", "bg-surface-card", "ring-1", "ring-border-thin"];
function panelSurface(moduleEl: HTMLElement): HTMLElement {
  return moduleEl.firstElementChild as HTMLElement;
}

describe("DashboardView module layout", () => {
  it("zero-pending：评审状态模块不渲染（零待办零渲染——MAIC 形态批），其余模块为兄弟", () => {
    stores.edges = [];
    const { container } = render(<DashboardView />);
    const topologySummary = container.querySelector<HTMLElement>('[data-dashboard-module="topology-summary"]');
    const reviewStatus = container.querySelector<HTMLElement>('[data-dashboard-module="review-status"]');
    const syncLog = container.querySelector<HTMLElement>('[data-dashboard-module="sync-log"]');

    expect(topologySummary).not.toBeNull();
    expect(reviewStatus).toBeNull();
    expect(syncLog).not.toBeNull();
    // 幸存模块是兄弟（同一父容器）
    expect(topologySummary?.parentElement).toBe(syncLog?.parentElement);
    expect(within(topologySummary as HTMLElement).getByText("实体类别分布")).toBeInTheDocument();
    // MAIC 形态批（Master 裁 A）：常驻统计卡整块退役——规模/待办数字回归各工作页
    expect(screen.queryByTestId("statistic")).not.toBeInTheDocument();
    // 行尾绝对数与区头徽章同批撤：构成占比由条宽表达（页内无裸数字行）
    expect(within(topologySummary as HTMLElement).queryByText("服务")).toBeInTheDocument();
    // 同步日志：新鲜度与版本保留，库总量（N 实体 · N 关系）随批撤
    expect(within(syncLog as HTMLElement).getByText(/最近生成/)).toBeInTheDocument();
    expect(within(syncLog as HTMLElement).queryByText(/1 实体/)).not.toBeInTheDocument();
  });

  it("pending>0：评审状态降级为一条可点链接（依附动作容器），不显示计数", () => {
    stores.edges = [{ reviewStatus: "pending" }, { reviewStatus: "pending" }, { reviewStatus: "approved" }];
    const { container } = render(<DashboardView />);
    const reviewStatus = container.querySelector<HTMLElement>('[data-dashboard-module="review-status"]');
    expect(reviewStatus).not.toBeNull();
    expect(within(reviewStatus as HTMLElement).getByText("关系待审核")).toBeInTheDocument();
    // 不再回潮成数字汇总行（生效 X / 待审 Y / 拒绝 Z 同批撤）
    expect(within(reviewStatus as HTMLElement).queryByText(/待审核$/)).not.toHaveTextContent(/\d/);
    expect(within(reviewStatus as HTMLElement).queryByText(/已生效|已拒绝/)).not.toBeInTheDocument();
    expect(panelSurface(reviewStatus as HTMLElement)).toHaveClass(...PANEL_SURFACE);
  });

  it("omits duplicate summary hints from review and gap stat cards", () => {
    stores.edges = [];
    const { queryByText } = render(<DashboardView />);

    expect(queryByText("来自审核 API")).not.toBeInTheDocument();
    expect(queryByText(/个待处理$/)).not.toBeInTheDocument();
    expect(queryByText("已全部处理")).not.toBeInTheDocument();
  });
});
