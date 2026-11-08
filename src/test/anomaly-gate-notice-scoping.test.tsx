import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnomalyGateNotice } from "@/features/anomaly-workbench/components/AnomalyGateNotice";

// 议题范围守卫（#1413）：闸点提示是「当前动作主体（文章）」的守门信息，
// 不是全库议题总账。审批工作台对文章 X 发布时，X 自己 0 条未处理议题
// 就不该挂着别的文章的计数（实测缺陷：样本A 发布旁显示样本C 的 6 条）。
const api = vi.hoisted(() => ({ fetchAnomalies: vi.fn() }));
vi.mock("@/features/anomaly-workbench/anomaly-workbench-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/anomaly-workbench/anomaly-workbench-api")>()),
  fetchAnomalies: api.fetchAnomalies,
}));

const SAMPLE_A = "知识库/raw/precleaned/样本A.md";
const SAMPLE_C = "知识库/raw/precleaned/样本C.md";

function issue(path: string, blockedActions: string[]) {
  return {
    issueId: `entity-${path}-${Math.random().toString(36).slice(2, 6)}`,
    issueKind: "missing_field",
    title: "x",
    status: "open",
    evidence: [{ kind: "entity-compliance", path }],
    blockedActions,
    handling: "fix",
  };
}

describe("AnomalyGateNotice · 议题范围（sourcePath 过滤）", () => {
  beforeEach(() => {
    api.fetchAnomalies.mockReset();
    api.fetchAnomalies.mockResolvedValue({ issues: [
      issue(SAMPLE_C, ["publish_graph"]),
      issue(SAMPLE_C, ["publish_graph"]),
      issue(SAMPLE_C, ["publish_graph"]),
      issue(SAMPLE_C, ["publish_graph"]),
      issue(SAMPLE_C, ["publish_graph"]),
      issue(SAMPLE_C, ["publish_graph"]),
      issue(SAMPLE_A, []),
    ], total: 7 });
  });

  it("T1 当前文章无议题：即使全库有别的文章的 publish_graph 议题也不渲染", async () => {
    const { container } = render(<AnomalyGateNotice action="publish_graph" sourcePath={SAMPLE_A} />);
    await waitFor(() => expect(api.fetchAnomalies).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[data-gate-notice]")).toBeNull());
  });

  it("T2 当前文章有议题：显示该文章自己的计数与跳转入口", async () => {
    render(<AnomalyGateNotice action="publish_graph" sourcePath={SAMPLE_C} />);
    expect(await screen.findByText(/6 条未处理议题与合并并激活 Release相关/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看/ })).toBeInTheDocument();
  });

  it("T3 守卫：不传 sourcePath 保持全量语义（全局诊断入口），不回归", async () => {
    render(<AnomalyGateNotice action="publish_graph" />);
    expect(await screen.findByText(/6 条未处理议题与合并并激活 Release相关/)).toBeInTheDocument();
  });

  it("T4 负例：issues 拉取失败时不渲染、不崩溃", async () => {
    api.fetchAnomalies.mockRejectedValue(new Error("网络失败"));
    const { container } = render(<AnomalyGateNotice action="publish_graph" sourcePath={SAMPLE_C} />);
    await waitFor(() => expect(api.fetchAnomalies).toHaveBeenCalled());
    expect(container.querySelector("[data-gate-notice]")).toBeNull();
    expect(container.textContent || "").not.toContain("未处理议题");
  });
});
