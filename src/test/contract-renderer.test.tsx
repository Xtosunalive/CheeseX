import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ContractRenderer } from "@/components/contract-renderer/renderer-registry";
import type { ScreenContract } from "@/lib/contract-renderer";

const screenContract: ScreenContract = {
  nav_region: "region-config-audit",
  nav_item: "individuals",
  renderer: "generic",
  list: { columns: ["question"], filters: [], default_sort: { field: "question", direction: "asc" } },
  form: null,
  detail: null,
  buttons: [],
  empty: { component: "EmptyState", variant: "no-data", absence_kind: null, primary_action_id: null, guide: { what: "暂无条目", where: "新建条目" } },
  custom_binding_key: null,
  states: {
    loading: { component: "TableLoading", label_cn: "正在读取屏幕契约数据" },
    error: { component: "TableErrorState", retry: true },
    forbidden: { component: "Alert", variant: "warn", message_cn: "当前身份无权查看" },
    retired: { component: "Alert", variant: "error", message_cn: "该种类已退役", replacement_type_id: "FaqCard" },
  },
};

function renderView(props: Partial<ComponentProps<typeof ContractRenderer>> = {}) {
  return render(
    <ContractRenderer
      screen={screenContract}
      fields={[{ name: "question", display: "问题", required: true, type: "text", declared: true }]}
      rows={[]}
      ariaLabel="屏幕契约测试"
      onAction={vi.fn()}
      {...props}
    />,
  );
}

describe("ContractRenderer 状态与定制保护", () => {
  it("加载态使用屏幕契约文案，不伪装成空态", () => {
    renderView({ loading: true });
    expect(screen.getByTestId("table-loading")).toHaveTextContent("正在读取屏幕契约数据");
    expect(screen.queryByText(/暂无条目/)).toBeNull();
  });

  it("错误态提供契约声明的重试动作", () => {
    const onRetry = vi.fn();
    renderView({ error: "读取失败", onRetry });
    expect(screen.getByTestId("table-error")).toHaveTextContent("读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("无权限态使用契约消息并保留具体拒绝原因", () => {
    renderView({ forbiddenReason: "ROLE_DENIED" });
    expect(screen.getByRole("status")).toHaveTextContent("当前身份无权查看：ROLE_DENIED");
  });

  it("退役态显示契约消息，不展示空态创建入口", () => {
    renderView({ retiredMessage: "该种类已退役；替代种类：FaqCard" });
    expect(screen.getByRole("alert")).toHaveTextContent("该种类已退役；替代种类：FaqCard");
    expect(screen.queryByText(/暂无条目/)).toBeNull();
  });

  it("定制 renderer 不挂载通用表格与表单，并回退页面现有实现", () => {
    renderView({
      screen: { ...screenContract, renderer: "custom:article-workflow", custom_binding_key: "article-workflow" },
      fallback: <div>文章工作流现有实现</div>,
    });
    expect(screen.getByText("文章工作流现有实现")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建条目" })).toBeNull();
  });

  it("屏幕契约缺失时回退页面现有实现", () => {
    renderView({ screen: null, fallback: <div>页面现有实现</div> });
    expect(screen.getByText("页面现有实现")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
