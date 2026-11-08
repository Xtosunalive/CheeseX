import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchitectureVersionView } from "@/features/architecture-version/ArchitectureVersionView";
import { useArchitectureVersionStore } from "@/features/architecture-version/architecture-version-store";

vi.mock("@/features/architecture-version/architecture-version-api", () => ({
  fetchProductVersions: vi.fn(), compareArchitectureVersions: vi.fn(),
}));

import { compareArchitectureVersions, fetchProductVersions } from "@/features/architecture-version/architecture-version-api";

const versions = { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), items: [
  { product: "AnyShare", version: "7.0", label: "AnyShare 7.0", status: "released" as const, sourceMode: "snapshot" as const },
  { product: "AnyShare", version: "7.1", label: "AnyShare 7.1", status: "draft" as const, sourceMode: "live" as const },
] };

const comparison = {
  releaseId: `release-${"c".repeat(64)}`,
  sourceCommit: "d".repeat(40),
  product: "AnyShare",
  source: { version: "7.0", label: "AnyShare 7.0", status: "released" as const, sourceMode: "snapshot" as const, generatedAt: "2026-07-01T00:00:00.000Z" },
  target: { version: "7.1", label: "AnyShare 7.1", status: "draft" as const, sourceMode: "live" as const, generatedAt: null },
  summary: { componentsAdded: 1, componentsRemoved: 1, componentsChanged: 1, relationsAdded: 1, relationsRemoved: 1, documentsAdded: 1, documentsRemoved: 1 },
  components: { added: [{ id: "audit", label: "Audit", layer: "service", category: "服务", role: "" }], removed: [], changed: [] },
  relations: { added: [{ key: "audit|DEPENDS_ON|gateway", source: "audit", sourceLabel: "审计服务", target: "gateway", targetLabel: "网关", type: "DEPENDS_ON" }], removed: [{ key: "legacy|DEPENDS_ON|gateway", source: "legacy", sourceLabel: "旧服务", target: "gateway", targetLabel: "网关", type: "DEPENDS_ON" }] }, documents: { added: [], removed: [], changed: [] },
};

describe("ArchitectureVersionView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useArchitectureVersionStore.setState({ versions: null, comparison: null, status: "idle", comparing: false, error: null, product: "", sourceVersion: "", targetVersion: "" });
  });

  it("loads registered versions and compares valid states", async () => {
    vi.mocked(fetchProductVersions).mockResolvedValue(versions);
    vi.mocked(compareArchitectureVersions).mockResolvedValue(comparison);
    render(<ArchitectureVersionView />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——数据就绪改由副标题断言
    await screen.findByText("产品版本数"); // 页题已裁删——以锚点卡为就绪信号
    fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
    await waitFor(() => expect(compareArchitectureVersions).toHaveBeenCalledWith("AnyShare", "7.0", "7.1"));
    expect(useArchitectureVersionStore.getState().versions).toMatchObject({ releaseId: versions.releaseId, sourceCommit: versions.sourceCommit });
    expect(useArchitectureVersionStore.getState().comparison).toMatchObject({ releaseId: comparison.releaseId, sourceCommit: comparison.sourceCommit });
    expect(await screen.findByText("架构组件新增")).toBeInTheDocument();
    expect(screen.getByText("Audit")).toBeInTheDocument();
    expect(screen.getByText("审计服务").parentElement).toHaveTextContent("审计服务 → 依赖 → 网关");
    expect(screen.queryByText("audit")).not.toBeInTheDocument();
    expect(screen.queryByText("DEPENDS_ON")).not.toBeInTheDocument();
    expect(screen.getByText("快照")).toBeInTheDocument();
    expect(screen.getByText("实时投影")).toBeInTheDocument();
  });

  it("links to product version management when fewer than two versions exist", async () => {
    vi.mocked(fetchProductVersions).mockResolvedValue({ ...versions, items: [versions.items[0]] });
    render(<ArchitectureVersionView />);
    expect(await screen.findByText("至少需要两个产品版本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开产品版本校验" }));
    expect(window.location.hash).toBe("#/schema?tab=versions");
  });

  it("加载态：产品版本加载中显示加载提示", () => {
    vi.mocked(fetchProductVersions).mockReturnValue(new Promise(() => {}));
    render(<ArchitectureVersionView />);
    expect(screen.getByText("正在加载产品版本...")).toBeInTheDocument();
  });

  it("状态过期态：比较来源未验证时给出提示", async () => {
    vi.mocked(fetchProductVersions).mockResolvedValue(versions);
    vi.mocked(compareArchitectureVersions).mockResolvedValue(comparison);
    render(<ArchitectureVersionView />);
    fireEvent.click(await screen.findByRole("button", { name: "开始对比" }));
    expect(await screen.findByText("比较包含实时或待确认来源")).toBeInTheDocument();
  });

  it("失败态：产品版本加载失败时显示错误", async () => {
    vi.mocked(fetchProductVersions).mockRejectedValue(new Error("产品版本加载失败"));
    render(<ArchitectureVersionView />);
    expect(await screen.findByText("产品版本加载失败")).toBeInTheDocument();
  });

  it("defaults to a product that has two comparable versions", async () => {
    vi.mocked(fetchProductVersions).mockResolvedValue({ ...versions, items: [
      { product: "OneVersion", version: "1.0", label: "OneVersion 1.0", status: "draft", sourceMode: "live" },
      ...versions.items,
    ] });
    vi.mocked(compareArchitectureVersions).mockResolvedValue(comparison);
    render(<ArchitectureVersionView />);
    await screen.findByText("产品版本数"); // 页题已裁删——锚点卡为就绪信号
    fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
    await waitFor(() => expect(compareArchitectureVersions).toHaveBeenCalledWith("AnyShare", "7.0", "7.1"));
  });
});
