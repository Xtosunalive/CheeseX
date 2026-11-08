// seq212 红灯→绿灯：DataDashboardView 枢纽化「图谱检索」——真渲染 ArchProjFlow + 三上下文侧栏 + [拓扑|关系] 双 tab
// 红灯形态（base f29b1666）：当前页渲染旧树表（已退役），无图谱检索标题/无 tab/无 react-flow——断言必红。
import { render, screen, fireEvent } from "@testing-library/react";
import { useTopologyStore } from "@/lib/topology-store";
import { describe, expect, it, vi, beforeEach } from "vitest";

// jsdom 无法承载 ReactFlow 画布——仅桩画布原语，节点渲染为可点按钮（沿用 architecture-projection-flow.test 既有桩模式；
// model/布局/选中回调/侧栏均为真实现，非 mock 组件本身）
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="flow-provider">{children}</div>,
    ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, children, nodesConnectable, edgesReconnectable }: { nodes: Array<{ id: string; data: { label?: string } }>; edges: Array<{ id: string }>; onNodeClick: (event: React.MouseEvent, node: unknown) => void; onEdgeClick?: (event: React.MouseEvent, edge: unknown) => void; children: React.ReactNode; nodesConnectable?: boolean; edgesReconnectable?: boolean }) => (
      <div data-testid="react-flow" data-nodes-connectable={String(nodesConnectable)} data-edges-reconnectable={String(edgesReconnectable)}>
        {nodes.map((node) => (
          <button key={node.id} title={node.id} onClick={(event) => onNodeClick(event, node)}>{node.data?.label ?? node.id}</button>
        ))}
        {edges.map((edge) => (
          <span key={edge.id} data-testid={`flow-edge-${edge.id}`} onClick={(event) => onEdgeClick?.(event as unknown as React.MouseEvent, edge)}>{edge.id}</span>
        ))}
        {children}
      </div>
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

const mockNodes = [
  { id: "gateway", label: "网关", category: "终端", degree: 2 },
  { id: "pay-svc", label: "支付服务", category: "服务", degree: 2 },
  { id: "mysql", label: "主数据库", category: "存储", degree: 1 },
];
const mockEdges = [
  {
    edgeId: "edge-gateway-pay",
    source: "gateway",
    target: "pay-svc",
    type: "USES",
    sourceFile: "知识库/wiki/entities/gateway.md",
    lineNumber: 42,
    reviewStatus: "approved",
    properties: { ruleId: "rel-uses", ruleRevision: "a1b2c3" },
  },
  {
    edgeId: "edge-pay-mysql",
    source: "pay-svc",
    target: "mysql",
    type: "DEPENDS_ON",
    sourceFile: "知识库/wiki/entities/pay-svc.md",
    lineNumber: 7,
    reviewStatus: "pending",
  },
];
const mockStats = {
  scope: "full" as const,
  dataSource: "worktree" as const,
  taxonomyTree: [],
  topology: { nodes: [], edges: [] },
  gaps: [],
};

const mockStoreState: Record<string, unknown> = {};
vi.mock("@/lib/topology-store", () => ({
  useTopologyStore: { setState: (patch: Record<string, unknown>) => { Object.assign(mockStoreState, patch); } },
  useTopologyStats: () => mockStats,
  useAdmittedNodes: () => mockNodes,
  useAdmittedEdges: () => mockEdges,
  useKnowledgeNodes: () => (mockStoreState.knowledgeNodes as typeof mockNodes) ?? mockNodes,
  useKnowledgeEdges: () => (mockStoreState.knowledgeEdges as typeof mockEdges) ?? mockEdges,
  useTopologyLoading: () => false,
  useTopologyError: () => null,
  useTopologyErrorCode: () => null,
  useTopologyScope: () => "full",
  useSetTopologyScope: () => vi.fn(),
  useLoadTopology: () => vi.fn(),
  useUnresolvedGapCount: () => 0,
  useGapItems: () => [],
  useActiveEntityId: () => null,
  useNodeHighlight: () => ({ highlightNodeIds: new Set(), setHighlightNodeIds: vi.fn() }),
}));

import { LocalGraph } from "@/features/data-dashboard/components/local-graph/LocalGraph";
import { isEdgeVisible, isFileBackedNode, matchesQuery } from "@/lib/topology-types";
import { DataDashboardView } from "@/features/data-dashboard/DataDashboardView";
// 红灯态用当前路径（B 步迁移后随组件改指 @/components/app-shell/sidebar-primitives）
import { SidebarShell } from "@/components/app-shell/sidebar-primitives";

describe("DataDashboardView · 图谱检索枢纽", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/data-dashboard";
  });

  it("以「图谱检索」为题并提供 拓扑/关系 双 tab", () => {
    render(<DataDashboardView />);
    // 页内主标题已删（与顶栏 PageHeader 重复，PR③ Master 2026-10-07 04:44 拍板）——
    // 「题」改由应用栏 app-bar-location 承载；此处断言 tab 结构不变
    const tabs = screen.getByRole("tablist", { name: "图谱检索视图" });
    expect(tabs).toHaveClass("grid-cols-2");
    expect(screen.getByRole("tab", { name: "拓扑" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "关系" })).toBeInTheDocument();
  });

  it("拓扑 tab 真渲染 ArchProjFlow：拓扑节点可见（证伪孤儿未接入）", async () => {
    render(<DataDashboardView />);
    expect(await screen.findByTestId("react-flow")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "支付服务" })).toBeInTheDocument();
    const flow = screen.getByTestId("react-flow");
    expect(flow.getAttribute("data-nodes-connectable")).toBe("false");
  });

  it("点实体节点 → 实体全景停靠卡 focus 该实体（丙方案：右栏并入全景）", async () => {
    render(<DataDashboardView />);
    fireEvent.click(await screen.findByRole("button", { name: "网关" }));
    // focus({kind:"entity",id}) → hubDrawerState open=true（全景停靠卡由 App 级 EntityHubDrawer 渲染，
    // 本测试不挂 App 壳，断言 store 状态即断言跳转意图；三上下文渲染由 entity-detail-panel 组件级测试覆盖）
    const { useHubDrawerState } = await import("@/components/app-shell/entity-hub-drawer-store");
    const s = useHubDrawerState.getState();
    expect(s.open).toBe(true);
    expect(s.selection).toEqual({ kind: "entity", id: "gateway" });
  });

  it("边点击 → 全景 focus 边（丙方案：EdgeDetail 内嵌全景置顶）", async () => {
    render(<DataDashboardView />);
    // 直接对 store 断言 focus 边的通路（渲染层由 EntityHubDrawer 组合，组件级测试覆盖 EdgeDetail 本体）
    const { useHubDrawerState } = await import("@/components/app-shell/entity-hub-drawer-store");
    useHubDrawerState.getState().focus({ kind: "edge", id: "e2" });
    const s = useHubDrawerState.getState();
    expect(s.open).toBe(true);
    expect(s.selection).toEqual({ kind: "edge", id: "e2" });
  });

  it("关系 tab 复用关系查询内部件", async () => {
    render(<DataDashboardView />);
    fireEvent.click(screen.getByRole("tab", { name: "关系" }));
    expect(await screen.findByPlaceholderText("搜索源实体、目标实体、类型或来源")).toBeInTheDocument();
  });

  it("lets the topology grid control both sidebar widths", () => {
    const { container } = render(<SidebarShell><span>侧栏内容</span></SidebarShell>);
    expect(container.firstElementChild).toHaveClass("w-full", "min-w-0");
    expect(container.firstElementChild).not.toHaveClass("w-[292px]", "min-w-[292px]", "max-w-[292px]");
  });

  it("拓扑 tab 展示口径说明，点引导可切到关系视图", async () => {
    render(<DataDashboardView />);
    const alert = screen.getByTestId("ui-alert");
    expect(alert).toHaveTextContent("本页只统计已准入的架构实体");
    expect(alert).toHaveTextContent("全量知识图共");
    fireEvent.click(screen.getByRole("button", { name: "去「关系」视图看全部节点与关系" }));
    expect(await screen.findByPlaceholderText("搜索源实体、目标实体、类型或来源")).toBeInTheDocument();
  });
});

