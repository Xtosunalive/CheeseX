import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ArchProjMobile from "@/components/architecture-projection/ArchitectureProjectionMobile";
import { buildProjectionModel } from "@/components/architecture-projection/architecture-projection-model";

describe("ArchitectureProjectionMobile", () => {
  it("opens evidence and highlights its topology ids from a diagnostic card", () => {
    const model = buildProjectionModel(
      { seedCount: 2, seedComponentIds: ["api", "order"], unresolvedPairs: [{ nodeA: "api", nodeB: "order" }] },
      { nodes: [{ id: "api", label: "API" }, { id: "order", label: "Order" }], edges: [] },
      { showGaps: true },
    );
    const onEvidence = vi.fn();
    const onHighlight = vi.fn();
    render(<ArchProjMobile model={model} selectedEvidence={null} onEvidence={onEvidence} onHighlight={onHighlight} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /api.*order.*unresolved/i }));
    expect(onEvidence).toHaveBeenCalledWith(expect.stringMatching(/^unresolved_pair:/));
    expect(Array.from(onHighlight.mock.calls[0][0] as Set<string>)).toEqual(["api", "order"]);
  });

  it("shows the neutral empty state instead of success when there are no seeds", () => {
    const model = buildProjectionModel({ seedCount: 0, seedComponentIds: [] }, { nodes: [], edges: [] });
    render(<ArchProjMobile model={model} selectedEvidence={null} onEvidence={vi.fn()} onHighlight={vi.fn()} onClear={vi.fn()} />);
    // WP-146 裁决2：写在图表数据文件里的空态节点标签不上屏；节点本体（empty 卡片）照常渲染
    expect(screen.queryByText(/暂无已准入实体/)).toBeNull();
    expect(screen.getByText("empty")).toBeDefined();
    expect(screen.queryByText("✓ 投影完整")).toBeNull();
  });

  it("does not label the normal seed-existence decision as a diagnostic branch", () => {
    const model = buildProjectionModel({ seedCount: 1, seedComponentIds: ["api"] }, { nodes: [{ id: "api", label: "API" }], edges: [] });
    render(<ArchProjMobile model={model} selectedEvidence={null} onEvidence={vi.fn()} onHighlight={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByText(/诊断分支/)).toBeNull();
    expect(screen.getByText("✓ 投影完整")).toBeDefined();
  });
});
