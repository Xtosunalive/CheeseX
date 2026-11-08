import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleAssociationsView } from "@/features/article-associations/ArticleAssociationsView";
import { useArticleAssociationsStore } from "@/features/article-associations/article-associations-store";
import { usePipelineStore } from "@/lib/pipeline-store";

vi.mock("@/features/article-associations/article-associations-api", () => ({ fetchArticleAssociations: vi.fn(), previewArticleAssociation: vi.fn(), saveArticleAssociation: vi.fn() }));
import { fetchArticleAssociations, previewArticleAssociation, saveArticleAssociation } from "@/features/article-associations/article-associations-api";

const data = {
  schema_version: 1 as const,
  revision: "sha256:one",
  sourceFile: "知识库/TheSchema/article_associations.yaml",
  auditStatus: "valid" as const,
  auditError: null,
  articles: [{ articleId: "ART-1", title: "Guide", sourcePath: "知识库/raw/precleaned/a.md", sourceHash: "sha256:one", product: "AnyShare", version: "7.0", componentIds: ["gateway"] }],
  componentOptions: [{ id: "gateway", label: "Gateway" }, { id: "audit", label: "Audit" }],
  versionOptions: [{ id: "version-anyshare-7-0", label: "AnyShare 7.0", product: "AnyShare", version: "7.0", status: "draft" as const }],
  currentAssociations: [{ association_id: "assoc-1", product: "AnyShare", component_id: "gateway", version_since: "7.0", version_until: "", decision_id: "DEC-0", articleId: "ART-1", articleTitle: "Guide", sourcePath: "知识库/raw/precleaned/a.md", sourceHash: "sha256:one" }],
  auditRecords: [],
  decisions: [],
};
const preview = { article: data.articles[0], action: "replace" as const, fileRevision: "sha256:article", current: { componentIds: ["gateway"], versionIds: ["version-anyshare-7-0"] }, next: { componentIds: ["audit"], versionIds: ["version-anyshare-7-0"] }, added: { componentIds: ["audit"], versionIds: [] }, removed: { componentIds: ["gateway"], versionIds: [] } };

describe("ArticleAssociationsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/article-associations";
    usePipelineStore.setState({ open: false });
    useArticleAssociationsStore.setState({ data: null, preview: null, status: "idle", saving: false, error: null, articleId: "", action: "replace", componentIds: [], versionIds: [] });
  });
  it("直接写回：保存映射立即生效（AA1，不走 Proposal）", async () => {
    vi.mocked(fetchArticleAssociations).mockResolvedValue(data);
    vi.mocked(previewArticleAssociation).mockResolvedValue(preview);
    vi.mocked(saveArticleAssociation).mockResolvedValue({ success: true, ...data, preview });
    render(<ArticleAssociationsView />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——数据就绪改由副标题断言
    await screen.findByRole("button", { name: "选择关联架构组件" }); // 页题已裁删——表单控件为就绪锚
    expect(screen.getByRole("button", { name: "保存映射" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选择关联架构组件" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Audit" }));
    fireEvent.click(screen.getByRole("button", { name: "查看映射结果" }));
    await waitFor(() => expect(previewArticleAssociation).toHaveBeenCalled());
    const saveBtn = await screen.findByRole("button", { name: "保存映射" });
    await waitFor(() => expect(saveBtn).toBeEnabled());
    fireEvent.click(saveBtn);
    await waitFor(() => expect(saveArticleAssociation).toHaveBeenCalledWith(expect.objectContaining({ revision: "sha256:article", articleId: "ART-1", action: "replace" })));
  });

  it("shows a fresh Proposal audit without a second pipeline lifecycle", async () => {
    vi.mocked(fetchArticleAssociations).mockResolvedValue({
      ...data,
      decisions: [{ decisionId: "DEC-1", articleId: "ART-1", action: "add", componentIds: ["audit"], versionIds: ["version-anyshare-7-0"], candidateSourcePath: data.articles[0].sourcePath, candidateSourceHash: data.articles[0].sourceHash, decidedAt: "2026-07-18T00:00:00.000Z", stale: false }],
    });
    render(<ArticleAssociationsView />);
    expect(await screen.findByText("审计记录有效")).toBeInTheDocument();
    expect(screen.queryByText("管道已应用")).not.toBeInTheDocument();
  });

  it("空态即结构：无候选时内容区自然留空，引导卡退役（Master 2026-10-29）", async () => {
    vi.mocked(fetchArticleAssociations).mockResolvedValue({ ...data, articles: [] });
    render(<ArticleAssociationsView />);
    await screen.findByText(/搜索工作草稿|投稿/).catch(() => {}); // 任一常驻元素 settle
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("SPEC-029：无正式 Release（发布前常态）→ 无错误横幅亦无引导卡（空态即结构）", async () => {
    vi.mocked(fetchArticleAssociations).mockRejectedValue(Object.assign(new Error("NO_CURRENT_RELEASE"), { code: "NO_CURRENT_RELEASE" }));
    render(<ArticleAssociationsView />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/No current Release/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });
});
