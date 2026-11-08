import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import { validateRequiredFields, isFieldEmpty, REPAIR_FIELD_DEFS } from "@/components/entity-repair/entity-repair-field-model";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

// B1 分流（#1412）：多字段/非当前议题字段直连 entity-repair 批量链，不再走单议题 onPreview
const repairApi = vi.hoisted(() => ({ previewEntityRepair: vi.fn(), applyEntityRepair: vi.fn() }));
vi.mock("@/lib/domain/entity-repair-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/entity-repair-api")>()),
  previewEntityRepair: repairApi.previewEntityRepair,
  applyEntityRepair: repairApi.applyEntityRepair,
}));

function mockEnums(checks: Array<Record<string, unknown>> = [], sourceValues: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    const data = url.includes("/api/entity/check")
      ? {
          generatedAt: "2026-08-03T00:00:00.000Z", summary: {}, readiness: {}, total: 1, limit: 10, offset: 0,
          items: [{ sourceKey: "知识库/wiki/entities/demo.md", sourceType: "entity", sourceExists: true, sourceValues, groups: [{ id: "identity", label: "字段", checks }] }],
        }
      : { layers: [{ id: "service" }], categories: ["middleware"], subdomains: {}, modules: { MySQL: {} }, tags: { entity: ["entity"] } };
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  }));
}

function missingEntityIssue(): AnomalyIssue {
  return {
    issueId: "missing-entity-1",
    issueKind: "missing_entity",
    title: "实体缺失",
    status: "open",
    evidence: [],
    proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/demo.md" },
    executionReady: true,
  } as unknown as AnomalyIssue;
}

function missingTitleIssue(): AnomalyIssue {
  return {
    issueId: "missing-field-title",
    issueKind: "missing_field",
    title: "title 是必填字段",
    status: "open",
    evidence: [],
    proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/demo.md", field: "title", currentValue: "", hint: "在 frontmatter 中添加 title 字段" },
    executionReady: true,
  } as unknown as AnomalyIssue;
}

function missingVersionIssue(): AnomalyIssue {
  return {
    issueId: "missing-field-version",
    issueKind: "version_scope",
    title: "建议填写 arch_since",
    status: "open",
    evidence: [],
    proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/demo.md", field: "arch_since", currentValue: "", hint: "填写组件有效期起点" },
    executionReady: true,
  } as unknown as AnomalyIssue;
}

