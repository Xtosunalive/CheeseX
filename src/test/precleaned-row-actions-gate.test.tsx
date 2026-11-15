import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrecleanedTable } from "@/features/article-workflow/components/PrecleanedTable";
import type { PrecleanedArticleItem } from "@/features/article-workflow/article-workflow-types";

/** PR-310/WP-178：行内「审批与发布」按文章 stage 门控——published 终态行不再渲染入口。 */
const itemBase = {
  id: "p1",
  fileName: "a.md",
  title: "文章A",
  product: "产品",
  module: "模块",
  articleType: "标准文章",
  version: "v1",
  status: "standardized",
  standardizationStatus: "standardized",
  standardizationWarningCount: 0,
  stale: false,
  blockers: [],
  updatedAt: "2026-11-15T00:00:00Z",
};

describe("PR-310 行内审批入口状态门控", () => {
  it("published 行不渲染「审批与发布」，drafting 行维持", () => {
    const items = [
      { ...itemBase, id: "pub", title: "已发布文章", stage: "published" },
      { ...itemBase, id: "draft", title: "草稿文章", stage: "ready_to_confirm" },
    ] as unknown as PrecleanedArticleItem[];
    render(
      <PrecleanedTable
        items={items}
        loading={false}
        sortField="updatedAt"
        sortDirection="desc"
        emptyTitle=""
        emptyDescription=""
        onSortChange={() => {}}
        onOpen={() => {}}
        onApprove={() => {}}
        onRetire={() => {}}
        standardizingKeys={[]}
        skillOutcomes={{}}
      />,
    );
    expect(screen.queryByRole("button", { name: /审批与发布 已发布文章/ })).toBeNull();
    expect(screen.getByRole("button", { name: /审批与发布 草稿文章/ })).toBeInTheDocument();
    // 「退役」后端全状态合法（撤稿语义）——门控不变
    expect(screen.getAllByRole("button", { name: /退役/ }).length).toBe(2);
  });
});
