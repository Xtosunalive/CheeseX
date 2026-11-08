import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { AnomalyActionToolbar } from "@/features/anomaly-workbench/components/AnomalyActionToolbar";
import { groupIssuesByArticle } from "@/features/anomaly-workbench/anomaly-article-groups";

// WP-146 件3：跳转类动作收进「前往处理」下拉——导航出口 spy 钉住
const navigationMock = vi.hoisted(() => ({ safeNavigateHash: vi.fn() }));
vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  safeNavigateHash: navigationMock.safeNavigateHash,
}));

function makeIssue(overrides: Partial<AnomalyIssue> & { issueId: string; issueKind: AnomalyIssue["issueKind"] }): AnomalyIssue {
  return {
    title: "测试问题",
    status: "open",
    evidence: [{ path: "知识库/wiki/entities/test.md" }],
    expectedRevisions: {},
    blockedActions: [],
    proposedAction: null,
    ...overrides,
  } as AnomalyIssue;
}

const fieldIssue = makeIssue({ issueId: "f-1", issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "arch_layer", sourceKey: "知识库/wiki/entities/test.md" } });
const conflictIssue = makeIssue({ issueId: "c-1", issueKind: "relation_conflict", proposedAction: { type: "inference-review", conflictId: "conf-9" } });

describe("AnomalyActionToolbar", () => {
  it("未选择文章时操作条不渲染（整改5：空态整条浮层不存在 DOM）", () => {
    const groups = groupIssuesByArticle([fieldIssue]);
    const { container } = render(<AnomalyActionToolbar groups={groups} selectedKeys={[]} onSelectionChange={vi.fn()} onAction={vi.fn()} />);
    expect(screen.queryByRole("toolbar", { name: "批量操作条" })).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("选择一篇包含 missing_field 和 relation_conflict 的文章时只显示对应动作", async () => {
    const issues = [fieldIssue, conflictIssue];
    const groups = groupIssuesByArticle(issues);
    const selectedKeys = groups.map((g) => g.articleKey);
    render(<AnomalyActionToolbar groups={groups} selectedKeys={selectedKeys} onSelectionChange={vi.fn()} onAction={vi.fn()} />);
    // 页面内动作＝主操作实心钮直点
    expect(screen.getByRole("button", { name: "补齐字段" })).toBeInTheDocument();
    // 专业页面交接＝次操作收进「前往处理」下拉（WP-146 件3）
    fireEvent.pointerDown(screen.getByRole("button", { name: /前往处理/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "转到源文档检查" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "转到关系审核" })).toBeInTheDocument();
    // 不显示无关动作
    expect(screen.queryByRole("menuitem", { name: "生成正式图修复预览" })).not.toBeInTheDocument();
  });

  it("没有对应 issue 类型时不显示灰色占位按钮", async () => {
    const groups = groupIssuesByArticle([fieldIssue]);
    const selectedKeys = groups.map((g) => g.articleKey);
    render(<AnomalyActionToolbar groups={groups} selectedKeys={selectedKeys} onSelectionChange={vi.fn()} onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "修复关系" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成正式图修复预览" })).not.toBeInTheDocument();
    // 跳转类收纳后：打开「前往处理」下拉核对无关跳转不出现
    fireEvent.pointerDown(screen.getByRole("button", { name: /前往处理/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: "转到源文档检查" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "转到文章映射修复" })).not.toBeInTheDocument();
  });

  it("同类动作只显示一次（去重）", () => {
    const duplicateField = makeIssue({ issueId: "f-2", issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "module", sourceKey: "知识库/wiki/entities/test.md" } });
    const groups = groupIssuesByArticle([fieldIssue, duplicateField]);
    const selectedKeys = groups.map((g) => g.articleKey);
    render(<AnomalyActionToolbar groups={groups} selectedKeys={selectedKeys} onSelectionChange={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "补齐字段" })).toHaveLength(1);
  });

  it("有 Markdown 来源时不在工具栏显示 Obsidian 按钮（已由来源通道提供）", () => {
    const groups = groupIssuesByArticle([fieldIssue]);
    const selectedKeys = groups.map((g) => g.articleKey);
    render(<AnomalyActionToolbar groups={groups} selectedKeys={selectedKeys} onSelectionChange={vi.fn()} onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "在 Obsidian 中打开" })).not.toBeInTheDocument();
  });

  it("点击动作按钮触发 onAction 回调", () => {
    const onAction = vi.fn();
    const groups = groupIssuesByArticle([fieldIssue]);
    const selectedKeys = groups.map((g) => g.articleKey);
    render(<AnomalyActionToolbar groups={groups} selectedKeys={selectedKeys} onSelectionChange={vi.fn()} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "补齐字段" }));
    expect(onAction).toHaveBeenCalledWith("entity-repair", expect.any(Array));
  });

  it("跳转类动作点击菜单项经 safeNavigateHash 跳转（WP-146 件3：跳转收进前往处理下拉）", async () => {
    const groups = groupIssuesByArticle([conflictIssue]);
    render(<AnomalyActionToolbar groups={groups} selectedKeys={groups.map((g) => g.articleKey)} onSelectionChange={vi.fn()} onAction={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: /前往处理/ }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "转到关系审核" }));
    expect(navigationMock.safeNavigateHash).toHaveBeenCalledTimes(1);
    expect(navigationMock.safeNavigateHash).toHaveBeenCalledWith(expect.stringContaining("#/review"));
  });

  it("操作条浮层承载批量动作与清除（整改5：原型 selbar 同构——全选框随空态退役，清除走 Clear）", () => {
    const conflictOther = makeIssue({ issueId: "c-1", issueKind: "relation_conflict", proposedAction: { type: "inference-review", conflictId: "conf-9" }, evidence: [{ path: "知识库/wiki/entities/other.md" }] });
    const groups = groupIssuesByArticle([fieldIssue, conflictOther]);
    const onSelectionChange = vi.fn();
    render(<AnomalyActionToolbar groups={groups} selectedKeys={groups.map((g) => g.articleKey)} onSelectionChange={onSelectionChange} onAction={vi.fn()} />);
    const bar = screen.getByRole("toolbar", { name: "批量操作条" });
    expect(bar).toHaveTextContent("2 篇已选");
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });
});
