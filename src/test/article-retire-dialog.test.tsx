// SPEC-013 文章退役 UI——预演对话框（dryRun 零落盘→确认执行→列表刷新）。层级：纯单元（mock api）。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleRetireDialog } from "@/features/article-workflow/components/ArticleRetireDialog";
import * as api from "@/features/article-workflow/article-workflow-api";

vi.mock("@/features/article-workflow/article-workflow-api", () => ({
  previewArticleRetirement: vi.fn(),
  retireArticle: vi.fn(),
}));

const plan = {
  plan: {
    basename: "a.md",
    workingPath: "/x/precleaned/a.md",
    formalPaths: ["/x/wiki/articles/d/h.md"],
    archivePath: "知识库/raw/archive/投稿/ha-a.md",
    manifestKey: "a",
    warnings: [],
  },
};

describe("ArticleRetireDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("打开即预演（dryRun），展示清理计划，确认才执行", async () => {
    vi.mocked(api.previewArticleRetirement).mockResolvedValue(plan);
    vi.mocked(api.retireArticle).mockResolvedValue({ retired: true, ...plan });
    const onRetired = vi.fn();
    render(<ArticleRetireDialog open basename="a.md" title="文章A" onClose={() => {}} onRetired={onRetired} />);

    await screen.findByText(/将清理/);
    expect(api.previewArticleRetirement).toHaveBeenCalledWith("a.md");
    expect(screen.getByText(/正式版快照 1 份/)).toBeInTheDocument();
    expect(screen.getByText(/原文归档（archive，随溯源链）/)).toBeInTheDocument();
    expect(screen.getByText(/预演未修改任何文件/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认退役/ }));
    await waitFor(() => expect(api.retireArticle).toHaveBeenCalledWith("a.md"));
    await waitFor(() => expect(onRetired).toHaveBeenCalled());
  });

  it("预演失败显示错误，禁用执行", async () => {
    vi.mocked(api.previewArticleRetirement).mockRejectedValue(new Error("文章不存在（工作区与正式区均无）"));
    render(<ArticleRetireDialog open basename="ghost.md" title="G" onClose={() => {}} onRetired={() => {}} />);
    await screen.findByText(/文章不存在/);
    expect(screen.getByRole("button", { name: /确认退役/ })).toBeDisabled();
  });

  it("悬空溯源锚以 warning 呈现（不阻断执行）", async () => {
    vi.mocked(api.previewArticleRetirement).mockResolvedValue({
      plan: { ...plan.plan, archivePath: null, warnings: ["未找到 source_file 溯源锚——归档副本不在本次清理范围（需人工确认）"] },
    });
    render(<ArticleRetireDialog open basename="a.md" title="A" onClose={() => {}} onRetired={() => {}} />);
    await screen.findByText(/溯源锚/);
    expect(screen.getByRole("button", { name: /确认退役/ })).not.toBeDisabled();
  });
});
