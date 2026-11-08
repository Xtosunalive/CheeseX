import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnomalyActionPreview, AnomalyResolutionForm, DerivedGraphRepairPanel } from "@/features/anomaly-workbench/components";
import { AnomalyWorkbenchView } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

function contaminationIssue(overrides: Partial<AnomalyIssue> = {}): AnomalyIssue {
  return {
    issueId: "derived-graph-unapproved-articles",
    issueKind: "missing_lineage",
    handling: "fix",
    title: "正式图仍包含 2 个未准入文章节点",
    status: "open",
    evidence: [
      { kind: "derived-graph-diagnostic", path: ".ledger/master_graph.json", coordinate: "node:doc-token", articleId: "token" },
      { kind: "derived-graph-diagnostic", path: ".ledger/master_graph.json", coordinate: "node:doc-mysql", articleId: "mysql" },
    ],
    expectedRevisions: { graphHash: "sha256:formal" },
    blockedActions: [],
    proposedAction: { type: "derived-graph-repair" },
    executionReady: true,
    ...overrides,
  };
}

function lineageIssues(count: number): AnomalyIssue[] {
  return Array.from({ length: count }, (_, index): AnomalyIssue => ({
    issueId: `lineage-${index}`,
    issueKind: "missing_lineage",
    handling: "fix",
    title: `内部关系-${index}`,
    status: "open",
    evidence: [{ kind: "derived-graph-diagnostic", path: ".ledger/master_graph.json", coordinate: `relation:internal-${index}` }],
    expectedRevisions: { graphHash: "sha256:formal" },
    blockedActions: [],
    proposedAction: { type: "derived-graph-repair" },
  }));
}

describe("derived graph repair task", () => {
  afterEach(() => {
    window.location.hash = "";
    vi.unstubAllGlobals();
  });

  it("summarizes graph diagnostics and hands off to the approval workbench", () => {
    render(<DerivedGraphRepairPanel issues={[contaminationIssue(), ...lineageIssues(74)]} />);

    expect(screen.getByRole("region", { name: "派生图来源修复" })).toHaveTextContent("派生图需要来源修复");
    expect(screen.getByText("误入派生图的文章节点").parentElement).toHaveTextContent("2");
    // 2026-10-08 裁决 3：主 fixture 改 missing_lineage 后计入关系计数（74 批量 + 1 主 = 75）
    expect(screen.getByText("缺少可信来源链的关系").parentElement).toHaveTextContent("75");
    expect(screen.getByText("修正 owner 来源")).toBeInTheDocument();
    expect(screen.queryByText(/创建修复批次|开始暂存计算|确认发布图谱/)).not.toBeInTheDocument();
    expect(screen.queryByText(/内部关系-/)).not.toBeInTheDocument();
    expect(screen.queryByText(".ledger/master_graph.json")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开审批与发布" }));
    expect(window.location.hash).toBe("#/article-workflow");
  });

  it("never renders the retired confirmation action even for historical previews", () => {
    const onOperate = vi.fn();
    const issue = contaminationIssue({
      status: "previewed",
      previewId: "repair-preview-1",
      actionPreview: { accepted: true, adapter: "derived-graph-repair", summary: { unapprovedNodeCount: 2, missingLineageCount: 74 } },
    });
    render(<><AnomalyActionPreview issue={issue} /><AnomalyResolutionForm issue={issue} onPreview={onOperate} /></>);

    expect(screen.queryByRole("button", { name: /创建正式图修复批次|确认这次处理/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开审批与发布" }));
    expect(window.location.hash).toBe("#/article-workflow");
    expect(onOperate).not.toHaveBeenCalled();
  });

  it("ignores a historical batch id and still routes to the approval workbench", () => {
    const issue = contaminationIssue({ status: "confirmed", executionResult: { accepted: true, adapter: "derived-graph-repair", result: { batchId: "repair-1" } } });
    render(<DerivedGraphRepairPanel issues={[issue]} />);

    fireEvent.click(screen.getByRole("button", { name: "打开审批与发布" }));
    expect(window.location.hash).toBe("#/article-workflow");
  });

  it("does not call the legacy preview or confirm operations from the workbench", async () => {
    const issue = contaminationIssue({
      status: "previewed",
      previewId: "repair-preview-1",
      actionPreview: { accepted: true, adapter: "derived-graph-repair", summary: { unapprovedNodeCount: 2, missingLineageCount: 74 } },
    });
    const issues = [issue, ...lineageIssues(2)];
    useAnomalyWorkbenchStore.setState({ issues, selectedIssueId: null, status: "success", error: null, refreshing: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { generatedAt: "2026-07-24T00:00:00.000Z", issues, total: issues.length } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AnomalyWorkbenchView />);

    fireEvent.click(await screen.findByRole("button", { name: "打开审批与发布" }));
    expect(window.location.hash).toBe("#/article-workflow");
    expect(fetchMock.mock.calls.some(([url]) => /\/preview|\/confirm/.test(String(url)))).toBe(false);
    expect(screen.queryByRole("region", { name: "处理步骤" })).not.toBeInTheDocument();
  });
});
