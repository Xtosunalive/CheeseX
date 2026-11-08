// EntityDetailPanel 单测——三上下文 + 数据诚实度（有则展、无则「未记录」）
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityDetailPanel, type HubSelection } from "@/features/data-dashboard/EntityDetailPanel";
import type { TopoEdge, TopoNode } from "@/lib/topology-types";

const nodes: TopoNode[] = [
  { id: "gateway", label: "网关", category: "终端", degree: 2 },
  { id: "pay-svc", label: "支付服务", category: "服务", degree: 2 },
  { id: "mysql", label: "主数据库", category: "存储", degree: 1 },
];
const edges: TopoEdge[] = [
  {
    edgeId: "e1", source: "gateway", target: "pay-svc", type: "USES",
    sourceFile: "知识库/wiki/entities/gateway.md", lineNumber: 42, reviewStatus: "approved",
    properties: { ruleId: "rel-uses", ruleRevision: "a1b2c3", confidence: 0.91 },
  },
  {
    edgeId: "e2", source: "pay-svc", target: "mysql", type: "DEPENDS_ON",
    sourceFile: "知识库/wiki/entities/pay-svc.md", lineNumber: 7, reviewStatus: "pending",
  },
];

function setup(selection: HubSelection | null) {
  const onSelect = vi.fn();
  render(<EntityDetailPanel selection={selection} nodes={nodes} edges={edges} onSelect={onSelect} />);
  return { onSelect };
}

describe("EntityDetailPanel · 节点详情", () => {
  it("三上下文齐全：是什么/从哪来/连到哪，sourceFile:line 真实展示", () => {
    setup({ kind: "node", nodeId: "gateway" });
    for (const ctx of ["是什么", "从哪来", "连到哪"]) expect(screen.getByText(ctx)).toBeInTheDocument();
    expect(screen.getByText("网关")).toBeInTheDocument();
    expect(screen.getByText("终端")).toBeInTheDocument();
    expect(screen.getByText("gateway.md:42")).toBeInTheDocument();
    expect(screen.getByText(/1 条关系/)).toBeInTheDocument();
  });

  it("点「连到哪」关系行 → onSelect 切到边详情", () => {
    const { onSelect } = setup({ kind: "node", nodeId: "mysql" });
    const row = screen.getAllByRole("button", { name: /依赖/ }).find((b) => b.textContent?.includes("支付服务"));
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "edge", edgeId: "e2" });
  });
});

describe("EntityDetailPanel · 边详情（数据诚实度）", () => {
  it("有 provenance 展真值：ruleId@revision + 置信度", () => {
    setup({ kind: "edge", edgeId: "e1" });
    expect(screen.getByText("rel-uses@a1b2c3")).toBeInTheDocument();
    expect(screen.getByText("0.91")).toBeInTheDocument();
    expect(screen.getByText("gateway.md:42")).toBeInTheDocument();
    expect(screen.getByText("已通过")).toBeInTheDocument();
  });

  it("无 provenance 标「未记录」+ 两个可点实体行", () => {
    const { onSelect } = setup({ kind: "edge", edgeId: "e2" });
    expect(screen.getAllByText(/未记录/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/rel-uses/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /看源实体/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "node", nodeId: "pay-svc" });
    fireEvent.click(screen.getByRole("button", { name: /看目标实体/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "node", nodeId: "mysql" });
  });
});

describe("EntityDetailPanel · 空态", () => {
  it("未选中时显示引导空态", () => {
    setup(null);
    expect(screen.getByText(/点击左侧的节点或关系/)).toBeInTheDocument();
  });
});
