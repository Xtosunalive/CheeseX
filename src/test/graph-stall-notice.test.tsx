// GraphStallNotice 门禁（2026-11-22 Master「做」——OpenMAIC StorageHealthNotice 同构）：
// 钉死三条不变量——①常态零渲染（idle/running/succeeded/cancelled 均不出现）②停摆（failed）
// 才渲染：标题＋失败原因＋日志折叠③恢复即自隐（job 变 running → 横幅消失）。
// 层级：组件单元（pipeline-api mock——mock 返回值即 store 真相，经 initialize 异步落账）。
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphStallNotice } from "@/components/pipeline";
import { fetchPipelineStatus, type PipelineJob } from "@/lib/pipeline-api";
import { usePipelineStore } from "@/lib/pipeline-store";

vi.mock("@/lib/pipeline-api", async (original) => ({
  ...(await original<typeof import("@/lib/pipeline-api")>()),
  fetchPipelineStatus: vi.fn(),
}));

function job(state: PipelineJob["state"], overrides: Partial<PipelineJob> = {}): PipelineJob {
  return { state, message: "", logs: [], jobId: "job-1", mode: "full", stage: null, startedAt: null, finishedAt: null, exitCode: null, ...overrides } as PipelineJob;
}

const flush = () => act(async () => { await Promise.resolve(); });

describe("GraphStallNotice（图谱自动更新停摆横幅）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePipelineStore.setState({ job: null, status: "idle", initialized: false });
  });

  it("常态零渲染：idle／running／succeeded／cancelled 均不出现任何元素", async () => {
    for (const state of ["idle", "running", "succeeded", "cancelled"] as const) {
      vi.mocked(fetchPipelineStatus).mockResolvedValue(job(state));
      const { container, unmount } = render(<GraphStallNotice />);
      await flush();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      unmount();
      usePipelineStore.setState({ job: null, status: "idle", initialized: false });
    }
  });

  it("停摆渲染：failed 态出 role=alert——标题＋失败原因＋日志折叠", async () => {
    vi.mocked(fetchPipelineStatus).mockResolvedValue(job("failed", {
      message: "validate_graph 结构校验失败（exit=1）",
      logs: [{ source: "stdout", message: "❌ 主图存在悬空连接" }],
    }));
    render(<GraphStallNotice />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("图谱自动更新已停摆");
    expect(alert).toHaveTextContent("validate_graph 结构校验失败");
    expect(screen.getByText(/失败日志 \(1\)/)).toBeInTheDocument();
  });

  it("恢复即自隐：job 从 failed 变 running → 横幅消失（新一轮自动重试起动）", async () => {
    vi.mocked(fetchPipelineStatus).mockResolvedValue(job("failed", { message: "x" }));
    const { container } = render(<GraphStallNotice />);
    await screen.findByRole("alert");
    await act(async () => { usePipelineStore.setState({ job: job("running") }); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("失败原因缺省回落兜底文案", async () => {
    vi.mocked(fetchPipelineStatus).mockResolvedValue(job("failed", { message: "" }));
    render(<GraphStallNotice />);
    expect(await screen.findByRole("alert")).toHaveTextContent("管道最近一次运行失败");
  });
});
