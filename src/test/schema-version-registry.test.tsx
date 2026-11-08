import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaManagerView } from "@/features/schema-manager/SchemaManagerView";
import { useSchemaManagerStore } from "@/features/schema-manager/schema-manager-store";

vi.mock("@/features/schema-manager/schema-manager-api", () => ({
  fetchEnums: vi.fn(),
  previewEnumsChanges: vi.fn(),
  updateEnumsSections: vi.fn(),
}));
vi.mock("@/features/schema-manager/schema-write-api", () => ({
  writeOntology: vi.fn(), writeEnums: vi.fn(), writeDependencies: vi.fn(), writeVersions: vi.fn(), writeProductIdentity: vi.fn(), freezeVersion: vi.fn(), absorbDiscovery: vi.fn(), rollbackEnums: vi.fn(),
}));
vi.mock("@/features/schema-manager/dependencies-api", () => ({
  fetchDependencyRules: vi.fn(),
  validateDependencyRules: vi.fn(),
  updateDependencyRules: vi.fn(),
}));
vi.mock("@/features/schema-manager/version-registry-api", () => ({
  fetchProductIdentity: vi.fn(),
  fetchVersionRegistry: vi.fn(),
  validateVersionRegistry: vi.fn(),
  freezeProductVersion: vi.fn(),
  updateProductIdentity: vi.fn(),
}));

import { fetchEnums } from "@/features/schema-manager/schema-manager-api";
import { writeProductIdentity, writeVersions } from "@/features/schema-manager/schema-write-api";
import { fetchProductIdentity, fetchVersionRegistry, freezeProductVersion, validateVersionRegistry } from "@/features/schema-manager/version-registry-api";

const enums = { domains: { ops: "运维" }, subdomains: { ops: [] }, layers: [], categories: [] };
const versions = {
  schema_version: 1 as const,
  products: {
    AnyShare: {
      versions: [
        { id: "7.0.2", label: "AnyShare 7.0.2", status: "draft" as const, release_date: null, aliases: [], snapshot: null },
        { id: "7.0.1", label: "AnyShare 7.0.1", status: "released" as const, release_date: "2026-07-01", aliases: [], snapshot: { path: "知识库/architecture/AnyShare/7.0.1/architecture-version.snapshot.json", sha256: `sha256:${"a".repeat(64)}`, generated_at: "2026-07-01T00:00:00.000Z" } },
      ],
    },
  },
  diagnostics: [],
  revision: "sha256:registry",
  sourceFile: "知识库/TheSchema/versions.yaml",
  summary: { totalProducts: 1, totalVersions: 2, draft: 1, released: 1, deprecated: 0, errors: 0 },
};
const productIdentity = { canonicalProduct: "AnyShare", aliases: ["AS"], revision: "sha256:enums", sourceFile: "知识库/TheSchema/enums.yaml", renameSupported: false as const, configured: true };

