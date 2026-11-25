import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleContractView } from "@/features/schema-manager/components/ModuleContractView";
import type { IndividualUiConfig } from "@/features/individuals/individuals-types";
import type { ModuleRegistry } from "@/features/schema-manager/schema-manager-types";

const api = vi.hoisted(() => ({
  fetchIndividualConfig: vi.fn(),
  upsertModule: vi.fn(),
  appendModuleProduct: vi.fn(),
}));
vi.mock("@/features/individuals/individuals-api", () => ({ fetchIndividualConfig: api.fetchIndividualConfig }));
vi.mock("@/features/schema-manager/schema-write-api", () => ({
  upsertModule: api.upsertModule,
  appendModuleProduct: api.appendModuleProduct,
}));

const screenContract: NonNullable<IndividualUiConfig["screen"]> = {
  nav_region: "region-config-audit",
  nav_item: "schema",
  renderer: "generic",
  list: { columns: ["name", "system", "subdomain", "products"], filters: [], default_sort: { field: "name", direction: "asc" } },
  form: {
    sections: [
      { id: "identity", title_cn: "模块身份", fields: ["name", "system", "subdomain"] },
      { id: "lifecycle", title_cn: "版本与产品", fields: ["parent_id", "since", "until", "products", "description"] },
    ],
    field_order: ["name", "system", "subdomain", "parent_id", "since", "until", "products", "description"],
    widget_overrides: [{ field: "products", widget: "array" }, { field: "description", widget: "textarea" }],
  },
  detail: { sections: [{ id: "identity", title_cn: "模块身份", fields: ["name", "system", "subdomain"], relations: [] }] },
  buttons: [
    { action_id: "schema.modules.upsert", label_cn: "新建模块", placement: "toolbar", http_route: "PUT /api/schema/modules/{moduleId}", required_roles: ["admin"], impact: [{ class_id: "Module", operation: "modify", fields: ["name", "system"], description: "单条目写入 modules 词表" }], risk_id: null, confirmation: "none", availability_source: "action-execution-factory", availability: { allowed: true, reason: null } },
    { action_id: "schema.modules.upsert", label_cn: "编辑模块", placement: "row", http_route: "PUT /api/schema/modules/{moduleId}", required_roles: ["admin"], impact: [{ class_id: "Module", operation: "modify", fields: ["name", "system"], description: "单条目写入 modules 词表" }], risk_id: null, confirmation: "none", availability_source: "action-execution-factory", availability: { allowed: true, reason: null } },
    { action_id: "schema.modules.upsert", label_cn: "保存模块", placement: "detail", http_route: "PUT /api/schema/modules/{moduleId}", required_roles: ["admin"], impact: [{ class_id: "Module", operation: "modify", fields: ["name", "system"], description: "单条目写入 modules 词表" }], risk_id: null, confirmation: "none", availability_source: "action-execution-factory", availability: { allowed: true, reason: null } },
    { action_id: "schema.enums.append", label_cn: "追加适用产品", placement: "row", http_route: "POST /api/schema/enums/append", required_roles: ["admin"], impact: [{ class_id: "Module", operation: "modify", fields: ["products"], description: "向模块 products 追加版本化词表值" }], risk_id: null, confirmation: "none", availability_source: "action-execution-factory", availability: { allowed: true, reason: null } },
  ],
  empty: { component: "EmptyState", variant: "no-data", absence_kind: "modules-empty", primary_action_id: "schema.modules.upsert", guide: { what: "产品模块注册表还没有模块", where: "规则配置 → 产品模块 → 保存模块" } },
  custom_binding_key: null,
  states: {
    loading: { component: "TableLoading", label_cn: "正在加载产品模块" },
    error: { component: "TableErrorState", retry: true },
    forbidden: { component: "Alert", variant: "warn", message_cn: "当前身份无权修改产品模块" },
    retired: { component: "Alert", variant: "error", message_cn: "该产品模块已退役", replacement_type_id: null },
  },
};

