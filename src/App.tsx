import { useState, useEffect, lazy, Suspense } from "react";
import { LayoutDashboard, Search, ShieldCheck, Database, Settings, Link2, AlertTriangle, Upload, FilePenLine } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { AppErrorBoundary } from "@/components/app-shell/AppErrorBoundary";
import { APP_SHELL_COPY } from "@/components/components-copy";
// ── F3（体检收账，2026-10-26）：15 视图全部路由级懒加载 ──
// 首屏只装应用壳（导航/抽屉/Toaster），各视图及其独占依赖（@xyflow/react 等）随访问
// 拆入独立 chunk——与 ThemePreviewView 同式（.then 取具名导出），vi.mock 动态导入可拦截。
const DataDashboardView = lazy(() => import("@/features/data-dashboard/DataDashboardView").then(m => ({ default: m.DataDashboardView })));
const AdmissionView = lazy(() => import("@/features/admission/AdmissionView").then(m => ({ default: m.AdmissionView })));
const ReviewView = lazy(() => import("@/features/review/ReviewView").then(m => ({ default: m.ReviewView })));
const GapEngineView = lazy(() => import("@/features/gap-engine/GapEngineView").then(m => ({ default: m.GapEngineView })));
const PropertyGovView = lazy(() => import("@/features/property-gov/PropertyGovView").then(m => ({ default: m.PropertyGovView })));
const EntityComplianceView = lazy(() => import("@/features/entity-compliance/EntityComplianceView").then(m => ({ default: m.EntityComplianceView })));
const DocumentInventoryView = lazy(() => import("@/features/document-inventory/DocumentInventoryView").then(m => ({ default: m.DocumentInventoryView })));
const ImpactAnalysisView = lazy(() => import("@/features/impact-analysis/ImpactAnalysisView").then(m => ({ default: m.ImpactAnalysisView })));
const ArchitectureVersionView = lazy(() => import("@/features/architecture-version/ArchitectureVersionView").then(m => ({ default: m.ArchitectureVersionView })));
const SchemaManagerView = lazy(() => import("@/features/schema-manager/SchemaManagerView").then(m => ({ default: m.SchemaManagerView })));
const ArticleWorkflowView = lazy(() => import("@/features/article-workflow/ArticleWorkflowView").then(m => ({ default: m.ArticleWorkflowView })));
const ArticleAssociationsView = lazy(() => import("@/features/article-associations/ArticleAssociationsView").then(m => ({ default: m.ArticleAssociationsView })));
const WorkbenchView = lazy(() => import("@/features/workbench/WorkbenchView").then(m => ({ default: m.WorkbenchView })));
const AnomalyWorkbenchView = lazy(() => import("@/features/anomaly-workbench/AnomalyWorkbenchView").then(m => ({ default: m.AnomalyWorkbenchView })));
// DEV-only 主题预览（PR-025 阶段 4）：懒加载，生产构建不进主 chunk
const ThemePreviewView = lazy(() => import("@/features/theme-preview/ThemePreviewView").then(m => ({ default: m.ThemePreviewView })));
import { EntityHubDrawer } from "@/components/app-shell/EntityHubDrawer";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";
import { PageHeader } from "@/components/page-header";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/aria/sidebar";
import { useActiveEntityId } from "@/lib/topology-store";
import { TERM } from "@/constants/term-const";
import { EntityRepairDrawer } from "@/features/entity-compliance/EntityRepairDrawer";
import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";
import type { NavGroup, NavId } from "@/components/app-navigation";
import { navigate, getNavQueryParam, NAV_ROUTES, type NavRoute } from "@/lib/navigation";

// ── Task-oriented navigation: each top-level entry starts a user workflow ──
// 说明句/徽标文案链已于 #1756 整链退役（含 nav-copy.ts，见 ADR053）——本表只保留结构（id/icon/label/items）

// 五区域导航（2026-11-17 收尾批 A，目标 IA 五区域映射）：
// 工作台（待办聚合）｜对象浏览器（对象与检索）｜审批与发布（变更生命周期）｜修复中心（诊断修复）｜配置与审计（规则与账）
const NAV_GROUPS: NavGroup[] = [
  {
    id: "region-workbench", icon: LayoutDashboard, label: TERM.REGION_WORKBENCH,
    items: [
      { id: "workbench", icon: LayoutDashboard, label: TERM.WORKBENCH },
      { id: "anomalies", icon: AlertTriangle, label: TERM.PENDING_ISSUES },
    ],
  },
  {
    id: "region-object-browser", icon: Search, label: TERM.REGION_OBJECT_BROWSER,
    items: [
      { id: "data-dashboard", icon: Database, label: TERM.GRAPH_EXPLORER },
    ],
  },
  {
    id: "region-approval-publish", icon: Upload, label: TERM.REGION_APPROVAL_PUBLISH,
    items: [
      { id: "article-workflow", icon: Upload, label: TERM.ARTICLE_ADMISSION },
    ],
  },
  {
    id: "region-repair-center", icon: ShieldCheck, label: TERM.REGION_REPAIR_CENTER,
    items: [
      { id: "property", icon: Settings, label: TERM.ARTICLE_AND_COMPONENTS },
      { id: "article-associations", icon: FilePenLine, label: TERM.ARTICLE_MAPPING_REPAIR },
    ],
  },
  {
    id: "region-config-audit", icon: Settings, label: TERM.REGION_CONFIG_AUDIT,
    items: [
      { id: "schema", icon: Settings, label: TERM.SCHEMA },
      { id: "review", icon: Link2, label: TERM.RELATION_REVIEW },
    ],
  },
];

