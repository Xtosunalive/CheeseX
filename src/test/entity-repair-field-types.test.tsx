import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepairFieldEditor, EntityRepairForm } from "@/components/entity-repair";
import { resolveFieldKind, fieldDefFor, REPAIR_FIELD_DEFS } from "@/components/entity-repair/entity-repair-field-model";

describe("entity repair field type routing", () => {
  it("routes boolean fields to a checkbox", () => {
    render(<RepairFieldEditor field="arch_component" label="激活为架构组件" message="" value={false} kind="boolean" onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("routes enum fields to a single-select dropdown", () => {
    render(<RepairFieldEditor field="arch_layer" label="架构分层" message="" value="" kind="select" allowedValues={["service", "storage"]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "架构分层 选项" })).toBeInTheDocument();
  });

  it("routes array fields without enum values to a token input", () => {
    render(<RepairFieldEditor field="tags" label="标签" message="" value={[]} kind="array" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "标签" })).toBeInTheDocument();
  });

  it("routes array fields with enum values to a multi-select", () => {
    render(<RepairFieldEditor field="module" label="产品模块" message="" value={[]} kind="array" allowedValues={["MySQL", "Redis"]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "产品模块 选项" })).toBeInTheDocument();
  });

  it("routes date fields to the calendar popover field", () => {
    render(<RepairFieldEditor field="date" label="创建日期" message="" value="" kind="date" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "创建日期 日期" })).toBeInTheDocument();
  });

  it("routes text fields with suggestions to autocomplete", () => {
    render(<RepairFieldEditor field="version" label="产品版本" message="" value="" kind="text" suggestions={["7.0.0.0"]} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "产品版本" })).toBeInTheDocument();
  });

  it("routes json fields to a structured textarea", () => {
    render(<RepairFieldEditor field="arch_version_overrides" label="版本属性覆盖" message="" value={[]} kind="json" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "版本属性覆盖 JSON" })).toBeInTheDocument();
  });

  it("derives the control kind from field metadata, not from field-name sets", () => {
    expect(fieldDefFor("arch_component")?.control).toBe("boolean");
    // 2026-10-08 字段托管：date/updated 系统托管只读（服务端写路径注入，表单只读展示）——
    // 旧断言期待 "date" 控件已过时（僵尸），对齐现契约 readonly-system（2026-10-09 Master 批准删僵尸）。
    expect(fieldDefFor("date")?.control).toBe("readonly-system");
    expect(fieldDefFor("updated")?.control).toBe("readonly-system");
    expect(fieldDefFor("module")?.control).toBe("array");
    expect(fieldDefFor("tags")?.control).toBe("array");
    expect(fieldDefFor("aliases")).toBeUndefined();
    expect(fieldDefFor("arch_version_overrides")?.control).toBe("json");
    expect(REPAIR_FIELD_DEFS.filter((def) => def.field === "arch_version_overrides")).toHaveLength(1);
    expect(fieldDefFor("arch_layer")?.control).toBe("select");
    expect(fieldDefFor("arch_category")?.control).toBe("select");
    // select 在没有可用枚举时降级为 text，由调用方传入 allowedValues 决定
    expect(resolveFieldKind("select", [])).toBe("text");
    expect(resolveFieldKind("select", ["service"])).toBe("select");
    expect(resolveFieldKind("date", [])).toBe("date");
    expect(resolveFieldKind("boolean", [])).toBe("boolean");
  });

  it("marks required fields with a red asterisk instead of 必填/可选 text", () => {
    render(<RepairFieldEditor field="title" label="实体名称" message="" value="" kind="text" required showLabel onChange={vi.fn()} />);
    expect(screen.getByText("*")).toHaveClass("text-status-error");
    expect(screen.queryByText("必填")).not.toBeInTheDocument();
    expect(screen.queryByText("可选")).not.toBeInTheDocument();
  });

  it("renders the unified title/control/hint card layout via the shared EntityRepairForm", () => {
    render(
      <EntityRepairForm
        groups={[{
          id: "identity",
          label: "身份",
          fields: [
            { field: "title", label: "实体名称", required: true, kind: "text", value: "", onChange: vi.fn() },
            { field: "architecture-node-id", label: "架构组件身份", required: true, kind: "text", value: "", error: "必填字段不能为空", onChange: vi.fn() },
          ],
        }]}
      />,
    );
    // 标题区：分组标题 + 字段名 + 红色 *
    expect(screen.getByText("身份")).toBeInTheDocument();
    expect(screen.getByText("实体名称")).toBeInTheDocument();
    // 提示区：字段级错误
    expect(screen.getByRole("alert")).toHaveTextContent("必填字段不能为空");
    // 控件区：两个字段都渲染输入框
    expect(screen.getByRole("textbox", { name: "实体名称" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "架构组件身份" })).toBeInTheDocument();
  });
});
