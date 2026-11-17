// 工作台量值带钉（第 2 批，目标 IA 工作台落地）：
// ① 首屏四信号卡渲染（L0 配额内：4 卡＝1 主视觉组，无逐页动作）；
// ② 未知口径：未加载信号显「—」不冒充真零（WP-134 口径）；
// ③ 深链分发：卡点击跳对应工作页（动作仍在各页——下钻修正口径）。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchView } from "@/features/workbench/WorkbenchView";
import { useReviewDataStore } from "@/lib/review-data-store";
import { useWorkbenchStore } from "@/features/workbench/workbench-store";
import { usePropertyStore } from "@/features/property-gov/property-store";

const nav = vi.hoisted(() => ({ to: null as string | null }));
vi.mock("@/lib/navigation", () => ({
  navigate: vi.fn((route: string) => { nav.to = route; }),
  NAV_ROUTES: ["workbench", "data-dashboard", "review", "gaps", "anomalies", "property"],
  getNavQueryParam: () => null,
  readNavLocation: () => ({ route: "workbench", sub: null, query: new URLSearchParams() }),
}));
vi.mock("@/lib/topology-store", () => ({
  useUnresolvedGapCount: () => 3,
  useLoadTopology: () => vi.fn(),
  useTopologyLoading: () => false,
  useTopologyError: () => null,
  useTopologyStats: () => null,
}));
vi.mock("@/lib/api", () => ({
  apiFetchEnvelope: vi.fn(async (path: string) =>
    path.startsWith("/api/anomalies")
      ? { ok: true, data: { issues: [{ status: "pending" }, { status: "verified" }] }, error: null }
      : path.includes("article-manifests")
        ? { ok: true, data: { summary: { stale: 1, missingEligible: 2, missing: 3 } }, error: null }
        : { ok: false, data: null, error: "x" }),
}));

describe("WorkbenchView 工作台量值带", () => {
  it("五信号卡渲染：待审（第 1 批接线源）＋缺口（topology 同源）＋异常＋映射聚合＋199 阻断警告聚合", async () => {
    useReviewDataStore.setState({ pendingCount: 2 });
    usePropertyStore.setState({ summary: { totalComponents: 3, blockerCount: 1, warningCount: 2, healthyCount: 0, coverageRatio: 0 } as never });
    render(<WorkbenchView />);
    await waitFor(() => expect(useWorkbenchStore.getState().manifestPending).toBe(3));
    expect(screen.getByTestId("wb-pending-review")).toHaveTextContent("2");
    expect(screen.getByTestId("wb-gaps")).toHaveTextContent("3");
    // pending 单源：isAnomalyPending（verified 终态不计）
    expect(screen.getByTestId("wb-anomalies")).toHaveTextContent("1");
    expect(screen.getByTestId("wb-manifest")).toHaveTextContent("3");
    // 199：阻断+警告聚合（1+2=3）
    expect(screen.getByTestId("wb-check-issues")).toHaveTextContent("3");
  });

  it("未知口径：pendingReview 未加载显「—」不显示 0", () => {
    useReviewDataStore.setState({ pendingCount: null });
    useWorkbenchStore.setState({ anomalies: null, manifestPending: null, loaded: true });
    usePropertyStore.setState({ summary: null });
    render(<WorkbenchView />);
    expect(screen.getByTestId("wb-pending-review")).toHaveTextContent("—");
    expect(screen.getByTestId("wb-anomalies")).toHaveTextContent("—");
    expect(screen.getByTestId("wb-check-issues")).toHaveTextContent("—");
  });

  it("深链分发：卡点击跳对应工作页（动作仍在各页——下钻口径）", () => {
    useReviewDataStore.setState({ pendingCount: 1 });
    useWorkbenchStore.setState({ anomalies: 1, manifestPending: 1, loaded: true });
    render(<WorkbenchView />);
    fireEvent.click(screen.getByTestId("wb-pending-review"));
    expect(nav.to).toBe("review");
    fireEvent.click(screen.getByTestId("wb-gaps"));
    expect(nav.to).toBe("gaps");
    fireEvent.click(screen.getByTestId("wb-anomalies"));
    expect(nav.to).toBe("anomalies");
    fireEvent.click(screen.getByTestId("wb-manifest"));
    expect(nav.to).toBe("property");
    fireEvent.click(screen.getByTestId("wb-check-issues"));
    expect(nav.to).toBe("property");
  });
});