const config: IndividualUiConfig = {
  classId: "Module",
  fields: [
    { name: "name", display: "模块名称", required: true, type: "text", declared: true },
    { name: "system", display: "所属系统", required: true, type: "text", declared: true },
    { name: "subdomain", display: "所属子域", required: true, type: "text", declared: true },
    { name: "parent_id", display: "父模块", required: false, type: "text", declared: true },
    { name: "since", display: "生效版本", required: false, type: "text", declared: true },
    { name: "until", display: "失效版本", required: false, type: "text", declared: true },
    { name: "products", display: "适用产品", required: false, type: "list", declared: true },
    { name: "description", display: "模块说明", required: false, type: "text", declared: true },
  ],
  screen: screenContract,
  actions: { create: "PUT /api/schema/modules/{moduleId}", list: "GET /api/schema/enums?section=modules", read: "GET /api/schema/enums?section=modules", update: "PUT /api/schema/modules/{moduleId}", retire: "" },
};

const modules = {
  部署服务: { system: "deploy-service", subdomain: "deploy", parent_id: "", since: "7.0.0", until: "", products: ["AnyShare"], description: "部署" },
};

function renderView(value: IndividualUiConfig = config, moduleValue: ModuleRegistry = modules) {
  api.fetchIndividualConfig.mockResolvedValue({ success: true, data: value });
  const onWritten = vi.fn().mockResolvedValue(undefined);
  render(<ModuleContractView modules={moduleValue} revision="sha256:rules" disabled={false} fallback={<div>旧模块编辑器</div>} onWritten={onWritten} />);
  return onWritten;
}

