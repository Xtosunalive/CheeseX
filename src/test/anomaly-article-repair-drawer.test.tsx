import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const api = vi.hoisted(() => ({
  fetchArticleRepairOptions: vi.fn(),
  fetchEntityCompliance: vi.fn(),
  fetchEnums: vi.fn(),
  fetchVersionRegistry: vi.fn().mockResolvedValue({ schema_version: 1, revision: "r", sourceFile: "versions.yaml", summary: {}, products: {}, diagnostics: [] }),
  previewEntityRepair: vi.fn().mockResolvedValue({ previewId: "p-fix", changedFields: [], postCheck: {} }),
}));
vi.mock("@/features/anomaly-workbench/anomaly-workbench-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/anomaly-workbench/anomaly-workbench-api")>()),
  fetchArticleRepairOptions: api.fetchArticleRepairOptions,
}));
vi.mock("@/lib/domain/entity-repair-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/entity-repair-api")>()),
  previewEntityRepair: api.previewEntityRepair,
}));
vi.mock("@/features/entity-compliance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/entity-compliance")>()),
  fetchEntityCompliance: api.fetchEntityCompliance,
}));
vi.mock("@/features/schema-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/schema-manager")>()),
  fetchEnums: api.fetchEnums,
}));

// 切片3回归：文章源（precleaned）缺字段卡打开抽屉，必须渲染服务端单源的文章字段清单，
// 而不是实体字段模板（曾经的死胡同："补齐字段（0 个待处理）"空抽屉）。
const articleIssue = {
  issueId: "entity-知识库/raw/precleaned/销账验证.md-A06",
  issueKind: "missing_field",
  title: "article_type 是标准文章必填字段",
  status: "open",
  evidence: [{ kind: "entity-compliance", path: "知识库/raw/precleaned/销账验证.md", ruleId: "A06" }],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/raw/precleaned/销账验证.md", field: "article_type", hint: "可用值：排错指南", allowedValues: ["排错指南"] },
} as unknown as AnomalyIssue;

describe("AnomalyEntityRepairDrawer · 文章源分支", () => {
  it("文章卡渲染服务端单源字段清单（含文章字段与修复提示），不再开实体空抽屉", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("文章源合规不强制"));
    api.fetchEnums.mockResolvedValue({ layers: [], categories: [], subdomains: {} });
    api.fetchArticleRepairOptions.mockResolvedValue({
      products: [{ name: "AnyShare", versions: ["7.0.6.7"] }],
      articleTypes: ["排错指南", "常见问题"],
      modules: ["可观测性"],
      docTypes: ["技术文档"],
      categoryPaths: ["ops:deploy"],
      articleFields: [
        { field: "title", label: "标题", control: "text", required: true },
        { field: "article_type", label: "知识文章类型", control: "select", required: true },
      ],
    });
    render(
      <AnomalyEntityRepairDrawer
        issue={articleIssue}
        relatedIssues={[articleIssue]}
        error={null}
        onPreview={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // 回归守卫①：文章源必须触发服务端单源清单加载（死胡同 bug 的接线证明——修复前此调用永不发生）
    await waitFor(() => expect(api.fetchArticleRepairOptions).toHaveBeenCalled());
    // 回归守卫②：实体模板字段不再出现在文章卡抽屉
    expect(screen.queryByText("架构组件 ID")).not.toBeInTheDocument();
    // 回归守卫③：切片3修复提示在场（P4 重新标准化 + 正文 Obsidian 边界）
    expect(screen.getByText(/正文请在 Obsidian 修改/)).toBeInTheDocument();
  });
});

// PR-324②/WP-180：确认（应用修复）钮接状态×操作投影——非 preview_ready 态不渲染改显指引
describe("AnomalyEntityRepairDrawer · 确认钮状态门控（PR-324②）", () => {
  it("open 态：应用修复钮不渲染（WP-183 清账：预览钮即结构引导，无指引句）", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("文章源合规不强制"));
    api.fetchEnums.mockResolvedValue({ layers: [], categories: [], subdomains: {} });
    api.fetchArticleRepairOptions.mockResolvedValue({
      products: [{ name: "AnyShare", versions: ["7.0.6.7"] }],
      articleTypes: ["排错指南"],
      modules: ["可观测性"],
      docTypes: ["技术文档"],
      categoryPaths: ["ops:deploy"],
      articleFields: [{ field: "article_type", label: "知识文章类型", control: "select", required: true }],
    });
    render(
      <AnomalyEntityRepairDrawer
        issue={articleIssue}
        relatedIssues={[articleIssue]}
        error={null}
        onPreview={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.fetchArticleRepairOptions).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /应用修复/ })).toBeNull();
  });
});

