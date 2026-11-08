import { fireEvent, render, screen } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentInventoryView } from "@/features/document-inventory/DocumentInventoryView";

const actions = { initialLoad: vi.fn(), loadNode: vi.fn(), query: vi.fn(), setFilter: vi.fn(), clearFilter: vi.fn(), clearAllFilters: vi.fn(), toggleCard: vi.fn() };
let state: Record<string, unknown>;

vi.mock("@/features/document-inventory/document-inventory-store", () => ({ useDocumentInventoryStore: () => ({ ...state, ...actions }) }));

const availableFilters = { arch_status: [], status: [], arch_category: [{ value: "存储", count: 1 }], arch_layer: [], arch_subdomain: [], module: [], tags: [], wikilinkTarget: [], relationType: [], documentKind: [], graphStatus: [], product: [], version: [], articleType: [], docType: [] };
const document = { documentId: "entity:mysql", documentKind: "entity" as const, title: "MySQL", articleId: "", sourcePath: "知识库/wiki/entities/mysql.md", sourceHash: `sha256:${"a".repeat(64)}`, graphNodeIds: ["mysql"], graphStatus: "indexed" as const, product: "AnyShare", version: "7.0", module: ["Content", "Storage"], articleType: "", docType: "技术文档", arch_component: true, arch_status: "approved", status: "有效", arch_layer: "data-lake", arch_category: "存储", arch_subdomain: "database", tags: ["架构"], relations: [{ type: "DEPENDS_ON", target: "gateway" }] };

