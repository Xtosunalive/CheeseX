import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeReviewPanel } from "@/features/review/EdgeReviewPanel";
import { AuditLogPanel } from "@/features/review/AuditLogPanel";
import { RelationLibraryTab as RelationsLibraryTable } from "@/features/data-dashboard/components/relation-library-tab";
import { EntityRegistryTable } from "@/features/admission/EntityRegistryTable";
import { ADMISSION_STATUS_DISPLAY } from "@/lib/domain/StatusDisplay";
import { relationSourceDetail, relationSourceMeta } from "@/lib/domain";

const api = vi.hoisted(() => ({
  fetchPendingReview: vi.fn(),
  fetchReviewHistory: vi.fn(),
  reviewEdge: vi.fn(),
}));
const edgeApi = vi.hoisted(() => ({
  fetchRelationsBundle: vi.fn(),
  saveRelations: vi.fn(),
}));
const stores = vi.hoisted(() => ({
  edges: [
    { source: "product:anybackup", target: "product", type: "BELONGS_TO", reviewStatus: "pending", properties: { source: "category-path" } },
  ],
  nodes: [
    { id: "product:anybackup", label: "AnyBackup", category: "产品", degree: 1 },
    { id: "product", label: "产品", category: "产品", degree: 1 },
  ],
  entities: [
    { componentName: "AnyBackup", entityId: "product:anybackup", layer: "product", category: "产品", articlePath: "wiki/entities/anybackup.md", admissionStatus: "APPROVED", hasSourceArticle: true, frontmatter: {} },
  ],
  reviewLoad: vi.fn().mockResolvedValue(undefined),
  openDrawer: vi.fn(),
}));

vi.mock("@/features/review/review-api", () => api);
vi.mock("@/lib/edge-api", () => edgeApi);
vi.mock("@/lib/topology-store", () => ({ useAdmittedEdges: () => stores.edges, useAdmittedNodes: () => stores.nodes, useKnowledgeEdges: () => stores.edges, useKnowledgeNodes: () => stores.nodes }));
vi.mock("@/lib/review-data-store", () => ({ useReviewStore: (selector: (state: { load: () => Promise<void>; pendingCount: number }) => unknown) => selector({ load: stores.reviewLoad, pendingCount: 1 }) }));
vi.mock("@/features/admission/admission-store", () => ({ useRegistryItems: () => stores.entities, useOpenDrawer: () => stores.openDrawer }));

