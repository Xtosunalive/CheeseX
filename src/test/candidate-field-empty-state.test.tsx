import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateFieldForm } from "@/features/article-workflow/components/CandidateFieldForm";
import type { CandidateFieldOptions } from "@/features/article-workflow/article-workflow-types";

// WP-062（功能可用性）：选项空态显式化——availability.empty 时渲染指引（缺什么/去哪配），
// 不渲染死下拉；满态不渲染提示。数据态（归档词表）为服务端照实上报，组件不代填。

const article = {
  id: "a1",
  title: "测试文章",
  metadata: { product: "AnyShare", version: "1.0" },
} as unknown as Parameters<typeof CandidateFieldForm>[0]["article"];

const baseFields = [
  { field: "arch_category", label: "业务分类", control: "select", required: true, optionsKey: "archCategories", completable: true },
  { field: "product", label: "产品", control: "select", required: true, optionsKey: "products", completable: true },
];

describe("WP-062 标准化表单空态功能性保障", () => {
  it("空态：archCategories 空＋availability.empty → 渲染指引文本（不再死下拉无提示）", () => {
    const options = {
      products: [{ name: "AnyShare", versions: [] }],
      articleTypes: [], modules: [], docTypes: [], categoryPaths: [],
      archLayers: [], archCategories: [],
      articleFields: baseFields,
      availability: {
        archCategories: { empty: true, hint: "业务分类未配置——请在词表 arch_categories（或矩阵约束 allowed_categories）登记分类值" },
        products: { empty: false, hint: "" },
      },
    } as unknown as CandidateFieldOptions;
    render(<CandidateFieldForm article={article} options={options} optionsLoading={false} saving={false} onSave={async () => {}} />);
    expect(screen.getByText(/业务分类未配置/)).toBeDefined();
  });

  it("满态：选项在场且 availability.empty=false → 不渲染指引", () => {
    const options = {
      products: [{ name: "AnyShare", versions: ["1.0"] }],
      articleTypes: [], modules: [], docTypes: [], categoryPaths: [],
      archLayers: [], archCategories: ["终端", "服务"],
      articleFields: baseFields,
      availability: {
        archCategories: { empty: false, hint: "" },
        products: { empty: false, hint: "" },
      },
    } as unknown as CandidateFieldOptions;
    render(<CandidateFieldForm article={article} options={options} optionsLoading={false} saving={false} onSave={async () => {}} />);
    expect(screen.queryByText(/业务分类未配置/)).toBeNull();
    expect(screen.getByLabelText("业务分类")).toBeDefined();
  });

  it("无 availability（旧载荷兼容）：空选项不炸、不渲染指引（向后兼容）", () => {
    const options = {
      products: [], articleTypes: [], modules: [], docTypes: [], categoryPaths: [],
      archLayers: [], archCategories: [],
      articleFields: baseFields,
    } as unknown as CandidateFieldOptions;
    render(<CandidateFieldForm article={article} options={options} optionsLoading={false} saving={false} onSave={async () => {}} />);
    expect(screen.getByLabelText("业务分类")).toBeDefined();
  });
});