describe("DocumentInventoryView", () => {
  beforeEach(() => {
    window.location.hash = "#/document-inventory";
    vi.clearAllMocks();
    // WP-070：展示类空态指引由服务端经空态语义契约组装（availability.hints）——夹具按 openapi AvailabilityGuide 形状给
    state = { filters: {}, result: { filters: {}, summary: { totalResults: 0, totalDocuments: 3, indexedDocuments: 2, pendingExtraction: 1 }, availableFilters, documents: [], limit: 50, offset: 0, generatedAt: "now", availability: { empty: true, kinds: ["formal-release-empty"], hints: ["正式发布库暂无文档——去处：「文章准入 → 工作草稿行操作「审批与发布」（发布后进入正式库）」"] } }, candidateResult: null, expandedCards: {}, status: "idle", error: null };
  });

  it("renders the indexed overview and read-only controls", () => {
    render(<DocumentInventoryView />);
    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——断言副标题与结构
    // 页题已裁删（ce337ad4）。2026-11-01 Master「直接默认全部正式文档」：idle=空库语义
    //（正式文档默认全列，status=success），提示文案改空库指引
    // WP-070：指引来自服务端 availability.hints（契约单源）——前端不再写死第二份文案
    expect(screen.getByTestId("inventory-availability")).toHaveTextContent("工作草稿行操作「审批与发布」");
    expect(screen.queryByText(/正式库暂无已索引文档/)).not.toBeInTheDocument();
    expect(screen.getByText("待抽取 1 篇")).toBeInTheDocument();
    expect(screen.getByTestId("document-search-toolbar")).toHaveClass("rounded-lg", "bg-surface-root", "ring-border-thin");
    expect(screen.getByLabelText(TERM.DOCUMENT_SEARCH_INPUT)).toHaveClass("h-8", "text-xs", "bg-transparent");
    [["实体类别", "类别筛选"], ["架构分层", "分层筛选"], ["标签", "标签筛选"], ["关系", "关系筛选"]].forEach(([label, text]) => {
      expect(screen.getByRole("button", { name: `筛选${label}` })).toHaveTextContent(text);
    });
    expect(screen.queryByRole("button", { name: "刷新文档索引" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除文档筛选" })).toBeDisabled();
    expect(screen.queryByText("修改文档")).not.toBeInTheDocument();
  });

  it("renders results and expands a card", () => {
    state = { ...state, status: "success", expandedCards: { "entity:mysql": true }, result: { ...(state.result as object), documents: [document] } };
    render(<DocumentInventoryView />);
    // seq209：这里原本叫「模块」，已与补齐表单对齐为字典长名「产品模块」
    expect(screen.getByText("产品模块：Content、Storage")).toBeInTheDocument();
    expect(screen.getByText("产品版本：7.0")).toBeInTheDocument();
    expect(screen.getByText("文内关系：依赖")).toBeInTheDocument();
    expect(screen.queryByText("DEPENDS_ON")).not.toBeInTheDocument();
    expect(screen.queryByText("gateway")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("MySQL")[0]);
    expect(actions.toggleCard).toHaveBeenCalledWith("entity:mysql");
  });

  it("marks unbound standard articles as pending extraction without graph actions", () => {
    const pending = { ...document, documentId: "article:ART-001", documentKind: "standard-article" as const, articleId: "ART-001", graphNodeIds: [], graphStatus: "pending-extraction" as const };
    state = { ...state, status: "success", expandedCards: { "article:ART-001": true }, result: { ...(state.result as object), documents: [pending] } };
    render(<DocumentInventoryView />);
    expect(screen.getByText("待抽取")).toBeInTheDocument();
    expect(screen.getByText("标准文章")).toBeInTheDocument();
    expect(screen.queryByText("快捷跳转")).not.toBeInTheDocument();
  });

  it("PR-151→WP-070：零发布态由服务端 200＋availability（no-formal-release）表达——卡片副文案取契约指引，不进错误横幅", () => {
    // 零发布：路由层接住 NO_CURRENT_RELEASE 走工作树活读＋指引（不再是 error 态）
    const hint = "尚无正式发布版本——去处：「文章准入 → 工作草稿行操作「审批与发布」（首次发布生成正式版本）」";
    state = { ...state, status: "idle", error: null, result: { ...(state.result as object), documents: [], availability: { empty: true, kinds: ["no-formal-release"], hints: [hint] } } };
    render(<DocumentInventoryView />);
    expect(screen.getByText("正式版文档总数")).toBeInTheDocument();
    expect(screen.getByTestId("inventory-no-release")).toHaveTextContent(hint);
    expect(screen.queryByText(/文章经「标准化 → 审批 → 发布」后进入本清单/)).not.toBeInTheDocument();
    // 「空态即结构」（Master 2026-10-29）不变：不渲染错误横幅与重试按钮
    expect(screen.queryByRole("button", { name: TERM.RETRY_ACTION })).not.toBeInTheDocument();
  });

  it("shows half-finished knowledge as a name-only list without a detail action", () => {
    state = { ...state, status: "success", candidateResult: { items: [{ title: "待完善升级经验" }], total: 1, limit: 50, offset: 0, generatedAt: "now" } };
    render(<DocumentInventoryView />);
    expect(screen.getByRole("heading", { name: "半成品名称" })).toBeInTheDocument();
    expect(screen.getByText("待完善升级经验")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /待完善升级经验/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /待完善升级经验/ })).not.toBeInTheDocument();
  });

  it("renders empty and recoverable error states", () => {
    state = { ...state, status: "empty", filters: { keyword: "none" } };
    const { rerender } = render(<DocumentInventoryView />);
    expect(screen.getByText("没有匹配文档")).toBeInTheDocument();
    state = { ...state, status: "error", error: "索引不可用" };
    rerender(<DocumentInventoryView />);
    fireEvent.click(screen.getByText("重试"));
    expect(actions.query).toHaveBeenCalled();
  });

  it("WP-070：服务端未标空态（availability.empty=false）时不渲染指引块", () => {
    state = { ...state, result: { ...(state.result as object), availability: { empty: false, kinds: [], hints: [] } } };
    render(<DocumentInventoryView />);
    expect(screen.queryByTestId("inventory-availability")).not.toBeInTheDocument();
  });
});
