import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComponentCheckDetail } from "@/features/property-gov/ComponentCheckDetail";
import { usePropertyStore } from "@/features/property-gov/property-store";
import type { CheckResultItem } from "@/features/property-gov/property-types";

/** PR-314/WP-178：重新生成属性入队成功后的持久回显——结果去向指引，非按钮瞬时变字。 */
const refreshApi = vi.hoisted(() => ({ refreshProperty: vi.fn() }));

vi.mock("@/features/property-gov/property-api", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshProperty: (...args: unknown[]) => refreshApi.refreshProperty(...(args as [])),
}));

const item = {
  componentId: "mysql",
  label: "MySQL",
  module: null,
  sourcePath: "知识库/wiki/entities/MySQL.md",
  sourcePathExists: true,
  sourceRevision: { mtimeMs: 1, size: 2, contentHash: `sha256:${"a".repeat(64)}` },
  checks: {
    stale_property: { passed: false, articleMtime: "2026-11-10T08:00:00Z", propertyExtractedAt: "2026-11-01T08:00:00Z" },
  },
} as unknown as CheckResultItem;

describe("PR-314 重新生成属性队列回显", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePropertyStore.setState({ lastRefreshQueued: null, repairingId: null });
    refreshApi.refreshProperty.mockResolvedValue(undefined);
  });

  it("入队成功后卡片出现持久队列提示（含时间与结果去向指引）", async () => {
    
    render(<ComponentCheckDetail item={item} />);
    fireEvent.click(screen.getByRole("button", { name: /重新生成属性/ }));
    const hint = await screen.findByTestId("refresh-queued-hint");
    expect(hint.textContent).toContain("已加入队列");
    expect(hint.textContent).toContain("重新检查");
    // busy 早已结束（refreshingId 复位），提示仍在——非瞬时变字
    expect(usePropertyStore.getState().repairingId).toBeNull();
    expect(screen.getByTestId("refresh-queued-hint")).toBeInTheDocument();
  });

  it("入队失败不出现队列提示", async () => {
    
    refreshApi.refreshProperty.mockRejectedValue(new Error("boom"));
    render(<ComponentCheckDetail item={item} />);
    fireEvent.click(screen.getByRole("button", { name: /重新生成属性/ }));
    expect(await screen.findByRole("button", { name: /重新生成属性/ })).toBeInTheDocument();
    expect(screen.queryByTestId("refresh-queued-hint")).toBeNull();
  });
});