describe("entity repair required validation", () => {
  beforeEach(() => {
    repairApi.previewEntityRepair.mockReset();
    repairApi.applyEntityRepair.mockReset();
  });

  it("validateRequiredFields returns only missing required field labels", () => {
    const defs = REPAIR_FIELD_DEFS.filter((def) => ["title", "arch_layer", "tags"].includes(def.field));
    const missing = validateRequiredFields(defs, { title: "", arch_layer: "service", tags: [] });
    expect(missing).toContain("实体名称");
    expect(missing).not.toContain("架构分层");
    // tags 必填（后端 F16 required:true），空 tags 参与必填校验（2026-09-13 required 单源对齐）
    expect(missing).toContain("标签");
  });

  it("treats empty string, null, undefined and empty array as empty", () => {
    expect(isFieldEmpty("")).toBe(true);
    expect(isFieldEmpty(null)).toBe(true);
    expect(isFieldEmpty(undefined)).toBe(true);
    expect(isFieldEmpty([])).toBe(true);
    expect(isFieldEmpty("service")).toBe(false);
    expect(isFieldEmpty(false)).toBe(false);
    expect(isFieldEmpty(["a"])).toBe(false);
  });

  it("blocks preview generation when required fields are empty and shows card-level errors", async () => {
    mockEnums();
    const onPreview = vi.fn();
    render(<AnomalyEntityRepairDrawer issue={missingEntityIssue()} error={null} onPreview={onPreview} onConfirm={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "实体名称" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    // 必填字段为空 → 校验阻断预览，卡片内显示错误
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getAllByText("必填字段不能为空").length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("does not clear filled field values when validation or preview fails", async () => {
    mockEnums();
    render(<AnomalyEntityRepairDrawer issue={missingEntityIssue()} error="预览生成失败" onPreview={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await screen.findByRole("textbox", { name: "实体名称" });
    fireEvent.change(titleInput, { target: { value: "MySQL 主库" } });
    expect(titleInput).toHaveValue("MySQL 主库");

    // 触发预览：其余必填字段为空导致校验失败
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    // 已填写的字段值不被清空
    expect(screen.getByRole("textbox", { name: "实体名称" })).toHaveValue("MySQL 主库");
    vi.unstubAllGlobals();
  });

  it("clears a field's error as soon as the user fills it", async () => {
    mockEnums();
    render(<AnomalyEntityRepairDrawer issue={missingEntityIssue()} error={null} onPreview={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await screen.findByRole("textbox", { name: "实体名称" });

    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    const errorCountBefore = screen.getAllByText("必填字段不能为空").length;
    expect(errorCountBefore).toBeGreaterThan(0);

    fireEvent.change(titleInput, { target: { value: "MySQL 主库" } });
    // 实体名称卡片的错误被清除，其余未填写字段的错误仍在
    expect(screen.getAllByText("必填字段不能为空").length).toBe(errorCountBefore - 1);
    vi.unstubAllGlobals();
  });

  it("does not submit untouched supplemental fields", async () => {
    mockEnums();
    const onPreview = vi.fn();
    render(<AnomalyEntityRepairDrawer issue={missingTitleIssue()} error={null} onPreview={onPreview} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await screen.findByRole("textbox", { name: "实体名称" });
    fireEvent.change(titleInput, { target: { value: "Fixture Component" } });

    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1));
    expect(screen.getByText("其他可补充字段")).toBeInTheDocument();
    expect(onPreview).toHaveBeenCalledWith({ changes: { title: "Fixture Component" } });
    vi.unstubAllGlobals();
  });

  it("previews all filled findings for the same source in one write（B1 分流后走 entity-repair 批量链）", async () => {
    mockEnums();
    const titleIssue = missingTitleIssue();
    const versionIssue = missingVersionIssue();
    const onPreview = vi.fn();
    render(<AnomalyEntityRepairDrawer issue={titleIssue} relatedIssues={[titleIssue, versionIssue]} error={null} onPreview={onPreview} onConfirm={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "实体名称" }), { target: { value: "Fixture Component" } });
    fireEvent.change(screen.getByRole("textbox", { name: "组件有效期起点" }), { target: { value: "7.0.0.0" } });
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));

    await waitFor(() => expect(repairApi.previewEntityRepair).toHaveBeenCalledTimes(1));
    expect((repairApi.previewEntityRepair.mock.calls[0][0] as { changes: Record<string, unknown> }).changes).toEqual({ title: "Fixture Component", arch_since: "7.0.0.0" });
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "激活为架构组件" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows the complete governed entity template with pending fields first", async () => {
    mockEnums();
    render(<AnomalyEntityRepairDrawer issue={missingTitleIssue()} error={null} onPreview={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("当前待处理字段")).toBeInTheDocument();
    expect(screen.getByText("其他可补充字段")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "版本属性覆盖 JSON" })).toBeInTheDocument();
    expect(screen.getAllByText("版本属性覆盖")).toHaveLength(1);
    expect(screen.queryByText("别名")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("loads current values and submits only an edited supplemental field", async () => {
    mockEnums([
      { ruleId: "F01", field: "title", passed: false, editable: true, value: null, message: "title 是必填字段" },
      { ruleId: "F08", field: "arch_until", passed: true, editable: true, value: null, message: "通过" },
      { ruleId: "F10", field: "arch_version_overrides", passed: true, editable: true, value: null, message: "通过" },
    ], { arch_until: "8.0.0.0", arch_version_overrides: [{ version: "7.0.0.0", arch_layer: "service" }] });
    const onPreview = vi.fn();
    render(<AnomalyEntityRepairDrawer issue={missingTitleIssue()} error={null} onPreview={onPreview} onConfirm={vi.fn()} onClose={vi.fn()} />);

    const until = await screen.findByRole("textbox", { name: "组件有效期终点" });
    await waitFor(() => expect(until).toHaveValue("8.0.0.0"));
    expect(screen.getByRole("textbox", { name: "版本属性覆盖 JSON" })).toHaveValue('[\n  {\n    "version": "7.0.0.0",\n    "arch_layer": "service"\n  }\n]');
    fireEvent.change(until, { target: { value: "8.1.0.0" } });
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));

    // B1 分流：补充字段（非当前议题动作字段）也走批量链，避免单议题闸门 400
    await waitFor(() => expect(repairApi.previewEntityRepair).toHaveBeenCalledTimes(1));
    expect((repairApi.previewEntityRepair.mock.calls[0][0] as { changes: Record<string, unknown> }).changes).toEqual({ arch_until: "8.1.0.0" });
    expect(onPreview).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("allows an existing source to save filled findings while other required findings remain empty", async () => {
    mockEnums();
    const titleIssue = missingTitleIssue();
    const versionIssue = missingVersionIssue();
    const onPreview = vi.fn();
    render(<AnomalyEntityRepairDrawer issue={titleIssue} relatedIssues={[titleIssue, versionIssue]} error={null} onPreview={onPreview} onConfirm={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "组件有效期起点" }), { target: { value: "7.0.0.0" } });
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));

    // B1 分流：改动字段（arch_since）≠ 当前议题动作字段（title）→ 批量链
    await waitFor(() => expect(repairApi.previewEntityRepair).toHaveBeenCalledTimes(1));
    expect((repairApi.previewEntityRepair.mock.calls[0][0] as { changes: Record<string, unknown> }).changes).toEqual({ arch_since: "7.0.0.0" });
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.queryByText("必填字段不能为空")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
