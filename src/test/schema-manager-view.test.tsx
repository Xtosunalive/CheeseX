// Smoke test for SchemaManagerView
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SchemaManagerView } from "@/features/schema-manager/SchemaManagerView";

vi.mock("@/features/schema-manager/schema-manager-api", () => ({
  fetchEnums: vi.fn(),
  previewEnumsChanges: vi.fn(),
}));
vi.mock("@/features/schema-manager/schema-write-api", () => ({
  writeOntology: vi.fn(),
  writeEnums: vi.fn(),
  writeDependencies: vi.fn(),
  writeVersions: vi.fn(),
  writeProductIdentity: vi.fn(),
  freezeVersion: vi.fn(),
  absorbDiscovery: vi.fn(),
  rollbackEnums: vi.fn(),
}));
vi.mock("@/features/schema-manager/dependencies-api", () => ({
  fetchDependencyRules: vi.fn(),
  previewDependencyRules: vi.fn(),
  validateDependencyRules: vi.fn(),
  updateDependencyRules: vi.fn(),
}));
vi.mock("@/lib/pipeline-api", () => ({
  runPipeline: vi.fn(),
}));

import { fetchEnums, previewEnumsChanges } from "@/features/schema-manager/schema-manager-api";
import { writeEnums } from "@/features/schema-manager/schema-write-api";
import { fetchDependencyRules, previewDependencyRules } from "@/features/schema-manager/dependencies-api";
import { runPipeline } from "@/lib/pipeline-api";
import { useSchemaManagerStore } from "@/features/schema-manager/schema-manager-store";
import { TAB_LABELS } from "@/features/schema-manager/schema-manager-types";

const MOCK_ENUMS = {
  domains: { ops: "运维操作", ref: "参考资料" },
  subdomains: { ops: [{ id: "deploy" }, { id: "monitor" }], ref: [{ id: "architecture" }] },
  subdomain_constraints: {},
  layers: [
    { id: "external", label: "外部系统", color: "gray", layout: "left-panel" as const },
    { id: "gateway", label: "网关", color: "slate", layout: "central" as const },
  ],
  categories: ["终端", "服务"],
  article_types: [],
  doc_types: [],
  modules: {
    部署服务: { subdomain: "deploy", system: "deploy-service", since: "7.0.0", until: "", products: ["AnyShare"], parent_id: "" },
  },
  tags: {},
  tag_aliases: {},
  disabled_tags: [],
  revision: "sha256:rules",
  sourceFile: "知识库/TheSchema/enums.yaml",
};

const MOCK_DEPENDENCIES = {
  items: [
    { id: "dep-0", source: "client", target: "gateway", type: "DEPENDS_ON", since: "v1.0", until: null, origin: "manual" as const },
  ],
  diagnostics: [],
  revision: "sha256:abc123",
  sourceFile: "知识库/TheSchema/dependencies.yaml",
  managedScope: "architecture-component-or-graph-entity-id" as const,
  relationTypeOptions: [{ id: "DEPENDS_ON", label: "依赖", versionable: true }],
  entityOptions: [
    { id: "client", label: "客户端", scope: "architecture-component" as const },
    { id: "gateway", label: "网关", scope: "architecture-component" as const },
  ],
  summary: { total: 1, errors: 0, warnings: 0 },
};

