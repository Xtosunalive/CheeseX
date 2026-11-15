import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckResultsPanel } from "@/features/property-gov/CheckResultsPanel";
import { ManifestListPanel } from "@/features/property-gov/ManifestListPanel";
import * as api from "@/features/property-gov/property-api";
import { usePropertyStore } from "@/features/property-gov/property-store";

vi.mock("@/features/property-gov/property-api", () => ({
  fetchArticleManifests: vi.fn(),
  fetchCheckResults: vi.fn(),
  repairProperty: vi.fn(),
  refreshProperty: vi.fn(),
}));

const summary = {
  totalSources: 2,
  totalManifests: 2,
  fresh: 1,
  missing: 1,
  stale: 0,
  unknown: 0,
  totalSourcesRaw: 2,
  excludedSources: 0,
  eligibleSources: 2,
  relationalManifests: 1,
  sourceOnlyManifests: 1,
  coveredSources: 1,
  missingEligible: 1,
  coverageRatio: 0.5,
};

const items = [
  {
    sourcePath: "知识库/wiki/entities/zeta.md",
    normalizedSourcePath: "知识库/wiki/entities/zeta.md",
    title: "Zeta",
    kind: "wiki_entity",
    nodeEvidenceCount: 1,
    directRelationCount: 1,
    manifestMode: "source_only",
    manifest: { exists: false, fresh: false, status: "missing", relativePath: null, reason: "missing" },
  },
  {
    sourcePath: "知识库/wiki/entities/alpha.md",
    normalizedSourcePath: "知识库/wiki/entities/alpha.md",
    title: "Alpha",
    kind: "standard_article",
    nodeEvidenceCount: 1,
    directRelationCount: 5,
    manifestMode: "relational",
    manifest: { exists: true, fresh: true, status: "fresh", relativePath: "raw/manifests/alpha.json", reason: "" },
  },
];

const passedChecks = {
  missing_module: { passed: true },
  invalid_module: { passed: true, value: "", validModules: [] },
  stale_property: { passed: true, articleMtime: "", propertyExtractedAt: "" },
  mount_mismatch: { passed: true, matchedEntityId: "alpha" },
  mount_diagnostic: { passed: true, entityCount: 1, edgeCount: 0, missingEntityIds: [] },
  format_artifact: { passed: true, artifacts: [] },
};

