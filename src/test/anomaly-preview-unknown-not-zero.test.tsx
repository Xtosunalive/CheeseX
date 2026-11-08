// WP-134 波2 假零拆钉：处理预览的四项计数此前写 `summary?.X || 0`——
// 预览未就位（summary 缺席）与「真的是 0 项」被折成同一个 0，红色告警位还挂着「0」当已核实结论。
// 判据＝EntityComplianceCard.tsx:16：只有契约 optional 且后端恒发 0 才允许归一；此处缺席是「未生成预览」。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnomalyActionPreview } from "@/features/anomaly-workbench/components/AnomalyActionPreview";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const derivedRepairIssue = {
  issueId: "iss-1",
  proposedAction: { type: "derived-graph-repair" },
} as unknown as AnomalyIssue;

function withSummary(summary: Record<string, unknown>) {
  return {
    ...derivedRepairIssue,
    actionPreview: { accepted: true, summary },
  } as unknown as AnomalyIssue;
}

describe("AnomalyActionPreview 计数：未知不折叠为 0", () => {
  it("预览已生成而 summary 未带计数＝四项「—」，不出现冒充已核实的 0", () => {
    // 注：四格在 `preview.accepted === true` 分支内（组件实测），故用「预览就位但计数字段缺席」这一真实中间态
    render(<AnomalyActionPreview issue={{ ...derivedRepairIssue, actionPreview: { accepted: true } } as unknown as AnomalyIssue} />);
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("后端真报 0 时照实显示 0（正对照：`??` 与 `||` 的分界就在这里）", () => {
    render(
      <AnomalyActionPreview
        issue={withSummary({
          unapprovedNodeCount: 0,
          incidentRelationCount: 0,
          missingLineageCount: 0,
          approvedArticleCount: 0,
        })}
      />,
    );
    expect(screen.getAllByText("0").length).toBe(4);
    expect(screen.queryByText("—")).toBeNull();
  });

  it("部分字段缺席＝逐项各归各值，不整块降级", () => {
    render(<AnomalyActionPreview issue={withSummary({ unapprovedNodeCount: 3, approvedArticleCount: 12 })} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBe(2);
  });
});