describe("SchemaManagerView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/schema";
    // Reset Zustand store state between tests
    useSchemaManagerStore.setState({
      activeTab: "domains",
      enums: null,
      savedEnums: null,
      status: "idle",
      error: null,
      saveStatus: "clean",
      saveError: null,
      dependencies: null,
      dependenciesSaved: null,
      dependenciesRequest: { status: "idle", error: null },
      dependenciesSaveStatus: "clean",
      dependenciesSaveError: null,
      dependencyPreview: null,
      dependencyPreviewLoading: false,
    });
    vi.mocked(writeEnums).mockResolvedValue({ category: "enums", revision: "sha256:after" });
  });

  it("opens the product version tab from a validated hash deep link", async () => {
    window.location.hash = "#/schema?tab=versions";
    vi.mocked(fetchEnums).mockReturnValue(new Promise(() => {}));
    useSchemaManagerStore.setState({ versionsRequest: { status: "loading", error: null } });
    render(<SchemaManagerView />);
    await waitFor(() => expect(useSchemaManagerStore.getState().activeTab).toBe("versions"));
  });

  it("renders loading spinner initially", () => {
    vi.mocked(fetchEnums).mockReturnValue(new Promise(() => {}));
    render(<SchemaManagerView />);
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders sidebar navigation with grouped items after data loads", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——数据就绪改由侧栏分组按钮断言
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "架构分层" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "实体类别" })).toBeInTheDocument();
  });

  it("seq202: 侧栏标签消费 TAB_LABELS 单源——2 漂移键归一且旧漂移值绝迹", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);
    await waitFor(() => expect(screen.getByRole("button", { name: "版本快照" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "未收录值" })).toBeInTheDocument();
    expect(screen.queryByText("Schema 快照")).not.toBeInTheDocument();
    expect(screen.queryByText("待沉淀枚举")).not.toBeInTheDocument();
    expect(screen.queryByText("待沉淀标签")).not.toBeInTheDocument(); // Master 2026-10-23 已裁决定名「未收录值」
  });

  it("renders the local classification tree and editor as one continuous workspace", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    const localSidebar = within(layout).getByLabelText("分类结构专属目录");
    const classificationLayout = within(layout).getByTestId("classification-tab-layout");
    expect(localSidebar.parentElement).toBe(classificationLayout);
    expect(layout).toHaveClass("rounded-xl", "ring-1", "overflow-hidden");
    expect(layout).not.toHaveClass("gap-4");
    expect(localSidebar).not.toHaveClass("rounded-xl", "ring-1");
    expect(localSidebar).toHaveClass("border-r");
    expect(within(localSidebar).getByText("参考资料")).toBeInTheDocument();
    expect(within(localSidebar).getByText("deploy")).toBeInTheDocument();
    expect(within(localSidebar).queryByText("backup")).not.toBeInTheDocument();
    expect(within(localSidebar).getByText("新增分类")).toBeInTheDocument();
    expect(within(localSidebar).getByRole("button", { name: "添加分类" })).toBeDisabled();
    expect(within(layout).getByRole("button", { name: "知识域/子域" })).toBeInTheDocument();
    expect(within(layout).getByRole("button", { name: "架构分层" })).toBeInTheDocument();
    expect(within(classificationLayout).getByText("子域 — 参考资料")).toBeInTheDocument();
    expect(within(classificationLayout).getByRole("button", { name: "重命名分类" })).toBeInTheDocument();
    expect(within(classificationLayout).getByRole("button", { name: "删除分类" })).toBeInTheDocument();
    expect(within(classificationLayout).getAllByRole("button", { name: "添加分类" })).toHaveLength(1);
    fireEvent.change(within(localSidebar).getByPlaceholderText("ID (英文)"), { target: { value: "new-domain" } });
    fireEvent.change(within(localSidebar).getByPlaceholderText("标签 (中文)"), { target: { value: "新分类" } });
    fireEvent.click(within(localSidebar).getByRole("button", { name: "添加分类" }));
    expect(within(localSidebar).getByText("新分类")).toBeInTheDocument();
    expect(useSchemaManagerStore.getState().enums?.domains["new-domain"]).toBe("新分类");
    fireEvent.click(within(layout).getByRole("button", { name: "架构分层" }));
    expect(within(layout).queryByLabelText("分类结构专属目录")).not.toBeInTheDocument();
  });

  it("switches the edited label when selecting different subdomains", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);

    const layout = await screen.findByTestId("schema-manager-layout");
    const localSidebar = within(layout).getByLabelText("分类结构专属目录");
    const editor = within(layout).getByRole("region", { name: "子域编辑区" });

    fireEvent.click(within(localSidebar).getByRole("button", { name: "deploy" }));
    expect(within(editor).getByText("deploy")).toBeInTheDocument();
    expect(within(editor).queryByText("monitor")).not.toBeInTheDocument();

    fireEvent.click(within(localSidebar).getByRole("button", { name: "monitor" }));
    expect(within(editor).getByText("monitor")).toBeInTheDocument();
    expect(within(editor).queryByText("deploy")).not.toBeInTheDocument();
  });

  it("shows save button disabled when clean", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);
    await waitFor(() => {
      expect(screen.getByText("保存规则")).toBeDisabled();
    });
  });

  it("does not open the pipeline dialog after saving", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存规则" })).toBeDisabled();
    });

    useSchemaManagerStore.setState({
      enums: {
        ...MOCK_ENUMS,
        layers: [
          ...MOCK_ENUMS.layers,
          { id: "edge", label: "边缘层", color: "cyan", layout: "right-panel" as const },
        ],
      },
      savedEnums: MOCK_ENUMS,
      saveStatus: "dirty",
    });

    render(<SchemaManagerView />);
      fireEvent.click(screen.getAllByRole("button", { name: "保存规则" })[0]);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "运行管道" })).not.toBeInTheDocument();
    });
  });

  it("saves only the dirty section diff, without read-only projection fields (tr_70af34a6)", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存规则" })).toBeDisabled();
    });

    // 复现现场：删除一个实体类别后点保存——patch 若整包回写 GET 投影（lifecycle_status/sourceFile），
    // 会被 PUT /api/schema/enums 写闸门以 Unknown section 400 拒绝
    act(() => {
      useSchemaManagerStore.setState({
        enums: { ...MOCK_ENUMS, categories: ["服务"] },
        savedEnums: MOCK_ENUMS,
        saveStatus: "dirty",
      });
    });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "保存规则" })[0]).toBeEnabled());

    fireEvent.click(screen.getAllByRole("button", { name: "保存规则" })[0]);

    await waitFor(() => expect(writeEnums).toHaveBeenCalledTimes(1));
    const [revisionArg, patchArg] = vi.mocked(writeEnums).mock.calls[0];
    expect(revisionArg).toBe("sha256:rules");
    expect(patchArg).toEqual({ categories: ["服务"] });
  });

  it("requires evidence preview and confirmation before saving a subdomain rename", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    vi.mocked(previewEnumsChanges).mockResolvedValue({
      previewId: "preview-1",
      expiresAt: "2026-07-20T12:00:00.000Z",
      source: { sourceFile: "知识库/TheSchema/enums.yaml", revision: "sha256:rules" },
      changes: { removed: [{ domainId: "ops", value: "deploy" }], added: [{ domainId: "ops", value: "release" }] },
      affectedModules: [{ name: "部署服务", before: "deploy", after: "release" }],
      affectedDocuments: [{ documentId: "node:deploy-node", title: "部署节点", sourcePath: "知识库/wiki/entities/deploy-node.md", sourceHash: "sha256:doc", lineNumber: 5, currentValue: "deploy" }],
      diagnostics: [],
      summary: { removedValues: 1, addedValues: 1, modules: 1, documents: 1, invalidDocuments: 0 },
    });

    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    const localSidebar = within(layout).getByLabelText("分类结构专属目录");
    fireEvent.click(within(localSidebar).getByRole("button", { name: "deploy" }));
    const editor = within(layout).getByRole("region", { name: "子域编辑区" });
    fireEvent.click(within(editor).getByTitle("编辑")); // ADR-008 D1：词条对象化后按钮语义=编辑（id+label）
    fireEvent.change(within(editor).getByDisplayValue("deploy"), { target: { value: "release" } });
    fireEvent.keyDown(within(editor).getByDisplayValue("release"), { key: "Enter" });
    expect(within(layout).getByText("尚未生效：deploy → release")).toBeInTheDocument();

    fireEvent.click(within(layout).getByRole("button", { name: "保存规则" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("确认分类身份变更");
    expect(screen.getByText("知识库/wiki/entities/deploy-node.md:5 · 当前值 deploy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(within(layout).getByRole("button", { name: "保存规则" }));
    await screen.findByRole("dialog");
    // WP-142 批⓪：确认按钮只保存规则不重跑管道，文案与行为对齐，按钮不得再出现"重跑"承诺
    const confirmButton = screen.getByRole("button", { name: "确认修改并保存" });
    expect(confirmButton).not.toHaveTextContent("重跑");
    fireEvent.click(confirmButton);
    await waitFor(() => expect(writeEnums).toHaveBeenCalledWith("sha256:rules", expect.objectContaining({ subdomains: expect.objectContaining({ ops: [{ id: "release" }, { id: "monitor" }] }) }))); // ADR-008 D1 词条对象形态
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("shows error message with retry button on load failure", async () => {
    vi.mocked(fetchEnums).mockRejectedValue(new Error("网络错误"));
    render(<SchemaManagerView />);
    await waitFor(() => {
      expect(screen.getByText("网络错误")).toBeInTheDocument();
    });
  });

  it("renders dependency rules with shared controls and accurate boundary copy", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    vi.mocked(fetchDependencyRules).mockResolvedValue(MOCK_DEPENDENCIES);
    render(<SchemaManagerView />);

    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "依赖版本区间" }));

    const editor = await screen.findByTestId("dependency-rules-editor");
    expect(editor).toHaveTextContent("依赖规则维护版本范围和来源，可导入、筛选与删除。");
    expect(editor).toHaveTextContent("知识库/TheSchema/dependencies.yaml");
    expect(within(editor).getByRole("button", { name: "筛选源实体" })).toHaveAttribute("data-select-variant", "filter");
    expect(within(editor).getByRole("button", { name: "筛选目标实体" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "筛选来源" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "校验" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "新增" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "导入规则" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "第 1 条源实体" })).toHaveTextContent("客户端");
    expect(within(editor).getByRole("button", { name: "第 1 条目标实体" })).toHaveTextContent("网关");
    expect(within(editor).getByRole("button", { name: "第 1 条关系类型" })).toHaveTextContent("依赖");
    expect(within(editor).queryByText("client")).not.toBeInTheDocument();
    expect(within(editor).queryByText("gateway")).not.toBeInTheDocument();
    expect(within(editor).queryByText("DEPENDS_ON")).not.toBeInTheDocument();
    expect(within(editor).getByTestId("table-pagination")).toHaveTextContent("1–1 / 共 1");

    vi.mocked(previewDependencyRules).mockResolvedValue({
      revision: "sha256:abc123", diagnostics: [],
      affectedVersions: [{ product: "AnyShare", version: "2.0", status: "draft", added: [{ source: "client", target: "gateway", type: "DEPENDS_ON" }], removed: [], componentIds: ["client", "gateway"], paths: [], documents: [] }],
      reasoning: { sourceRevision: "sha256:reasoning", candidates: [], conflicts: [], results: [], status: "clear", writeAllowed: true },
      summary: { versions: 1, relationsAdded: 1, relationsRemoved: 0, components: 2, paths: 0, documents: 0 },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("region", { name: "依赖规则影响预览" })).toHaveTextContent("受影响版本");
    expect(screen.getByRole("region", { name: "变更决策状态" })).toHaveTextContent("未发现额外处置条件");
    expect(screen.getByRole("button", { name: "保存规则" })).not.toHaveTextContent("保存中");
  });

  // ── SCHEMA-IA-001 批2：导航形态并存＋切换装配（默认目录镜像维持 SPEC-019 A 档字面） ──

  it("PD-1 裁后（Master 2026-10-26「1A 只留意图分区」）：意图分区为唯一导航，目录镜像与切换钮退役", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    expect(within(layout).getByTestId("schema-intent-nav")).toBeInTheDocument();
    expect(within(layout).queryByTestId("schema-file-tree")).not.toBeInTheDocument();
    expect(within(layout).queryByTestId("schema-nav-mode")).not.toBeInTheDocument();
  });

  it("批2: 意图分区形态下 13 页签可达（叶名＝TAB_LABELS 单源）且切换页签生效", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    const intentNav = within(layout).getByTestId("schema-intent-nav");
    for (const label of Object.values(TAB_LABELS)) {
      expect(within(intentNav).getByRole("button", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(within(intentNav).getByRole("button", { name: "版本快照" }));
    expect(useSchemaManagerStore.getState().activeTab).toBe("history");
  });

  it("批2: 干净数据下悬空警示条不渲染（能改变才呈现）；深链两形态行为一致", async () => {
    vi.mocked(fetchEnums).mockResolvedValue(MOCK_ENUMS);
    window.location.hash = "#/schema?tab=versions";
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    await waitFor(() => expect(useSchemaManagerStore.getState().activeTab).toBe("versions"));
    expect(within(layout).queryByTestId("schema-dangling-notice")).not.toBeInTheDocument();
  });

});
