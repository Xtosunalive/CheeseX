// seq212：集成断言改造——枢纽拓扑 tab 由修复后的 ArchProjFlow 渲染真实拓扑（R5 退役 Mermaid mock）
// 真实拓扑 scope（architecture）下 1 个种子实体 → react-flow 画布实际出现该实体节点
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const architectureStats = {
  scope: "architecture" as const,
  topology: { nodes: [{ id: "api", label: "API", type: "ArchitectureComponent", category: "service" }], edges: [] },
  seedCount: 1,
  seedComponentIds: ["api"],
  implicitPaths: [],
  unresolvedPairs: [],
  missingSeeds: [],
  taxonomyTree: [],
  dataFreshness: { fresh: true, ageHours: 0, updatedAt: "2026-07-13T00:00:00Z", version: "1" },
};

vi.mock("@/lib/topology-store", () => ({
  useAdmittedNodes: () => architectureStats.topology.nodes,
  useAdmittedEdges: () => [],
  useKnowledgeNodes: () => architectureStats.topology.nodes,
  useKnowledgeEdges: () => [],
  useTopologyStats: () => architectureStats,
  useTopologyLoading: () => false,
  useTopologyError: () => null,
  useTopologyErrorCode: () => null,
  useTopologyScope: () => "architecture",
  useSetTopologyScope: () => vi.fn(),
  useLoadTopology: () => vi.fn(),
  useUnresolvedGapCount: () => 0,
  useActiveEntityId: () => null,
}));

// jsdom 画布桩（沿 flow.test 模式：节点渲染为可点按钮）
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ReactFlow: ({ nodes }: { nodes: Array<{ id: string; data: { label?: string } }> }) => (
      <div data-testid="react-flow">{nodes.map((n) => <span key={n.id} data-testid={`flow-node-${n.id}`}>{n.data?.label ?? n.id}</span>)}</div>
    ),
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
  };
});

import { DataDashboardView } from "../../features/data-dashboard/DataDashboardView";

describe("DataDashboard seq212 integration", () => {
  it("renders the repaired ArchitectureProjectionFlow topology canvas (entity node visible)", async () => {
    render(<DataDashboardView />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——画布即页面身份锚点
    expect(await screen.findByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByTestId("flow-node-proj-entity-api").textContent).toBe("API");
  });
});
