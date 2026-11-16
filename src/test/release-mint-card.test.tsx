import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReleaseMintCard } from "@/features/data-dashboard/components/release-mint-card";

/** PR-321/WP-178：发布＝高危动作（铸版＋切 current 指针＋触发全量重建）——两段式确认，确认才 mint。 */
describe("PR-321 发布二次确认", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("单击发布先出确认承载（纯动作：确认/取消，无解说词——Master「文案收敛」口径），取消不发 mint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ReleaseMintCard />);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    const panel = screen.getByTestId("publish-confirm");
    expect(panel.textContent).not.toContain("此操作将");
    expect(screen.getByRole("button", { name: "确认发布" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByTestId("publish-confirm")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("确认后才 POST /api/releases/mint", async () => {
    
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { releaseId: "rel-1", artifactCount: 7 } }),
    }));
    render(<ReleaseMintCard />);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
    expect(await screen.findByTestId("publish-result")).toBeInTheDocument();
    const called = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
    expect(called.some((u) => u.includes("/api/releases/mint"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
