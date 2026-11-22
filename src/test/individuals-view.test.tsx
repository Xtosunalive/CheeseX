// WP-210（SPEC-100 批 4）：个体派生面视图测试——mock api 层，验渲染/交互（创建/编辑/退役）。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IndividualsView } from "@/features/individuals/IndividualsView";

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

const config = {
  success: true,
  data: {
    classId: "FaqCard",
    fields: [
      { name: "question", display: "问题", required: true, type: "text", declared: true },
      { name: "weight", display: "权重", required: false, type: "integer", declared: false },
    ],
    actions: { create: "POST /api/individuals/{classId}", list: "GET /api/individuals/{classId}", read: "GET /api/individuals/{classId}/{individualId}", update: "PUT /api/individuals/{classId}/{individualId}", retire: "POST /api/individuals/{classId}/{individualId}/retire" },
  },
};
const list = { success: true, data: [{ individualId: "faq-1", title: "问题一", revision: "sha256:a" }] };
const record = { success: true, data: { classId: "FaqCard", individualId: "faq-1", fields: { question: "问题一", answer: "答", faq_id: "f1" }, revision: "sha256:a" } };

async function loadClass() {
  api.fetchIndividualConfig.mockResolvedValue(config);
  api.fetchIndividualList.mockResolvedValue(list);
  render(<IndividualsView />);
  fireEvent.change(screen.getByPlaceholderText(/本体已声明/), { target: { value: "FaqCard" } });
  fireEvent.click(screen.getByRole("button", { name: "加载" }));
  await screen.findByRole("button", { name: "创建" }); // 等 config 装载与状态落定
}

describe("IndividualsView（派生面）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchIndividualClasses.mockResolvedValue(["FaqCard", "Entity"]);
  });

  it("config 驱动动态表单：中文 display 渲染＋必填标记＋未声明标注", async () => {
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(screen.getByText("问题")).toBeDefined();
    expect(screen.getByText("必填")).toBeDefined();
    expect(screen.getByText(/未声明/)).toBeDefined();
  });

  it("创建全链路：表单值经 createIndividual 发往通用面", async () => {
    api.createIndividual.mockResolvedValue({ success: true, data: { individualId: "faq-new", revision: "sha256:n" } });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.change(screen.getByLabelText(/问题/), { target: { value: "新问题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.createIndividual).toHaveBeenCalledWith("FaqCard", { question: "新问题" }));
  });

  it("退役全链路：list 行退役按钮→retireIndividual→清单刷新", async () => {
    api.fetchIndividual.mockResolvedValue(record);
    api.retireIndividual.mockResolvedValue({ success: true, data: { retired: true } });
    api.fetchIndividualList.mockResolvedValueOnce(list).mockResolvedValueOnce({ success: true, data: [] });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "退役" }));
    await waitFor(() => expect(api.retireIndividual).toHaveBeenCalledWith("FaqCard", "faq-1", "sha256:a"));
    await waitFor(() => expect(screen.getByText(/空数据态合法/)).toBeDefined());
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
    expect(screen.getByText(/类管理地图/)).toBeDefined();
    expect(screen.getByText(/内容族/)).toBeDefined();
    expect(screen.getByText(/知识文章/)).toBeDefined();
    expect(screen.getByText(/派生面新增/)).toBeDefined();
  });

  it("后端错误透传（fail-loud——后端为单一执法点）", async () => {
    api.createIndividual.mockResolvedValue({ success: false, data: null });
    await loadClass();
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });
});
