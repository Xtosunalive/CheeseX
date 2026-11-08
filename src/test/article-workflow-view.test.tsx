import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleWorkflowView } from "@/features/article-workflow/ArticleWorkflowView";
import { useArticleWorkflowStore } from "@/features/article-workflow/article-workflow-store";

const api = vi.hoisted(() => ({
  fetchPrecleanedArticles: vi.fn(),
  fetchArticleUploads: vi.fn(),
  fetchPrecleanedArticle: vi.fn(),
  fetchCandidateFieldOptions: vi.fn(),
  patchCandidateFields: vi.fn(),
  uploadArticle: vi.fn(),
  setArticleApproval: vi.fn(),
  setArticleApprovals: vi.fn(),
  standardizeArticle: vi.fn(),
  validateDraftArticle: vi.fn(),
  promoteDraftArticle: vi.fn(),
  ARTICLE_BULK_APPROVAL_ACTION: { id: "article-workflow.bulk-approval", risk: "medium", dataChannel: "PUT /api/articles/precleaned/approval" },
  ARTICLE_STANDARDIZATION_ACTION: { id: "article-workflow.standardize", risk: "medium", dataChannel: "POST /api/articles/precleaned/:id/standardization" },
  ARTICLE_STANDARDIZATION_SKILL_ACTION: { id: "article-workflow.standardization-skill", risk: "medium", dataChannel: "POST /api/articles/drafts/validate → POST /api/articles/drafts/promote" },
  ARTICLE_FIELD_COMPLETION_ACTION: { id: "article-workflow.field-completion", risk: "medium", dataChannel: "PATCH /api/articles/precleaned/:id/fields" },
}));
vi.mock("@/features/article-workflow/article-workflow-api", () => api);

