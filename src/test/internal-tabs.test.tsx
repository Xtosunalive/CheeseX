import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileText, ShieldCheck } from "lucide-react";
import { InternalTabs, type InternalTabItem } from "@/components/internal-tabs";
import { PropertyGovView } from "@/features/property-gov/PropertyGovView";
import { getPipelineGenPresentation } from "@/features/property-gov/pipeline-gen-presentation";
import { DataDashboardView } from "@/features/data-dashboard/DataDashboardView";
import { ReviewView } from "@/features/review/ReviewView";

const mocks = vi.hoisted(() => ({
  loadTopology: vi.fn(),
  setActiveEntityId: vi.fn(),
}));

vi.mock("@/lib/topology-store", () => ({
  useLoadTopology: () => mocks.loadTopology,
  useSetActiveEntityId: () => mocks.setActiveEntityId,
  useTopologyStats: () => ({ scope: "full", taxonomyTree: [], topology: { nodes: [], edges: [] }, gaps: [] }),
  useAdmittedNodes: () => [],
  useAdmittedEdges: () => [],
  useKnowledgeNodes: () => [],
  useKnowledgeEdges: () => [],
  useTopologyLoading: () => false,
  useTopologyError: () => null,
  useTopologyErrorCode: () => null,
  useTopologyScope: () => "full",
  useSetTopologyScope: () => vi.fn(),
  useUnresolvedGapCount: () => 0,
  useGapItems: () => [],
  useActiveEntityId: () => null,
}));
// jsdom 画布桩（沿 architecture-projection-flow.test 模式）
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ReactFlow: ({ nodes }: { nodes: Array<{ id: string }> }) => <div data-testid="react-flow">{nodes.map((n) => <span key={n.id}>{n.id}</span>)}</div>,
    Background: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
    useReactFlow: () => ({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }),
    useNodesState: <T,>(initial: T[]) => { const [s, setS] = React.useState(initial); return [s, setS, vi.fn()] as const; },
    useEdgesState: <T,>(initial: T[]) => { const [s, setS] = React.useState(initial); return [s, setS, vi.fn()] as const; },
  };
});
vi.mock("@/features/property-gov/property-api", () => ({ fetchPipelineGenStatus: vi.fn().mockResolvedValue(null) }));
vi.mock("@/features/property-gov/property-store", () => ({
  usePropertyStore: { getState: () => ({ setQuery: vi.fn() }) },
}));
vi.mock("@/features/property-gov/ManifestListPanel", () => ({ ManifestListPanel: () => <div>文章图谱映射面板</div> }));
vi.mock("@/features/property-gov/CheckResultsPanel", () => ({ CheckResultsPanel: () => <div>架构组件属性面板</div> }));
vi.mock("@/features/review/EdgeReviewPanel", () => ({ EdgeReviewPanel: () => <div>关系审核面板</div> }));
vi.mock("@/components/review/InferenceConflictPanel", () => ({ InferenceConflictPanel: () => <div>规则冲突面板</div> }));
vi.mock("@/features/review/AuditLogPanel", () => ({ AuditLogPanel: () => <div>审核记录面板</div> }));
vi.mock("@/features/data-dashboard/components/relation-library-tab", () => ({ RelationLibraryTab: () => <div>关系查询面板</div> }));
vi.mock("@/features/data-dashboard/components/relations-panel", () => ({ RelationsPanel: () => <div>关系概览面板</div> }));

type TestTab = "articles" | "checks";

const ITEMS: InternalTabItem<TestTab>[] = [
  { id: "articles", label: "文章图谱映射", icon: FileText },
  { id: "checks", label: "架构组件属性", icon: ShieldCheck },
];

function InternalTabsFixture() {
  const [value, setValue] = useState<TestTab>("articles");
  return <InternalTabs ariaLabel="文章图谱映射和架构组件属性视图" items={ITEMS} value={value} onValueChange={setValue} />;
}

