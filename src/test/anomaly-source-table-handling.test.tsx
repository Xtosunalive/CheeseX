import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalySourceTable } from "@/features/anomaly-workbench/components/AnomalySourceTable";
import { groupIssuesByArticle } from "@/features/anomaly-workbench/anomaly-article-groups";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

// 切片3：来源分组行按 handling 分型动作面——组内各议题 handling 计数去重后渲染为徽章串。
// 文案固定：fix=需处理 adjudicate=需评审 operate=可重试 note=无需处理（枚举单源：生成类型 AnomalyIssue["handling"]）。
function makeIssue(extra: Partial<AnomalyIssue>): AnomalyIssue {
  return {
    issueId: "i1",
    issueKind: "missing_field",
    handling: "fix",
    title: "product 是标准文章必填字段",
    status: "open",
    evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/a.md", coordinate: "rule:A03", lineNumber: 3 }],
    proposedAction: { type: "entity-repair", sourceKey: "知识库/raw/precleaned/a.md", field: "product" },
    ...extra,
  } as AnomalyIssue;
}

function renderTable(issues: AnomalyIssue[], onSelect = vi.fn()) {
  render(<AnomalySourceTable groups={groupIssuesByArticle(issues)} selectedIssueId={null} onSelect={onSelect} />);
}

function rowOf(sourcePath: string): HTMLElement {
  return screen.getByText(sourcePath).closest("tr") as HTMLElement;
}

describe("AnomalySourceTable · handling 分型动作面", () => {
  it("分组含 fix 类议题 → 行内出现「需处理」徽章", () => {
    renderTable([makeIssue({ issueId: "fix-1", handling: "fix", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/fix.md" }] })]);
    expect(within(rowOf("知识库/raw/precleaned/fix.md")).getByText("需处理 ×1")).toBeInTheDocument();
  });

  it("分组含 adjudicate 类议题 → 行内出现「需评审」徽章", () => {
    renderTable([makeIssue({ issueId: "adj-1", handling: "adjudicate", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/adjudicate.md" }] })]);
    expect(within(rowOf("知识库/raw/precleaned/adjudicate.md")).getByText("需评审 ×1")).toBeInTheDocument();
  });

  it("分组含 operate 类议题 → 行内出现「可重试」徽章", () => {
    renderTable([makeIssue({ issueId: "op-1", handling: "operate", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/operate.md" }] })]);
    expect(within(rowOf("知识库/raw/precleaned/operate.md")).getByText("可重试 ×1")).toBeInTheDocument();
  });

  it("分组含 note 类议题 → 行内出现「无需处理」徽章", () => {
    renderTable([makeIssue({ issueId: "note-1", handling: "note", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/note.md" }] })]);
    expect(within(rowOf("知识库/raw/precleaned/note.md")).getByText("无需处理 ×1")).toBeInTheDocument();
  });

  it("同组混合 handling → 徽章串按类计数去重，样式复用既有徽章 token", () => {
    renderTable([
      makeIssue({ issueId: "mix-1", handling: "fix", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/mixed.md" }] }),
      makeIssue({ issueId: "mix-2", handling: "fix", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/mixed.md" }] }),
      makeIssue({ issueId: "mix-3", handling: "note", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/mixed.md" }] }),
    ]);
    const row = rowOf("知识库/raw/precleaned/mixed.md");
    expect(within(row).getByText("需处理 ×2")).toBeInTheDocument();
    expect(within(row).getByText("无需处理 ×1")).toBeInTheDocument();
    expect(within(row).queryByText(/需评审|可重试/)).not.toBeInTheDocument();
    const badge = within(row).getByText("需处理 ×2");
    // 收官批（Master 2026-10-16 批准）：处理动作徽章换 ui/tag neutral（D6 类消最后一处），断言随之改钉统一件
    expect(badge).toHaveAttribute("data-testid", "ui-tag");
  });

  it("回归护栏：复选框 aria-label、来源文件名、类型/状态列与行点击选择不破坏", () => {
    const onSelect = vi.fn();
    renderTable([
      makeIssue({ issueId: "fix-1", handling: "fix", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/fix.md" }] }),
      makeIssue({ issueId: "adj-1", handling: "adjudicate", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/adjudicate.md" }] }),
      makeIssue({ issueId: "op-1", handling: "operate", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/operate.md" }] }),
      makeIssue({ issueId: "note-1", handling: "note", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/note.md" }] }),
    ], onSelect);
    const table = screen.getByRole("region", { name: "问题来源待处理项" });
    for (const name of ["fix.md", "adjudicate.md", "operate.md", "note.md"]) {
      expect(screen.getByRole("checkbox", { name: `选择文章：知识库/raw/precleaned/${name}` })).toBeInTheDocument();
      expect(screen.getByText(`知识库/raw/precleaned/${name}`)).toBeInTheDocument();
    }
    expect(within(table).getAllByText("字段缺失")).toHaveLength(4);
    expect(within(table).getAllByText("待处理")).toHaveLength(4);
    // 来源文件名 span 在 ObsidianLink 内（stopPropagation），行点击走类型文本（与既有 view 测试一致）
    fireEvent.click(within(rowOf("知识库/raw/precleaned/operate.md")).getByText("字段缺失"));
    expect(onSelect).toHaveBeenCalledWith("op-1");
  });
});

describe("#1798-B · 来源链接点击不吞行选中（真凶修复）", () => {
  it("T8 点击来源路径的 Obsidian 链接必须同时切换行选中（冒泡到 tr onSelect）", () => {
    const onSelect = vi.fn();
    const issue = makeIssue({ issueId: "link-1", evidence: [{ kind: "vault-document", path: "知识库/raw/precleaned/link.md" }] });
    render(<AnomalySourceTable groups={groupIssuesByArticle([issue])} selectedIssueId={null} onSelect={onSelect} />);
    const link = screen.getByRole("button", { name: /在 Obsidian 中打开来源文档/ });
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith("link-1");
  });
});
