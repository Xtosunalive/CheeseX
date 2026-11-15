import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EdgeReviewPanel } from "@/features/review/EdgeReviewPanel";

/** PR-309/WP-178：批准钮在边有 open blocker 时不可点（阻断原因已由 PR-045 块内联可见），不再只靠 title＋写门 409 兜底。 */
const edgeBase = {
  edgeId: "api|db|DEPENDS_ON|||",
  source: "api",
  sourceLabel: "API",
  target: "db",
  targetLabel: "DB",
  type: "DEPENDS_ON",
  reviewStatus: "pending",
} as const;

function stubPendingReview(edge: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ success: true, data: { edges: [edge], workingRevision: `sha256:${"0".repeat(64)}` } }),
  }));
}

describe("PR-309 关系审核批准钮阻断门控", () => {
  it("blockers 非空：批准钮 disabled（阻断原因内联块在场）", async () => {
    stubPendingReview({
      ...edgeBase,
      blockers: [{ issueId: "iss-1", issueKind: "missing_entity", entityId: "db" }],
    });
    render(<EdgeReviewPanel />);
    const approve = await screen.findByRole("button", { name: /批准/ });
    expect(approve).toBeDisabled();
    expect(screen.getByLabelText(/阻断/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("blockers 空：批准钮可点（合法态维持原口径）", async () => {
    stubPendingReview({ ...edgeBase, blockers: [] });
    render(<EdgeReviewPanel />);
    const approve = await screen.findByRole("button", { name: /批准/ });
    expect(approve).toBeEnabled();
    vi.unstubAllGlobals();
  });
});
