// RelationsPanel — 空态且有无关系边时展示知识概念（孤立 Concept）浏览器
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import { RelationsPanel } from "@/features/data-dashboard/components/relations-panel";
import { useTopologyStore } from "@/lib/topology-store";

function seedStore({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) {
  useTopologyStore.setState({
    knowledgeNodes: nodes as never,
    knowledgeEdges: edges as never,
    stats: null,
    status: "idle",
  } as never);
}

describe("RelationsPanel — 无关系边时展示知识概念", () => {
  beforeEach(() => {
    useTopologyStore.setState({
      knowledgeNodes: [],
      knowledgeEdges: [],
      stats: null,
      status: "idle",
      error: null,
    } as never);
  });

  it("edges=0 且有概念节点 → 展示『知识概念』列表（含孤立概念）", () => {
    seedStore({
      nodes: [
        { id: "concept-写入一致性", label: "写入一致性", category: "concept" },
        { id: "concept-单源写入", label: "单源写入", category: "concept" },
      ],
      edges: [],
    });
    render(<RelationsPanel />);
    expect(screen.getByText("知识概念")).toBeInTheDocument();
    expect(screen.getByText("写入一致性")).toBeInTheDocument();
    expect(screen.getByText("单源写入")).toBeInTheDocument();
  });

  it("edges=0 且无节点 → 展示『暂无知识节点』空态", () => {
    seedStore({ nodes: [], edges: [] });
    render(<RelationsPanel />);
    expect(screen.getByText("暂无知识节点")).toBeInTheDocument();
  });

  it("有边时不受影响（保留关系总览）", () => {
    seedStore({
      nodes: [{ id: "n1", label: "N1", category: "x" }, { id: "n2", label: "N2", category: "y" }],
      edges: [{ source: "n1", target: "n2", type: "DEPENDS_ON" }],
    });
    render(<RelationsPanel />);
    expect(screen.getByText("关系总览")).toBeInTheDocument();
    expect(screen.getAllByText("N1").length).toBeGreaterThan(0); // 关系节点出现在总览
    expect(screen.queryByText("知识概念")).not.toBeInTheDocument(); // 有边时不进概念列表
  });
});
