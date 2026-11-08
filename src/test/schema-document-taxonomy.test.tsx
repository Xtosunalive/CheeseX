import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaManagerView } from "@/features/schema-manager/SchemaManagerView";
import { useSchemaManagerStore } from "@/features/schema-manager/schema-manager-store";

vi.mock("@/features/schema-manager/schema-manager-api", () => ({
  fetchEnums: vi.fn(),
  previewEnumsChanges: vi.fn(),
}));
vi.mock("@/features/schema-manager/schema-write-api", () => ({
  writeOntology: vi.fn(), writeEnums: vi.fn(), writeDependencies: vi.fn(), writeVersions: vi.fn(), writeProductIdentity: vi.fn(), freezeVersion: vi.fn(), absorbDiscovery: vi.fn(), rollbackEnums: vi.fn(),
}));
vi.mock("@/features/schema-manager/dependencies-api", () => ({
  fetchDependencyRules: vi.fn(), validateDependencyRules: vi.fn(), updateDependencyRules: vi.fn(),
}));
vi.mock("@/features/schema-manager/version-registry-api", () => ({
  fetchVersionRegistry: vi.fn(), validateVersionRegistry: vi.fn(), updateVersionRegistry: vi.fn(), freezeProductVersion: vi.fn(),
}));

import { fetchEnums } from "@/features/schema-manager/schema-manager-api";
import { writeEnums } from "@/features/schema-manager/schema-write-api";

const enums = {
  domains: { ops: "运维" },
  subdomains: { ops: [{ id: "service", label: "核心服务域" }] },
  layers: [],
  categories: [],
  article_types: ["排错指南", "最佳实践"],
  doc_types: ["用户手册", "部署指南"],
  modules: {
    核心服务: { subdomain: "service", system: "core-service", since: "7.0.0", until: "", products: ["AnyShare"] },
  },
  revision: "sha256:enums",
  sourceFile: "知识库/TheSchema/enums.yaml",
};

describe("Schema document taxonomy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEnums).mockResolvedValue(enums);
    useSchemaManagerStore.setState({
      activeTab: "domains",
      enums: null,
      savedEnums: null,
      status: "idle",
      error: null,
      saveStatus: "clean",
      saveError: null,
    });
    vi.mocked(writeEnums).mockResolvedValue({ category: "enums", revision: "sha256:after" });
  });

  it("edits taxonomy and commits the complete enums candidate to the open Proposal", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "文章字段值域" }));

    const editor = await screen.findByTestId("document-taxonomy-editor");
    expect(editor).toHaveTextContent("知识文章类型");
    expect(editor).toHaveTextContent("文档类型");
    expect(editor).not.toHaveTextContent("产品模块"); // 批10 拆独立页签
    expect(within(editor).getByRole("textbox", { name: "知识文章类型 1" })).toHaveValue("排错指南");

    fireEvent.change(within(editor).getByRole("textbox", { name: "新增知识文章类型" }), { target: { value: "升级经验" } });
    fireEvent.click(within(editor).getByRole("button", { name: "添加知识文章类型" }));
    fireEvent.click(within(layout).getByRole("button", { name: "保存规则" }));

    await waitFor(() => expect(writeEnums).toHaveBeenCalledWith("sha256:enums", expect.objectContaining({ article_types: ["排错指南", "最佳实践", "升级经验"] })));
  });

  it("preserves module metadata while editing product modules", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "文章字段值域" }));
    await screen.findByTestId("document-taxonomy-editor");
    fireEvent.click(within(layout).getByRole("button", { name: "产品模块" }));

    expect(screen.getByRole("button", { name: "核心服务 subdomain" })).toBeInTheDocument();
    // WP-040 裁⑤：父模块/起始/截止列退役——版本区间作为兼容位随编辑保留（不再暴露编辑面）
    expect(screen.queryByRole("textbox", { name: "核心服务 until" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "核心服务 system" }), { target: { value: "core-service-2" } }); // system 挂 datalist 建议——a11y 角色=combobox（until 列无 datalist 故原为 textbox）
    expect(useSchemaManagerStore.getState().enums?.modules["核心服务"]).toEqual({
      subdomain: "service", system: "core-service-2", since: "7.0.0", until: "", products: ["AnyShare"], // 夹具 until 本为空（原测试靠已退役的 until 编辑面填值）
    });
  });
});

// ── 批9：编辑器语义化（标题派生/子域挂靠走词表/空表引导）──
describe("批9 模块编辑器关系接线", () => {
  it("页签标题派生自字典正名（文章字段值域），不再硬编码旧名", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "文章字段值域" }));
    const editor = await screen.findByTestId("document-taxonomy-editor");
    expect(within(editor).getByText("文章字段值域")).toBeInTheDocument();
    expect(within(editor).queryByText("文档分类")).not.toBeInTheDocument();
  });

  it("subdomain 挂靠从子域词表选取（FilterSelect，值=子域 id）", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "文章字段值域" }));
    await screen.findByTestId("document-taxonomy-editor");
    fireEvent.click(within(layout).getByRole("button", { name: "产品模块" }));
    const trigger = await screen.findByRole("button", { name: "核心服务 subdomain" });
    expect(trigger).toHaveTextContent("核心服务域 · service");
  });
});

describe("批10 拆页签", () => {
  it("taxonomy 页签只剩两个值域轴（产品模块子区钮绝迹），模块走独立页签", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "文章字段值域" }));
    const editor = await screen.findByTestId("document-taxonomy-editor");
    expect(within(editor).queryByRole("button", { name: "产品模块" })).not.toBeInTheDocument();
    expect(within(layout).getByRole("button", { name: "产品模块" })).toBeInTheDocument();
  });
});
