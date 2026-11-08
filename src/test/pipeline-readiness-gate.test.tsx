import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GlobalPipelineControl } from "@/components/pipeline/GlobalPipelineControl";
import { cancelPipeline, fetchPipelineStatus, rebuildPipeline, runPipeline, type PipelineJob } from "@/lib/pipeline-api";
import { usePipelineStore } from "@/lib/pipeline-store";
import { TERM } from "@/constants/term-const";

vi.mock("@/lib/pipeline-api", async (original) => ({ ...(await original<typeof import("@/lib/pipeline-api")>()), fetchPipelineStatus: vi.fn(), runPipeline: vi.fn(), rebuildPipeline: vi.fn(), cancelPipeline: vi.fn() }));

const idle: PipelineJob = { state: "idle", message: "尚未运行", logs: [] };
const running: PipelineJob = { state: "running", message: "Stage 1", stage: "1", logs: [] };

describe("Pipeline readiness gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePipelineStore.setState({ job: null, open: false, status: "idle", confirming: false, confirmingMode: "diagnostic", error: null, initialized: false });
    vi.mocked(fetchPipelineStatus).mockResolvedValueOnce(idle).mockResolvedValue(running);
    vi.mocked(runPipeline).mockResolvedValue(running);
    vi.mocked(rebuildPipeline).mockResolvedValue(running);
    vi.mocked(cancelPipeline).mockResolvedValue({ ...running, state: "cancelling" });
  });

  async function openPanel() {
    render(<GlobalPipelineControl />);
    const runButton = await screen.findByRole("button", { name: TERM.OPEN_GRAPH_PIPELINE_ACTION });
    expect(runButton).toHaveAttribute("title", TERM.GRAPH_PIPELINE);
    expect(runButton).toHaveClass("h-8", "w-8");
    expect(runButton).not.toHaveTextContent(TERM.GRAPH_PIPELINE);
    fireEvent.click(runButton);
    expect(await screen.findByRole("dialog", { name: TERM.GRAPH_PIPELINE })).toHaveTextContent("尚未运行");
  }

  it("starts global diagnosis even when content blockers may exist", async () => {
    await openPanel();
    // ADR063 双模式：默认档=只读诊断（WP-146 件1：只读诊断升主按钮，直执行无阻断确认）
    fireEvent.click(screen.getByRole("button", { name: TERM.RUN_PIPELINE_DIAGNOSTIC_ACTION }));
    await waitFor(() => expect(runPipeline).toHaveBeenCalledOnce());
    expect(await screen.findByText("运行中 · 阶段 1")).toBeInTheDocument();
  });

  it("runs the read-only diagnosis directly without a blocking confirmation (WP-146 件1)", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: TERM.RUN_PIPELINE_DIAGNOSTIC_ACTION }));
    await waitFor(() => expect(runPipeline).toHaveBeenCalledOnce());
    expect(screen.queryByText(/内容阻断不会拒绝诊断，也不会自动批准文章或发布图谱/)).not.toBeInTheDocument();
    expect(await screen.findByText("运行中 · 阶段 1")).toBeInTheDocument();
  });

  it("asks rebuild-specific confirmation with error-level visuals before a full --force rebuild (ADR063 + WP-146 件1)", async () => {
    await openPanel();
    // 重建档收进「进阶操作」折叠区（jsdom 中 details 收起内容仍可查询）
    fireEvent.click(screen.getByRole("button", { name: TERM.RUN_FULL_GRAPH_PIPELINE_ACTION }));
    expect(screen.getByText(/完整重建将全量重跑管道并重写工作投影/)).toBeInTheDocument();
    expect(screen.getByText(/来源为空时将重建为空投影/)).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: "确认重建" });
    // 险级视觉分离：重建确认钮=error 险级（bg-status-error 系），不再是 warn 同款
    expect(confirmButton).toHaveClass("bg-status-error-3", "text-status-error");
    fireEvent.click(confirmButton);
    await waitFor(() => expect(rebuildPipeline).toHaveBeenCalledOnce());
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("links a completed diagnostic with blockers to the refreshed workbench", async () => {
    vi.mocked(fetchPipelineStatus).mockReset();
    vi.mocked(fetchPipelineStatus).mockResolvedValue({
      state: "succeeded", message: "Pipeline 执行完成", stage: "complete", logs: [],
      diagnostics: { status: "completed", generatedAt: "2026-07-25T00:00:00.000Z", blockerCount: 1, verifiedCount: 0, issueIds: ["issue-1"], message: "发现 1 项待处理问题" },
    });
    render(<GlobalPipelineControl />);
    fireEvent.click(await screen.findByRole("button", { name: TERM.OPEN_GRAPH_PIPELINE_ACTION }));
    const link = await screen.findByRole("link", { name: `打开${TERM.PENDING_ISSUES}` });
    expect(link).toHaveAttribute("href", "#/anomalies");
  });
});