const newFields = { standardizationStatus: "pending_standardization" as const, currentStandardVersion: null, validatedAt: null, graphAdmissionStatus: "not_queued" as const, standardizationWarningCount: 0 };
const item = { id: "article-1", fileName: "文章.md", title: "文章", product: "AnyShare", module: "ECMS集群", articleType: "排错指南", version: "7.0.1.1", status: "pending_approval" as const, sourcePath: "知识库/raw/precleaned/文章.md", updatedAt: "2026-07-16T00:00:00Z", approvedAt: null, submittedAt: null, completedAt: null, batchId: null, pipelineJobId: null, graphStatus: "not_queued" as const, hasApprovedVersion: false, formalContentHash: null, ...newFields };
const item2 = { ...item, id: "article-2", fileName: "部署.md", title: "部署", module: "Office Online", articleType: "安装部署", sourcePath: "知识库/raw/precleaned/部署.md", updatedAt: "2026-07-16T02:00:00Z" };
// 历史批准文章：旧批准字段仅兼容读取，检索与展示资格由 standardizationStatus 表达。
const legacyApprovedItem2 = { ...item2, status: "approved" as const, approvedAt: "2026-07-16T01:00:00Z", hasApprovedVersion: true, formalContentHash: "b".repeat(64), standardizationStatus: "standardized" as const, validatedAt: "2026-07-16T01:00:00Z" };
const detail = { ...item, metadata: {}, content: "## 问题描述\n\n正文" };
const uploadTask = { taskId: "task-raw", originalFileName: "原始资料.pdf", draftPath: "知识库/raw/drafts/投稿/原始资料.pdf", precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0, status: "awaiting_architect_processing" as const, sizeBytes: 2048, createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z" };
// Markdown 草稿任务：本地标准化 Skill 按钮的作用对象（非 .md 草稿按钮禁用）。
const mdUploadTask = { ...uploadTask, taskId: "task-md", originalFileName: "测试文章.md", draftPath: "知识库/raw/drafts/投稿/测试文章.md" };
const waitingUploadCounts = { awaiting_architect_processing: 1, awaiting_approval: 0, standardized: 0, published: 0, source_deleted: 0, digested: 0 };

describe("ArticleWorkflowView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useArticleWorkflowStore.setState({ items: [], uploads: [], uploadTotal: 0, uploadStatusCounts: { awaiting_architect_processing: 0, awaiting_approval: 0, standardized: 0, published: 0, source_deleted: 0, digested: 0 }, lastScannedAt: null, selected: null, latestTask: null, status: "idle", submitting: false, updatingIds: [], skillRunningIds: [], skillOutcomes: {}, fieldOptions: null, fieldOptionsLoading: false, savingFields: false, error: null });
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [item, item2], generatedAt: "2026-07-16T00:00:00Z" });
    api.fetchArticleUploads.mockResolvedValue({ items: [uploadTask], total: 1, statusCounts: waitingUploadCounts, generatedAt: "2026-07-16T00:00:00Z" });
    api.fetchCandidateFieldOptions.mockResolvedValue({ products: [{ name: "AnyShare", versions: ["7.0.1.1"] }], articleTypes: ["排错指南"], modules: ["Gateway"], articleFields: [
      // PR-151 续：表单渲染面＝服务端 articleFields（契约派生）——mock 对齐服务端真实形状
      { field: "product", label: "产品", control: "select", required: true, optionsKey: "products", completable: true },
      { field: "article_type", label: "知识文章类型", control: "select", required: true, optionsKey: "articleTypes", completable: true },
    ] });
    api.patchCandidateFields.mockImplementation(async (_id: string, fields: Record<string, string>) => ({ ...detail, metadata: { ...detail.metadata, ...fields } }));
    api.validateDraftArticle.mockResolvedValue({ valid: true, status: "passed", errors: [], warnings: [], summary: "校验通过", autoFilled: [], suggested: {}, reportable: [] });
    api.promoteDraftArticle.mockResolvedValue({ precleanedPath: "知识库/raw/precleaned/测试文章.md", message: "已晋升" });
    api.fetchPrecleanedArticle.mockImplementation(async (id: string) => ({ ...(id === item.id ? detail : { ...item2, metadata: {}, content: "## 部署步骤\n\n正文" }) }));
    api.uploadArticle.mockImplementation(async (payload: { fileName: string }) => ({ taskId: `task-${payload.fileName}`, originalFileName: payload.fileName, draftPath: `知识库/raw/drafts/投稿/${payload.fileName}`, precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0, status: "awaiting_architect_processing", sizeBytes: 4, createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z" }));
    // 目标态主链：标准化校验通过即产出可检索的标准文章，只写新字段。
    api.standardizeArticle.mockImplementation(async (id: string) => ({ ...(id === item.id ? item : item2), standardizationStatus: "standardized", currentStandardVersion: { articleId: id, contentHash: (id === item.id ? "a" : "b").repeat(64), snapshotPath: `知识库/wiki/articles/${id}/${(id === item.id ? "a" : "b").repeat(64)}.md`, validatedAt: "2026-07-16T01:00:00Z", proposalId: "proposal-123456789abc", proposalCommit: "c".repeat(40), checksId: "checks-article", previewHash: `sha256:${"d".repeat(64)}`, releaseId: `release-${"e".repeat(64)}`, sourceCommit: "c".repeat(40) }, validatedAt: "2026-07-16T01:00:00Z", standardizationWarningCount: 0, formalContentHash: (id === item.id ? "a" : "b").repeat(64) }));
  });

  it("失败态：候选加载失败时页顶显示错误", async () => {
    api.fetchPrecleanedArticles.mockRejectedValue(new Error("读取候选失败"));
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("读取候选失败")).toBeInTheDocument();
  });

  it("加载态：读取候选中显示加载提示", async () => {
    api.fetchPrecleanedArticles.mockReturnValue(new Promise(() => {}));
    api.fetchArticleUploads.mockReturnValue(new Promise(() => {}));
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("正在读取 precleaned...")).toBeInTheDocument();
  });

  it("无已标准化候选时统计可见且无独立审批入口（勾选体系退役 2026-10-15）", async () => {
    render(<ArticleWorkflowView />);
    expect(await screen.findByTestId("admission-stats")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审批与发布" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /创建上图批次/ })).not.toBeInTheDocument();
    const stats = screen.getByTestId("admission-stats");
    expect(within(stats).getByText("已标准化").querySelector("b")).toHaveTextContent("0");
  });

  it("状态过期：源变化后候选显示 ERROR 阻断", async () => {
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [{ ...item, status: "admission-blocked" as const, standardizationStatus: "blocked" as const }], generatedAt: "2026-07-16T00:00:00Z" });
    render(<ArticleWorkflowView />);
    expect((await screen.findAllByText("ERROR 阻断")).length).toBeGreaterThan(0);
  });

  it("uploads the source file and lets the architect standardize without a second publish action", async () => {
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [item, legacyApprovedItem2], generatedAt: "2026-07-16T00:00:00Z" });
    api.fetchPrecleanedArticle.mockImplementation(async (id: string) => ({ ...(id === item.id ? detail : { ...legacyApprovedItem2, metadata: {}, content: "## 部署步骤\n\n正文" }) }));
    render(<ArticleWorkflowView />);
    expect(await screen.findByText(/文章.md/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "投稿" })).not.toBeInTheDocument();
    expect(screen.queryByText("原始资料进入架构师本地处理队列")).not.toBeInTheDocument();
    expect(screen.queryByText(/本地 Skill 产出/)).not.toBeInTheDocument();
    // 最后扫描说明行已删（Master 2026-10-16 裁定「这个功能看着没用」）
    expect(screen.getByText("投稿记录")).toBeInTheDocument();
    [screen.getByRole("region", { name: "投稿记录" }), screen.getByRole("region", { name: "工作草稿" })].forEach((module) => {
      expect(module).toHaveClass("rounded-xl", "bg-surface-card", "ring-border-thin");
    });
    ["upload-history", "standard-articles"].forEach((title) => {
      expect(document.querySelector(`[data-module-title="${title}"] svg`)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "展开投稿记录" }).querySelector("svg")).toBeInTheDocument();
    // 页面级标题「文章准入」已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）；
    // 主卡片标题「工作草稿」唯一，无内层重复标题
    expect(screen.getAllByRole("heading", { name: "工作草稿" })).toHaveLength(1);
    // 计数升级为 stat 数字（待标准化 / 已标准化 / 工作草稿）
    const stats = screen.getByTestId("admission-stats");
    expect(within(stats).getByText("待标准化").querySelector("b")).toHaveTextContent("1");
    expect(within(stats).getByText("已标准化").querySelector("b")).toHaveTextContent("1");
    expect(within(stats).getByText("工作草稿").querySelector("b")).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: /批准所选/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
    expect(screen.queryByText("原始资料.pdf")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开投稿记录" }));
    expect(screen.getByText("原始资料.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 / 2 篇工作草稿").parentElement).toHaveClass("text-kg-xs");
    expect(screen.getByRole("textbox", { name: "工作草稿分页 跳转页码" })).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: "搜索工作草稿" })).toHaveClass("h-8", "text-xs", "bg-transparent");
    expect(screen.getByRole("heading", { name: "工作草稿" }).compareDocumentPosition(screen.getByRole("textbox", { name: "搜索工作草稿" }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 收官批（Master 裁定 A）：T12 投稿记录表化后同页两表——断言由「页面唯一表」收窄为按表名定位 T05 工作草稿表
    // 后续裁定（2026-10-16）：同页两表口径撞脸，T05 摘除钉住的旧字号类（text-xs/text-text-sub）回归 14px 基线（卡 §十三.1），断言改钉基座形态
    expect(screen.getByRole("table", { name: "工作草稿表" })).toHaveClass("data-table__table", "table-fixed");
    ["文章标题", "产品 / 模块", "类型 / 版本", "标准化校验状态", "更新时间"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "筛选标准化校验状态" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "更新时间排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: /最旧优先/ }));
    // 收官批（Master 裁定 A）同批第二处单表假设：行序查询由页面级收窄为表内（T12 表化后页面两表）
    expect(within(screen.getByRole("table", { name: "工作草稿表" })).getAllByRole("row")[1]).toHaveTextContent("文章");

    expect(screen.getByRole("region", { name: "原始资料投稿浮动栏" })).toBeInTheDocument();
    const pdf = new File(["%PDF"], "manual.pdf", { type: "application/pdf" });
    const markdown = new File(["# note"], "note.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("选择多个原始资料"), { target: { files: [pdf, markdown] } });
    fireEvent.click(screen.getByRole("button", { name: "投稿 2 个文件" }));
    await waitFor(() => expect(api.uploadArticle).toHaveBeenCalledTimes(2));
    expect(api.uploadArticle).toHaveBeenNthCalledWith(1, { fileName: "manual.pdf", contentBase64: "JVBERg==" }, undefined);
    expect(api.uploadArticle).toHaveBeenNthCalledWith(2, { fileName: "note.md", contentBase64: "IyBub3Rl" }, undefined);
    expect(await screen.findByText(/已投稿 2\/2/)).toBeInTheDocument();
    expect(screen.queryByLabelText("产品")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("模块")).not.toBeInTheDocument();

    // 目标态主链：标准化校验通过即产出标准文章（可检索阅读），不经过任何批准动作。
    fireEvent.click(screen.getByRole("button", { name: "查看 文章" }));
    expect(await screen.findByText(/正文/)).toBeInTheDocument();
    expect(screen.getByText("标准化校验：待标准化")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标准化文章" }));
    await waitFor(() => expect(api.standardizeArticle).toHaveBeenCalledWith("article-1"));
    expect(await screen.findByText("标准化校验：已标准化")).toBeInTheDocument();
    expect(screen.getByTitle(`release-${"e".repeat(64)}`)).toHaveTextContent("正式版本 eeeeeeeeeeee");
    expect(screen.getByTitle("c".repeat(40))).toHaveTextContent("变更提案 123456789abc");
    // PR-151：已标准化文章保留「标准化文章」入口（内容变化后重走标准化；补齐表单同样常驻）
    expect(screen.getByRole("button", { name: "标准化文章" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(await screen.findAllByText("已标准化")).not.toHaveLength(0);

    // 图事实已收敛进行内 🚀（勾选体系退役 2026-10-15）：无复选框、无批次动作残留
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "审批与发布" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开始暂存计算|发布图谱|创建退役批次/ })).not.toBeInTheDocument();
  }, 10_000);

  it("P5 守卫：无上传任务时不渲染规模统计堆与教育横幅（Master 2026-10-29 横幅全撤）", async () => {
    api.fetchArticleUploads.mockResolvedValue({ items: [], total: 0, statusCounts: { awaiting_architect_processing: 0, awaiting_approval: 0, standardized: 0, published: 0, source_deleted: 0, digested: 0 }, generatedAt: "2026-10-29T00:00:00Z" });
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [], generatedAt: "2026-10-29T00:00:00Z" });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText(/搜索工作草稿/)).toBeInTheDocument(); // 工具条常驻为就绪锚
    expect(screen.queryByText("待架构师处理")).not.toBeInTheDocument(); // 零值统计堆不渲染
    expect(screen.queryByText(/数据源：|标准化校验通过即成为/)).not.toBeInTheDocument(); // 双横幅撤
  });

  it("keeps the precleaned inventory table visible when the directory is empty", async () => {
    api.fetchPrecleanedArticles.mockResolvedValueOnce({ items: [], generatedAt: "2026-07-16T00:00:00Z" });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText(/搜索工作草稿/)).toBeInTheDocument(); // 空态即结构：锚工具条，无提示文案
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "文章标题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文章标题排序" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /批准所选/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows standardization WARNING count without blocking the article", async () => {
    api.fetchPrecleanedArticles.mockResolvedValueOnce({ items: [{ ...item, standardizationStatus: "standardized" as const, standardizationWarningCount: 2, currentStandardVersion: { articleId: item.id, contentHash: "a".repeat(64), snapshotPath: `知识库/wiki/articles/${item.id}/${"a".repeat(64)}.md`, validatedAt: "2026-07-16T01:00:00Z" }, validatedAt: "2026-07-16T01:00:00Z", formalContentHash: "a".repeat(64) }], generatedAt: "2026-07-16T00:00:00Z" });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("WARNING 2 项")).toBeInTheDocument();
    expect(screen.getAllByText("已标准化")).not.toHaveLength(0);
  });

  it("does not revive the retired batch workflow from a legacy batchId query", async () => {
    window.location.hash = "#/article-workflow?batchId=repair-1";
    api.fetchPrecleanedArticles.mockResolvedValueOnce({ items: [], generatedAt: "2026-07-16T00:00:00Z" });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText(/搜索工作草稿/)).toBeInTheDocument(); // 空态即结构：锚工具条，无提示文案
    expect(screen.queryByText("派生图来源修复")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始暂存计算" })).not.toBeInTheDocument();
    window.location.hash = "";
  });

  it("keeps article standardization separate while graph processing is active", async () => {
    api.fetchPrecleanedArticles.mockResolvedValueOnce({ items: [{ ...legacyApprovedItem2, graphStatus: "processing" as const, graphAdmissionStatus: "processing" as const, submittedAt: "2026-07-16T01:00:00Z", batchId: "batch-1", pipelineJobId: "pipeline-1" }], generatedAt: "2026-07-16T01:02:00Z" });
    render(<ArticleWorkflowView />);
    expect((await screen.findAllByText("已标准化")).length).toBeGreaterThan(0); // 摘要条与筛选项均可命中 // 摘要条与筛选项均可命中
    expect(screen.queryByText("管道处理完成")).not.toBeInTheDocument();
    expect(screen.queryByText("管道处理中")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows the derived upload lifecycle instead of a fixed waiting label", async () => {
    api.fetchArticleUploads.mockResolvedValueOnce({
      items: [{ ...uploadTask, status: "published", precleanedPath: item.sourcePath, precleanedPaths: [item.sourcePath], articleIds: [item.id], candidateCount: 1 }],
      total: 1,
      statusCounts: { ...waitingUploadCounts, awaiting_architect_processing: 0, published: 1 },
      generatedAt: "2026-07-16T01:02:00Z",
    });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("投稿已完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开投稿记录" }));
    // 终态历史默认折叠（2026-10-15 方案 2）：先展开历史再断言条目
    fireEvent.click(screen.getByRole("button", { name: /展开终态历史/ }));
    expect(screen.getByText("已发布")).toBeInTheDocument();
    expect(screen.queryByText("等待架构师本地处理")).not.toBeInTheDocument();
  });

  it("counts a standardized upload task as handed off instead of pending", async () => {
    api.fetchArticleUploads.mockResolvedValueOnce({
      items: [{ ...uploadTask, status: "standardized", precleanedPath: item.sourcePath, precleanedPaths: [item.sourcePath], articleIds: [item.id], candidateCount: 1 }],
      total: 1,
      statusCounts: { ...waitingUploadCounts, awaiting_architect_processing: 0, standardized: 1 },
      generatedAt: "2026-07-16T01:02:00Z",
    });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("投稿已完成，审批与发布见工作草稿。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开投稿记录" }));
    fireEvent.click(screen.getByRole("button", { name: /展开终态历史/ }));
    expect(screen.getByText("已标准化（待审批）")).toBeInTheDocument();
  });

  it("WP-038 上传即自动链跑：.md 投稿成功后不经点击触发校验与提升，非 .md 不触发", async () => {
    render(<ArticleWorkflowView />);
    await screen.findByRole("region", { name: "原始资料投稿浮动栏" });
    const pdf = new File(["%PDF"], "auto.pdf", { type: "application/pdf" });
    const markdown = new File(["# auto"], "auto-note.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("选择多个原始资料"), { target: { files: [pdf, markdown] } });
    fireEvent.click(screen.getByRole("button", { name: "投稿 2 个文件" }));
    await waitFor(() => expect(api.uploadArticle).toHaveBeenCalledTimes(2));
    // .md：上传成功回调自动链跑 validate→promote（draftPath 取上传返回任务的投稿路径）
    await waitFor(() => expect(api.validateDraftArticle.mock.calls.some((call) => call[0] === "知识库/raw/drafts/投稿/auto-note.md")).toBe(true));
    await waitFor(() => expect(api.promoteDraftArticle).toHaveBeenCalledWith("知识库/raw/drafts/投稿/auto-note.md"));
    // 非 .md：零触发（runStandardizationSkill 内 guard 拦截）
    expect(api.validateDraftArticle.mock.calls.every((call) => call[0].endsWith(".md"))).toBe(true);
    expect(api.promoteDraftArticle.mock.calls.every((call) => call[0].endsWith(".md"))).toBe(true);
  });

  it("WP-063 去按钮化：precleaned 面无标准化按钮（标准化由服务端哈希回退后自动执行）", async () => {
    api.fetchArticleUploads.mockResolvedValue({ items: [mdUploadTask], total: 1, statusCounts: waitingUploadCounts, generatedAt: "2026-07-16T00:00:00Z" });
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [{ ...item, id: "article-md", fileName: "测试文章.md", title: "测试文章", sourcePath: "知识库/raw/precleaned/测试文章.md", standardizationStatus: "pending_standardization" as const }], generatedAt: "2026-07-16T00:00:00Z" });
    render(<ArticleWorkflowView />);
    // 行内标准化按钮退役——不存在「标准化 测试文章」按钮
    expect(screen.queryByRole("button", { name: "标准化 测试文章" })).toBeNull();
    // Skill 链（validate→promote）不再由前端按钮触发——自动执行在服务端 synchronizedState
    expect(api.validateDraftArticle).not.toHaveBeenCalled();
    expect(api.promoteDraftArticle).not.toHaveBeenCalled();
  });

  it("WP-063 去按钮化：Skill 链三态测试面退役——validate/promote 由服务端自动执行（哈希回退触发）", () => {
    // 三态覆盖（字段缺失警告/结构性失败/WARNING 不阻断）原依赖行内按钮触发 Skill 链；
    // WP-063 去按钮化后标准化由服务端 synchronizedState 哈希回退自动调 standardize（ID 路径）——
    // 前端不再承载该触发面；服务端行为由 article-workflow-service.test.cjs 全链测试覆盖。
    // 保守断言：按钮不存在＋Skill 链不被前端调用。
    api.validateDraftArticle.mockClear();
    api.promoteDraftArticle.mockClear();
    api.fetchArticleUploads.mockResolvedValue({ items: [mdUploadTask], total: 1, statusCounts: waitingUploadCounts, generatedAt: "2026-07-16T00:00:00Z" });
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [{ ...item, id: "article-md", fileName: "测试文章.md", title: "测试文章", sourcePath: "知识库/raw/precleaned/测试文章.md", standardizationStatus: "pending_standardization" as const }], generatedAt: "2026-07-16T00:00:00Z" });
    render(<ArticleWorkflowView />);
    expect(screen.queryByRole("button", { name: "标准化 测试文章" })).toBeNull();
    expect(api.validateDraftArticle).not.toHaveBeenCalled();
    expect(api.promoteDraftArticle).not.toHaveBeenCalled();
  });

  it("WP-104：ERROR阻断不计作待标准化，三种校验结果分列", async () => {
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [{ ...item, standardizationStatus: "blocked" }, legacyApprovedItem2], generatedAt: "t" });
    render(<ArticleWorkflowView />);
    const stats = await screen.findByTestId("admission-stats");
    expect(within(stats).getByText("待标准化").querySelector("b")).toHaveTextContent("0");
    expect(within(stats).getByText("ERROR 阻断").querySelector("b")).toHaveTextContent("1");
    expect(within(stats).getByText("已标准化").querySelector("b")).toHaveTextContent("1");
    expect(screen.queryByText("1 篇工作草稿仍待标准化。")).not.toBeInTheDocument();
  });

  it("WP-104：投稿已标准化但未发布时汇总只声明投稿处理完成", async () => {
    api.fetchArticleUploads.mockResolvedValue({ items: [{ ...uploadTask, status: "standardized" }], total: 1, statusCounts: { ...waitingUploadCounts, awaiting_architect_processing: 0, standardized: 1 }, generatedAt: "t" });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("投稿已完成，审批与发布见工作草稿。")).toBeInTheDocument();
    expect(screen.queryByText("全部处理完成")).not.toBeInTheDocument();
  });

  it.each(["published", "source_deleted", "digested"] as const)("WP-104：%s没有工作草稿时不指向已退场草稿", async (status) => {
    api.fetchPrecleanedArticles.mockResolvedValue({ items: [], generatedAt: "t" });
    api.fetchArticleUploads.mockResolvedValue({ items: [{ ...uploadTask, status }], total: 1, statusCounts: { awaiting_architect_processing: 0, awaiting_approval: 0, standardized: 0, published: 0, source_deleted: 0, digested: 0, [status]: 1 }, generatedAt: "t" });
    render(<ArticleWorkflowView />);
    expect(await screen.findByText("投稿已完成")).toBeInTheDocument();
    expect(screen.queryByText(/审批与发布请查看工作草稿/)).not.toBeInTheDocument();
  });

});
