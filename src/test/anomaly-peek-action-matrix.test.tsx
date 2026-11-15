import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnomalyPeekPanel } from "@/features/anomaly-workbench/components";
import { ANOMALY_PEEK_COPY } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

/**
 * PR-308 / WP-177：状态×动作渲染矩阵（Master 2026-11-15「按钮跟着状态走」口径）。
 * 确认钮只在 confirm 操作合法（previewed）且 previewId 在场且 executionReady≠false 时渲染；
 * 非法态不渲染按钮，改显「下一步」指引；执行未就绪显示阻断说明。
 */
const baseIssue = {
  issueId: "matrix-1",
  issueKind: "missing_field",
  handling: "fix",
  title: "补充架构分层字段",
  status: "open",
  evidence: [],
  expectedRevisions: {},
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/example.md", field: "arch_layer" },
} as unknown as AnomalyIssue;

function renderPeek(issue: AnomalyIssue) {
  return render(<AnomalyPeekPanel issue={issue} open onClose={() => {}} onOperate={() => {}} />);
}

const confirmButton = () => screen.queryByRole("button", { name: ANOMALY_PEEK_COPY.CONFIRM_ACTION });

describe("PR-308 状态×动作渲染矩阵（WP-183 文案清账：指引句删除——表单内预览钮即结构引导）", () => {
  it("open：不渲染确认钮（表单内预览钮=结构引导，无附加指引句）", () => {
    renderPeek(baseIssue);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.queryByText(/下一步/)).not.toBeInTheDocument();
  });

  it("stale：预览合法、确认非法——同 open 口径", () => {
    renderPeek({ ...baseIssue, status: "stale" });
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it("blocked：同 open 口径", () => {
    renderPeek({ ...baseIssue, status: "blocked" });
    expect(confirmButton()).not.toBeInTheDocument();
  });

  it("previewed＋previewId＋executionReady：确认钮在场可点，文案=「确认落盘」（WP-183 清账：去向由状态徽章承载）", () => {
    renderPeek({ ...baseIssue, status: "previewed", previewId: "pv-1", executionReady: true });
    const button = screen.getByRole("button", { name: ANOMALY_PEEK_COPY.CONFIRM_ACTION });
    expect(button).toBeEnabled();
    expect(ANOMALY_PEEK_COPY.CONFIRM_ACTION).toBe("确认落盘");
    expect(button.getAttribute("title")).toBeNull();
  });

  it("previewed 但 executionReady=false：确认钮不渲染，显示最短阻断说明", () => {
    renderPeek({ ...baseIssue, status: "previewed", previewId: "pv-1", executionReady: false });
    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByText("执行未就绪")).toBeInTheDocument();
  });

  it("open 且 executionReady=false：确认钮不渲染（修复入口改道），阻断说明在场", () => {
    renderPeek({ ...baseIssue, executionReady: false });
    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.getByText("执行未就绪")).toBeInTheDocument();
  });

  it("review-only 候选（拒绝专用流）：不出现确认钮也不出现执行阻断说明（能力集≠操作集）", () => {
    const reviewOnly = {
      ...baseIssue,
      status: "previewed",
      previewId: "pv-2",
      executionReady: false,
      relationCandidate: { candidateId: "c1", conflictGroupId: "g1", candidateHash: "h1", evidenceSetHash: "h2", sourceSetHash: "h3", candidateStatus: "pending", triples: [] },
      proposedAction: { type: "relation-candidate-review", sourceKey: "x" },
    } as unknown as AnomalyIssue;
    renderPeek(reviewOnly);
    expect(confirmButton()).not.toBeInTheDocument();
    expect(screen.queryByText(ANOMALY_PEEK_COPY.EXECUTION_NOT_READY_HINT)).not.toBeInTheDocument();
  });

  it("RPF 回归：closed 态重开钮不受矩阵影响", () => {
    renderPeek({ ...baseIssue, issueId: "rpf-1", issueKind: "release_publication_failure", status: "closed", proposedAction: null });
    expect(screen.getByRole("button", { name: ANOMALY_PEEK_COPY.REOPEN_ACTION })).toBeInTheDocument();
  });
});