// MAIC 继承批（Master 2026-11-15 裁）：缺失实体＝继承主战场——议题携带文章 frontmatter 快照，
// 实体页尚不存在（合规行必查不到）时创建表单据此预填；无快照的旧议题行为不变。
const missingEntityIssue = (withSnapshot: boolean) => ({
  issueId: "missing-entity-doc-article-fixture-a",
  issueKind: "missing_entity",
  title: '文章 "Article A" 模块 "Fixture模块" 缺少知识实体',
  status: "open",
  evidence: [{ kind: "vault-document", path: "知识库/wiki/articles/ops/article-fixture-a/snapshot.md", ruleId: "document-module-entity" }],
  proposedAction: {
    type: "entity-repair",
    entityId: "doc-article-fixture-a",
    sourceKey: "知识库/wiki/entities/Fixture模块.md",
    field: "module_entity",
    currentValue: "Fixture模块",
    expected: "Fixture模块",
    allowedValues: [],
    ...(withSnapshot
      ? { articleSnapshot: { sourcePath: "知识库/wiki/articles/ops/article-fixture-a/snapshot.md", sourceStage: "precleaned", fields: { module: ["Fixture模块"], tags: ["entity"], arch_layer: "gateway", arch_category: "知识域A" } } }
      : {}),
  },
}) as unknown as AnomalyIssue;

describe("AnomalyEntityRepairDrawer · 缺失实体继承快照", () => {
  it("创建模式预填继承快照＋自动激活：点预览后请求携带 title/arch_component/module/tags/架构字段（批3＋激活统一）", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("实体页不存在"));
    api.fetchEnums.mockResolvedValue({ layers: [], categories: [], subdomains: {} });
    render(
      <AnomalyEntityRepairDrawer
        issue={missingEntityIssue(true)}
        relatedIssues={[missingEntityIssue(true)]}
        error={null}
        onPreview={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Fixture模块")).toBeInTheDocument(); // 标题＝期望值（既有通道不回归）
    await waitFor(() => expect(screen.getByText("entity")).toBeInTheDocument()); // tags chip＝文章标签
    expect(screen.getByText("Fixture模块")).toBeInTheDocument(); // module chip＝声明模块
    expect(screen.getByDisplayValue("gateway")).toBeInTheDocument(); // arch_layer select（批3 扩字段）
    expect(screen.getByDisplayValue("知识域A")).toBeInTheDocument(); // arch_category select（批3 扩字段）
    // 激活统一（Master 裁）：arch_component 预填 true——点预览后批量请求应携带激活与全部继承字段
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => expect(api.previewEntityRepair).toHaveBeenCalled());
    const request = api.previewEntityRepair.mock.calls[0][0];
    expect(request.createIfMissing).toBe(true);
    expect(request.initialTitle).toBe("Fixture模块");
    expect(request.changes.arch_component).toBe(true);
    expect(request.changes.title).toBe("Fixture模块");
    expect(request.changes.module).toEqual(["Fixture模块"]);
    expect(request.changes.arch_layer).toBe("gateway");
    expect(request.changes.arch_category).toBe("知识域A");
    expect(request.changes.tags).toEqual(["entity"]);
  });

  it("无快照的旧议题行为不变：不出文章字段预填（回归钉）", async () => {
    api.fetchEntityCompliance.mockRejectedValue(new Error("实体页不存在"));
    api.fetchEnums.mockResolvedValue({ layers: [], categories: [], subdomains: {} });
    render(
      <AnomalyEntityRepairDrawer
        issue={missingEntityIssue(false)}
        relatedIssues={[missingEntityIssue(false)]}
        error={null}
        onPreview={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Fixture模块")).toBeInTheDocument(); // 标题通道保持
    expect(screen.queryByText("entity")).not.toBeInTheDocument(); // 无快照→无 tags 预填
  });
});
