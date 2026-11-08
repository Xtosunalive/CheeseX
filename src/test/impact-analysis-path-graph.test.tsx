import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ImpactPathGraph } from "@/features/impact-analysis/components/ImpactPathGraph";
import type { ImpactAnalysisResult } from "@/features/impact-analysis/impact-analysis-types";
import { useTopologyStore } from "@/lib/topology-store";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";

const result: ImpactAnalysisResult = { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), downstream: { byHop: [{ hop: 1, nodes: [{ nodeId: "b", label: "组件 B", hop: 1, risk: "LOW", paths: [{ nodeIds: ["a", "b"], edges: [{ source: "a", target: "b", type: "DEPENDS_ON", confidence: 0.8, reviewStatus: "approved", sourceFile: "", lineNumber: null }], confidence: 0.8 }] }] }], terminalNodeIds: ["b"], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], meta: { totalNodesAffected: 1, maxDepth: 1, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] } };
describe("ImpactPathGraph", () => {
  beforeEach(() => { useTopologyStore.setState({ activeEntityId: null, admittedNodes: [{ id: "a", label: "组件 A", category: "服务", degree: 1 }, { id: "b", label: "组件 B", category: "服务", degree: 1 }] }); useHubDrawerState.setState({ open: false }); });
  it("renders path order and opens the entity panorama", () => { render(<ImpactPathGraph result={result} />); expect(screen.getByText("依赖")).toBeInTheDocument(); expect(screen.queryByText("DEPENDS_ON")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "组件 B" })); expect(useTopologyStore.getState().activeEntityId).toBe("b"); expect(useHubDrawerState.getState().open).toBe(true); });

  // WP-134 波1 直读收口：受累组件数只有服务端遍历口径一个数（impact-analysis-service.cjs:222）。
  // 夹具故意让 meta 与 path.nodeIds 并集不等（9 vs 2）——旧逻辑从路径重建集合数出 2，本例即红。
  it("受累组件数取契约 meta.totalNodesAffected，不再从 path.nodeIds 重建第二个集合来数", () => {
    render(<ImpactPathGraph result={{ ...result, meta: { ...result.meta, totalNodesAffected: 9 } }} />);
    const header = screen.getByText(/个架构组件/);
    expect(header.textContent).toContain("9 个架构组件");
    expect(header.textContent).not.toContain("2 个架构组件");
  });

  it("绘制上限闸门同取契约口径：契约报 501 即停绘（本页路径只含 2 个节点也不画）", () => {
    render(<ImpactPathGraph result={{ ...result, meta: { ...result.meta, totalNodesAffected: 501 } }} />);
    expect(screen.getByText(/超过 500 个/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "组件 B" })).toBeNull();
  });
});
