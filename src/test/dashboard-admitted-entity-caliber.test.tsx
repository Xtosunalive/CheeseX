// WP-134 收官补扫新发现（C 档口径切换器）：DashboardView「已准入实体」卡旧写法
// `admittedEntityCount ?? nodes.length` 在注册表未加载时改用拓扑节点数——与同文件 :31-32 的
// PR-156 刀三 裁定（已准入实体与准入页同源，不用拓扑节点数）直接相悖：拓扑里混装文档/分类学节点。
// 本钉住两态：未加载＝「—」（未知不冒充），已加载＝按注册表 kind=entity 且 admitted 数出。
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/features/dashboard/DashboardView";
import { useCanvasAdmissionStore } from "@/features/admission/admission-store";

vi.mock("@/features/admission/admission-api", () => ({
  // 永不应承：load() 在 useEffect 里发起，不能让它在断言前改写本测试设定的 store 态
  fetchCanvasAdmission: () => new Promise(() => {}),
}));

vi.mock("@/lib/topology-store", () => ({
  useAdmittedNodes: () => [{ category: "服务" }, { category: "服务" }, { category: "文档" }],
  useAdmittedEdges: () => [],
  useKnowledgeNodes: () => [],
  useKnowledgeEdges: () => [],
  useTopologyStats: () => ({ dataFreshness: { fresh: true, ageHours: 0, updatedAt: "2026-07-16T00:00:00Z", version: "1" } }),
  useTopologyLoading: () => false,
  useTopologyError: () => null,
  useTopologyErrorCode: () => null,
  useLoadTopology: () => vi.fn(),
  useUnresolvedGapCount: () => 0,
}));
vi.mock("@/lib/review-data-store", () => ({
  useReviewPendingCount: () => 0,
  useReviewStore: (selector: (state: { load: () => void }) => unknown) => selector({ load: () => {} }),
}));
vi.mock("@/lib/property-data-store", () => ({
  usePropertyDataStore: (selector: (state: { summary: { blockerCount: number; warningCount: number }; load: () => void }) => unknown) =>
    selector({ summary: { blockerCount: 0, warningCount: 0 }, load: () => {} }),
}));

function admittedEntityCard(): HTMLElement {
  const card = screen
    .getAllByTestId("statistic")
    .find((el) => el.textContent?.includes("已准入实体"));
  if (!card) expect.fail("「已准入实体」卡未渲染");
  return card;
}

function setRegistry(componentsById: Map<string, { admitted: boolean; blockedReasons: string[]; kind: "entity" | "document" | "taxonomy" | null }> | null) {
  useCanvasAdmissionStore.setState({ componentsById, totals: null, status: componentsById ? "ready" : "idle" });
}

describe("DashboardView 已准入实体卡的口径", () => {
  beforeEach(() => setRegistry(null));

  it("注册表未加载＝未知，显「—」，不拿拓扑节点数（3）顶替", () => {
    render(<DashboardView />);
    expect(admittedEntityCard().textContent).toContain("—");
    expect(admittedEntityCard().textContent).not.toContain("3");
  });

  it("注册表就绪＝只数 kind=entity 且已准入（2），文档节点不并入", () => {
    setRegistry(
      new Map([
        ["e1", { admitted: true, blockedReasons: [], kind: "entity" }],
        ["e2", { admitted: true, blockedReasons: [], kind: "entity" }],
        ["e3", { admitted: false, blockedReasons: ["missing_id"], kind: "entity" }],
        ["d1", { admitted: true, blockedReasons: [], kind: "document" }],
      ]),
    );
    render(<DashboardView />);
    expect(admittedEntityCard().textContent).toContain("2");
    expect(admittedEntityCard().textContent).not.toContain("—");
  });
});