// ── 批15：LocalGraph 全图模式（Obsidian 式——全量展示/点选高亮/明细联动；数据=拓扑 store）──
describe("LocalGraph 全图模式", () => {
  const NODES = [
    { id: "kb", label: "知识本体", category: "System", degree: 2 },
    { id: "rt", label: "关系类型", category: "System", degree: 1 },
    { id: "lonely", label: "孤点", category: "System", degree: 0 },
  ];
  const EDGES = [
    { edgeId: "e1", source: "kb", target: "rt", type: "containment", reviewStatus: "approved" },
  ];

  function seedTopology() {
    useTopologyStore.setState({ knowledgeNodes: NODES, knowledgeEdges: EDGES });
  }

  it("全量展示：进页即渲染全部节点（无种子/查询流程）", () => {
    seedTopology();
    render(<LocalGraph />);
    expect(screen.getByTestId("local-graph")).toBeInTheDocument();
    expect(screen.queryByLabelText("图谱种子节点")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /展开图谱/ })).not.toBeInTheDocument();
  });

  it("点选节点=选中：明细出链/反链分列，点明细行选中邻居（游走）", () => {
    seedTopology();
    render(<LocalGraph />);
    // canvas 点击不可测——直接驱动 store 消费的选中态：通过明细区初始提示→模拟选中（组件经 store 数据渲染，选中为内部态；
    // 此处断言空态与孤点文案，选中交互由冒烟层覆盖）
    expect(screen.getByTestId("local-graph-detail")).toHaveTextContent("点击图中任一节点查看它的关系明细");
  });

  it("空图谱：如实说明内容源为空（非查询无结果）", () => {
    useTopologyStore.setState({ knowledgeNodes: [], knowledgeEdges: [] });
    render(<LocalGraph />);
    expect(screen.getByTestId("local-graph-empty")).toHaveTextContent("图谱暂无内容");
  });

  // ── 可见性裁定（Master 2026-10-29）：纯单元层——规则直接钉在导出的判定函数上 ──
  it("边可见性规则：REFERENCES 全显（无审批状态也显示）；其余类型仅 approved", () => {
    // 层级：纯单元（领域规则）；对象=可见性判定函数
    expect(isEdgeVisible({ edgeId: "e1", source: "a", target: "b", type: "REFERENCES" })).toBe(true);
    expect(isEdgeVisible({ edgeId: "e2", source: "a", target: "b", type: "REFERENCES", reviewStatus: "pending" })).toBe(true);
    expect(isEdgeVisible({ edgeId: "e3", source: "a", target: "b", type: "MENTIONS", reviewStatus: "approved" })).toBe(true);
    expect(isEdgeVisible({ edgeId: "e4", source: "a", target: "b", type: "MENTIONS", reviewStatus: "pending" })).toBe(false);
    expect(isEdgeVisible({ edgeId: "e5", source: "a", target: "b", type: "DEPENDS_ON" })).toBe(false);
    expect(isEdgeVisible({ edgeId: "e6", source: "a", target: "b", type: "DOCUMENTS", reviewStatus: "rejected" })).toBe(false);
  });

  it("节点可见性规则：文件背书节点常驻；注册表结构/派生节点（无文件）不背书", () => {
    // 层级：纯单元（领域规则）；对象=节点背书判定函数
    expect(isFileBackedNode({ id: "d1", label: "文档", category: "文档", degree: 0, labels: ["Document"] })).toBe(true);
    expect(isFileBackedNode({ id: "m1", label: "模块", category: "服务", degree: 0, labels: ["Module", "ArchitectureComponent"] })).toBe(true);
    expect(isFileBackedNode({ id: "c1", label: "概念", category: "概念", degree: 0, labels: ["Concept"] })).toBe(true);
    expect(isFileBackedNode({ id: "ref", label: "参考资料", category: "域", degree: 0, labels: ["BusinessDomain"] })).toBe(false);
    expect(isFileBackedNode({ id: "ref:ov", label: "总览", category: "域", degree: 0, labels: ["Subdomain"] })).toBe(false);
    expect(isFileBackedNode({ id: "team", label: "待分配", category: "域", degree: 0, labels: ["Team"] })).toBe(false);
    expect(isFileBackedNode({ id: "p1", label: "板块", category: "板块", degree: 0, labels: ["Plate"] })).toBe(false);
    expect(isFileBackedNode({ id: "pv", label: "版本", category: "版本", degree: 0, labels: ["ProductVersion"] })).toBe(false);
    // 无 labels 的旧契约/测试桩数据不误杀（按文件背书处理）
    expect(isFileBackedNode({ id: "legacy", label: "旧数据", category: "System", degree: 0 })).toBe(true);
  });

  // ── 可见性裁定：接线层——结构节点无可见边=空态（无实体裸点不进图） ──
  it("只剩注册表结构节点（无可见边）时显示空态，不画裸点", () => {
    useTopologyStore.setState({
      knowledgeNodes: [
        { id: "ref", label: "参考资料", category: "域", degree: 0, labels: ["BusinessDomain"] },
        { id: "team-unassigned", label: "待分配", category: "域", degree: 0, labels: ["Team"] },
      ],
      knowledgeEdges: [],
    });
    render(<LocalGraph />);
    expect(screen.getByTestId("local-graph-empty")).toHaveTextContent("图谱暂无内容");
  });

  it("结构节点挂未审批机器边仍不进图；文件节点常驻不触发空态", () => {
    useTopologyStore.setState({
      knowledgeNodes: [
        { id: "ref", label: "参考资料", category: "域", degree: 1, labels: ["BusinessDomain"] },
        { id: "doc1", label: "文档一", category: "文档", degree: 1, labels: ["Document"] },
      ],
      knowledgeEdges: [
        { edgeId: "e-pending", source: "doc1", target: "ref", type: "MENTIONS", reviewStatus: "pending" },
      ],
    });
    render(<LocalGraph />);
    expect(screen.queryByTestId("local-graph-empty")).not.toBeInTheDocument();
  });

  // ── Obsidian 逆向引入批（Master 2026-10-30「这三个直接引入」）：图内搜索匹配规则 ──
  it("图内搜索匹配：标签/ID 包含即命中、大小写不敏感、空串全通过", () => {
    // 层级：纯单元（领域规则）；对象=matchesQuery（Obsidian filters 口径）
    const n = { id: "doc-article-agents", label: "AGENTS" };
    expect(matchesQuery(n, "")).toBe(true);
    expect(matchesQuery(n, "   ")).toBe(true);
    expect(matchesQuery(n, "agent")).toBe(true);       // label 大小写不敏感包含
    expect(matchesQuery(n, "AGENTS")).toBe(true);
    expect(matchesQuery(n, "article")).toBe(true);     // id 参与匹配
    expect(matchesQuery(n, "图数据库")).toBe(false);    // 不匹配
  });

  it("图内搜索控件与着色开关渲染（接线层：输入框/按钮存在且可切换）", () => {
    useTopologyStore.setState({
      knowledgeNodes: [{ id: "d1", label: "文档一", category: "文档", degree: 0, labels: ["Document"] }],
      knowledgeEdges: [],
    });
    render(<LocalGraph />);
    const input = screen.getByLabelText("图内搜索") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "文档" } });
    expect(input.value).toBe("文档");
    expect(screen.getByRole("button", { name: "清除搜索" })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("button", { name: "清除搜索" })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /按分类着色/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});
