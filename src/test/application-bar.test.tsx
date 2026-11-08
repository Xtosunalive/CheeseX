import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TERM } from "@/constants/term-const";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";
import { useTopologyStore } from "@/lib/topology-store";
import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";

vi.mock("@/features/entity-compliance/entity-compliance-api", () => ({ fetchEntityReadiness: vi.fn() }));
vi.mock("@/lib/pipeline-api", () => ({
  PIPELINE_RUN_ACTION: { id: "pipeline.run", risk: "medium", dataChannel: "POST /api/pipeline/run" },
  fetchPipelineStatus: vi.fn().mockResolvedValue({ state: "idle", message: "尚未运行", logs: [] }),
  runPipeline: vi.fn(),
  cancelPipeline: vi.fn(),
}));

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/features/document-inventory/components", () => ({
  DocumentSearchBar: () => <input aria-label={TERM.DOCUMENT_SEARCH_INPUT} />,
}));
vi.mock("@/features/dashboard/DashboardView", () => ({ DashboardView: () => <div>dashboard</div> }));
vi.mock("@/features/data-dashboard/DataDashboardView", () => ({ DataDashboardView: () => null }));
vi.mock("@/features/admission/AdmissionView", () => ({ AdmissionView: () => null }));
vi.mock("@/features/review/ReviewView", () => ({ ReviewView: () => <div>关系审核页</div> }));
vi.mock("@/features/gap-engine/GapEngineView", () => ({ GapEngineView: () => null }));
vi.mock("@/features/property-gov/PropertyGovView", () => ({ PropertyGovView: () => null }));
vi.mock("@/features/entity-compliance/EntityComplianceView", () => ({ EntityComplianceView: () => null }));
vi.mock("@/features/document-inventory/DocumentInventoryView", () => ({
  DocumentInventoryView: () => <input aria-label={TERM.DOCUMENT_SEARCH_INPUT} data-testid="page-search-input" />,
}));
vi.mock("@/features/impact-analysis/ImpactAnalysisView", () => ({ ImpactAnalysisView: () => null }));
vi.mock("@/features/architecture-version/ArchitectureVersionView", () => ({ ArchitectureVersionView: () => null }));
vi.mock("@/features/schema-manager/SchemaManagerView", () => ({ SchemaManagerView: () => null }));
vi.mock("@/features/article-workflow/ArticleWorkflowView", () => ({ ArticleWorkflowView: () => <div>投稿模块页</div> }));
vi.mock("@/features/article-associations/ArticleAssociationsView", () => ({ ArticleAssociationsView: () => null }));
vi.mock("@/features/anomaly-workbench/AnomalyWorkbenchView", () => ({ AnomalyWorkbenchView: () => null }));

/** 投稿按钮的可访问名称：动作 + 落点（组合现有 TERM 常量） */
const SUBMISSION_ACTION_LABEL = `${TERM.ARTICLE_SUBMISSION} · 进入${TERM.ARTICLE_ADMISSION}`;

