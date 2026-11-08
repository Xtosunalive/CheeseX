import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

// B1/B2 回归：批量「补齐字段」弹窗的多字段路径必须直连 /api/entity/repair/*（契约类型化薄封装），
// 不得再走单议题 POST /api/anomalies/:issueId/preview（adapter 单字段闸门恒 400，#1410）。
const api = vi.hoisted(() => ({
  fetchArticleRepairOptions: vi.fn(),
  fetchEntityCompliance: vi.fn(),
  fetchEnums: vi.fn(),
  fetchVersionRegistry: vi.fn().mockResolvedValue({ schema_version: 1, revision: "r", sourceFile: "versions.yaml", summary: {}, products: {}, diagnostics: [] }),
  previewEntityRepair: vi.fn(),
  applyEntityRepair: vi.fn(),
}));
vi.mock("@/features/anomaly-workbench/anomaly-workbench-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/anomaly-workbench/anomaly-workbench-api")>()),
  fetchArticleRepairOptions: api.fetchArticleRepairOptions,
}));
vi.mock("@/features/entity-compliance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/entity-compliance")>()),
  fetchEntityCompliance: api.fetchEntityCompliance,
}));
vi.mock("@/features/schema-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/schema-manager")>()),
  fetchEnums: api.fetchEnums,
}));
vi.mock("@/lib/domain/entity-repair-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/entity-repair-api")>()),
  previewEntityRepair: api.previewEntityRepair,
  applyEntityRepair: api.applyEntityRepair,
}));

const SOURCE_KEY = "知识库/raw/precleaned/样本X.md";
const SOURCE_REVISION = { mtimeMs: 1715000000000, contentHash: "sha256:abc", size: 100 };

function fieldIssue(field: string, issueId: string): AnomalyIssue {
  return {
    issueId,
    issueKind: "missing_field",
    title: `${field} 是标准文章必填字段`,
    status: "open",
    evidence: [{ kind: "entity-compliance", path: SOURCE_KEY, ruleId: "A06" }],
    proposedAction: { type: "entity-repair", sourceKey: SOURCE_KEY, field },
    expectedRevisions: { sourceRevision: SOURCE_REVISION },
    executionReady: true,
  } as unknown as AnomalyIssue;
}

const articleTypeIssue = fieldIssue("article_type", "entity-x-A06");
const moduleIssue = fieldIssue("module", "entity-x-A05");

function setup() {
  api.fetchEntityCompliance.mockRejectedValue(new Error("文章源合规不强制"));
  api.fetchEnums.mockResolvedValue({ layers: [], categories: [], subdomains: {} });
  api.fetchArticleRepairOptions.mockResolvedValue({
    products: [{ name: "AnyShare", versions: ["7.0.6.7"] }],
    articleTypes: ["排错指南", "常见问题"],
    modules: ["可观测性"],
    docTypes: ["技术文档"],
    categoryPaths: ["ops:deploy"],
    articleFields: [
      // PR-151 续：选项映射按 optionsKey 取包（对齐服务端真实形状——契约派生必带 optionsKey）
      { field: "article_type", label: "知识文章类型", control: "select", required: true, optionsKey: "articleTypes", completable: true },
      { field: "module", label: "产品模块", control: "select", required: true, optionsKey: "modules", completable: true },
    ],
  });
  api.previewEntityRepair.mockReset();
  api.applyEntityRepair.mockReset();
}

function mount(overrides: Partial<Parameters<typeof AnomalyEntityRepairDrawer>[0]> = {}) {
  const onPreview = vi.fn<(payload: Record<string, unknown>) => void>();
  const onConfirm = vi.fn<(previewId: string) => void>();
  const onClose = vi.fn<() => void>();
  const props = {
    issue: articleTypeIssue,
    relatedIssues: [articleTypeIssue, moduleIssue],
    error: null,
    onPreview,
    onConfirm,
    onClose,
    ...overrides,
  };
  const view = render(<AnomalyEntityRepairDrawer {...props} />);
  return { view, props, onPreview, onConfirm, onClose };
}

/** PR-050：文章受管字段收敛为单源控件（原生 select）——交互改 fireEvent.change，值断言读 select.value */
async function pick(label: string, option: string) {
  const select = await screen.findByRole("combobox", { name: label });
  fireEvent.change(select, { target: { value: option } });
}

async function fillTwoFields() {
  await pick("知识文章类型", "排错指南");
  await pick("产品模块", "可观测性");
}

function triggerValues(label: string): string {
  return (screen.getByRole("combobox", { name: label }) as HTMLSelectElement).value || "";
}

