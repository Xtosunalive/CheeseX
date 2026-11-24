// WP-210（SPEC-100 批 4）：个体派生面视图测试——mock api 层，验渲染/交互（创建/编辑/退役）。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndividualsView } from "@/features/individuals/IndividualsView";
import type { IndividualUiConfig } from "@/features/individuals/individuals-types";

const api = vi.hoisted(() => ({
  fetchIndividualClasses: vi.fn(),
  fetchIndividualConfig: vi.fn(),
  fetchIndividualList: vi.fn(),
  fetchIndividual: vi.fn(),
  createIndividual: vi.fn(),
  updateIndividual: vi.fn(),
  retireIndividual: vi.fn(),
}));
vi.mock("@/features/individuals/individuals-api", () => api);

const screenContract = {
  nav_region: "region-config-audit",
  nav_item: "individuals",
  renderer: "generic" as const,
  list: { columns: ["question", "weight", "revision"], filters: [], default_sort: { field: "question", direction: "asc" as const } },
  form: {
    sections: [
      { id: "content", title_cn: "问题内容", fields: ["question", "answer"] },
      { id: "management", title_cn: "管理信息", fields: ["weight"] },
    ],
    field_order: ["question", "answer", "weight"],
    widget_overrides: [],
  },
  detail: { sections: [{ id: "content", title_cn: "问题内容", fields: ["question", "answer"], relations: [] }] },
  buttons: [
    { action_id: "individuals.create", label_cn: "新建问题卡", placement: "toolbar" as const, http_route: "POST /api/individuals/{classId}", required_roles: [], impact: [{ class_id: "*", operation: "add" as const, fields: ["*"], description: "新建一个通用个体" }], risk_id: null, confirmation: "none" as const, availability_source: "action-execution-factory" as const, availability: { allowed: true, reason: null } },
    { action_id: "individuals.update", label_cn: "编辑", placement: "row" as const, http_route: "PUT /api/individuals/{classId}/{individualId}", required_roles: [], impact: [{ class_id: "*", operation: "modify" as const, fields: ["*"], description: "更新个体字段" }], risk_id: null, confirmation: "none" as const, availability_source: "action-execution-factory" as const, availability: { allowed: true, reason: null } },
    { action_id: "individuals.update", label_cn: "保存修改", placement: "detail" as const, http_route: "PUT /api/individuals/{classId}/{individualId}", required_roles: [], impact: [{ class_id: "*", operation: "modify" as const, fields: ["*"], description: "更新个体字段" }], risk_id: null, confirmation: "none" as const, availability_source: "action-execution-factory" as const, availability: { allowed: true, reason: null } },
    { action_id: "individuals.retire", label_cn: "退役问题卡", placement: "row" as const, http_route: "POST /api/individuals/{classId}/{individualId}/retire", required_roles: [], impact: [{ class_id: "*", operation: "modify" as const, fields: ["lifecycle_status", "retired"], description: "个体退役不删除文件" }], risk_id: "individual-retire", confirmation: "confirm" as const, availability_source: "action-execution-factory" as const, availability: { allowed: true, reason: null } },
  ],
  empty: { component: "EmptyState" as const, variant: "no-data" as const, absence_kind: "faq-card-empty", primary_action_id: "individuals.create", guide: { what: "当前类还没有问题卡", where: "个体派生面 → 新建问题卡" } },
  custom_binding_key: null,
  states: {
    loading: { component: "TableLoading" as const, label_cn: "正在加载问题卡" },
    error: { component: "TableErrorState" as const, retry: true },
    forbidden: { component: "Alert" as const, variant: "warn" as const, message_cn: "当前身份无权执行此动作" },
    retired: { component: "Alert" as const, variant: "error" as const, message_cn: "该问题卡已退役", replacement_type_id: null },
  },
};
const config = {
  success: true,
  data: {
    classId: "FaqCard",
    fields: [
      { name: "question", display: "问题", required: true, type: "text", declared: true },
      { name: "answer", display: "答案", required: true, type: "text", declared: true },
      { name: "weight", display: "权重", required: false, type: "integer", declared: true },
    ],
    screen: screenContract,
    actions: { create: "POST /api/individuals/{classId}", list: "GET /api/individuals/{classId}", read: "GET /api/individuals/{classId}/{individualId}", update: "PUT /api/individuals/{classId}/{individualId}", retire: "POST /api/individuals/{classId}/{individualId}/retire" },
  },
};
const list = { success: true, data: [{ individualId: "faq-1", title: "问题一", revision: "sha256:a", fields: { question: "问题一", answer: "答", weight: 10 } }] };
const record = { success: true, data: { classId: "FaqCard", individualId: "faq-1", fields: { question: "问题一", answer: "答", faq_id: "f1" }, revision: "sha256:a" } };

