import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelationLibraryTab } from "@/features/data-dashboard/components/relation-library-tab";

// F6（#1416）：关系检索页两个呈现诚实度缺口——
// a) 空态不区分「实体不存在」vs「实体存在但无关系」（用户搜存在的实体得到「无匹配结果」被误导）
// b) 筛选器「全部」态显示裸占位词（「来源分组」），看起来像已选具体筛选（与全仓「全部X」惯例不一致）
const topo = vi.hoisted(() => ({ useKnowledgeEdges: vi.fn(), useKnowledgeNodes: vi.fn() }));
vi.mock("@/lib/topology-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/topology-store")>()),
  useKnowledgeEdges: topo.useKnowledgeEdges,
  useKnowledgeNodes: topo.useKnowledgeNodes,
}));

const NODE = { id: "anyrobot-embedded", label: "AnyRobot Embedded" };
const EDGE = {
  source: "anyrobot-embedded", target: "fixture-node", type: "depends_on", reviewStatus: "approved",
  properties: { source: "manual" },
};

function mount(edges: unknown[], nodes: unknown[]) {
  topo.useKnowledgeEdges.mockReturnValue(edges);
  topo.useKnowledgeNodes.mockReturnValue(nodes);
  return render(<RelationLibraryTab />);
}

describe("RelationLibraryTab · 空态归因（F6a）+ 筛选全部态标签（F6b）", () => {
  beforeEach(() => {
    topo.useKnowledgeEdges.mockReset();
    topo.useKnowledgeNodes.mockReset();
    window.location.hash = ""; // W1·N1：表格 URL 状态跨用例隔离（T01 挂载会恢复 hash 查询段）
  });

  it("T1 搜索词命中已知实体但全库无边：提示「实体存在但无关系」，不再裸「无匹配结果」", async () => {
    mount([], [NODE]);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索关系" }), { target: { value: "AnyRobot" } });
    fireEvent.click(screen.getByRole("button", { name: "执行查询" }));
    await waitFor(() => {
      const cell = [...document.querySelectorAll("td")].find((td) => (td.textContent || "").includes("已存在，但当前没有任何关系边"));
      expect(cell, "应出现「实体已存在但无关系」空态").toBeTruthy();
    });
    expect(screen.queryByText("无匹配结果")).not.toBeInTheDocument();
  });

  it("T2 全库零边且无搜索：空态说明「还没有任何关系边」并给创建指引，不是「无匹配结果」", () => {
    mount([], [NODE]);
    expect(screen.getByText(/还没有任何关系边/)).toBeInTheDocument();
    expect(screen.queryByText("无匹配结果")).not.toBeInTheDocument();
  });

  it("T3 守卫：有边但搜索不命中：保持「无匹配结果」（真无匹配语义不变）", async () => {
    mount([EDGE as never], [NODE, { id: "fixture-node", label: "Fixture Node" }]);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索关系" }), { target: { value: "不存在的词" } });
    fireEvent.click(screen.getByRole("button", { name: "执行查询" }));
    await waitFor(() => expect(screen.getByText("无匹配结果")).toBeInTheDocument());
  });

  it("T4 筛选器「全部」态显示「全部」前缀标签（对齐全仓惯例），不再伪装成已选筛选", () => {
    mount([EDGE as never], [NODE]);
    expect(screen.getByRole("button", { name: "筛选来源分组" }).textContent).toContain("全部分组");
    expect(screen.getByRole("button", { name: "筛选来源说明" }).textContent).toContain("全部来源");
    expect(screen.getByRole("button", { name: "筛选审核状态" }).textContent).toContain("全部状态");
  });

  it("T5 守卫：搜索过滤仍正常（回归保护）", async () => {
    mount([EDGE as never], [NODE, { id: "fixture-node", label: "Fixture Node" }]);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索关系" }), { target: { value: "AnyRobot" } });
    fireEvent.click(screen.getByRole("button", { name: "执行查询" }));
    await waitFor(() => expect(screen.getByText(/1 \/ 1 条/)).toBeInTheDocument());
  });
});
