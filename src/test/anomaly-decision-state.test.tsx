import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyPeekPanel, AnomalyResolutionForm } from "@/features/anomaly-workbench/components";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const issue: AnomalyIssue = {
  issueId: "entity-check-1",
  issueKind: "unrecognized_entity",
  handling: "fix",
  title: "3 个目标无法解析",
  status: "previewed",
  evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/example.md", lineNumber: null, ruleId: "B02" }],
  expectedRevisions: { sourceRevision: "sha256:source", ruleRevision: "B02" },
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/example.md", field: "arch_subdomain" },
  previewId: "preview-1",
  executionReady: true,
};

describe("anomaly decision state", () => {
  // 「makes an unavailable write action visibly non-actionable」随 AnomalyDecisionPanel 退役（其状态展示块已死；确认门禁与 RPF 动作的活覆盖见下）

  // 「waits for global diagnosis instead of exposing per-item verification」随 AnomalyDecisionPanel 退役（其状态展示块已死；确认门禁与 RPF 动作的活覆盖见下）

  // 「explains when a previous resolution was superseded」随 AnomalyDecisionPanel 退役（其状态展示块已死；确认门禁与 RPF 动作的活覆盖见下）

  it("allows a stale issue to generate a new preview from current evidence", () => {
    const onOperate = vi.fn();
    const staleIssue = { ...issue, status: "stale", proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/example.md", unresolvedTargets: ["ghost"], relationTargetOptions: [{ id: "auth", label: "认证服务" }] } } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={staleIssue} onPreview={onOperate} />);
    fireEvent.change(screen.getByRole("combobox", { name: "需要修正的旧链接" }), { target: { value: "ghost" } });
    fireEvent.change(screen.getByRole("combobox", { name: "替换为已有实体" }), { target: { value: "auth" } });
    fireEvent.click(screen.getByRole("button", { name: "预览替换为实体" }));
    expect(onOperate).toHaveBeenCalledWith({ relationPatch: { operation: "retarget", originalTarget: "ghost", targetId: "auth" } });
  });

  it("persistent issue (release_publication_failure) open → 显式关闭并可操作（宿主 PeekPanel footer）", () => {
    const onOperate = vi.fn();
    const persistent = { ...issue, issueId: "release-fail-1", issueKind: "release_publication_failure", status: "open", proposedAction: null, evidence: [], expectedRevisions: {} } as AnomalyIssue;
    render(<AnomalyPeekPanel issue={persistent} open onClose={() => {}} onOperate={onOperate} />);
    const closeBtn = screen.getByRole("button", { name: "显式关闭" });
    fireEvent.click(closeBtn);
    expect(onOperate).toHaveBeenCalledWith("close", {});
  });

  it("persistent issue closed → 重开并可操作（宿主 PeekPanel footer）", () => {
    const onOperate = vi.fn();
    const persistent = { ...issue, issueId: "release-fail-1", issueKind: "release_publication_failure", status: "closed", proposedAction: null, evidence: [], expectedRevisions: {} } as AnomalyIssue;
    render(<AnomalyPeekPanel issue={persistent} open onClose={() => {}} onOperate={onOperate} />);
    const reopenBtn = screen.getByRole("button", { name: "重开" });
    fireEvent.click(reopenBtn);
    expect(onOperate).toHaveBeenCalledWith("reopen", {});
  });

  it("does not present a completed inactive decision as a new required action", () => {
    render(<AnomalyPeekPanel open onClose={() => {}} onOperate={vi.fn()} issue={{ ...issue, status: "verified", sourceActive: false, previousResolution: { status: "verified", actionPreview: null, executionResult: null, verificationResult: { verified: true }, expectedRevisions: {}, reason: "已复核问题被来源检查器重新检出", supersededAt: "2026-07-20T00:00:00.000Z" } }} />);

    expect(screen.queryByText(/上一轮处理已失效/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前状态：|当前不需要继续操作/)).not.toBeInTheDocument();
  });
});