describe("review table controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchPendingReview.mockResolvedValue({
      workingRevision: `sha256:${"d".repeat(64)}`,
      total: 3,
      pending: 3,
      approved: 0,
      edges: [
        { edgeId: "z", source: "zeta", sourceLabel: "Zeta 服务", target: "product", targetLabel: "产品", type: "BELONGS_TO", sourceFile: "wiki/entities/zeta.md", sourceRevision: `sha256:${"a".repeat(64)}`, reviewStatus: "pending", properties: { source: "category-path" } },
        { edgeId: "a", source: "alpha", sourceLabel: "Alpha 服务", target: "service", targetLabel: "服务层", type: "DEPENDS_ON", sourceFile: "wiki/entities/alpha.md", sourceRevision: `sha256:${"b".repeat(64)}`, reviewStatus: "pending", properties: { source: "entity-wikilink" } },
        { edgeId: "m", source: "middle", sourceLabel: "中间服务", target: "document", targetLabel: "文档", type: "DOCUMENTS", sourceFile: "wiki/entities/middle.md", sourceRevision: `sha256:${"c".repeat(64)}`, reviewStatus: "pending", properties: { source: "document-body" } },
      ],
    });
    api.fetchReviewHistory.mockResolvedValue({
      total: 2,
      records: [
        { source: "zeta", sourceLabel: "Zeta 服务", target: "product", targetLabel: "产品", action: "approved", reviewer: "architect", reason: "确认挂载", decidedAt: "2026-07-16T02:00:00Z" },
        { source: "alpha", sourceLabel: "Alpha 服务", target: "service", targetLabel: "服务层", action: "rejected", reviewer: "human", reason: "需要回滚", decidedAt: "2026-07-16T00:00:00Z" },
      ],
    });
  });

  it("uses one relation provenance mapping across relation views", () => {
    expect(relationSourceMeta("entity-wikilink")).toEqual({
      group: "正文引用",
      label: "正文引用",
      description: "来自实体正文中的关联引用",
    });
    expect(relationSourceMeta("unknown-source")).toMatchObject({ group: "系统来源", label: "系统来源" });
    expect(relationSourceDetail("")).toEqual({ label: "未标记", description: "未标记来源" });
  });

  it("filters and sorts pending relations", async () => {
    render(<EdgeReviewPanel />);
    expect(await screen.findByText("Zeta 服务")).toBeInTheDocument();
    expect(screen.getByTestId("pending-review-working-revision")).toHaveTextContent("待审核关系"); // WP-034：标题人话化＋收纳
    expect(screen.getByTestId("pending-review-working-revision")).toHaveTextContent("dddddddddddd");
    expect(screen.queryByText("zeta")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "源实体排序" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "目标实体排序" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "类型 / 来源排序" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "源实体排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "源实体 Z-A" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Zeta 服务");

    expect(screen.getByRole("button", { name: "筛选关系类型" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选关系来源" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索待审核关系" }), { target: { value: "Zeta" } });
    expect(screen.getByText("1 / 3 条待审核关系")).toBeInTheDocument();
    expect(screen.queryByText("Alpha 服务")).not.toBeInTheDocument();
  });

  it("turns relation confirmation into a graph-fact Proposal instead of a direct review write", async () => {
    render(<EdgeReviewPanel />);
    const row = (await screen.findByText("Zeta 服务")).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getByRole("button", { name: "批准" }));
    await waitFor(() => expect(api.reviewEdge).toHaveBeenCalledWith(expect.objectContaining({
      edgeId: expect.any(String),
      action: "approved",
    })));
    expect(api.reviewEdge.mock.calls[0][0]).not.toHaveProperty("reviewer");
    expect(within(row as HTMLTableRowElement).queryByRole("button", { name: "驳回候选" })).not.toBeInTheDocument();
  });

  it("直接审批：pending 关系可批准（不再依赖 sourceFile/revision）", async () => {
    api.reviewEdge.mockResolvedValueOnce({ success: true, edgeId: "stale", action: "approved", reviewStatus: "approved", decidedAt: "t" });
    api.fetchPendingReview.mockResolvedValueOnce({
      total: 1, pending: 1, approved: 0,
      edges: [{ edgeId: "stale", source: "alpha", sourceLabel: "Alpha 服务", target: "service", targetLabel: "服务层", type: "DEPENDS_ON", sourceFile: "", reviewStatus: "pending", properties: {} }],
    });
    render(<EdgeReviewPanel />);
    const approve = await screen.findByRole("button", { name: "批准" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(api.reviewEdge).toHaveBeenCalledWith(expect.objectContaining({ edgeId: "stale", action: "approved" })));
  });

  it("WP-142：有建议档位的行 select 预填该档位；手动改档后以手动值为准", async () => {
    api.fetchPendingReview.mockResolvedValueOnce({
      total: 2, pending: 2, approved: 0,
      edges: [
        { edgeId: "sug", source: "alpha", sourceLabel: "Alpha 服务", target: "service", targetLabel: "服务层", type: "DEPENDS_ON", sourceFile: "", reviewStatus: "pending", properties: {}, suggestedConfidence: 0.52, suggestedConfidenceBand: "medium" },
        { edgeId: "nosug", source: "zeta", sourceLabel: "Zeta 服务", target: "product", targetLabel: "产品", type: "BELONGS_TO", sourceFile: "", reviewStatus: "pending", properties: {} },
      ],
    });
    render(<EdgeReviewPanel />);
    const sugRow = (await screen.findByText("Alpha 服务")).closest("tr") as HTMLTableRowElement;
    const sugSelect = within(sugRow).getByRole("combobox") as HTMLSelectElement;
    // 初始预填：服务端换算的 suggestedConfidenceBand 直接选中（用户不用自己拿 0.52 换算）
    expect(sugSelect).toHaveValue("medium");
    // 无建议的行保持「不评分位」（字段缺省 → 空值）
    const noSugRow = screen.getByText("Zeta 服务").closest("tr") as HTMLTableRowElement;
    expect(within(noSugRow).getByRole("combobox")).toHaveValue("");
    // 手动改档后以手动值为准（建议值不再顶回）
    fireEvent.change(sugSelect, { target: { value: "low" } });
    expect(sugSelect).toHaveValue("low");
    // 手动改回「不评分位」同样保留手动态（?? 语义：显式空选不回落建议档位）
    fireEvent.change(sugSelect, { target: { value: "" } });
    expect(sugSelect).toHaveValue("");
  });

  it("WP-142 写入链：预填未动直接批准→confidence_band 双写为建议档位（写入与显示同链）", async () => {
    api.fetchPendingReview.mockResolvedValueOnce({
      total: 1, pending: 1, approved: 0,
      edges: [{ edgeId: "sug", source: "alpha", sourceLabel: "Alpha 服务", target: "service", targetLabel: "服务层", type: "DEPENDS_ON", sourceFile: "", reviewStatus: "pending", properties: {}, suggestedConfidence: 0.52, suggestedConfidenceBand: "medium" }],
    });
    edgeApi.fetchRelationsBundle.mockResolvedValue({ success: true, data: { relations: [], revision: "rev-1" } });
    edgeApi.saveRelations.mockResolvedValue({ success: true, data: { relationsPath: "TheSchema/relations.yaml", revision: "rev-2" } });
    render(<EdgeReviewPanel />);
    const row = (await screen.findByText("Alpha 服务")).closest("tr") as HTMLTableRowElement;
    // 预填未动：select 停在建议档位（medium），不触发 change
    expect(within(row).getByRole("combobox")).toHaveValue("medium");
    fireEvent.click(within(row).getByRole("button", { name: "批准" }));
    await waitFor(() => expect(api.reviewEdge).toHaveBeenCalledWith(expect.objectContaining({
      edgeId: "sug",
      action: "approved",
      confidenceBandAudit: expect.objectContaining({ source: "alpha", target: "service", type: "DEPENDS_ON", relationsPath: "TheSchema/relations.yaml", revision: "rev-2" }),
    })));
    // C7 第一腿：屏上显示的建议档位即实际写入（批准写入 relations.yaml 账本）
    expect(edgeApi.saveRelations).toHaveBeenCalledTimes(1);
    const payload = edgeApi.saveRelations.mock.calls[0][0];
    expect(payload.relations).toEqual([expect.objectContaining({
      source: "alpha", target: "service", type: "DEPENDS_ON", asserted_by: "human", endpoint_domain: "graph", confidence_band: "medium",
    })]);
  });

  it("WP-142 写入链：显式选「不评分位」后批准→不写 band（显式空位守住不写语义）", async () => {
    api.fetchPendingReview.mockResolvedValueOnce({
      total: 1, pending: 1, approved: 0,
      edges: [{ edgeId: "sug", source: "alpha", sourceLabel: "Alpha 服务", target: "service", targetLabel: "服务层", type: "DEPENDS_ON", sourceFile: "", reviewStatus: "pending", properties: {}, suggestedConfidence: 0.52, suggestedConfidenceBand: "medium" }],
    });
    edgeApi.fetchRelationsBundle.mockResolvedValue({ success: true, data: { relations: [], revision: "rev-1" } });
    edgeApi.saveRelations.mockResolvedValue({ success: true, data: { relationsPath: "TheSchema/relations.yaml", revision: "rev-2" } });
    render(<EdgeReviewPanel />);
    const row = (await screen.findByText("Alpha 服务")).closest("tr") as HTMLTableRowElement;
    // 显式把预填改回「不评分位」——写入路径按手动态执行，不回落建议档位
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "" } });
    expect(within(row).getByRole("combobox")).toHaveValue("");
    fireEvent.click(within(row).getByRole("button", { name: "批准" }));
    await waitFor(() => expect(api.reviewEdge).toHaveBeenCalledWith(expect.objectContaining({ edgeId: "sug", action: "approved" })));
    // 零写入：band 腿整段跳过，reviewEdge 也不携带 confidenceBandAudit
    expect(edgeApi.saveRelations).not.toHaveBeenCalled();
    expect(api.reviewEdge.mock.calls[0][0]).not.toHaveProperty("confidenceBandAudit");
  });

  it("PR-045：文档端点带类型徽章，被拦边的阻断原因前置并可跳转异常工作台", async () => {
    api.fetchPendingReview.mockResolvedValueOnce({
      total: 1, pending: 1, approved: 0,
      edges: [{
        edgeId: "doc-edge", source: "doc-article-x", sourceLabel: "部署手册", sourceLabels: ["Document"],
        target: "service", targetLabel: "服务层", targetLabels: [],
        type: "DOCUMENTS", reviewStatus: "pending", properties: { source: "document-body" },
        blockers: [{ entityId: "doc-article-x", issueId: "anom-1", issueKind: "missing_entity" }],
      }],
    });
    render(<EdgeReviewPanel />);
    const row = (await screen.findByText("部署手册")).closest("tr") as HTMLTableRowElement;
    expect(row).not.toBeNull();
    // 文档端点类型徽章（读侧 labels 透传 → 前端标注）
    expect(within(row).getByText("文档")).toBeInTheDocument();
    // 阻断原因前置：缺实体行内可见，深链携带 issueId 直达异常工作台
    const blockerLink = within(row).getByRole("link", { name: /缺实体：doc-article-x/ });
    const href = blockerLink.getAttribute("href") ?? "";
    expect(href).toContain("#/anomalies?");
    expect(href).toContain("issueId=anom-1");
    // 呈现不执法：批准仍可点，但 title 提示暂时无法批准（WP-034 人话化——机制词不上屏）
    expect(within(row).getByRole("button", { name: "批准" })).toHaveAttribute("title", expect.stringContaining("暂时无法批准"));
  });

  it("filters and sorts audit records", async () => {
    render(<AuditLogPanel />);
    expect(await screen.findByText("确认挂载")).toBeInTheDocument();
    ["源实体 → 目标实体", "动作", "审核人", "原因", "时间"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "时间排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitem", { name: "最旧优先" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Alpha 服务 → 服务层");
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索审核记录" }), { target: { value: "回滚" } });
    expect(screen.getByText("1 / 2 条审核记录")).toHaveClass("text-kg-xs", "text-text-hint");
    expect(screen.queryByText("确认挂载")).not.toBeInTheDocument();
  });

  it("adds sortable headers to relation libraries and entity admission", () => {
    expect(ADMISSION_STATUS_DISPLAY.PENDING.label).toBe("待入图审批");
    const relationView = render(<RelationsLibraryTable />);
    expect(screen.queryByText("看已准入的关系，按来源和状态快速找条目")).not.toBeInTheDocument();
    expect(screen.queryByText(/来源说明 \d+ 类/)).not.toBeInTheDocument();
    expect(screen.getByText("1 / 1 条")).toHaveClass("text-kg-xs");
    expect(screen.getByRole("textbox", { name: "搜索关系" })).toHaveClass("h-8", "text-xs", "bg-transparent");
    expect(screen.getByRole("button", { name: TERM.CLEAR_FILTER_ACTION })).toBeDisabled();
    ["源实体", "目标实体", "关系类型", "来源分组", "来源说明", "审核状态"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });
    relationView.unmount();

    render(<EntityRegistryTable />);
    expect(screen.getByTestId("admission-filter-toolbar")).toHaveClass("rounded-lg", "bg-surface-root", "ring-border-thin");
    expect(screen.getByRole("textbox", { name: "搜索入图实体" })).toHaveClass("h-8", "text-xs", "bg-transparent");
    expect(screen.getByRole("button", { name: "高级筛选" })).toHaveClass("h-8");
    expect(screen.getByRole("button", { name: "清除入图筛选" })).toBeDisabled();
    ["架构组件名称", "架构分层", "实体类别", "图谱引用文档", "准入状态"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });
    expect(screen.queryByText("product:anybackup")).not.toBeInTheDocument();
    expect(screen.getByRole("table").querySelector("thead")).toHaveClass("bg-surface-hover/40", "text-text-main");
    fireEvent.change(screen.getByRole("textbox", { name: "搜索入图实体" }), { target: { value: "missing" } });
    expect(screen.getByText("0 / 1 条")).toBeInTheDocument();
    expect(screen.queryByText("AnyBackup")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除入图筛选" }));
    expect(screen.getByText("AnyBackup")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "高级筛选" }));
    expect(screen.getByRole("button", { name: "筛选字段 1" })).toBeInTheDocument();
  });
});