describe("ModuleContractView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.upsertModule.mockResolvedValue({ category: "enums", revision: "sha256:next" });
    api.appendModuleProduct.mockResolvedValue({ category: "enums", revision: "sha256:next", appended: true });
  });

  it("契约渲染模块列、表单分区与统一字段中文", async () => {
    renderView();
    expect(await screen.findByRole("columnheader", { name: "模块名称" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "所属系统" })).toBeDefined();
    expect(screen.getByText("deploy-service")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "编辑模块" }));
    expect(screen.getByText("模块身份")).toBeDefined();
    expect(screen.getByText("版本与产品")).toBeDefined();
    expect(screen.getByLabelText(/模块名称/)).toBeDisabled();
    expect(screen.getByLabelText(/模块说明/).tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText(/适用产品/).tagName).toBe("INPUT");
  });

  it("空态指引可创建首个模块并经 modules-upsert 写回", async () => {
    const onWritten = renderView(config, {});
    expect((await screen.findAllByText(/产品模块注册表还没有模块/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/规则配置 → 产品模块 → 保存模块/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "新建模块" }));
    fireEvent.change(screen.getByLabelText(/模块名称/), { target: { value: "结算" } });
    fireEvent.change(screen.getByLabelText(/所属系统/), { target: { value: "settlement-service" } });
    fireEvent.change(screen.getByLabelText(/所属子域/), { target: { value: "finance" } });
    fireEvent.change(screen.getByLabelText(/模块说明/), { target: { value: "U3 样板" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模块" }));
    await waitFor(() => expect(api.upsertModule).toHaveBeenCalledWith("结算", {
      system: "settlement-service",
      subdomain: "finance",
      parent_id: "",
      since: "",
      until: "",
      products: [],
      description: "U3 样板",
    }, "sha256:rules"));
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1));
  });

  it("编辑路径元数据完整保留（承接 WP-234 D2 删旧退役的 preserves module metadata 用例）", async () => {
    const onWritten = renderView();
    fireEvent.click(await screen.findByRole("button", { name: "编辑模块" }));
    expect(screen.getByLabelText(/模块名称/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/所属系统/), { target: { value: "deploy-service-2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模块" }));
    await waitFor(() => expect(api.upsertModule).toHaveBeenCalledWith("部署服务", {
      system: "deploy-service-2",
      subdomain: "deploy",
      parent_id: "",
      since: "7.0.0",
      until: "",
      products: ["AnyShare"],
      description: "部署",
    }, "sha256:rules"));
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1));
  });

  it("追加适用产品走 enum-append，重复与冲突由服务端裁决", async () => {
    const onWritten = renderView();
    fireEvent.click(await screen.findByRole("button", { name: "追加适用产品" }));
    fireEvent.change(screen.getByRole("textbox", { name: /追加到「部署服务」/ }), { target: { value: "产品A" } });
    fireEvent.click(screen.getByRole("button", { name: "确认追加" }));
    await waitFor(() => expect(api.appendModuleProduct).toHaveBeenCalledWith("部署服务", "产品A", "sha256:rules"));
    await waitFor(() => expect(onWritten).toHaveBeenCalledTimes(1));
  });

  it("服务端 availability 拒绝时禁用写按钮", async () => {
    const denied: IndividualUiConfig = {
      ...config,
      screen: {
        ...screenContract,
        buttons: screenContract.buttons.map((button) => ({ ...button, availability: { allowed: false, reason: "ROLE_DENIED" } })),
      },
    };
    renderView(denied);
    expect(await screen.findByRole("button", { name: "新建模块" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑模块" })).toBeDisabled();
    expect(screen.getAllByText("ROLE_DENIED").length).toBeGreaterThan(0);
  });

  it("类退役后显示退役语义并禁用写按钮", async () => {
    renderView({ ...config, lifecycle_status: "retired" });
    expect(await screen.findByRole("alert")).toHaveTextContent("该产品模块已退役");
    expect(screen.getByRole("button", { name: "新建模块" })).toBeDisabled();
  });

  it("契约端点不可用时回退现有模块编辑器", async () => {
    api.fetchIndividualConfig.mockRejectedValue(new Error("config unavailable"));
    render(<ModuleContractView modules={modules} revision="sha256:rules" disabled={false} fallback={<div>旧模块编辑器</div>} onWritten={vi.fn()} />);
    expect(await screen.findByText("旧模块编辑器")).toBeDefined();
    expect(screen.getByText(/显示层契约不可用/)).toBeDefined();
  });

  it("契约端点不可用且无旧实现时显示统一不可用提示（WP-234 D2 删旧后回退＝Alert）", async () => {
    api.fetchIndividualConfig.mockResolvedValue({ success: true, data: { ...config, screen: null } });
    render(<ModuleContractView modules={modules} revision="sha256:rules" disabled={false} onWritten={vi.fn()} />);
    expect(await screen.findByTestId("ui-alert")).toHaveTextContent(/显示层契约不可用/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建模块" })).toBeNull();
  });

  it("写错误透传且不伪装成功", async () => {
    api.upsertModule.mockRejectedValue(new Error("ENUMS_REVISION_CONFLICT"));
    const onWritten = renderView(config, {});
    fireEvent.click(await screen.findByRole("button", { name: "新建模块" }));
    fireEvent.change(screen.getByLabelText(/模块名称/), { target: { value: "结算" } });
    fireEvent.change(screen.getByLabelText(/所属系统/), { target: { value: "settlement-service" } });
    fireEvent.change(screen.getByLabelText(/所属子域/), { target: { value: "finance" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模块" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ENUMS_REVISION_CONFLICT");
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("写成功但刷新失败时保留表单并显示错误", async () => {
    const onWritten = vi.fn().mockRejectedValue(new Error("REFRESH_FAILED"));
    render(<ModuleContractView modules={{}} revision="sha256:rules" disabled={false} fallback={<div>旧模块编辑器</div>} onWritten={onWritten} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建模块" }));
    fireEvent.change(screen.getByLabelText(/模块名称/), { target: { value: "结算" } });
    fireEvent.change(screen.getByLabelText(/所属系统/), { target: { value: "settlement-service" } });
    fireEvent.change(screen.getByLabelText(/所属子域/), { target: { value: "finance" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模块" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("REFRESH_FAILED");
    expect(screen.getByLabelText(/模块名称/)).toHaveValue("结算");
    expect(screen.getByRole("button", { name: "保存模块" })).toBeDefined();
  });

  it("追加成功但刷新失败时保留追加面板并显示错误", async () => {
    const onWritten = vi.fn().mockRejectedValue(new Error("REFRESH_FAILED"));
    render(<ModuleContractView modules={modules} revision="sha256:rules" disabled={false} fallback={<div>旧模块编辑器</div>} onWritten={onWritten} />);
    fireEvent.click(await screen.findByRole("button", { name: "追加适用产品" }));
    fireEvent.change(screen.getByRole("textbox", { name: /追加到「部署服务」/ }), { target: { value: "产品A" } });
    fireEvent.click(screen.getByRole("button", { name: "确认追加" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("REFRESH_FAILED");
    expect(screen.getByRole("textbox", { name: /追加到「部署服务」/ })).toHaveValue("产品A");
  });
});
