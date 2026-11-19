// local-graph-incremental.test.tsx — LocalGraph 常驻实例回归钉（2026-11-20「一大一小跳变」收口批）。
// 断言对象：数据变化时图实例不销毁重建（跳变根因＝整图销毁重建——Master「为什么自己造轮子」），
// 增量数据操作直接落在同一实例上；空数据态销毁实例、数据回归时允许重新首建。
// 层级：组件级单测（G6 经 setup.ts 数据记忆桩——画布渲染由冒烟/e2e 层覆盖）。
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// GraphStub 经 setup.ts 注入；此处引入静态计数面做实例断言
import { Graph } from "@antv/g6";
const GraphStub = Graph as unknown as typeof Graph & {
  created: number;
  instances: Array<{
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    destroyed: boolean;
  }>;
  reset: () => void;
};

const docNode = (id: string, label: string) =>
  ({ id, label, category: "文档", degree: 0, labels: ["Document"], properties: {} });
const refEdge = (id: string, source: string, target: string) =>
  ({ edgeId: id, source, target, type: "REFERENCES", reviewStatus: "approved" });

const BASE_NODES = [docNode("doc-1", "文档一"), docNode("doc-2", "文档二")];
const BASE_EDGES = [refEdge("edge-1", "doc-1", "doc-2")];

const mockStoreState: Record<string, unknown> = {};
vi.mock("@/lib/topology-store", () => ({
  useTopologyStore: { setState: (patch: Record<string, unknown>) => { Object.assign(mockStoreState, patch); } },
  useKnowledgeNodes: () => (mockStoreState.knowledgeNodes as typeof BASE_NODES) ?? BASE_NODES,
  useKnowledgeEdges: () => (mockStoreState.knowledgeEdges as typeof BASE_EDGES) ?? BASE_EDGES,
  useTopologyLoading: () => false,
  useTopologyStats: () => null,
  useAdmittedNodes: () => [],
  useAdmittedEdges: () => [],
  useTopologyError: () => null,
  useTopologyErrorCode: () => null,
  useTopologyScope: () => "full",
  useSetTopologyScope: () => vi.fn(),
  useLoadTopology: () => vi.fn(),
  useUnresolvedGapCount: () => 0,
  useGapItems: () => [],
  useActiveEntityId: () => null,
}));

import { LocalGraph } from "@/features/data-dashboard/components/local-graph/LocalGraph";

beforeEach(() => {
  GraphStub.reset();
  delete mockStoreState.knowledgeNodes;
  delete mockStoreState.knowledgeEdges;
});
afterEach(cleanup);

describe("LocalGraph 常驻实例（Obsidian 式增量同步）", () => {
  it("数据变化不新建实例：增删节点落同一实例（跳变根因回归钉）", async () => {
    const view = render(<LocalGraph />);
    await waitFor(() => expect(GraphStub.created).toBe(1));
    const inst = GraphStub.instances[0];
    await waitFor(() => expect(inst.nodes.length).toBe(2));
    expect(inst.edges.length).toBe(1);

    // 真实数据变化：新文档准入入图（新节点＋新边）——增量落同一实例
    mockStoreState.knowledgeNodes = [...BASE_NODES, docNode("doc-3", "文档三")];
    mockStoreState.knowledgeEdges = [...BASE_EDGES, refEdge("edge-2", "doc-1", "doc-3")];
    view.rerender(<LocalGraph />);
    await waitFor(() => expect(inst.nodes.length).toBe(3));
    expect(inst.edges.length).toBe(2);
    expect(GraphStub.created).toBe(1); // 常驻——不再整图销毁重建

    // 节点下架：同实例缩减
    mockStoreState.knowledgeNodes = BASE_NODES;
    mockStoreState.knowledgeEdges = BASE_EDGES;
    view.rerender(<LocalGraph />);
    await waitFor(() => expect(inst.nodes.length).toBe(2));
    expect(inst.edges.length).toBe(1);
    expect(GraphStub.created).toBe(1);
  });

  it("数据清空销毁实例（空态接管），数据回归重新首建", async () => {
    const view = render(<LocalGraph />);
    await waitFor(() => expect(GraphStub.created).toBe(1));
    const first = GraphStub.instances[0];
    await waitFor(() => expect(first.nodes.length).toBe(2));

    mockStoreState.knowledgeNodes = [];
    mockStoreState.knowledgeEdges = [];
    view.rerender(<LocalGraph />);
    await waitFor(() => expect(first.destroyed).toBe(true));

    mockStoreState.knowledgeNodes = BASE_NODES;
    mockStoreState.knowledgeEdges = BASE_EDGES;
    view.rerender(<LocalGraph />);
    await waitFor(() => expect(GraphStub.created).toBe(2));
    const second = GraphStub.instances[1];
    await waitFor(() => expect(second.nodes.length).toBe(2));
    expect(second.destroyed).toBe(false);
  });

  it("卸载销毁实例（生命周期单点：数据变化路径不触碰销毁）", async () => {
    const view = render(<LocalGraph />);
    await waitFor(() => expect(GraphStub.created).toBe(1));
    const inst = GraphStub.instances[0];
    await waitFor(() => expect(inst.nodes.length).toBe(2));
    view.unmount();
    await waitFor(() => expect(inst.destroyed).toBe(true));
    expect(GraphStub.created).toBe(1);
  });
});
