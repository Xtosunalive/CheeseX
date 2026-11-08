// Component: UsageBadgesStrip Tests（§3.3.1 实施项②）
// @responsible: B 域使用徽章——画像数据呈现/无数据静默/维度隔离
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { UsageBadgesStrip } from "@/features/schema-manager/UsageBadgesStrip";

vi.mock("@/features/schema-manager/schema-manager-store", () => ({
  useSchemaManagerStore: vi.fn(() => ({ discovery: null, discoveryRequest: { status: "idle", error: null }, discoveryOperationError: null, loadDiscovery: vi.fn() })),
}));
const profile = {
  dimensions: {
    layer: { words: [
      { word: "gateway", usageCount: 3, stage: "verified" as const },
      { word: "data", usageCount: 0, stage: "seed" as const },
    ], deadWords: ["data"], wildValues: [] },
    category: { words: [], deadWords: [], wildValues: [] },
    subdomain: { words: [{ word: "architecture", usageCount: 1, stage: "growing" as const }], deadWords: [], wildValues: [] },
    module: { words: [], deadWords: [], wildValues: [] },
    tag: { words: [], deadWords: [], wildValues: [] },
  },
  summary: { verifiedThreshold: 1, totalWords: 3, totalDead: 1, dimensions: {} },
};

describe("UsageBadgesStrip（§3.3.1 实施项②）", () => {
  beforeEach(() => {
    vi.mocked(useSchemaManagerStore).mockReturnValue({ discovery: { vocabularyProfile: profile } as never, discoveryRequest: { status: "idle", error: null }, discoveryOperationError: null, loadDiscovery: vi.fn() });
  });
  it("画像在：呈现阶段计数+死词", () => {
    render(<UsageBadgesStrip dimension="layer" label="架构分层" />);
    expect(screen.getByText(/Seed 1/)).toBeTruthy();
    expect(screen.getByText(/Verified 1/)).toBeTruthy();
    expect(screen.getByText(/死词 1/)).toBeTruthy();
  });
  it("无画像静默 null（不阻塞编辑）", () => {
    vi.mocked(useSchemaManagerStore).mockReturnValue({ discovery: null, discoveryRequest: { status: "idle", error: null }, discoveryOperationError: null, loadDiscovery: vi.fn() });
    const { container } = render(<UsageBadgesStrip dimension="layer" label="架构分层" />);
    expect(container.textContent).toBe("");
  });
  it("维度隔离：subdomain 只显 growing", () => {
    render(<UsageBadgesStrip dimension="subdomain" label="子域" />);
    expect(screen.getByText(/Growing 1/)).toBeTruthy();
  });
});
import { useSchemaManagerStore } from "@/features/schema-manager/schema-manager-store";
