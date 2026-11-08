// WP-027（PR-142）：GraphFreshnessChip 图新鲜度状态提示——四态渲染＋保存成功后即刷（refreshTick）。
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { GraphFreshnessChip } from "@/features/schema-manager/GraphFreshnessChip";

const api = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetchJson: api.fetchJson,
}));

afterEach(() => {
  vi.useRealTimers();
  api.fetchJson.mockReset();
});

describe("GraphFreshnessChip · 图新鲜度状态", () => {
  it("upToDate=true → 图谱已是最新", async () => {
    api.fetchJson.mockResolvedValue({ success: true, data: { upToDate: true, changed: [], scheduler: { pending: false } } });
    render(<GraphFreshnessChip />);
    const chip = await screen.findByTestId("graph-freshness-chip");
    await waitFor(() => expect(chip.getAttribute("data-state")).toBe("fresh"));
    expect(screen.getByText("图谱已是最新")).toBeInTheDocument();
  });

  it("upToDate=false 且调度窗内 → 图谱待更新＋预计触发时刻", async () => {
    api.fetchJson.mockResolvedValue({
      success: true,
      data: { upToDate: false, changed: ["ontology.yaml"], scheduler: { pending: true, firesAt: "2026-10-28T12:34:00.000Z" } },
    });
    render(<GraphFreshnessChip />);
    const chip = await screen.findByTestId("graph-freshness-chip");
    await waitFor(() => expect(chip.getAttribute("data-state")).toBe("stale"));
    expect(screen.getByText(/图谱待更新/)).toBeInTheDocument();
    expect(screen.getByText(/自动刷新/)).toBeInTheDocument();
  });

  it("upToDate=null（从未增量抽取）→ 图状态未知，不假绿", async () => {
    api.fetchJson.mockResolvedValue({ success: true, data: { upToDate: null, changed: [], scheduler: null } });
    render(<GraphFreshnessChip />);
    const chip = await screen.findByTestId("graph-freshness-chip");
    await waitFor(() => expect(chip.getAttribute("data-state")).toBe("unknown"));
    expect(screen.getByText("图状态未知")).toBeInTheDocument();
  });

  it("请求失败 → 未知态（fail-open 不打断页面）", async () => {
    api.fetchJson.mockRejectedValue(new Error("network down"));
    render(<GraphFreshnessChip />);
    const chip = await screen.findByTestId("graph-freshness-chip");
    await waitFor(() => expect(chip.getAttribute("data-state")).toBe("unknown"));
  });

  it("refreshTick 变化（保存成功）→ 立即重新拉取", async () => {
    api.fetchJson.mockResolvedValue({ success: true, data: { upToDate: true, changed: [], scheduler: null } });
    const { rerender } = render(<GraphFreshnessChip refreshTick={0} />);
    await screen.findByTestId("graph-freshness-chip");
    await waitFor(() => expect(api.fetchJson).toHaveBeenCalledTimes(1));
    rerender(<GraphFreshnessChip refreshTick={1} />);
    await waitFor(() => expect(api.fetchJson).toHaveBeenCalledTimes(2));
  });
});