/** Resolve active NavId from window.location.hash. Backward-compatible with all legacy routes. */
function getNavFromHash(): NavId {
  const raw = window.location.hash.replace("#/", "");
  const h = raw.split("?")[0]; // strip query params for nav resolution
  if (h === "admission" || h.startsWith("admission") || h === "node" || h.startsWith("node")) return "data-dashboard"; // 第 3 批：准入注册表入枢纽页签
  // 运行概览退役（2026-11-17 Master 裁 B）：旧 hash 回落图谱检索枢纽（publish→article-workflow 同款兼容先例）
  if (h === "dashboard") return "data-dashboard";
  if (h === "data-dashboard") return "data-dashboard";
  // 第 4 批修复中心：实体合规入属性治理页签（hash 透传 sub，页签初值读 sub）
  if (h === "entity-compliance" || h.startsWith("entity-compliance")) return "property";
  if (h === "review" || h.startsWith("review/")) return "review";
  // 第 5 批收尾批 A：gaps 导航项退役（工作台量值带深链）——旧 hash 归一工作台
  if (h === "gaps") return "workbench";
  // 第 3 批对象浏览器：三旧路由并入图谱检索枢纽页签（hash 原样透传，页签初值读 sub）
  if (h === "document-inventory" || h.startsWith("document-inventory")) return "data-dashboard";
  if (h === "impact-analysis" || h.startsWith("impact-analysis")) return "data-dashboard";
  // 第 5 批：版本分析并入审批与发布区（version-diff 页签；hash 透传 sub 供页签初值）
  if (h === "architecture-version") return "article-workflow";
  // seq212：旧「关系查询」路由并入图谱检索枢纽——渲染映射 + URL 归一化（见下方 normalize 效果）
  if (h === "relations" || h.startsWith("relations")) return "data-dashboard";
  if (h === "property" || h.startsWith("property/")) return "property";
  if (h === "article-associations") return "article-associations";
  if (h === "schema") return "schema";
  if (h === "workbench") return "workbench";
  if (h === "anomalies") return "anomalies";
  if (h === "article-workflow") return "article-workflow";
  if (h === "publish") return "article-workflow"; // 审批与发布页退役（2026-10-15 收敛）——旧链接回落文章工作台
  // 主题预览仅 DEV 可达（import.meta.env.DEV）；生产回落 dashboard
  if (h === "theme" && import.meta.env.DEV) return "theme";
  return "data-dashboard";
}

/** NAV_GROUPS 全部导航项 id（运行时从 NAV_GROUPS 派生，保持导航配置单一来源；组 id 不是路由 id） */
const NAV_ITEM_IDS: ReadonlySet<string> = new Set(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id)),
);

/** AppSidebar/PageHeader 的 onNavigate 回调签名为 string；用运行时守卫收窄到 NavId 后再导航 */
function isNavItemId(id: string): id is NavId {
  return NAV_ITEM_IDS.has(id);
}

/** DEV-only 主题预览的懒加载包装（Suspense 边界） */
function ThemePreviewLazy() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-text-hint">{APP_SHELL_COPY.THEME_PREVIEW_LOADING}</div>}>
      <ThemePreviewView />
    </Suspense>
  );
}

/** View components keyed by NavId — single source of truth for view resolution */
const VIEWS: Record<NavId, React.ComponentType> = {
  "data-dashboard": DataDashboardView,
  "entity-compliance": EntityComplianceView,
  admission: AdmissionView,
  "impact-analysis": ImpactAnalysisView,
  "architecture-version": ArchitectureVersionView,
  review: ReviewView,
  gaps: GapEngineView,
  property: PropertyGovView,
  schema: SchemaManagerView,
  "article-associations": ArticleAssociationsView,
  workbench: WorkbenchView,
  anomalies: AnomalyWorkbenchView,
  "document-inventory": DocumentInventoryView,
  "article-workflow": ArticleWorkflowView,
  theme: ThemePreviewLazy,
};

/** Human-readable boundary names for ErrorBoundary */
const VIEW_BOUNDARIES: Record<NavId, string> = {
  "data-dashboard": "DataDashboardView",
  "entity-compliance": "EntityComplianceView",
  admission: "AdmissionView",
  "impact-analysis": "ImpactAnalysisView",
  "architecture-version": "ArchitectureVersionView",
  review: "ReviewView",
  gaps: "GapEngineView",
  property: "PropertyGovView",
  schema: "SchemaManagerView",
  "article-associations": "ArticleAssociationsView",
  workbench: "WorkbenchView",
  anomalies: "AnomalyWorkbenchView",
  "document-inventory": "DocumentInventoryView",
  "article-workflow": "ArticleWorkflowView",
  theme: "ThemePreviewView",
};

