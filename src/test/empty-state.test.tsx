import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/empty-state";

describe("EmptyState（WP-037 P4 配方 empty-state——统一空态组件）", () => {
  it("no-data 变体：默认弱底容器，渲染标题/描述/操作，variant 标记可断言", () => {
    render(
      <EmptyState
        variant="no-data"
        title="还没有图谱引用文档"
        description="运行图谱管道后，这里会列出全部文档及其映射状态。"
        action={<button type="button">运行管道</button>}
      />,
    );
    const root = screen.getByTestId("empty-state");
    expect(root.getAttribute("data-variant")).toBe("no-data");
    expect(root.className).toContain("rounded-xl");
    expect(screen.getByText("还没有图谱引用文档")).toBeTruthy();
    expect(screen.getByText(/运行图谱管道后/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "运行管道" })).toBeTruthy();
  });

  it("no-match 变体：bare 模式无外框（表格行区渲染，表头由 DataTable 保留）", () => {
    render(<EmptyState variant="no-match" bare title="无匹配的图谱引用文档" description="当前筛选条件下无结果" />);
    const root = screen.getByTestId("empty-state");
    expect(root.getAttribute("data-variant")).toBe("no-match");
    expect(root.className).not.toContain("rounded-xl");
    expect(screen.getByText("无匹配的图谱引用文档")).toBeTruthy();
  });

  it("默认变体＝no-data；缺省图标渲染（空态不只一行提示语——图标＋主提示＋次提示三件齐）", () => {
    render(<EmptyState title="暂无内容" />);
    const root = screen.getByTestId("empty-state");
    expect(root.getAttribute("data-variant")).toBe("no-data");
    expect(root.querySelector("svg")).toBeTruthy();
  });
});