describe("AnomalyEntityRepairDrawer · 批量补齐字段分流（B1）+ 失败保值（B2）", () => {
  it("T1 多字段预览直连 entity-repair 批量链：带全部改动字段与 sourceRevision，不走单议题 onPreview", async () => {
    setup();
    const { props } = mount();
    await fillTwoFields();
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(api.previewEntityRepair).toHaveBeenCalledTimes(1));
    const request = api.previewEntityRepair.mock.calls[0][0] as Record<string, unknown>;
    expect(request.sourceKey).toBe(SOURCE_KEY);
    expect(request.sourceRevision).toEqual(SOURCE_REVISION);
    expect(request.changes).toEqual({ article_type: "排错指南", module: "可观测性" });
    expect(props.onPreview).not.toHaveBeenCalled();
  });

  it("T2 单字段回归守卫：仅改动选中 issue 的字段时保持原单议题链（previewed→confirmed 审计流不动）", async () => {
    setup();
    const { props, onPreview } = mount();
    await pick("知识文章类型", "排错指南");
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(props.onPreview).toHaveBeenCalledTimes(1));
    expect(onPreview.mock.calls[0][0]).toEqual({ changes: { article_type: "排错指南" } });
    expect(api.previewEntityRepair).not.toHaveBeenCalled();
  });

  it("T3 批量预览成功后应用修复：applyEntityRepair(previewId) + 通知父层（reconcile 销账）", async () => {
    setup();
    api.previewEntityRepair.mockResolvedValue({
      previewId: "batch-p1", sourceKey: SOURCE_KEY, changedFields: ["article_type", "module"],
      beforeFrontmatter: "", afterFrontmatter: "", postCheck: { blockerCount: 0, warningCount: 0 }, expiresAt: "2099-01-01T00:00:00.000Z",
    });
    api.applyEntityRepair.mockResolvedValue({ ok: true });
    const onBatchApplied = vi.fn();
    mount({ onBatchApplied });
    await fillTwoFields();
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    const apply = await screen.findByRole("button", { name: "应用修复" });
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(apply);
    await waitFor(() => expect(api.applyEntityRepair).toHaveBeenCalledWith("batch-p1"));
    await waitFor(() => expect(onBatchApplied).toHaveBeenCalledTimes(1));
  });

  it("T4 预览失败（400）：错误可见且已填值保留，不重置表单", async () => {
    setup();
    api.previewEntityRepair.mockRejectedValue(new Error("必须且只能填写当前待处理字段"));
    mount();
    await fillTwoFields();
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("必须且只能填写当前待处理字段"));
    expect(triggerValues("知识文章类型")).toContain("排错指南");
    expect(triggerValues("产品模块")).toContain("可观测性");
  });

  it("T5 失败后父层重渲染（relatedIssues 身份变化，模拟 store loading→error）：已填值仍保留", async () => {
    setup();
    api.previewEntityRepair.mockRejectedValue(new Error("必须且只能填写当前待处理字段"));
    const { view, props } = mount();
    await fillTwoFields();
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(api.previewEntityRepair).toHaveBeenCalledTimes(1));
    // 身份全新、内容等价的 props（父层状态翻转的等价形态）
    view.rerender(<AnomalyEntityRepairDrawer {...props} relatedIssues={[fieldIssue("article_type", "entity-x-A06"), fieldIssue("module", "entity-x-A05")]} />);
    expect(triggerValues("知识文章类型")).toContain("排错指南");
    expect(triggerValues("产品模块")).toContain("可观测性");
  });

  it("T6 空改动负例：不发任何请求，给字段级提示（不弹无意义预览）", async () => {
    setup();
    const { props } = mount();
    await screen.findByRole("combobox", { name: "知识文章类型" });
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/必填字段不能为空|请先修改至少一个字段/));
    expect(props.onPreview).not.toHaveBeenCalled();
    expect(api.previewEntityRepair).not.toHaveBeenCalled();
  });

  it("T7 应用修复负例（409 预览过期）：错误显示、值保留、预览态清空（应用按钮回到禁用）", async () => {
    setup();
    api.previewEntityRepair.mockResolvedValue({
      previewId: "batch-expired", sourceKey: SOURCE_KEY, changedFields: ["article_type", "module"],
      beforeFrontmatter: "", afterFrontmatter: "", postCheck: { blockerCount: 0, warningCount: 0 }, expiresAt: "2099-01-01T00:00:00.000Z",
    });
    api.applyEntityRepair.mockRejectedValue(new Error("预览不存在、已过期或已消费"));
    mount();
    await fillTwoFields();
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    const apply = await screen.findByRole("button", { name: "应用修复" });
    await waitFor(() => expect((apply as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(apply);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("预览不存在、已过期或已消费"));
    expect(triggerValues("知识文章类型")).toContain("排错指南");
    expect((screen.getByRole("button", { name: "应用修复" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
