import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnomalyEvidencePanel } from "@/features/anomaly-workbench/components/AnomalyEvidencePanel";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

// #1397 切片2：证据面板按 handling 分型组合——fix/note/operate 加处置指引、坐标细节折叠"审计详情"；
// adjudicate（relationCandidate）豁免折叠（证据即弹药）。§4.10 固化文案零触碰。
function makeIssue(extra: Partial<AnomalyIssue>): AnomalyIssue {
  return {
    issueId: "i1", issueKind: "missing_field", title: "product 是标准文章必填字段", status: "open",
    evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/a.md", coordinate: "rule:A03", lineNumber: 3 }],
    proposedAction: { type: "entity-repair", sourceKey: "知识库/raw/precleaned/a.md", field: "product" },
    handling: "fix",
    ...extra,
  } as AnomalyIssue;
}

describe("AnomalyEvidencePanel · 证据形态（2026-10-16 冗余清理批后）", () => {
  // 处置方式段与「问题来源/类型 chip/当前处理状态」行已删（Master 裁定：类型列表行已示、
  // 处置入口由悬浮操作条指引、状态头部胶囊已示）——处置指引三测随段退役。
  it("坐标细节默认折叠，展开后可见", () => {
    render(<AnomalyEvidencePanel issue={makeIssue({})} />);
    const details = screen.getByText(/审计详情/).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText(/审计详情/));
    expect(details.open).toBe(true);
  });

  it("清理批回归护栏：问题来源/类型chip/处置方式/当前处理状态不再出现；解说与影响保留", () => {
    render(<AnomalyEvidencePanel issue={makeIssue({})} />);
    expect(screen.queryByText("问题来源")).not.toBeInTheDocument();
    expect(screen.queryByText(/处置方式：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前处理状态/)).not.toBeInTheDocument();
    expect(screen.getByText(/影响：/)).toBeInTheDocument();
    expect(screen.getByText(/知识库\/raw\/precleaned\/a\.md/)).toBeInTheDocument();
  });
});

describe("AnomalyEvidencePanel · 具体原因块已退役（Master 2026-10-16：字段校验规则不需要展示）", () => {
  it("evidence 带 message/ruleId 也不再渲染具体原因区", () => {
    render(<AnomalyEvidencePanel issue={makeIssue({
      evidence: [{ kind: "proposal-check", path: "知识库/raw/precleaned/样本B.md", message: "正文内容过短", ruleId: "W01" }],
    })} />);
    expect(screen.queryByText(/具体原因/)).not.toBeInTheDocument();
    expect(screen.queryByText(/W01/)).not.toBeInTheDocument();
  });
  it("状态原因字段在场时显示：staleReason/closeReason/executionError", () => {
    render(<AnomalyEvidencePanel issue={makeIssue({ staleReason: "来源内容已更新", closeReason: null as unknown as string, executionError: undefined as unknown as string })} />);
    expect(screen.getByText(/来源内容已更新/)).toBeInTheDocument();
  });
});
