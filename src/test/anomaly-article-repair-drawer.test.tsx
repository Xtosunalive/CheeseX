import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const api = vi.hoisted(() => ({
  fetchArticleRepairOptions: vi.fn(),
  fetchEntityCompliance: vi.fn(),
  fetchEnums: vi.fn(),
  fetchVersionRegistry: vi.fn().mockResolvedValue({ schema_version: 1, revision: "r", sourceFile: "versions.yaml", summary: {}, products: {}, diagnostics: [] }),
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
    expect(screen.queryByText("架构组件身份")).not.toBeInTheDocument();
    // 回归守卫③：切片3修复提示在场（P4 重新标准化 + 正文 Obsidian 边界）
    expect(screen.getByText(/正文请在 Obsidian 修改/)).toBeInTheDocument();
  });
});
