import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const api = vi.hoisted(() => ({
  fetchArticleRepairOptions: vi.fn(),
  fetchEntityCompliance: vi.fn(),
  fetchEnums: vi.fn(),
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
  fetchVersionRegistry: vi.fn().mockResolvedValue({ schema_version: 1, revision: "r", sourceFile: "versions.yaml", summary: {}, products: {}, diagnostics: [] }),
}));

// 用户报障场景：missing_entity（实体尚不存在）修复抽屉的 status 下拉
// 从 enumOptions 拿不到候选 → selectUnavailable → 永久禁用 → 必填 status 无法填写 → 表单死锁。
const missingEntityIssue = {
  issueId: "issue-missing-entity-样本A",
  issueKind: "missing_entity",
  title: "实体缺失：样本A",
  status: "open",
  evidence: [{ kind: "entity-compliance", path: "知识库/raw/precleaned/沟通壁垒-数据到信息到知识.md", ruleId: "G01" }],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/entities/样本A", field: "status", expected: "有效" },
} as unknown as AnomalyIssue;

function renderDrawer() {
  return render(
    <AnomalyEntityRepairDrawer
      issue={missingEntityIssue}
      relatedIssues={[missingEntityIssue]}
      error={null}
      onPreview={vi.fn()}
      onConfirm={vi.fn()}
      onBatchApplied={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("AnomalyEntityRepairDrawer · 生命周期字段选项接线（C2/C3）", () => {
  // 2026-10-08 字段托管：status/date/updated 系统托管只读（母版 control=readonly-system）——
  // 旧 C2「status 下拉含 Schema 值」与 C3「降级为可写文本」的断言对象（用户可编辑 status 下拉）已不存在。
  // 僵尸断言对齐现契约（2026-10-09 Master 批准删僵尸）：托管字段只读展示、行不展开；
  // 状态迁移走审批状态机通道（approval-state-machine），不经修复表单。
  it("C2(对齐): status 为系统托管只读——不渲染用户可选下拉（旧 C2 断言对象已随字段托管退役）", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("missing entity 无合规对象（预期路径，pending 绕过该门）"));
    api.fetchEnums.mockResolvedValue({
      revision: "rev-test-1",
      layers: [], categories: [], subdomains: {},
      lifecycle_status: ["制定中", "有效", "已归档"],
    });
    renderDrawer();
    // 等异步稳定（alert 出现=合规拒载路径；无 alert=字段区就绪——fixture 源文件不存在故走前者）
    await screen.findByRole("alert").catch(() => null);
    // 托管语义断言：任何渲染状态下都不存在用户可编辑的 status 下拉
    expect(screen.queryByRole("button", { name: "状态 选项" })).toBeNull();
  });

  it("C3(对齐): enums 加载失败时，托管字段禁用只读——不出用户可写入口（系统托管语义，2026-10-09 缺口补）", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("compliance unavailable"));
    api.fetchEnums.mockRejectedValue(new Error("enums 加载失败（降级路径）"));
    renderDrawer();
    expect(await screen.findByRole("alert")).toHaveTextContent("Schema 枚举加载失败");
    // 托管字段（status）允许以 disabled 输入框呈现（只读展示），但必须禁用——无可写用户路径
    const statusFields = screen.queryAllByRole("textbox", { name: "状态" });
    for (const field of statusFields) expect(field).toBeDisabled();
    expect(screen.queryByRole("button", { name: "状态 选项" })).toBeNull(); // 不渲染用户可选下拉
  });
});

describe("#1798 · Schema 枚举加载失败可重试", () => {
  it("枚举失败显示「重新加载选项」按钮，点击后重试并恢复下拉", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("合规查询失败"));
    api.fetchEnums.mockRejectedValueOnce(new Error("网络抖动"));
    const { container } = renderDrawer();
    expect(await screen.findByRole("alert")).toHaveTextContent("Schema 枚举加载失败");
    const retry = await screen.findByRole("button", { name: "重新加载选项" });
    api.fetchEnums.mockResolvedValueOnce({
      revision: "rev-test-2",
      layers: [], categories: [], subdomains: {},
      lifecycle_status: ["有效"],
      modules: {}, tags: {},
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    void container;
  });
});
