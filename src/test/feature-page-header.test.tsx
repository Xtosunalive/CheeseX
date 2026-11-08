import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeaturePageHeader } from "@/components/page-header";

// 页内主标题已删（与顶栏 PageHeader 重复，PR③ Master 2026-10-07 04:44 拍板）——
// 本组件只保留 description/meta/actions 三个信息位；title prop 为废弃位不渲染。
describe("FeaturePageHeader", () => {
  it("renders description with unified typography (no page-level heading)", () => {
    render(<FeaturePageHeader title="关系审核" description="审核关系可信度、解决规则冲突并追溯历史决定。" />);
    // h1 不再渲染（title 已废弃）
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("审核关系可信度、解决规则冲突并追溯历史决定。")).toHaveClass("text-sm", "text-text-hint");
  });

  it("renders actions on the right side", () => {
    render(
      <FeaturePageHeader
        title="待处理问题"
        actions={<button type="button">刷新列表</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "刷新列表" })).toBeInTheDocument();
  });

  it("renders meta information below the description area", () => {
    render(
      <FeaturePageHeader
        title="文档检索"
        meta={<span>共 42 条结果</span>}
      />,
    );
    expect(screen.getByText("共 42 条结果")).toBeInTheDocument();
  });

  it("omits description and meta when not provided (no heading, no paragraph)", () => {
    const { container } = render(<FeaturePageHeader title="极简标题" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