describe("InternalTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/property";
  });

  it("uses the shared visual baseline and switches tabs", () => {
    render(<InternalTabsFixture />);

    const tablist = screen.getByRole("tablist", { name: "文章图谱映射和架构组件属性视图" });
    const articleTab = screen.getByRole("tab", { name: "文章图谱映射" });
    const checksTab = screen.getByRole("tab", { name: "架构组件属性" });

    expect(tablist).toHaveClass("grid-cols-2", "rounded-lg", "bg-surface-root", "ring-border-thin");
    expect(articleTab).toHaveAttribute("aria-selected", "true");
    expect(articleTab).toHaveClass("bg-accent-base", "text-accent-contrast");

    fireEvent.click(checksTab);
    expect(checksTab).toHaveAttribute("aria-selected", "true");
    expect(articleTab).toHaveAttribute("aria-selected", "false");
  });

  it("supports keyboard navigation", () => {
    render(<InternalTabsFixture />);
    const articleTab = screen.getByRole("tab", { name: "文章图谱映射" });
    const checksTab = screen.getByRole("tab", { name: "架构组件属性" });

    articleTab.focus();
    fireEvent.keyDown(articleTab, { key: "ArrowRight" });

    expect(checksTab).toHaveAttribute("aria-selected", "true");
    expect(checksTab).toHaveFocus();
  });

  it("provides the same tab baseline to all nested-tab pages", () => {
    const property = render(<PropertyGovView />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——副标题仍在
    expect(screen.getByRole("tablist", { name: "文章与组件视图" })).toBeInTheDocument(); // 页题已裁删——页签条为锚
    expect(screen.getByRole("tablist", { name: "文章与组件视图" })).toHaveClass("grid-cols-3", "bg-surface-root", "p-0.5", "ring-border-thin");
    property.unmount();

    window.location.hash = "#/review";
    const review = render(<ReviewView />);
    expect(screen.getByRole("tablist", { name: "关系审核视图" })).toHaveClass("grid-cols-3", "bg-surface-root", "p-0.5", "ring-border-thin");
    review.unmount();

    window.location.hash = "#/review/conflicts?conflictId=conflict-1";
    const conflictReview = render(<ReviewView />);
    expect(screen.getByRole("tab", { name: "规则冲突" })).toHaveAttribute("aria-selected", "true");
    conflictReview.unmount();

    window.location.hash = "#/data-dashboard";
    const hub = render(<DataDashboardView />);
    // seq212：relations 页退役，双 tab 基线由图谱检索枢纽承载（拓扑|关系）
    // 页内主标题已删（同上拍板）——tablist 即页面身份锚点
    expect(screen.getByRole("tablist", { name: "图谱检索视图" })).toHaveClass("grid-cols-2", "bg-surface-root", "p-0.5", "ring-border-thin");
    expect(screen.getByRole("tab", { name: "拓扑" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "关系" })).toBeInTheDocument();
    hub.unmount();
  });

  it("formats the latest persisted pipeline summary instead of a placeholder", () => {
    expect(getPipelineGenPresentation({
      state: "idle",
      message: "Pipeline 尚未运行",
      logs: [],
      lastRun: {
        runTs: "20260716-063858",
        timestamp: "2026-07-16T06:39:00.451135+00:00",
        status: "success",
        nodes: 37,
        connections: 29,
        components: 1,
        plates: 0,
        failedStage: null,
        error: null,
        durationMs: 2305,
      },
    })).toMatchObject({
      label: "成功 · 37 实体 · 29 关系",
      tone: "success",
      title: expect.stringContaining("最近一次管道生成的主图总量"),
    });
  });

  it("empty tone carries no display copy (WP-146 裁决2：数据层文案不上屏)", () => {
    expect(getPipelineGenPresentation({
      state: "idle",
      message: "Pipeline 尚未运行",
      logs: [],
      lastRun: null,
    })).toMatchObject({ label: "", tone: "empty" });
  });
});
