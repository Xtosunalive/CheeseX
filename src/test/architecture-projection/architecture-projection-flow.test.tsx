import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="flow-provider">{children}</div>,
    ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, children, nodesConnectable, edgesReconnectable }: { nodes: Array<{ id: string; data: unknown }>; edges: Array<{ id: string }>; onNodeClick: (event: React.MouseEvent, node: unknown) => void; onEdgeClick?: (event: React.MouseEvent, edge: unknown) => void; children: React.ReactNode; nodesConnectable?: boolean; edgesReconnectable?: boolean }) => (
      <div data-testid="react-flow" data-nodes-connectable={String(nodesConnectable)} data-edges-reconnectable={String(edgesReconnectable)}>{nodes.map(node => <button key={node.id} onClick={(event) => onNodeClick(event, node)}>{node.id}</button>)}{(edges || []).map(edge => <span key={edge.id} data-testid={`flow-edge-${edge.id}`} onClick={(event) => onEdgeClick?.(event, edge)}>{edge.id}</span>)}{children}</div>
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

import ArchProjFlow from "@/components/architecture-projection/ArchitectureProjectionFlow";
import { buildProjectionModel } from "@/components/architecture-projection/architecture-projection-model";

describe("ArchitectureProjectionFlow", () => {
  it("provides React Flow context and opens evidence using the node evidence key", async () => {
    const model = buildProjectionModel(
      { seedCount: 2, seedComponentIds: ["api", "order"], implicitPaths: [{ seedA: "api", seedB: "order", path: ["api", "mid", "order"], ambiguous: false }] },
      { nodes: [{ id: "api", label: "API" }, { id: "mid", label: "Middle" }, { id: "order", label: "Order" }], edges: [] },
      { showGaps: true },
    );
    const onHighlight = vi.fn();
    render(<ArchProjFlow model={model} highlightNodeIds={null} onHighlight={onHighlight} onNodeClickEvidence={vi.fn()} />);
    expect(screen.getByTestId("flow-provider")).toBeDefined();
    // seq212：缺口诊断默认藏于叠加层——先开「缺口叠加」再点诊断节点
    fireEvent.click(screen.getByRole("button", { name: /缺口叠加/ }));
    const diagnostic = model.nodes.find(node => node.data.nodeType === "implicit")!;
    fireEvent.click(await screen.findByRole("button", { name: diagnostic.id }));
    await waitFor(() => expect(screen.getByText(/间接关联:/)).toBeDefined());
    expect(Array.from(onHighlight.mock.calls[0][0] as Set<string>)).toEqual([diagnostic.data.sourceNodeId]);
  });

  it("places diagnostic node types into distinct horizontal lanes", async () => {
    const model = buildProjectionModel(
      { seedCount: 3, seedComponentIds: ["a", "b", "ghost"], implicitPaths: [{ seedA: "a", seedB: "b", path: ["a", "b"], ambiguous: false }], unresolvedPairs: [{ nodeA: "a", nodeB: "b" }], missingSeeds: ["ghost"] },
      { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [] },
      { showGaps: true },
    );
    render(<ArchProjFlow model={model} highlightNodeIds={null} onHighlight={vi.fn()} onNodeClickEvidence={vi.fn()} />);
    await screen.findByTestId("react-flow");
    expect(model.meta).toMatchObject({ implicitCount: 1, unresolvedCount: 1, missingCount: 1, isComplete: false });
  });

  it("seq212: emits onSelect for entity nodes and topology edges (hub three-context selection)", async () => {
    const model = buildProjectionModel(
      { seedCount: 1, seedComponentIds: ["api"] },
      {
        nodes: [
          { id: "api", label: "API", category: "服务", degree: 1 },
          { id: "db", label: "DB", category: "存储", degree: 1 },
        ],
        edges: [{ edgeId: "e-uses-1", source: "api", target: "db", type: "USES", reviewStatus: "approved" }],
      },
    );
    const onSelect = vi.fn();
    render(<ArchProjFlow model={model} highlightNodeIds={null} onHighlight={vi.fn()} onNodeClickEvidence={vi.fn()} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button", { name: "proj-entity-api" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "node", nodeId: "api" });
    fireEvent.click(screen.getByTestId("flow-edge-proj-edge-e-uses-1"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "edge", edgeId: "e-uses-1" });
  });

  it("renders the canvas read-only: nodesConnectable and edgesReconnectable are explicitly false (ADR024 §6.3)", async () => {
    const model = buildProjectionModel(
      { seedCount: 1, seedComponentIds: ["api"] },
      { nodes: [{ id: "api", label: "API" }], edges: [] },
    );
    render(<ArchProjFlow model={model} highlightNodeIds={null} onHighlight={vi.fn()} onNodeClickEvidence={vi.fn()} />);
    const flow = await screen.findByTestId("react-flow");
    expect(flow.getAttribute("data-nodes-connectable")).toBe("false");
    expect(flow.getAttribute("data-edges-reconnectable")).toBe("false");
  });

  it("shows the read-only hint (ADR024 §4.1: canvas is a read-only consumption view)", async () => {
    const model = buildProjectionModel(
      { seedCount: 1, seedComponentIds: ["api"] },
      { nodes: [{ id: "api", label: "API" }], edges: [] },
    );
    render(<ArchProjFlow model={model} highlightNodeIds={null} onHighlight={vi.fn()} onNodeClickEvidence={vi.fn()} />);
    const hint = await screen.findByTestId("architecture-projection-readonly-hint");
    expect(hint.textContent).toContain("只读视图");
    expect(hint.textContent).toContain("刷新后重置");
  });
});
