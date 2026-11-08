// 「刷新并重检」按钮退役（Master 裁 2026-10-14）：①源删除销账②stuck-rerunning 重置③verified
// 托管已归位服务端读时对账（closeDeletedSourceEntries / applyLedgerTransitions / hostVerifiedSourceStatus），
// 拉列表即完整对账，页头不再出手动重检入口；reconcileAndLoad 保留为 B1 批量修复的程序化入口。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnomalyWorkbenchView } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";

describe("AnomalyWorkbenchView reconcile action retirement", () => {
  it("页头不再渲染「刷新并重检」按钮（读时对账归位后无手动入口）", () => {
    useAnomalyWorkbenchStore.setState({ issues: [], selectedIssueId: null, status: "idle", error: null, refreshing: false });
    render(<AnomalyWorkbenchView />);
    expect(screen.queryByRole("button", { name: "刷新并重检" })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/重检全部来源/)).not.toBeInTheDocument();
  });
});
