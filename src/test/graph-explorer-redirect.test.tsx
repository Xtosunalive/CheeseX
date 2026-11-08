// seq212 红灯→绿灯：旧 #/relations 书签自动跳转「图谱检索」枢纽（C8 导航收口）
// 红灯形态（base f29b1666）：当前 App 渲染旧关系查询页（已退役），无图谱检索标题、hash 不归一——断言必红。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
// jsdom 画布桩（沿 architecture-projection-flow.test 模式——本文件聚焦导航归一，画布不参与断言）
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

// DataDashboardView 经 TopologyStateGate 门控——桩 store 让门通过，聚焦导航归一行为
vi.mock("@/lib/topology-store", () => ({
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
  useLoadTopology: () => vi.fn(),
  useUnresolvedGapCount: () => 0,
  useGapItems: () => [],
  useActiveEntityId: () => null,
  useSetActiveEntityId: () => vi.fn(),
  useNodeHighlight: () => ({ highlightNodeIds: new Set(), setHighlightNodeIds: vi.fn() }),
}));

import App from "@/App";

describe("#/relations 重定向到图谱检索枢纽", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("旧 relations hash 渲染枢纽并归一化 URL 到 #/data-dashboard", async () => {
    window.location.hash = "#/relations";
    render(<App />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——
    // 枢纽渲染就绪改由应用栏页面名断言（hash 归一断言不变）
    expect(await screen.findByTestId("app-bar-location")).toHaveTextContent("图谱检索");
    expect(window.location.hash).toBe("#/data-dashboard");
  });

  it("relations 子路由（#/relations/overview）同样归一化", async () => {
    window.location.hash = "#/relations/overview";
    render(<App />);
    expect(await screen.findByTestId("app-bar-location")).toHaveTextContent("图谱检索");
    expect(window.location.hash).toBe("#/data-dashboard");
  });
});