describe("Schema product version registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEnums).mockResolvedValue(enums);
    vi.mocked(fetchVersionRegistry).mockResolvedValue(versions);
    vi.mocked(fetchProductIdentity).mockResolvedValue(productIdentity);
    vi.mocked(validateVersionRegistry).mockResolvedValue(versions);
    vi.mocked(freezeProductVersion).mockResolvedValue({
      success: true as const,
      data: {
        category: "versions",
        product: "AnyShare",
        version: "7.0.2",
        affectedFiles: ["知识库/TheSchema/versions.yaml", "知识库/architecture/AnyShare/7.0.2/architecture-version.snapshot.json"],
        revision: "sha256:frozen",
      },
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    useSchemaManagerStore.setState({
      activeTab: "domains",
      enums: null,
      savedEnums: null,
      status: "idle",
      error: null,
      saveStatus: "clean",
      saveError: null,
      versions: null,
      versionsSaved: null,
      versionsRequest: { status: "idle", error: null },
      versionsSaveStatus: "clean",
      versionsSaveError: null,
      productIdentity: null,
      productIdentitySaved: null,
      productIdentitySaveStatus: "clean",
      productIdentityError: null,
    });
    vi.mocked(writeProductIdentity).mockResolvedValue({ category: "product-identity", revision: "sha256:pi" });
    vi.mocked(writeVersions).mockResolvedValue({ category: "versions", revision: "sha256:vs" });
  });

  it("loads, edits, validates, and commits product versions directly to the authoritative registry", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "产品版本" }));
    const editor = await screen.findByTestId("version-registry-editor");
    expect(editor).toHaveTextContent("知识库/TheSchema/versions.yaml");
    expect(within(editor).getByText("已发布")).toBeInTheDocument();
    expect(within(editor).getByText("草稿")).toBeInTheDocument();
    expect(within(editor).getByRole("textbox", { name: "主产品名（身份锚点）" })).toHaveValue("AnyShare");
    expect(within(editor).getByRole("textbox", { name: "主产品名（身份锚点）" })).toHaveAttribute("readonly"); // 已设定态身份锚点只读（改名=换身份）
    expect(within(editor).queryByRole("textbox", { name: "新产品 ID" })).not.toBeInTheDocument();

    fireEvent.change(within(editor).getByRole("textbox", { name: "产品别名" }), { target: { value: "AS, AnyShare Enterprise" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存别名" })); // 已设定态按钮文案回「保存别名」
    await waitFor(() => expect(writeProductIdentity).toHaveBeenCalledWith("sha256:enums", { aliases: ["AS", "AnyShare Enterprise"] })); // 已设定态不携 product（首次设定语义）

    fireEvent.change(within(editor).getByRole("textbox", { name: "第 1 个显示名称" }), { target: { value: "AnyShare 7.0.2 LTS" } });
    const save = within(layout).getByRole("button", { name: "保存规则" });
    expect(save).toBeEnabled();
    fireEvent.click(within(editor).getByRole("button", { name: "验证产品版本" }));
    await waitFor(() => expect(validateVersionRegistry).toHaveBeenCalledOnce());
    fireEvent.click(save);
    await waitFor(() => expect(writeVersions).toHaveBeenCalledWith("sha256:registry", expect.objectContaining({ products: expect.any(Object) })));
    expect(freezeProductVersion).not.toHaveBeenCalled();
  });

  it("shows the comparison prerequisite when fewer than two versions exist", async () => {
    vi.mocked(fetchVersionRegistry).mockResolvedValue({
      ...versions,
      products: { AnyShare: { versions: [versions.products.AnyShare.versions[0]] } },
      summary: { ...versions.summary, totalVersions: 1, released: 0 },
    });
    render(<SchemaManagerView />);
    await screen.findByTestId("schema-manager-layout");
    fireEvent.click(screen.getByRole("button", { name: "产品版本" }));
    expect(await screen.findByText("至少登记两个产品版本后才能进行版本分析")).toBeInTheDocument();
  });

  it("submits version freeze directly to the authoritative source", async () => {
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "产品版本" }));
    fireEvent.click(await screen.findByRole("button", { name: "提交冻结 7.0.2" }));
    await waitFor(() => expect(freezeProductVersion).toHaveBeenCalledWith("sha256:registry", "AnyShare", "7.0.2"));
    expect(writeVersions).not.toHaveBeenCalled();
  });

  it("freeze confirmation dialog states direct write-back without legacy approval narrative", async () => {
    const confirmSpy = vi.fn((_message: string) => true);
    vi.stubGlobal("confirm", confirmSpy);
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "产品版本" }));
    fireEvent.click(await screen.findByRole("button", { name: "提交冻结 7.0.2" }));
    await waitFor(() => expect(freezeProductVersion).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledOnce();
    const message = String(confirmSpy.mock.calls[0][0]);
    expect(message).toContain("直接写回");
    expect(message).not.toMatch(/Proposal|批准与合并/);
  });

  it("explains invalid version numbers on the affected row", async () => {
    vi.mocked(validateVersionRegistry).mockResolvedValue({
      ...versions,
      diagnostics: [{
        severity: "error",
        code: "INVALID_VERSION",
        message: "版本必须是 X.Y 到 X.Y.Z.W 格式的精确版本号",
        path: "$.products.AnyShare.versions[0].id",
        details: { value: "A1" },
      }],
      summary: { ...versions.summary, errors: 1 },
    });
    render(<SchemaManagerView />);
    const layout = await screen.findByTestId("schema-manager-layout");
    fireEvent.click(within(layout).getByRole("button", { name: "产品版本" }));
    const editor = await screen.findByTestId("version-registry-editor");

    expect(within(editor).getByText("版本号")).toBeInTheDocument();
    expect(within(editor).getByText("显示名称")).toBeInTheDocument();
    expect(within(editor).getByRole("textbox", { name: "第 1 个版本号" })).toHaveAttribute("placeholder", "例如 7.0.6.8");
    expect(within(editor).getByRole("textbox", { name: "第 1 个显示名称" })).toHaveAttribute("placeholder", "例如 MyProduct 1.0.0");
    expect(within(editor).getByRole("textbox", { name: "第 1 个版本别名" })).toHaveAttribute("placeholder", "多个别名用英文逗号分隔");

    fireEvent.change(within(editor).getByRole("textbox", { name: "第 1 个版本号" }), { target: { value: "A1" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "第 1 个显示名称" }), { target: { value: "2.2.2.2" } });
    fireEvent.click(within(editor).getByRole("button", { name: "验证产品版本" }));

    expect(await within(editor).findByText(/版本号“A1”格式不正确/)).toHaveTextContent("请填写 2.2、2.2.2 或 2.2.2.2");
    expect(within(editor).getByText(/显示名称“2.2.2.2”看起来像版本号/)).toBeInTheDocument();
    expect(within(editor).getByRole("textbox", { name: "第 1 个版本号" })).toHaveAttribute("aria-invalid", "true");
    expect(editor).not.toHaveTextContent("$.products.AnyShare.versions[0].id");
  });
});