describe("application bar", () => {
  beforeEach(() => {
    window.location.hash = "#/dashboard";
    useHubDrawerState.getState().setOpen(false);
    useTopologyStore.setState({ activeEntityId: null });
    useEntityComplianceStore.getState().closeRepair();
  });

  it("exposes canonical accessible names for brand and global actions", () => {
    render(<App />);
    expect(screen.getByRole("img", { name: TERM.APP_NAME })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TERM.OPEN_GLOBAL_NAVIGATION })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUBMISSION_ACTION_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TERM.DOCUMENT_SEARCH_ACTION })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `打开${TERM.ENTITY_OVERVIEW}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TERM.OPEN_GRAPH_PIPELINE_ACTION })).toBeInTheDocument();
  });

  it("shows the current page short name and its task domain in the app bar", () => {
    window.location.hash = "#/review";
    render(<App />);
    const location = within(screen.getByRole("banner")).getByTestId("app-bar-location");
    expect(within(location).getByText(TERM.RELATION_REVIEW)).toBeInTheDocument();
    expect(within(location).getByText(TERM.TASK_KNOWLEDGE_APPROVAL)).toBeInTheDocument();
  });

  it("shows only the page name when the domain flattens to a single page", () => {
    window.location.hash = "#/article-workflow";
    render(<App />);
    const location = within(screen.getByRole("banner")).getByTestId("app-bar-location");
    // 发布页退役（2026-10-15 收敛）后内容管道仅剩一项：顶栏按单页域只显页名，不再带域标签
    expect(within(location).getByText(TERM.ARTICLE_ADMISSION)).toBeInTheDocument();
    expect(within(location).queryByText(TERM.TASK_CONTENT_PIPELINE)).not.toBeInTheDocument();
  });
});

describe("global navigation sidebar", () => {
  beforeEach(() => {
    window.location.hash = "#/dashboard";
    useHubDrawerState.getState().setOpen(false);
    useTopologyStore.setState({ activeEntityId: null });
    useEntityComplianceStore.getState().closeRepair();
  });

  it("lists all task domains and every page, flattening single-page domains", () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION });
    // 多页任务域保留分组标题；内容管道已随发布页退役拍平为单页域（标题不再渲染）
    for (const label of [
      TERM.TASK_KNOWLEDGE_APPROVAL,
      TERM.TASK_ASSET_LOOKUP,
      TERM.TASK_RULE_CHECK,
      TERM.TASK_IMPACT_ANALYSIS,
    ]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    for (const label of [
      TERM.ARTICLE_ADMISSION,
      TERM.GRAPH_ADMISSION,
      TERM.RELATION_REVIEW,
      TERM.TOPOLOGY_GAP_REVIEW,
      TERM.ARTICLE_MAPPING_REPAIR,
      TERM.DASHBOARD,
      TERM.GRAPH_EXPLORER,
      TERM.DOC_LOOKUP,
      TERM.SCHEMA,
      TERM.SOURCE_DOC_CHECK,
      TERM.ARTICLE_AND_COMPONENTS,
      TERM.PENDING_ISSUES,
      TERM.COMPONENT_IMPACT,
      TERM.VERSION_ANALYSIS,
    ]) {
      expect(within(dialog).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current task domain and current page", () => {
    window.location.hash = "#/review";
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION });
    expect(within(dialog).getByRole("button", { name: TERM.RELATION_REVIEW })).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getByText(TERM.TASK_KNOWLEDGE_APPROVAL)).toHaveAttribute("aria-current", "location");
    expect(within(dialog).getByText(TERM.TASK_ASSET_LOOKUP)).not.toHaveAttribute("aria-current");
  });

  it("marks the flattened single-page domain item as the current page", () => {
    window.location.hash = "#/article-workflow";
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION });
    expect(within(dialog).getByRole("button", { name: TERM.ARTICLE_ADMISSION })).toHaveAttribute("aria-current", "page");
  });

  it("keeps task domain descriptions out of the sidebar DOM with no hover tooltip", () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION });
    // 悬浮分组标题不再弹出任何 Tooltip
    fireEvent.pointerMove(within(dialog).getByText(TERM.TASK_KNOWLEDGE_APPROVAL));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not show the article admission description on hover (tooltip removed)", () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION });
    expect(within(dialog).queryByText("本功能用于管理标准文章从投稿、标准化、批准到图谱管道处理的完整流程")).not.toBeInTheDocument();
    // 抽屉打开时焦点落在首个可聚焦项上，但不得因此自动弹出 Tooltip（否则首次 Escape 只关 Tooltip 不关抽屉）
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    // 悬浮菜单项不再弹出说明 Tooltip（#1747）
    const item = within(dialog).getByRole("button", { name: TERM.ARTICLE_ADMISSION });
    fireEvent.pointerMove(item);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("navigates to the chosen page from the always-on sidebar", () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION });
    fireEvent.click(within(dialog).getByRole("button", { name: TERM.SCHEMA }));
    expect(window.location.hash).toBe("#/schema");
    // 侧边栏常驻，导航后不消失
    expect(screen.getByRole("complementary", { name: TERM.GLOBAL_NAVIGATION })).toBeInTheDocument();
  });
});

describe("document search in application bar", () => {
  beforeEach(() => {
    window.location.hash = "#/dashboard";
    useHubDrawerState.getState().setOpen(false);
    useTopologyStore.setState({ activeEntityId: null });
    useEntityComplianceStore.getState().closeRepair();
  });

  it("renders the search trigger icon-only with the slash hint in its tooltip", () => {
    render(<App />);
    const trigger = screen.getByRole("button", { name: TERM.DOCUMENT_SEARCH_ACTION });
    // 纯图标按钮：无可见文字、无 kbd；可访问名称与 tooltip（含 / 快捷键提示）兜底
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelector("kbd")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("title", `${TERM.DOCUMENT_SEARCH_ACTION}（/）`);
  });

  it("opens the panel on click and focuses the full-text input", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: TERM.DOCUMENT_SEARCH_ACTION }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).toHaveFocus());
  });

  it("opens the panel with the slash shortcut outside editing contexts", async () => {
    render(<App />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(await screen.findByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).toBeInTheDocument();
  });

  it("ignores the slash shortcut inside editing contexts", () => {
    render(<App />);
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(input, textarea, select, editable);
    try {
      for (const target of [input, textarea, select, editable]) {
        fireEvent.keyDown(target, { key: "/" });
        expect(screen.queryByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).not.toBeInTheDocument();
      }
    } finally {
      input.remove(); textarea.remove(); select.remove(); editable.remove();
    }
  });

  it("closes on Escape and on outside click", async () => {
    render(<App />);
    const trigger = screen.getByRole("button", { name: TERM.DOCUMENT_SEARCH_ACTION });
    fireEvent.click(trigger);
    expect(await screen.findByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TERM.DOCUMENT_SEARCH_ACTION }));
    expect(await screen.findByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).not.toBeInTheDocument();
  });

  it("focuses the existing page search box on the document inventory page", async () => {
    window.location.hash = "#/document-inventory";
    render(<App />);
    // F3 视图懒加载：等视图（含页面检索框）挂载后再点击——真实用户点击时页面已呈现，
    // 聚焦契约（点应用栏检索→聚焦页面检索框、不弹面板）在呈现态下验收
    const pageInput = await screen.findByTestId("page-search-input");
    fireEvent.click(screen.getByRole("button", { name: TERM.DOCUMENT_SEARCH_ACTION }));
    await waitFor(() => expect(pageInput).toHaveFocus());
    // 面板不打开：页面内检索框是唯一检索输入
    expect(screen.getAllByRole("textbox", { name: TERM.DOCUMENT_SEARCH_INPUT })).toHaveLength(1);
  });
});

describe("global quick actions in application bar", () => {
  beforeEach(() => {
    window.location.hash = "#/dashboard";
    useHubDrawerState.getState().setOpen(false);
    useTopologyStore.setState({ activeEntityId: null });
    useEntityComplianceStore.getState().closeRepair();
  });

  it("renders the submission action with the family icon and target label, and navigates directly", () => {
    render(<App />);
    const bar = screen.getByRole("banner");
    const submit = within(bar).getByRole("button", { name: SUBMISSION_ACTION_LABEL });
    expect(submit).toHaveAttribute("title", SUBMISSION_ACTION_LABEL);
    expect(submit).toHaveTextContent(TERM.ARTICLE_SUBMISSION);
    fireEvent.click(submit);
    expect(window.location.hash).toBe("#/article-workflow");
    expect(screen.getByText("投稿模块页")).toBeInTheDocument();
  });

  it("keeps the submission action selected on the article admission page", () => {
    window.location.hash = "#/article-workflow";
    render(<App />);
    const submit = within(screen.getByRole("banner")).getByRole("button", { name: SUBMISSION_ACTION_LABEL });
    expect(submit).toHaveAttribute("aria-current", "page");
  });

  it("renders the entity overview action icon-only at every breakpoint", () => {
    render(<App />);
    const bar = screen.getByRole("banner");
    const trigger = within(bar).getByRole("button", { name: `打开${TERM.ENTITY_OVERVIEW}` });
    // 用户确认的偏差：桌面端也不显示文字，只保留 tooltip / aria-label
    expect(trigger).toHaveAttribute("title", TERM.ENTITY_OVERVIEW);
    expect(trigger.textContent).toBe("");
    fireEvent.click(trigger);
    // PR-026 任务池：非模态悬浮面板（complementary），dialog 模态形态退役
    expect(screen.getByRole("complementary", { name: TERM.ENTITY_OVERVIEW })).toBeInTheDocument();
  });

  it("shows the status dot when an entity is active and keeps the selected state while open", () => {
    useTopologyStore.setState({ activeEntityId: "mysql/main" });
    render(<App />);
    const bar = screen.getByRole("banner");
    const trigger = within(bar).getByRole("button", { name: `打开${TERM.ENTITY_OVERVIEW}` });
    expect(within(trigger).getByTestId("entity-overview-status-dot")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(useHubDrawerState.getState().open).toBe(true);
    // 抽屉打开时按钮保留选中态而不是被隐藏
    expect(screen.getByRole("button", { name: `打开${TERM.ENTITY_OVERVIEW}`, hidden: true })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the resume repair action only for a minimized repair task", () => {
    const { rerender } = render(<App />);
    const bar = screen.getByRole("banner");
    expect(within(bar).queryByRole("button", { name: TERM.OPEN_REPAIR_TASK_ACTION })).not.toBeInTheDocument();

    useEntityComplianceStore.setState({
      selectedEntity: { entityId: "", title: "MySQL", fileName: "MySQL.md", sourceKey: "知识库/wiki/entities/MySQL.md", sourceExists: false, blockerCount: 1, warningCount: 0, infoCount: 0, score: 0, groups: [] },
      repairOpen: false,
      repairChanges: { title: "MySQL" },
    });
    rerender(<App />);
    const resume = within(screen.getByRole("banner")).getByRole("button", { name: TERM.OPEN_REPAIR_TASK_ACTION });
    expect(resume).toHaveAttribute("title", `${TERM.RESUME_REPAIR_ACTION} MySQL`);
    fireEvent.click(resume);
    expect(useEntityComplianceStore.getState().repairOpen).toBe(true);
  });
});
