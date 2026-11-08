import { fireEvent, render, screen } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImpactAnalysisPanel } from "@/features/impact-analysis/components";
import { useTopologyStore } from "@/lib/topology-store";

const actions = { setSeedNodeIds: vi.fn(), setMaxHops: vi.fn(), setDirection: vi.fn(), setMinConfidence: vi.fn(), setVersionScope: vi.fn(), setEnableInference: vi.fn(), setMaxInferenceDepth: vi.fn(), toggleHop: vi.fn(), analyze: vi.fn() };
let state: Record<string, unknown>;
vi.mock("@/features/impact-analysis/impact-analysis-store", () => ({ useImpactAnalysisStore: () => ({ ...state, ...actions }) }));

function lineage(status: "fresh" | "stale") {
  return {
    source: { kind: "vault-document", path: "知识库/wiki/entities/gateway.md", contentHash: `sha256:${"a".repeat(64)}`, lineNumber: 12, coordinate: "relation:edge-a-b" },
    rule: { ruleId: "typed-wikilink.dependency-rule", ruleRevision: "runtime:v2", reasonCode: "SOURCE_RELATION_WITH_VERSION_RULE" },
    scope: { product: "AnyShare", version: "7.0.6.8" },
    decision: { decisionId: "decision-1", operatorId: "local-architect", kind: "automatic", decidedAt: "2026-07-19T00:00:00.000Z" },
    freshness: { status, checkedAt: "2026-07-19T00:00:00.000Z", changedFields: status === "stale" ? ["sourceRevision"] : [] },
  };
}

describe("ImpactAnalysisPanel", () => {
  beforeEach(() => { vi.clearAllMocks(); useTopologyStore.setState({ admittedNodes: [{ id: "a", label: "组件 A", category: "服务", degree: 1 }, { id: "b", label: "组件 B", category: "服务", degree: 1 }] }); state = { seedNodeIds: [], maxHops: 2, direction: "downstream", minConfidence: 0.5, enableInference: false, maxInferenceDepth: 3, versions: [], product: "", version: "", scope: { status: "idle", error: null }, result: null, status: "idle", error: null, expandedHops: { "downstream-1": true } }; });
  it("renders controls and keeps analyze disabled without a seed", () => { render(<ImpactAnalysisPanel />); expect(screen.getByLabelText("分析起点实体")).toBeInTheDocument(); expect(screen.getByText("查看影响结果")).toBeDisabled(); });
  it("renders hop results, source evidence and stale analysis status", () => {
    const edge = { edgeId: "edge-a-b", source: "a", target: "b", type: "DEPENDS_ON", confidence: 0.8, reviewStatus: "approved", sourceFile: "知识库/wiki/entities/gateway.md", sourceHash: `sha256:${"a".repeat(64)}`, lineNumber: 12, evidenceHash: "evidence-1", since: "7.0.6.7", until: "7.0.6.9", lineage: lineage("fresh") };
    state = { ...state, seedNodeIds: ["a"], enableInference: true, result: { downstream: { byHop: [{ hop: 1, nodes: [{ nodeId: "b", label: "B", hop: 1, risk: "LOW", paths: [{ nodeIds: ["a", "b"], edges: [edge], confidence: 0.8 }] }] }], terminalNodeIds: ["b"], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], meta: { totalNodesAffected: 1, maxDepth: 1, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] }, lineage: lineage("stale"), reasoning: { sourceRevision: "sha256:reasoning", candidates: [], conflicts: [{ conflictId: "conflict-1", subjectNodeId: "a", conclusionKey: "architecture-change-disposition", status: "unresolved", sourceRevision: "sha256:reasoning" }], results: [], status: "conflicted", writeAllowed: false } } };

    render(<ImpactAnalysisPanel />);
    expect(screen.getByText("来源已变化")).toBeInTheDocument();
    expect(screen.getByText("查看关系依据")).toBeInTheDocument();
    expect(screen.getByText("7.0.6.7 起，7.0.6.9 前")).toBeInTheDocument();
    expect(screen.getByText(/来源正文关系/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "变更决策状态" })).toHaveTextContent("候选结论存在冲突");
    expect(screen.getByText("依赖")).toBeInTheDocument();
    expect(screen.queryByText("DEPENDS_ON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/第 1 层影响/));
    expect(actions.toggleHop).toHaveBeenCalled();
  });
  it("加载态：分析进行中按钮显示分析中并禁用", () => {
    state = { ...state, seedNodeIds: ["a"], status: "loading" };
    render(<ImpactAnalysisPanel />);
    const btn = screen.getByText("分析中…");
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });
  it("禁用原因：未选起点时按钮禁用且提示可见", () => {
    render(<ImpactAnalysisPanel />);
    expect(screen.getByText("查看影响结果")).toBeDisabled();
    expect(screen.getByText("未选择架构组件")).toBeInTheDocument();
  });
  it("失败态：后端失败时显示错误与重试", () => {
    state = { ...state, seedNodeIds: ["a"], error: `架构组件${TERM.TASK_IMPACT_ANALYSIS}失败` };
    render(<ImpactAnalysisPanel />);
    expect(screen.getByText(`架构组件${TERM.TASK_IMPACT_ANALYSIS}失败`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
  it("空态：无匹配影响结果时给出下一步引导", () => {
    state = { ...state, seedNodeIds: ["a"], result: { downstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] }, filteredEdges: [], inferredEdges: [], meta: { totalNodesAffected: 0, maxDepth: 0, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] }, lineage: lineage("fresh"), reasoning: { sourceRevision: "sha256:x", candidates: [], conflicts: [], results: [], status: "clear", writeAllowed: true } } };
    render(<ImpactAnalysisPanel />);
    expect(screen.getByText(/没有匹配的影响结果/)).toBeInTheDocument();
  });
  it("selects an exact registered product version", () => {
    state = { ...state, versions: [{ product: "AnyShare", version: "7.0.6.8", label: "7.0.6.8", status: "released", sourceMode: "snapshot" }], product: "AnyShare", version: "7.0.6.8" };
    render(<ImpactAnalysisPanel />);
    expect(screen.getByLabelText("分析产品版本")).toBeInTheDocument();
  });
});
