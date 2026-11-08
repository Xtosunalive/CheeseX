// 回归固化（PR-081 修正向，Master 2026-10-20 裁定「没数据就各组件显示 0，前端不感知产品概念」）：
// scope=architecture 且服务端返回零值 200 载荷（无 SA 数据＝合法空数据态）时，页面走既有
// 空数据渲染——正常骨架＋零值，不出现错误横幅、不出现任何「产品配置」语义的 UI。
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataDashboardView } from "@/features/data-dashboard/DataDashboardView";
import { useTopologyStore } from "@/lib/topology-store";

// 画布库 stub 沿用 architecture-projection-dashboard-integration.test.tsx 先例
// （断言只看骨架与 store 状态，不依赖真实 react-flow；jsdom 无 ResizeObserver）
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ReactFlow: () => <div data-testid="react-flow" />,
    Background: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
    useReactFlow: () => ({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }),
    useNodesState: <T,>(initial: T[]) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, vi.fn()] as const;
    },
    useEdgesState: <T,>(initial: T[]) => {
      const [state, setState] = React.useState(initial);
      return [state, setState, vi.fn()] as const;
    },
    Controls: () => null,
    MiniMap: () => null,
  };
});

function stubFetchWithEmptyArchitecture() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        scope: "architecture",
        totalNodes: 0,
        returnedNodes: 0,
        totalEdges: 0,
        returnedEdges: 0,
        topology: { nodes: [], edges: [] },
        taxonomyTree: [],
        seedComponentIds: [],
        seedCount: 0,
        implicitPaths: [],
        unresolvedPairs: [],
        missingSeeds: [],
      },
    }),
  }));
}

describe("architecture scope with empty data", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useTopologyStore.setState({
      scope: "full",
      error: null,
      errorCode: null,
      stats: null,
      admittedNodes: [],
      admittedEdges: [],
      knowledgeNodes: [],
      knowledgeEdges: [],
      gaps: [],
    });
  });

  it("renders the normal shell with zero counts, no error card", async () => {
    useTopologyStore.setState({ scope: "architecture" });
    stubFetchWithEmptyArchitecture();
    render(<DataDashboardView />);
    // 正常骨架：图谱检索双 tab 存在
    const tabs = await screen.findByRole("tablist", { name: "图谱检索视图" });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "拓扑" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "关系" })).toBeInTheDocument();
    // 数据态：store 无 error、stats 已落（零值载荷）
    expect(useTopologyStore.getState().error).toBeNull();
    expect(useTopologyStore.getState().stats?.seedCount).toBe(0);
    // 不出现错误横幅与「产品」语义文案
    expect(screen.queryByText(/无法连接 API|请求失败|错误/)).not.toBeInTheDocument();
    expect(screen.queryByText(/产品/)).not.toBeInTheDocument();
  });
});
