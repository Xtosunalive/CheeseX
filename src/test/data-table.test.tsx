// ── DataTable 基座与 ui/alert 的单元测试（P1）──
// 层级：纯单元＋组件渲染（vitest + testing-library）——骨架/三态/密度/键盘可达/展开/选择。
// 真实业务回归由 T08 迁移后全量前端套件承载（集成层证据）。
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { rowActionColumn } from "@/components/data-table/row-action-column";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { Alert } from "@/components/ui/alert";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "实体甲", score: 12 },
  { id: "b", name: "实体乙", score: 34 },
];

const columns: Array<Column<Row>> = [
  { key: "name", title: "名称", dataIndex: "name" },
  { key: "score", title: "分数", dataIndex: "score", align: "right" },
];

describe("DataTable 基座", () => {
  it("渲染列头与行（dataIndex 默认取值）", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} ariaLabel="测试表" />);
    expect(screen.getByRole("table", { name: "测试表" })).toBeTruthy();
    expect(screen.getByText("名称")).toBeTruthy();
    expect(screen.getByText("实体甲")).toBeTruthy();
    expect(screen.getByText("34")).toBeTruthy();
  });

  it("密度档透传到根节点（data-density）", () => {
    const { container } = render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} density="md" />);
    const root = container.querySelector(".data-table");
    expect(root?.getAttribute("data-density")).toBe("md");
  });

  it("加载态渲染在表体同位置", () => {
    render(<DataTable columns={columns} rows={[] as Row[]} rowKey={(r) => r.id} loading ariaLabel="加载表" />);
    expect(screen.getByTestId("table-loading")).toBeTruthy();
  });

  it("错误态＝Alert＋重试按钮，点击触发 onRetry", () => {
    const onRetry = vi.fn();
    render(<DataTable columns={columns} rows={[] as Row[]} rowKey={(r) => r.id} error="网络故障" onRetry={onRetry} ariaLabel="错误表" />);
    expect(screen.getByTestId("table-error")).toBeTruthy();
    expect(screen.getByText("网络故障")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("空态归因：无数据 vs 筛选清空两种文案", () => {
    const { rerender } = render(
      <DataTable columns={columns} rows={[] as Row[]} rowKey={(r) => r.id} empty={{ title: "暂无审核记录" }} ariaLabel="空表" />,
    );
    expect(screen.getByTestId("table-empty")).toBeTruthy();
    expect(screen.getByText("暂无审核记录")).toBeTruthy();
    rerender(
      <DataTable columns={columns} rows={[] as Row[]} rowKey={(r) => r.id} empty={{ title: "无匹配结果", description: "调整搜索或筛选条件后再试" }} ariaLabel="空表" />,
    );
    expect(screen.getByText("无匹配结果")).toBeTruthy();
    expect(screen.getByText("调整搜索或筛选条件后再试")).toBeTruthy();
  });

  it("行点击键盘可达：Enter 触发且行可聚焦（O3）", () => {
    const onRowClick = vi.fn();
    const { container } = render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} ariaLabel="键盘表" />);
    const tr = container.querySelector("tbody tr");
    expect(tr?.getAttribute("tabIndex")).toBe("0");
    expect(tr?.className).toContain("data-table__row--interactive");
    fireEvent.keyDown(tr!, { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledOnce();
  });

  it("可展开行：切换钮 aria-expanded 与展开渲染", () => {
    let expanded = false;
    const { rerender } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        expandable={{
          rowExpanded: (r) => expanded && r.id === "a",
          onToggle: () => { expanded = !expanded; },
          render: (r) => <div>详情：{r.name}</div>,
        }}
        ariaLabel="展开表"
      />,
    );
    expect(screen.queryByText("详情：实体甲")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "展开行详情" })[0]);
    expect(expanded).toBe(true);
    rerender(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        expandable={{
          rowExpanded: (r) => expanded && r.id === "a",
          onToggle: () => { expanded = !expanded; },
          render: (r) => <div>详情：{r.name}</div>,
        }}
        ariaLabel="展开表"
      />,
    );
    expect(screen.getByText("详情：实体甲")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "收起行详情" }).length).toBeGreaterThan(0);
  });

  it("行选择：checkbox 勾选触发 onToggle，全选钮存在", () => {
    const selected = new Set<string>(["a"]);
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowSelection={{
          selectedKeys: selected,
          onToggle: (r) => { void r; },
          onToggleAll: () => {},
        }}
        ariaLabel="选择表"
      />,
    );
    expect(screen.getByLabelText("全选本页")).toBeTruthy();
    expect(screen.getByLabelText("选择第 1 行")).toBeTruthy();
    expect(screen.getByLabelText("选择第 2 行")).toBeTruthy();
  });
});

describe("ui/alert（F1/F3）", () => {
  it("四语义变体与 role 映射（error=alert，其余=status）", () => {
    const { rerender } = render(<Alert variant="error">出错了</Alert>);
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(<Alert variant="success">成功了</Alert>);
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(<Alert variant="warn">注意</Alert>);
    expect(screen.getByTestId("ui-alert").className).toContain("bg-status-warn-2");
    rerender(<Alert variant="info" description="补充说明">提示</Alert>);
    expect(screen.getByText("补充说明")).toBeTruthy();
    expect(screen.getByTestId("ui-alert").className).toContain("px-6 py-5");
  });
});

// ── rowActionColumn 工厂（批8）──
describe("rowActionColumn 行操作列工厂", () => {
  it("渲染标签钮并透传 onRun(row, index)/danger", async () => {
    const calls: Array<{ id: string; index: number }> = [];
    const rows = [{ id: "a" }, { id: "b" }];
    render(
      <DataTable
        ariaLabel="工厂测试表"
        columns={[{ key: "id", title: "ID", render: (row) => row.id }, rowActionColumn<{ id: string }>({ label: "删除", danger: true, onRun: (row, index) => calls.push({ id: row.id, index }) })]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "删除" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(calls).toEqual([{ id: "b", index: 1 }]);
  });
  it("按行动态标签", () => {
    render(
      <DataTable
        ariaLabel="工厂动态标签表"
        columns={[{ key: "id", title: "ID" }, rowActionColumn<{ id: string }>({ label: (row) => `移除 ${row.id}`, onRun: () => {} })]}
        rows={[{ id: "x" }]}
        rowKey={(row) => row.id}
      />,
    );
    expect(screen.getByRole("button", { name: "移除 x" })).toBeInTheDocument();
  });
});
