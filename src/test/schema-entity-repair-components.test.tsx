import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateField, RepairFieldEditor } from "@/components/entity-repair";
import { PoolShell } from "@/components/pool-panel";
import { FilterSelect } from "@/components/filter-select";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

describe("entity repair shared components", () => {
  it("keeps pool close and minimize actions independent", () => {
    const minimize = vi.fn();
    const close = vi.fn();
    render(
      <PoolShell title="修复 MySQL" sourceKey="知识库/MySQL.md" onMinimize={minimize} onClose={close} footer={<button>保存</button>}>
        <p>字段内容</p>
      </PoolShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "最小化补齐面板" }));
    expect(minimize).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "结束补齐任务" }));
    expect(close).toHaveBeenCalledOnce();
    const pool = screen.getByRole("complementary", { name: "修复 MySQL" });
    expect(pool).toHaveTextContent("知识库/MySQL.md");
    // PR-026 任务池形态：300px 悬浮池（毛玻璃+圆角+投影），480px 通顶白条退役
    expect(pool).toHaveClass("w-[300px]", "bg-glass", "rounded-[var(--radius-panel)]", "shadow-card", "backdrop-blur-md");
  });

  it("normalizes array input via token interaction and preserves invalid JSON for correction", () => {
    const arrayChange = vi.fn();
    const jsonChange = vi.fn();
    const { rerender } = render(
      <RepairFieldEditor field="tags" label="标签" message="待补齐" value={[]} kind="array" onChange={arrayChange} />,
    );
    const tokenInput = screen.getByRole("textbox", { name: "标签" });
    fireEvent.change(tokenInput, { target: { value: "mysql" } });
    fireEvent.keyDown(tokenInput, { key: "Enter" });
    expect(arrayChange).toHaveBeenLastCalledWith(["mysql"]);

    rerender(<RepairFieldEditor field="overrides" label="版本覆盖" message="格式错误" value={[]} kind="json" onChange={jsonChange} />);
    fireEvent.change(screen.getByRole("textbox", { name: "版本覆盖 JSON" }), { target: { value: "[" } });
    expect(jsonChange).toHaveBeenLastCalledWith("[");
  });

  it("hides redundant allowed-value hints for select fields and renders hint without a 格式 prefix", () => {
    const { rerender } = render(
      <RepairFieldEditor field="module" label="产品模块" message="通过" value="MySQL" kind="select" allowedValues={["MySQL", "Redis"]} hint="可用值：MySQL、Redis" onChange={vi.fn()} />,
    );
    expect(screen.queryByText("可用值：MySQL、Redis")).not.toBeInTheDocument();

    rerender(<RepairFieldEditor field="version" label="产品版本" message="通过" value="7.0.0.0" kind="text" hint="填写精确产品版本" onChange={vi.fn()} />);
    expect(screen.getByText("填写精确产品版本")).toBeInTheDocument();
    expect(screen.queryByText("格式：填写精确产品版本")).not.toBeInTheDocument();

    // 同一张卡片不得出现两份「填写要求」：有 hint 时 placeholder 让位（hint 优先、placeholder 仅回落）
    rerender(<RepairFieldEditor field="arch_since" label="组件有效期起点" message="通过" value="" kind="text" placeholder="例如 7.0.0.0" hint="语义版本，例如 7.0.0.0" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "组件有效期起点" })).not.toHaveAttribute("placeholder");

    // 无 hint 时 placeholder 照常回落到控件上
    rerender(<RepairFieldEditor field="arch_since" label="组件有效期起点" message="通过" value="" kind="text" placeholder="例如 7.0.0.0" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "组件有效期起点" })).toHaveAttribute("placeholder", "例如 7.0.0.0");
  });

  it("keeps a popover above the pool panel and allows selecting an option", () => {
    render(
      <PoolShell title="补齐实体" sourceKey="知识库/wiki/entities/demo.md" onMinimize={vi.fn()} onClose={vi.fn()}>
        <FilterSelect ariaLabel="状态 选项" title="选择状态" value="" onValueChange={vi.fn()} options={[{ value: "active", label: "active", group: "Schema 可用值" }]} />
      </PoolShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "状态 选项" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("listbox").parentElement).toHaveClass("z-popover");
    fireEvent.click(screen.getByRole("option", { name: "active" }));
  });

  it("uses the shared calendar field and preserves the YYYY-MM-DD contract", () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="创建日期 日期" value="2026-08-02" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "创建日期 日期" }));
    expect(screen.getByRole("button", { name: "清除日期" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除日期" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("supports controlled autocomplete selection for free-text fields", () => {
    const onChange = vi.fn();
    render(<RepairFieldEditor field="version" label="产品版本" message="" value="7" kind="text" suggestions={["7.0.0.0", "8.0.0.0"]} onChange={onChange} />);
    fireEvent.focus(screen.getByRole("textbox", { name: "产品版本" }));
    fireEvent.click(screen.getByRole("option", { name: "7.0.0.0" }));
    expect(onChange).toHaveBeenCalledWith("7.0.0.0");
  });

  it("validates only the active field when repairing an existing entity", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { layers: [], categories: [], subdomains: {}, modules: {} } }),
    }));
    const issue = {
      issueId: "missing-architecture-node-id",
      issueKind: "missing_field",
      title: "架构组件身份缺失",
      status: "open",
      evidence: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/demo.md", field: "architecture-node-id" },
      executionReady: true,
    } as unknown as AnomalyIssue;
    render(<AnomalyEntityRepairDrawer issue={issue} error={null} onPreview={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    // 只校验当前问题字段：仅 architecture-node-id 卡片出现错误，实体名称等其他必填字段不参与校验
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("必填字段不能为空");
    vi.unstubAllGlobals();
  });
});