async function loadClass(configValue: { success: boolean; data: IndividualUiConfig } = config) {
  api.fetchIndividualConfig.mockResolvedValue(configValue);
  api.fetchIndividualList.mockResolvedValue(list);
  render(<IndividualsView />);
  fireEvent.change(screen.getByPlaceholderText(/本体已声明/), { target: { value: "FaqCard" } });
  fireEvent.click(screen.getByRole("button", { name: "加载" }));
  await screen.findByRole("button", { name: "新建问题卡" });
}

describe("IndividualsView（派生面）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchIndividualClasses.mockResolvedValue(["FaqCard", "Entity"]);
  });

  it("config 驱动动态表单：屏幕分区与字段中文由契约渲染", async () => {
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "新建问题卡" }));
    expect(screen.getByText("问题内容")).toBeDefined();
    expect(screen.getByText("管理信息")).toBeDefined();
    expect(screen.getByLabelText("问题", { exact: true })).toBeDefined();
    expect(screen.getByLabelText("答案", { exact: true })).toBeDefined();
    expect(screen.getByLabelText("权重", { exact: true })).toBeDefined();
  });

  it("创建全链路：表单值经 createIndividual 发往通用面", async () => {
    api.createIndividual.mockResolvedValue({ success: true, data: { individualId: "faq-new", revision: "sha256:n" } });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "新建问题卡" }));
    fireEvent.change(screen.getByLabelText(/问题/), { target: { value: "新问题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.createIndividual).toHaveBeenCalledWith("FaqCard", { question: "新问题" }));
  });

  it("编辑仅提交类声明字段，忽略服务端回退标题与系统字段", async () => {
    api.fetchIndividual.mockResolvedValue({ success: true, data: {
      ...record.data, fields: { question: "问题一", answer: "完整答案", title: "faq-1", class_id: "FaqCard", individual_id: "faq-1", status: "active" },
    } });
    api.updateIndividual.mockResolvedValue({ success: true, data: {} });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await screen.findByRole("button", { name: "保存修改" });
    expect(screen.getByText("完整答案")).toBeDefined();
    fireEvent.change(screen.getByLabelText(/问题/), { target: { value: "修改问题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(api.updateIndividual).toHaveBeenCalledWith("FaqCard", "faq-1", { question: "修改问题", answer: "完整答案" }, "sha256:a"));
  });

  it("退役全链路：影响面二次确认→retireIndividual→空态指引", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    api.fetchIndividual.mockResolvedValue(record);
    api.retireIndividual.mockResolvedValue({ success: true, data: { retired: true } });
    api.fetchIndividualList.mockResolvedValueOnce(list).mockResolvedValueOnce({ success: true, data: [] });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "退役问题卡" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("个体退役不删除文件"));
    await waitFor(() => expect(api.retireIndividual).toHaveBeenCalledWith("FaqCard", "faq-1", "sha256:a"));
    await waitFor(() => expect(screen.getAllByText(/当前类还没有问题卡/).length).toBeGreaterThan(0));
    expect(screen.getByText(/个体派生面 → 新建问题卡/)).toBeDefined();
  });

  it("挂载即拉可用类清单作输入候选（WP-219）", async () => {
    api.fetchIndividualConfig.mockResolvedValue(config);
    api.fetchIndividualList.mockResolvedValue({ success: true, data: [] });
    render(<IndividualsView />);
    await waitFor(() => expect(api.fetchIndividualClasses).toHaveBeenCalledTimes(1));
  });

  it("类管理地图渲染：四族×管理面×通道一处看全", async () => {
    api.fetchIndividualConfig.mockResolvedValue(config);
    api.fetchIndividualList.mockResolvedValue({ success: true, data: [] });
    render(<IndividualsView />);
    await waitFor(() => expect(api.fetchIndividualClasses).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/类管理地图/)).toBeDefined();
    expect(screen.getByText(/内容族/)).toBeDefined();
    expect(screen.getByText(/知识文章/)).toBeDefined();
    expect(screen.getByText(/派生面新增/)).toBeDefined();
  });

  it("只改 screen.list.columns，正式页面无需改代码即换列", async () => {
    const changed = {
      ...config,
      data: { ...config.data, screen: { ...screenContract, list: { ...screenContract.list, columns: ["answer"] } } },
    };
    await loadClass(changed);
    expect(screen.getByRole("columnheader", { name: "答案" })).toBeDefined();
    expect(screen.queryByRole("columnheader", { name: "权重" })).toBeNull();
    expect(screen.getByText("答")).toBeDefined();
  });

  it("定制 renderer 不挂载通用清单，并指引正式文章工作流", async () => {
    const custom = {
      ...config,
      data: { ...config.data, screen: { ...screenContract, nav_item: "article-workflow", renderer: "custom:article-workflow" as const, custom_binding_key: "article-workflow" } },
    };
    api.fetchIndividualConfig.mockResolvedValue(custom);
    api.fetchIndividualList.mockResolvedValue(list);
    render(<IndividualsView />);
    fireEvent.change(screen.getByPlaceholderText(/本体已声明/), { target: { value: "KnowledgeArticle" } });
    fireEvent.click(screen.getByRole("button", { name: "加载" }));
    expect(await screen.findByText(/该种类由所属管理面维护/)).toBeDefined();
    expect(screen.queryByRole("columnheader", { name: "问题" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建问题卡" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "前往所属管理面" }));
    expect(window.location.hash).toBe("#/article-workflow");
  });

  it("产品模块契约只指引正式 Schema 模块页，不暴露通用死按钮", async () => {
    const moduleConfig = {
      ...config,
      data: {
        ...config.data,
        classId: "Module",
        screen: {
          ...screenContract,
          nav_item: "schema",
          buttons: screenContract.buttons.map((button) => ({
            ...button,
            action_id: button.action_id.replace("individuals.create", "schema.modules.upsert").replace("individuals.update", "schema.modules.upsert"),
            http_route: "PUT /api/schema/modules/{moduleId}",
          })),
        },
      },
    };
    api.fetchIndividualConfig.mockResolvedValue(moduleConfig);
    api.fetchIndividualList.mockResolvedValue({ success: true, data: [] });
    render(<IndividualsView />);
    fireEvent.change(screen.getByPlaceholderText(/本体已声明/), { target: { value: "Module" } });
    fireEvent.click(screen.getByRole("button", { name: "加载" }));
    expect(await screen.findByText(/该种类由所属管理面维护/)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "新建问题卡" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "前往所属管理面" }));
    expect(window.location.hash).toBe("#/schema?tab=modules");
  });

  it("列表重试成功后清除错误并恢复清单", async () => {
    api.fetchIndividualConfig.mockResolvedValue(config);
    api.fetchIndividualList.mockRejectedValueOnce(new Error("LIST_DOWN")).mockResolvedValueOnce(list);
    render(<IndividualsView />);
    fireEvent.change(screen.getByPlaceholderText(/本体已声明/), { target: { value: "FaqCard" } });
    fireEvent.click(screen.getByRole("button", { name: "加载" }));
    expect(await screen.findByText("LIST_DOWN")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("cell", { name: "问题一" })).toBeDefined();
    expect(screen.queryByText("LIST_DOWN")).toBeNull();
  });

  it("服务端 availability 拒绝时按钮禁用，前端不重造权限", async () => {
    const denied = {
      ...config,
      data: {
        ...config.data,
        screen: {
          ...screenContract,
          buttons: screenContract.buttons.map((button) => button.action_id === "individuals.create"
            ? { ...button, availability: { allowed: false, reason: "ROLE_DENIED" } }
            : button),
        },
      },
    };
    await loadClass(denied);
    expect((screen.getByRole("button", { name: "新建问题卡" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("ROLE_DENIED").length).toBeGreaterThan(0);
  });

  it("后端错误透传（fail-loud——后端为单一执法点）", async () => {
    api.createIndividual.mockResolvedValue({ success: false, data: null });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "新建问题卡" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
