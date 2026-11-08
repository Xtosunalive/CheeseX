// PR-151②前端回归墙：补齐入口派生化——表单渲染面＝服务端 articleFields（契约表单形状派生），
// 契约/字典新增字段零代码自动出现；已标准化文章放开补齐。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CandidateFieldForm } from "@/features/article-workflow/components/CandidateFieldForm";
import { ArticlePreviewDialog } from "@/features/article-workflow/components/ArticlePreviewDialog";
import type { CandidateFieldOptions, PrecleanedArticleDetail } from "@/features/article-workflow/article-workflow-types";

const options = {
  products: [{ name: "通用", versions: ["1.0"] }],
  articleTypes: ["排错指南"],
  modules: ["测试"],
  docTypes: ["用户手册"],
  categoryPaths: ["ops:maintain"],
  archLayers: ["gateway", "service"],
  archCategories: ["终端", "服务"],
  articleFields: [
    { field: "title", label: "标题", control: "text", required: true, completable: false },
    { field: "product", label: "产品", control: "select", required: true, optionsKey: "products", completable: true },
    { field: "arch_layer", label: "架构分层", control: "select", required: true, optionsKey: "archLayers", completable: true },
    { field: "arch_category", label: "业务分类", control: "select", required: true, optionsKey: "archCategories", completable: true },
    // 类消灭用例：契约将来新增的字段（服务端下发即渲染——前端零代码）
    { field: "priority", label: "优先级", control: "select", required: true, optionsKey: "priorities", completable: true },
    { field: "tags", label: "标签", control: "array", required: true, completable: true },
  ],
  // 未来新选项包（TS 面未知——按运行时包取）
  priorities: ["高", "低"],
} as unknown as CandidateFieldOptions;

const article = {
  id: "arch-candidate", fileName: "候选.md", title: "候选", product: "通用", module: "测试", articleType: "排错指南",
  version: "1.0", sourcePath: "知识库/raw/precleaned/候选.md", updatedAt: "now",
  formalContentHash: null, standardizationStatus: "pending_standardization", currentStandardVersion: null,
  validatedAt: null, standardizationWarningCount: 0,
  metadata: { product: "通用", article_type: "排错指南", module: "测试", version: "1.0", "doc-type": "用户手册", "category-path": "ops:maintain", tags: ["测试"] },
  content: "正文",
} as unknown as PrecleanedArticleDetail;

describe("PR-151 字段补齐入口（架构分层/业务分类＋派生化）", () => {
  it("补齐表单按服务端 articleFields 渲染：arch 两字段下拉可选、策略排除字段（title）不出现、合成新字段零代码出现", () => {
    const onSave = vi.fn();
    render(<CandidateFieldForm article={article} options={options} optionsLoading={false} saving={false} onSave={onSave} />);
    const layer = screen.getByLabelText("架构分层") as HTMLSelectElement;
    const category = screen.getByLabelText("业务分类") as HTMLSelectElement;
    expect([...layer.options].map((o) => o.value)).toEqual(["", "gateway", "service"]);
    expect([...category.options].map((o) => o.value)).toEqual(["", "终端", "服务"]);
    // 策略排除：标题编辑走修复抽屉，补齐表单不渲染
    expect(screen.queryByLabelText("标题")).not.toBeInTheDocument();
    // 类消灭：契约新增的合成字段（priority）按 optionsKey 取包自动渲染
    const priority = screen.getByLabelText("优先级") as HTMLSelectElement;
    expect([...priority.options].map((o) => o.value)).toEqual(["", "高", "低"]);
    fireEvent.change(priority, { target: { value: "高" } });
    fireEvent.change(layer, { target: { value: "gateway" } });
    fireEvent.change(category, { target: { value: "服务" } });
    fireEvent.click(screen.getByRole("button", { name: "补齐字段" }));
    expect(onSave).toHaveBeenCalledWith("arch-candidate", { priority: "高", arch_layer: "gateway", arch_category: "服务" });
  });

  it("已标准化文章同样渲染补齐表单与标准化入口（PR-151 放开——回落待标准化后重走标准化）", () => {
    const standardized = { ...article, standardizationStatus: "standardized" as const, validatedAt: "now" } as unknown as PrecleanedArticleDetail;
    render(
      <ArticlePreviewDialog
        article={standardized}
        standardizing={false}
        fieldOptions={options}
        fieldOptionsLoading={false}
        savingFields={false}
        onStandardize={vi.fn(async () => {})}
        onSaveFields={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("架构分层")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "标准化文章" })).toBeInTheDocument();
  });
});
