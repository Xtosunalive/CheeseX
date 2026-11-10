import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalWorkbench } from "@/features/approval-workbench/ApprovalWorkbench";
import * as approvalApi from "@/features/approval-workbench/approval-api";
import { ApiError } from "@/lib/api";

vi.mock("@/features/approval-workbench/approval-api", () => ({
  getApprovalStatus: vi.fn(),
  transitionApproval: vi.fn(),
  fetchApprovalCandidates: vi.fn(),
}));

vi.mock("@/features/article-workflow/article-workflow-api", () => ({
  standardizeArticle: vi.fn(),
}));

import * as articleWorkflowApi from "@/features/article-workflow/article-workflow-api";

describe("ApprovalWorkbench（状态机审批工作区）", () => {
  beforeEach(() => {
    vi.mocked(approvalApi.getApprovalStatus).mockReset();
    vi.mocked(approvalApi.transitionApproval).mockReset();
    vi.mocked(approvalApi.fetchApprovalCandidates).mockReset();
    vi.mocked(articleWorkflowApi.standardizeArticle).mockReset();
    vi.mocked(articleWorkflowApi.standardizeArticle).mockResolvedValue({
      id: "candidate-1", fileName: "x.md", title: "x", product: "", module: "", articleType: "", version: "",
      sourcePath: "知识库/raw/precleaned/x.md", updatedAt: "t", formalContentHash: "aa".repeat(32),
      standardizationStatus: "standardized", currentStandardVersion: null, validatedAt: "t", standardizationWarningCount: 0,
    } as never);
    vi.mocked(approvalApi.fetchApprovalCandidates).mockResolvedValue([
      { id: "candidate-1", title: "强制入主", fileName: "强制入主.md", standardizationStatus: "pending_standardization", formalContentHash: "aa".repeat(32), sourcePath: "知识库/raw/precleaned/强制入主.md" },
      { id: "candidate-2", title: "ECMS集群令牌过期排障", fileName: "ECMS集群令牌过期排障.md", standardizationStatus: "pending_standardization", formalContentHash: "bb".repeat(32), sourcePath: "知识库/raw/precleaned/ecms.md" },
    ]);
  });

  it("正式文章改动显示字段和正文对照；检查失败时确认不可执行", async () => {
    vi.mocked(approvalApi.fetchApprovalCandidates).mockResolvedValue([{ id: "candidate-1", title: "文章", fileName: "文章.md", standardizationStatus: "blocked", formalContentHash: "a".repeat(64), sourcePath: "知识库/raw/precleaned/文章.md" }]);
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "pending", revision: "sha256:" + "a".repeat(64), updatedAt: "t", changeSummary: {
      fields: [{ field: "title", before: "旧标题", after: "新标题" }], bodyChanged: true, beforeExcerpt: "旧正文", afterExcerpt: "新正文",
    } });
    render(<ApprovalWorkbench title="审批" />);
    expect(await screen.findByText("正式文章变动（请核对后确认）")).toBeInTheDocument();
    expect(screen.getByText("发布版：旧标题")).toBeInTheDocument();
    expect(screen.getByText("当前文件：新正文")).toBeInTheDocument();
    expect(screen.getByText("确认（批准）")).toBeDisabled();
  });

  it("pending 状态显示确认/驳回按钮（调用 /api/approval/*）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "pending", revision: "sha256:abc", updatedAt: "t" });
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "approved", updatedAt: "t2", releaseId: null });
    render(<ApprovalWorkbench articleId="a1" title="测试文章" />);
    await waitFor(() => expect(screen.getByText("确认（批准）")).toBeInTheDocument());
    fireEvent.click(screen.getByText("确认（批准）"));
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalledWith("a1", "confirm", { contentHash: undefined }));
  });

  it("approved 状态显示发布按钮（publish，携带候选 sourcePath）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "approved", revision: "sha256:abc", updatedAt: "t" });
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "snapshot", updatedAt: "t2", releaseId: "release-x" });
    render(<ApprovalWorkbench title="测试工作台" />);
    await waitFor(() => expect(screen.getByText("发布（打包快照）")).toBeInTheDocument());
    fireEvent.click(screen.getByText("发布（打包快照）"));
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalledWith("candidate-1", "publish", expect.objectContaining({ sourcePath: "知识库/raw/precleaned/强制入主.md" })));
  });

  it("B1 红灯：候选无 sourcePath 时发布按钮禁用（不得发出注定假成功的发布请求）", async () => {
    vi.mocked(approvalApi.fetchApprovalCandidates).mockResolvedValue([
      { id: "candidate-1", title: "无源文件候选", fileName: "x.md", standardizationStatus: "standardized", formalContentHash: "aa".repeat(32), sourcePath: "" },
    ]);
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "approved", revision: "sha256:abc", updatedAt: "t" });
    render(<ApprovalWorkbench title="测试工作台" />);
    const button = await waitFor(() => screen.getByText("发布（打包快照）"));
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(approvalApi.transitionApproval).not.toHaveBeenCalled());
  });

  it("B2 红灯：resubmit 两步化（先 standardizeArticle 取新哈希，再携带证据 transition）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "rejected", revision: "sha256:abc", updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockResolvedValue({
      id: "candidate-1", fileName: "强制入主.md", title: "强制入主", product: "", module: "", articleType: "", version: "",
      sourcePath: "知识库/raw/precleaned/强制入主.md", updatedAt: "t", formalContentHash: "cc".repeat(32),
      standardizationStatus: "standardized", currentStandardVersion: null, validatedAt: "t", standardizationWarningCount: 0,
    } as never);
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "pending", updatedAt: "t2", releaseId: null });
    render(<ApprovalWorkbench title="测试工作台" />);
    fireEvent.click(await waitFor(() => screen.getByText("修改后重新提交")));
    await waitFor(() => expect(articleWorkflowApi.standardizeArticle).toHaveBeenCalledWith("candidate-1"));
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalledWith("candidate-1", "resubmit", expect.objectContaining({ contentHash: "cc".repeat(32) })));
  });

  it("B2 红灯：publish 操作前刷新候选（防陈旧 contentHash 参数）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "approved", revision: "sha256:abc", updatedAt: "t" });
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "snapshot", updatedAt: "t2", releaseId: "release-x" });
    render(<ApprovalWorkbench title="测试工作台" />);
    fireEvent.click(await waitFor(() => screen.getByText("发布（打包快照）")));
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalled());
    const fetchCalls = vi.mocked(approvalApi.fetchApprovalCandidates).mock.calls.length;
    // 挂载一次 + 操作前刷新一次
    expect(fetchCalls).toBeGreaterThanOrEqual(2);
    const order = vi.mocked(approvalApi.fetchApprovalCandidates).mock.invocationCallOrder; const fetchOrder = order[order.length - 1];
    const transitionOrder = vi.mocked(approvalApi.transitionApproval).mock.invocationCallOrder[0];
    // 刷新必须先于 transition
    expect(fetchOrder).toBeLessThan(transitionOrder);
  });

  it("rejected 状态显示重新提交按钮（resubmit 两步化：先标准化再携带新哈希）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "rejected", revision: "sha256:abc", updatedAt: "t" });
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "pending", updatedAt: "t2", releaseId: null });
    render(<ApprovalWorkbench articleId="a1" title="测试文章" />);
    await waitFor(() => expect(screen.getByText("修改后重新提交")).toBeInTheDocument());
    fireEvent.click(screen.getByText("修改后重新提交"));
    // B2/D3：resubmit 先真实标准化取新 formalContentHash，再 transition（服务端管线复核）
    await waitFor(() => expect(articleWorkflowApi.standardizeArticle).toHaveBeenCalledWith("a1"));
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalledWith("a1", "resubmit", expect.objectContaining({ contentHash: "aa".repeat(32) })));
  });

  it("draft 状态显示标准化按钮（先真实标准化再状态机 standardize→pending）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "draft", revision: null, updatedAt: null });
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "pending", updatedAt: "t2", releaseId: null });
    render(<ApprovalWorkbench articleId="a1" title="测试文章" />);
    await waitFor(() => expect(screen.getByText("标准化（进入待审）")).toBeInTheDocument());
    fireEvent.click(screen.getByText("标准化（进入待审）"));
    // 第一步：触发真实标准化（article-workflow API）
    await waitFor(() => expect(articleWorkflowApi.standardizeArticle).toHaveBeenCalledWith("a1"));
    // 第二步：成功后状态机进入待审（带 contentHash）
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalledWith("a1", "standardize", expect.objectContaining({ contentHash: "aa".repeat(32) })));
  });

  it("不传 articleId 时加载真实候选并默认选第一篇（调 /api/articles/precleaned）", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "pending", revision: "sha256:abc", updatedAt: "t" });
    render(<ApprovalWorkbench title="测试工作台" />);
    await waitFor(() => {
      expect(approvalApi.fetchApprovalCandidates).toHaveBeenCalled();
      expect(screen.getByLabelText("选择审批文章")).toBeInTheDocument();
    });
    // 默认选中第一篇候选 → 状态查询用 candidate-1
    await waitFor(() => expect(approvalApi.getApprovalStatus).toHaveBeenCalledWith("candidate-1"));
    expect(screen.getAllByText(/强制入主/).length).toBeGreaterThan(0);
  });
  // WP-104：组件层回归；HTTP替身只证明页面消费，真栈证据另记审计表。
  it("送审后立即呈现返回revision，刷新未编辑文章不误报绑定失效", async () => {
    const hash = "a".repeat(64);
    const fresh = { id: "candidate-1", title: "强制入主", fileName: "强制入主.md", standardizationStatus: "standardized" as const, formalContentHash: hash, sourcePath: "知识库/raw/precleaned/强制入主.md" };
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValueOnce({ status: "draft", revision: null, updatedAt: null }).mockResolvedValue({ status: "pending", revision: "sha256:" + hash, updatedAt: "t2" });
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "pending", revision: "sha256:" + hash, updatedAt: "t2", releaseId: null });
    // 首次候选是旧字节，真实标准化会重盖章而改变hash。
    vi.mocked(approvalApi.fetchApprovalCandidates).mockResolvedValueOnce([{ ...fresh, formalContentHash: "b".repeat(64) }]).mockResolvedValue([fresh]);
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    fireEvent.click(await screen.findByText("标准化（进入待审）"));
    await screen.findByText(/revision sha256:aaaaa/);
    expect(screen.queryByText("重新标准化（源已变化，刷新绑定）")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(approvalApi.fetchApprovalCandidates).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("重新标准化（源已变化，刷新绑定）")).not.toBeInTheDocument();
  });

  it("刷新发现真实源变化后禁用确认，重新标准化后恢复", async () => {
    const oldHash = "a".repeat(64), newHash = "b".repeat(64);
    const candidate = { id: "candidate-1", title: "强制入主", fileName: "x.md", standardizationStatus: "standardized" as const, formalContentHash: oldHash, sourcePath: "知识库/raw/precleaned/x.md" };
    vi.mocked(approvalApi.fetchApprovalCandidates).mockResolvedValueOnce([candidate]).mockResolvedValue([{ ...candidate, formalContentHash: newHash }]);
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "pending", revision: "sha256:" + oldHash, updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockResolvedValue({ ...candidate, formalContentHash: newHash } as never);
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "pending", revision: "sha256:" + newHash, updatedAt: "t2", releaseId: null });
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    expect(await screen.findByRole("button", { name: "确认（批准）" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("重新标准化（源已变化，刷新绑定）");
    const confirm = screen.getByRole("button", { name: "确认（批准）" });
    expect(confirm).toBeDisabled(); fireEvent.click(confirm);
    expect(approvalApi.transitionApproval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("重新标准化（源已变化，刷新绑定）"));
    await waitFor(() => expect(screen.getByRole("button", { name: "确认（批准）" })).toBeEnabled());
    expect(screen.queryByText("重新标准化（源已变化，刷新绑定）")).not.toBeInTheDocument();
  });

  it("审批状态读取失败不显示可操作草稿，刷新成功才恢复", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockRejectedValueOnce(new Error("审批读取失败")).mockResolvedValue({ status: "draft", revision: null, updatedAt: null });
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "标准化（进入待审）" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("标准化（进入待审）")).toBeEnabled();
  });

  it("发布成功只声明已有正式快照，不替未查询的检索拓扑刷新作保证", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "snapshot", revision: "sha256:" + "a".repeat(64), updatedAt: "t" });
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    expect(await screen.findByText("已发布为正式快照。")).toBeInTheDocument();
    expect(screen.queryByText(/检索.*拓扑消费端已切换/)).not.toBeInTheDocument();
  });

  it("WP-103：批准后源变化可重新标准化回待审，旧批准不能继续发布", async () => {
    const oldHash = "a".repeat(64), newHash = "b".repeat(64);
    vi.mocked(approvalApi.fetchApprovalCandidates).mockResolvedValue([{ id: "candidate-1", title: "强制入主", fileName: "x.md", standardizationStatus: "standardized", formalContentHash: newHash, sourcePath: "知识库/raw/precleaned/x.md" }]);
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "approved", revision: "sha256:" + oldHash, updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockResolvedValue({ formalContentHash: newHash, standardizationStatus: "standardized" } as never);
    vi.mocked(approvalApi.transitionApproval).mockResolvedValue({ status: "pending", revision: "sha256:" + newHash, updatedAt: "t2", releaseId: null });
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    const recovery = await screen.findByRole("button", { name: "重新标准化（源已变化，刷新绑定）" });
    expect(screen.getByRole("button", { name: "发布（打包快照）" })).toBeDisabled();
    fireEvent.click(recovery);
    await waitFor(() => expect(approvalApi.transitionApproval).toHaveBeenCalledWith("candidate-1", "standardize", expect.objectContaining({ contentHash: newHash })));
    expect(await screen.findByRole("button", { name: "确认（批准）" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "发布（打包快照）" })).not.toBeInTheDocument();
  });

  it("PR-254：标准化被拒时显示服务端所需/当前角色、处理人和一次排查编号", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "draft", revision: null, updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockRejectedValue(new ApiError("操作所需角色未满足\n排查编号：tr_rolehint001", {
      errorCode: "ROLE_DENIED", details: { required: ["review"], have: ["submit"] }, traceId: "tr_rolehint001",
    }));
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    fireEvent.click(await screen.findByRole("button", { name: "标准化（进入待审）" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("所需角色：review");
    expect(alert).toHaveTextContent("当前角色：submit");
    expect(alert).toHaveTextContent("请联系系统维护者核对账号角色配置");
    expect(alert).toHaveTextContent("配置生效后再重试");
    expect(alert.textContent?.match(/tr_rolehint001/g)).toHaveLength(1);
    expect(approvalApi.transitionApproval).not.toHaveBeenCalled();
  });

  it("PR-254：发布拒绝回显其publish角色，不把其他动作的审核要求写死", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "approved", revision: "sha256:abc", updatedAt: "t" });
    vi.mocked(approvalApi.transitionApproval).mockRejectedValue(new ApiError("操作所需角色未满足", {
      errorCode: "ROLE_DENIED", details: { required: ["publish"], have: ["submit", "review"] },
    }));
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    fireEvent.click(await screen.findByRole("button", { name: "发布（打包快照）" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("所需角色：publish");
    expect(alert).toHaveTextContent("当前角色：submit、review");
    expect(screen.queryByText("已发布为正式快照。")).not.toBeInTheDocument();
  });

  it("PR-254：驳回后重提交的标准化拒绝也有下一步", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "rejected", revision: null, updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockRejectedValue(new ApiError("操作所需角色未满足", {
      errorCode: "ROLE_DENIED", details: { required: ["review"], have: [] },
    }));
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    fireEvent.click(await screen.findByRole("button", { name: "修改后重新提交" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("所需角色：review");
    expect(alert).toHaveTextContent("当前角色：无");
    expect(alert).toHaveTextContent("系统维护者");
    expect(approvalApi.transitionApproval).not.toHaveBeenCalled();
  });

  it.each([null, { required: "review" }, { required: [null, 2], have: {} }])("PR-254：角色详情缺失或形状异常时不猜角色，仍给处理路径（%j）", async (details) => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "draft", revision: null, updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockRejectedValue(new ApiError("操作所需角色未满足", { errorCode: "ROLE_DENIED", details }));
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    fireEvent.click(await screen.findByRole("button", { name: "标准化（进入待审）" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("操作所需角色未满足");
    expect(alert).toHaveTextContent("系统维护者");
    expect(alert).not.toHaveTextContent("所需角色：");
    expect(alert).not.toHaveTextContent("当前角色：");
  });

  it("PR-254：非权限错误保留原文，不附角色或授权指路", async () => {
    vi.mocked(approvalApi.getApprovalStatus).mockResolvedValue({ status: "draft", revision: null, updatedAt: "t" });
    vi.mocked(articleWorkflowApi.standardizeArticle).mockRejectedValue(new Error("网络暂不可用"));
    render(<ApprovalWorkbench articleId="candidate-1" title="测试文章" />);
    fireEvent.click(await screen.findByRole("button", { name: "标准化（进入待审）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^网络暂不可用$/);
  });

});