describe("ManifestListPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchArticleManifests).mockResolvedValue({ ok: true, data: { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), summary, items }, error: null, errorCode: null, details: null, traceId: null, status: 200 });
    vi.mocked(api.fetchCheckResults).mockResolvedValue({
      summary: { totalComponents: 2, blockerCount: 0, warningCount: 0, healthyCount: 2, coverageRatio: 1 },
      total: 2,
      limit: 50,
      offset: 0,
      items: [
        { componentId: "zeta", label: "Zeta", module: "Zulu", archLayer: "service", sourcePath: "zeta.md", sourcePathExists: true, checks: passedChecks },
        { componentId: "alpha", label: "Alpha", module: "Alpha", archLayer: "gateway", sourcePath: "alpha.md", sourcePathExists: true, checks: passedChecks },
      ],
    });
    usePropertyStore.setState({ checkResults: [], summary: null, status: "idle", error: null, filter: "all", query: "" });
  });

  it("uses the shared compact toolbar and sortable table", async () => {
    render(<ManifestListPanel />);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    const summaryBar = screen.getByTestId("manifest-summary");
    // 量值对齐批（Master 2026-11-15 裁）：概览 7 卡退役——唯一保留待办头条（过期＋未生成合计），分项计数由筛选档承载
    expect(summaryBar.compareDocumentPosition(screen.getByTestId("manifest-toolbar")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("manifest-summary-metric")).toHaveTextContent("1需要处理");
    expect(screen.getByText("映射过期 0 · 未生成映射 1")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    expect(screen.queryByText("应生成映射")).not.toBeInTheDocument();
    expect(screen.queryByText("图谱引用文档")).not.toBeInTheDocument();
    expect(screen.getByTestId("manifest-toolbar")).toHaveClass("rounded-lg", "bg-surface-root", "ring-border-thin");
    expect(screen.getByRole("textbox", { name: "搜索图谱引用文档" })).toHaveClass("h-8", "text-xs", "bg-transparent");
    expect(screen.getByRole("button", { name: "筛选文章图谱映射状态" })).toHaveAttribute("data-select-variant", "filter");
    expect(screen.getByRole("textbox", { name: "文章图谱映射分页 跳转页码" })).toHaveValue("1");
    ["标题", "类型", "关系数", "映射状态"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });
    expect(screen.getAllByTestId("manifest-row-title").map((node) => node.textContent)).toEqual(["Alpha", "Zeta"]);
    expect(screen.getByText("文章")).toBeInTheDocument();
    expect(screen.getByText("实体文档")).toBeInTheDocument();
    expect(screen.queryByText("仅实体")).not.toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "关系数排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "关系数 低-高" }));
    expect(screen.getAllByTestId("manifest-row-title").map((node) => node.textContent)).toEqual(["Zeta", "Alpha"]);
  });

  it("falls back to all mappings when the default missing filter has no results", async () => {
    const completeSummary = {
      ...summary,
      totalSources: 3,
      totalManifests: 3,
      fresh: 3,
      missing: 0,
      totalSourcesRaw: 3,
      eligibleSources: 3,
      relationalManifests: 1,
      sourceOnlyManifests: 2,
      coveredSources: 3,
      missingEligible: 0,
      coverageRatio: 1,
    };
    const completeItems = [
      items[1],
      { ...items[0], title: "Beta", normalizedSourcePath: "知识库/wiki/entities/beta.md", sourcePath: "知识库/wiki/entities/beta.md", manifest: { ...items[0].manifest, exists: true, fresh: true, status: "fresh" } },
      { ...items[0], title: "Gamma", normalizedSourcePath: "知识库/wiki/entities/gamma.md", sourcePath: "知识库/wiki/entities/gamma.md", manifest: { ...items[0].manifest, exists: true, fresh: true, status: "fresh" } },
    ];
    vi.mocked(api.fetchArticleManifests).mockImplementation(async ({ filter }) => ({
      ok: true,
      data: { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), summary: completeSummary, items: filter === "missing" ? [] : completeItems },
      error: null, errorCode: null, details: null, traceId: null, status: 200,
    }));

    render(<ManifestListPanel />);

    await waitFor(() => expect(api.fetchArticleManifests).toHaveBeenCalledWith(expect.objectContaining({ filter: "all" })));
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.getAllByTestId("manifest-row-title")).toHaveLength(3);
    // 零待办正名态：头条降级为「映射全部最新」，不出统计值
    expect(screen.getByText("映射全部最新")).toBeInTheDocument();
    expect(screen.queryByTestId("manifest-summary-metric")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选文章图谱映射状态" })).toHaveTextContent("映射筛选");
  });

  it("aligns the property check toolbar and sortable table", async () => {
    render(<CheckResultsPanel />);
    expect(await screen.findByRole("button", { name: "展开 Alpha" })).toBeInTheDocument();
    const summaryBar = screen.getByTestId("property-check-summary");
    expect(screen.getByTestId("property-check-summary-grid")).toHaveClass("grid-cols-2");
    expect(summaryBar.compareDocumentPosition(screen.getByTestId("property-check-toolbar")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("property-check-toolbar")).toHaveClass("rounded-lg", "bg-surface-root", "ring-border-thin");
    expect(screen.getByText("架构组件属性概览")).toBeInTheDocument();
    // 2026-11-15 概览退役批：「受检架构组件」分母卡退役——动作数两卡保留
    ["阻断架构组件", "警告架构组件"].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
    expect(screen.queryByText("受检架构组件")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索架构组件属性" })).toHaveClass("h-8", "text-xs", "bg-transparent");
    expect(screen.getByRole("button", { name: "筛选架构组件属性问题" })).toHaveAttribute("data-select-variant", "filter");
    expect(screen.getByRole("textbox", { name: "架构组件属性分页 跳转页码" })).toHaveValue("1");
    ["名称", "模块", "架构分层", "检查结论"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "模块排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "模块 Z-A" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Zeta");
  });
});