export default function App() {
  const [activeNav, setActiveNav] = useState<NavId>(getNavFromHash);

  // ── 侧边栏：默认展开、纯手动收合（PR③ 原型形态：无固定/自动收起机制——
  //    收起只走品牌行收起钮，展开只走顶栏展开钮；DayEcho 原站同款行为）──
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sync activeNav with hash changes
  useEffect(() => {
    const onHash = () => setActiveNav(getNavFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // seq212＋第 3 批：旧 relations/document-inventory/admission/impact 地址归一化到枢纽
  // （渲染已由 getNavFromHash 映射；地址栏改写带 tab query，页签初值读取不受影响——初值函数读 path 段）
  useEffect(() => {
    const normalizeLegacyHash = () => {
      const raw = window.location.hash.replace("#/", "").split("?")[0];
      if (raw === "relations" || raw.startsWith("relations/")) navigate("data-dashboard");
    };
    normalizeLegacyHash();
    window.addEventListener("hashchange", normalizeLegacyHash);
    return () => window.removeEventListener("hashchange", normalizeLegacyHash);
  }, []);

  useEffect(() => {
    const onPipelineCompleted = () => window.location.reload();
    window.addEventListener("pipeline-completed", onPipelineCompleted);
    return () => window.removeEventListener("pipeline-completed", onPipelineCompleted);
  }, []);

  // EntityHub shared state
  const setHubOpen = useHubDrawerState(s => s.setOpen);
  const hubOpen = useHubDrawerState(s => s.open);
  const activeEntityId = useActiveEntityId();
  const repairEntity = useEntityComplianceStore((s) => s.selectedEntity);
  const repairOpen = useEntityComplianceStore((s) => s.repairOpen);
  const resumeRepair = useEntityComplianceStore((s) => s.resumeRepair);

  const navigateTo = (id: NavId) => {
    setActiveNav(id);
    // 原 #/${id} 动态直写；theme 为 DEV-only 预览路由不经 navigate，非法 id 兜底 dashboard
    navigate((NAV_ROUTES as readonly string[]).includes(id) ? (id as NavRoute) : "data-dashboard");
  };

  const ActiveView = VIEWS[activeNav];
  const createEntityFlow = activeNav === "entity-compliance" && getNavQueryParam("create") === "1";

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} defaultOpen={false}>
    <div className="flex h-screen w-full bg-surface-root text-text-main">
      {/* ── Left sidebar: complete navigation tree, always rendered ── */}
      <AppSidebar
        activeNav={activeNav}
        navGroups={NAV_GROUPS}
        onNavigate={(id) => { if (isNavItemId(id)) navigateTo(id); }}
      />

      {/* ── Right: header + main content + pool dock（目检④：池卡片与主内容并排，打开时内容收缩让位） ── */}
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        {/* ── Top app bar: hamburger + brand + current location + global quick actions ── */}
        <PageHeader
          activeNav={activeNav}
          activeLabel={createEntityFlow ? APP_SHELL_COPY.CREATE_ENTITY_FLOW_LABEL : undefined}
          navGroups={NAV_GROUPS}
          onNavigate={(id) => navigateTo(id as NavId)}
          onSubmitArticle={() => navigateTo("article-workflow")}
          onOpenEntityHub={() => setHubOpen(true)}
          entityHubOpen={hubOpen}
          hasActiveEntity={!!activeEntityId}
          repairTask={repairEntity && !repairOpen ? { title: repairEntity.title || repairEntity.fileName || "" } : null}
          onResumeRepair={resumeRepair}
        />

        {/* ── Main content area + pool dock（并排；窄视口槽隐藏） ── */}
        <div className="flex min-h-0 flex-1">
          <SidebarInset className="min-w-0">
            <div className="flex-1 min-h-0 flex flex-col overflow-auto p-4 sm:p-6" data-main-scroll-container>
              <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col">
                <AppErrorBoundary boundaryName={VIEW_BOUNDARIES[activeNav]}>
                  <Suspense fallback={<div className="p-6 text-sm text-text-hint">{APP_SHELL_COPY.VIEW_LOADING}</div>}>
                    <ActiveView />
                  </Suspense>
                </AppErrorBoundary>
              </div>
            </div>
          </SidebarInset>
          <div id="pool-dock" aria-label={APP_SHELL_COPY.POOL_DOCK_ARIA} className="hidden shrink-0 p-3 md:flex" data-pool-dock />
        </div>
      </div>

      {/* ── Global overlays（全局快捷操作的触发器已统一迁入应用栏 PageHeader） ── */}
      <EntityHubDrawer />
      <EntityRepairDrawer />
      <Toaster />
    </div>
    </SidebarProvider>
  );
}
