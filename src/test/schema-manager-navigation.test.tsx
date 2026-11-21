import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { TERM } from "@/constants/term-const";

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/document-inventory", () => ({ DocumentSearchBar: () => null }));
vi.mock("@/features/schema-manager/SchemaManagerView", () => ({ SchemaManagerView: () => <div>图谱规则配置页</div> }));
vi.mock("@/features/dashboard/DashboardView", () => ({ DashboardView: () => <div>dashboard</div> }));
vi.mock("@/features/admission/AdmissionView", () => ({ AdmissionView: () => null }));
vi.mock("@/features/review/ReviewView", () => ({ ReviewView: () => <div>关系审核深入页</div> }));
vi.mock("@/features/gap-engine/GapEngineView", () => ({ GapEngineView: () => <div>拓扑缺口深入页</div> }));
// 第 4 批：entity-compliance 归一入 property——PropertyGovView mock 需透传实体合规 mock 件（树常驻用例验「深入页」文本）
vi.mock("@/features/property-gov/PropertyGovView", async () => {
  const mod = await vi.importMock<Record<string, () => JSX.Element>>("@/features/entity-compliance/EntityComplianceView");
  return { PropertyGovView: () => <mod.EntityComplianceView /> };
});
vi.mock("@/features/entity-compliance/EntityComplianceView", () => ({ EntityComplianceView: () => <div>{TERM.SOURCE_DOC_CHECK}深入页</div> }));
vi.mock("@/features/document-inventory/DocumentInventoryView", () => ({ DocumentInventoryView: () => null }));
vi.mock("@/features/impact-analysis/ImpactAnalysisView", () => ({ ImpactAnalysisView: () => null }));
vi.mock("@/features/article-workflow/ArticleWorkflowView", () => ({ ArticleWorkflowView: () => <div>投稿模块页</div> }));
vi.mock("@/features/anomaly-workbench/AnomalyWorkbenchView", () => ({ AnomalyWorkbenchView: () => <div>待处理问题页</div> }));
vi.mock("@/features/workbench/WorkbenchView", () => ({ WorkbenchView: () => <div>工作台深入页</div> }));

