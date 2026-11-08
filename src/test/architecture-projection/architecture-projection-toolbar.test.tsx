import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ArchProjToolbar from "@/components/architecture-projection/ArchitectureProjectionToolbar";

describe("ArchProjToolbar", () => {
  const base = { filter: "all" as const, onFilterChange: vi.fn(), counts: { implicit: 2, unresolved: 1, missing: 1 }, onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFitView: vi.fn(), onToggleFullscreen: vi.fn(), isFullscreen: false, fullscreenAvailable: true, onClearHighlight: vi.fn(), hasHighlight: false };

  it("renders filter buttons", () => { render(<ArchProjToolbar {...base} />); expect(screen.getByText("全部")).toBeDefined(); });
  it("shows counts on filter buttons", () => { render(<ArchProjToolbar {...base} />); expect(screen.getByText(/间接关联/).textContent).toContain("2"); });
  it("clicking filter calls onFilterChange", () => { const fn = vi.fn(); render(<ArchProjToolbar {...base} onFilterChange={fn} />); fireEvent.click(screen.getByText(/间接关联/)); expect(fn).toHaveBeenCalledWith("implicit"); });
  it("renders aligned icon controls", () => { render(<ArchProjToolbar {...base} />); expect(screen.getByTestId("architecture-projection-toolbar")).toHaveClass("bg-surface-root", "border-border-thin"); expect(screen.getByRole("button", { name: "适配画布" })).toBeDefined(); });
  it("zoom in calls onZoomIn", () => { const fn = vi.fn(); render(<ArchProjToolbar {...base} onZoomIn={fn} />); fireEvent.click(screen.getByRole("button", { name: "放大" })); expect(fn).toHaveBeenCalled(); });
  it("fullscreen disabled when unavailable", () => { render(<ArchProjToolbar {...base} fullscreenAvailable={false} />); expect((screen.getByRole("button", { name: "全屏" }) as HTMLButtonElement).disabled).toBe(true); });
  it("clear highlight visible when hasHighlight", () => { render(<ArchProjToolbar {...base} hasHighlight={true} />); expect(screen.getByText("清除高亮")).toBeDefined(); });
});
