import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyGateNotice } from "@/features/anomaly-workbench/components/AnomalyGateNotice";

// #1398 切片4（闸点呈现）：被阻止动作的使用点显示"被 N 条待处理议题阻止"+ 跳转待处理问题。
// blockedActions 数据后端已有（anomaly-workbench-service:45-46），本切片为纯接线（设计有没接上线类）。
const api = vi.hoisted(() => ({ fetchAnomalies: vi.fn() }));
vi.mock("@/features/anomaly-workbench/anomaly-workbench-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/anomaly-workbench/anomaly-workbench-api")>()),
  fetchAnomalies: api.fetchAnomalies,
}));

function item(blockedActions: string[]) {
  return { issueId: `i-${Math.random()}`, issueKind: "missing_field", title: "x", status: "open", evidence: [], blockedActions, handling: "fix" };
}

describe("AnomalyGateNotice · 闸点呈现", () => {
  it("有阻止议题：显示计数+动作名+去处理入口", async () => {
    api.fetchAnomalies.mockResolvedValue({ issues: [item(["publish_graph"]), item(["publish_graph"]), item([])], total: 3 });
    render(<AnomalyGateNotice action="publish_graph" />);
    expect(await screen.findByText(/2 条未处理议题与合并并激活 Release相关/)).toBeInTheDocument();
    expect(screen.getByText(/合并并激活 Release/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /查看/ })).toBeInTheDocument();
  });

  it("无阻止议题：不渲染任何东西", async () => {
    api.fetchAnomalies.mockResolvedValue({ issues: [item([])], total: 1 });
    const { container } = render(<AnomalyGateNotice action="publish_graph" />);
    await waitFor(() => expect(api.fetchAnomalies).toHaveBeenCalled());
    expect(container.querySelector("[data-gate-notice]")).toBeNull();
  });

  it("动作标签映射：publish_graph→合并并激活 Release（#1403：approve_article 已退役不再供闸门）", async () => {
    api.fetchAnomalies.mockResolvedValue({ issues: [item(["publish_graph"])], total: 1 });
    render(<AnomalyGateNotice action="publish_graph" />);
    expect(await screen.findByText(/合并并激活 Release/)).toBeInTheDocument();
  });
});