describe("Skeleton Management navigation", () => {
  beforeEach(() => { window.location.hash = "#/dashboard"; });

  it("renders the website logo in the floating sidebar brand area", () => {
    render(<App />);
    const logo = screen.getByRole("img", { name: TERM.APP_NAME });
    expect(logo).toHaveAttribute("src", "/brand-logo.png");
    expect(logo).toHaveClass("size-6");
  });

  it("exposes task-domain titles and the flattened pipeline entry in the global navigation sheet", () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: "全局导航" });
    // 组标签仅多页组渲染：工作台(2)/修复中心(2)/配置与审计(2)；单页组对象浏览器/审批与发布拍平为页按钮
    for (const label of [TERM.REGION_WORKBENCH, TERM.REGION_REPAIR_CENTER, TERM.REGION_CONFIG_AUDIT]) {
      expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    }
    for (const page of [TERM.GRAPH_EXPLORER, TERM.ARTICLE_ADMISSION]) {
      expect(within(dialog).getByRole("button", { name: page })).toBeInTheDocument();
    }
    // 发布页退役（2026-10-15 收敛）后内容管道仅剩一项：单项组拍平，无组标题，仅剩「文章准入」按钮
    expect(within(dialog).getByRole("button", { name: "文章准入" })).toBeInTheDocument();
    expect(within(dialog).queryByText("内容管道")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "审批与发布" })).not.toBeInTheDocument();
  });

  it("orders task domains by operational dependency", () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: "全局导航" });
    const order = [TERM.REGION_WORKBENCH, TERM.GRAPH_EXPLORER, TERM.ARTICLE_ADMISSION, TERM.ARTICLE_MAPPING_REPAIR, TERM.SCHEMA]; // 组序以组内首个页项按钮为锚（单页组标签拍平不渲染）
    const positions = order.map((label) => within(dialog).getAllByRole("button", { name: label })[0].getBoundingClientRect().top);
    expect(positions.every((position, index) => index === 0 || position >= positions[index - 1])).toBe(true);
    // 「文章准入」占审批与发布组排序位：对象浏览器之后、修复中心之前
    const flattened = within(dialog).getByRole("button", { name: "文章准入" });
    expect(flattened.compareDocumentPosition(within(dialog).getByRole("button", { name: TERM.GRAPH_EXPLORER })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(flattened.compareDocumentPosition(within(dialog).getByRole("button", { name: TERM.ARTICLE_MAPPING_REPAIR })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens Skeleton Management from the global navigation sheet", async () => {
    render(<App />);
    const dialog = screen.getByRole("complementary", { name: "全局导航" });
    const schemaRoute = within(dialog).getByRole("button", { name: "图谱规则配置" });
    fireEvent.click(schemaRoute);
    expect(window.location.hash).toBe("#/schema");
    const globalNavigation = screen.getByTestId("global-navigation");
    const routeButtons = within(globalNavigation).getAllByRole("button").filter((button) => button.getAttribute("data-navigation-kind") === "route");
    // WP-210：individuals（个体管理派生面）入导航树，棘轮 8→9
    expect(routeButtons).toHaveLength(9);
    expect(within(globalNavigation).queryByText("参考资料")).not.toBeInTheDocument();
    expect(within(globalNavigation).queryByText("backup")).not.toBeInTheDocument();
    const sidebarRoute = within(globalNavigation).getByRole("button", { name: "图谱规则配置" });
    expect(sidebarRoute).toHaveAttribute("data-navigation-kind", "route");
    expect(sidebarRoute).toHaveAttribute("aria-current", "page");
    // F3 视图懒加载：点击后视图 chunk 经微任务解析，改 findBy 等待
    expect(await screen.findByText("图谱规则配置页")).toBeInTheDocument();
  });

  it("loads Skeleton Management directly from the schema hash", () => {
    window.location.hash = "#/schema";
    render(<App />);
    expect(screen.getByText("图谱规则配置页")).toBeInTheDocument();
  });

  it("keeps the complete navigation tree visible on every task page", async () => {
    const cases = [
      ["#/anomalies", "待处理问题页", "待处理问题"],
      // 第 5 批收尾批 A：gaps 导航项退役（工作台量值带深链）——旧 hash 仍可达，aria-current 落工作台
      ["#/gaps", "工作台深入页", TERM.WORKBENCH], // 归一工作台（WorkbenchView mock）
      ["#/review", "关系审核深入页", "关系审核"],
      // 第 4 批：entity-compliance 归一入属性治理（aria-current 落 property 组项）
      ["#/entity-compliance", `${TERM.SOURCE_DOC_CHECK}深入页`, TERM.ARTICLE_AND_COMPONENTS],
    ] as const;
    for (const [hash, page, activeRoute] of cases) {
      window.location.hash = hash;
      const view = render(<App />);
      // F3 视图懒加载：各视图首挂异步解析，改 findBy 等待
      expect(await screen.findByText(page)).toBeInTheDocument();
      const navigation = within(screen.getByTestId("global-navigation"));
      // 完整树常驻：全 9 个 route（WP-210：individuals 个体管理派生面入册），当前页面标记 aria-current
      // WP-210：individuals 入导航树，棘轮 8→9
      expect(navigation.getAllByRole("button").filter((button) => button.getAttribute("data-navigation-kind") === "route")).toHaveLength(9);
      const currentButton = navigation.getAllByRole("button", { name: activeRoute }).find((b) => b.getAttribute("data-navigation-kind") === "route");
      expect(currentButton).toHaveAttribute("aria-current", "page");
      view.unmount();
    }
  });

  it("keeps the active task entry free of a decorative light block", () => {
    window.location.hash = "#/property";
    render(<App />);
    const propertyRoute = within(screen.getByTestId("global-navigation")).getByRole("button", { name: TERM.ARTICLE_AND_COMPONENTS });
    expect(propertyRoute).toHaveAttribute("aria-current", "page");
    expect(propertyRoute).not.toHaveClass("bg-[rgba(255,255,255,0.06)]");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps nested article and component tabs under the merged route", () => {
    window.location.hash = "#/property/mapping";
    render(<App />);
    const propertyRoute = within(screen.getByTestId("global-navigation")).getByRole("button", { name: TERM.ARTICLE_AND_COMPONENTS });
    expect(propertyRoute).toHaveAttribute("aria-current", "page");
  });

  it("opens submission as an independent top-level module and keeps the sidebar mounted", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "投稿 · 进入文章准入" }));
    expect(window.location.hash).toBe("#/article-workflow");
    expect(await screen.findByText("投稿模块页")).toBeInTheDocument();
    // 完整导航树在投稿页也常驻
    expect(screen.getByTestId("global-navigation")).toBeInTheDocument();
  });

  it("labels the sidebar as global navigation and lists the complete tree", () => {
    window.location.hash = "#/review";
    render(<App />);
    const sidebar = screen.getByTestId("global-navigation");
    expect(sidebar).toHaveAttribute("aria-label", "全局导航");
    // WP-210：individuals 入导航树，棘轮 8→9
    expect(within(sidebar).getAllByRole("button").filter((button) => button.getAttribute("data-navigation-kind") === "route")).toHaveLength(9);
  });

  it("professional pages remain independently accessible and are not anomaly sub-routes", () => {
    const independentRoutes = [
      ["#/article-associations", TERM.ARTICLE_MAPPING_REPAIR],
      ["#/review", "关系审核"],
      ["#/property", TERM.ARTICLE_AND_COMPONENTS],
      // 第 4 批：entity-compliance 归一——hash 仍可达（页签初值读 sub），aria-current 落 property
      ["#/entity-compliance", TERM.ARTICLE_AND_COMPONENTS],
    ] as const;
    for (const [hash, navLabel] of independentRoutes) {
      window.location.hash = hash;
      const view = render(<App />);
      const sidebar = screen.getByTestId("global-navigation");
      // 路由仍可直接访问
      const routeButton = within(sidebar).getByRole("button", { name: navLabel });
      expect(routeButton).toHaveAttribute("aria-current", "page");
      // 不是 anomaly 的子路由：anomaly 路由不拥有 aria-current
      const anomalyButton = within(sidebar).getByRole("button", { name: "待处理问题" });
      expect(anomalyButton).not.toHaveAttribute("aria-current", "page");
      view.unmount();
    }
  });
});
