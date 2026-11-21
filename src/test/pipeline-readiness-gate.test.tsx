import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("diagnostic entry is retired from UI too — panel is status-only; channel stays at POST /api/pipeline/run (2026-11-22 Master「诊断按钮功能为什么还在」)", async () => {
    await openPanel();
    // 诊断按钮退役：面板纯状态化——「图为何未更新」由管道状态＋日志呈现，阻断由服务端链路汇入待处理问题
    expect(screen.queryByRole("button", { name: TERM.RUN_PIPELINE_DIAGNOSTIC_ACTION })).not.toBeInTheDocument();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("rebuild entry is retired from UI — no rebuild button/confirmation; channel stays at POST /api/pipeline/rebuild (2026-11-22 Master「现在就删」)", async () => {
    await openPanel();
    // 重建按钮与确认卡退役：日常走自愈链路（WP-216），维修通道保留在 rebuild 路由
    expect(screen.queryByRole("button", { name: TERM.RUN_FULL_GRAPH_PIPELINE_ACTION })).not.toBeInTheDocument();
    expect(screen.queryByText(/完整重建将全量重跑管道并重写工作投影/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认重建" })).not.toBeInTheDocument();
    expect(rebuildPipeline).not.toHaveBeenCalled();
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
