// PageHeader — GitHub 风格紧凑应用栏
// 左区：汉堡（SidebarTrigger 折叠/展开侧边栏）| 品牌 Logo | 分隔符 | 当前页面名称
// 右区：继续补齐（条件性）| 投稿 | 实体全景 | 文档搜索
// 应用壳层编排由 App.tsx 负责，本组件不读取 feature store
import { Box, FilePenLine } from "lucide-react";
import { TERM } from "@/constants/term-const";
import type { NavGroup } from "@/components/app-navigation";
import { FloatingSearch } from "@/components/floating-search";
import { GlobalPipelineControl } from "@/components/pipeline";
import { SidebarTrigger } from "@/components/aria/sidebar";
import { PAGE_HEADER_COPY } from "../components-copy";

interface PageHeaderProps {
  activeNav: string;
  activeLabel?: string;
  navGroups: NavGroup[];
  onNavigate: (id: string) => void;
  onSubmitArticle: () => void;
  onOpenEntityHub: () => void;
  entityHubOpen: boolean;
  hasActiveEntity: boolean;
  repairTask?: { title: string } | null;
  onResumeRepair?: () => void;
}

const ACTION_BUTTON_CLASS =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-thin px-2 text-text-sub transition-all duration-[var(--duration-base)] hover:bg-surface-hover hover:text-text-main";

export function PageHeader({
  activeNav,
  activeLabel,
  navGroups,
  onSubmitArticle,
  onOpenEntityHub,
  entityHubOpen,
  hasActiveEntity,
  repairTask,
  onResumeRepair,
}: PageHeaderProps) {
  // 侧栏开合（floating 布局：header 内的 SidebarTrigger 常驻可见，
  // 点击展开/收起浮起侧边栏；品牌已在侧边栏顶部，header 不再重复）。
  const currentItem = navGroups.flatMap((g) => g.items).find((i) => i.id === activeNav);
  const currentGroup = navGroups.find((g) => g.items.some((i) => i.id === activeNav));
  // 投稿图标单源化：与任务域 / 文章准入页共用导航配置中的同一个图标（规则 13）
  const submitItem = navGroups.flatMap((g) => g.items).find((i) => i.id === "article-workflow");
  const SubmitIcon = submitItem?.icon;
  const submissionLabel = PAGE_HEADER_COPY.SUBMISSION_LABEL;

  return (
    <header className="relative z-chrome h-[var(--app-bar-height)] shrink-0 flex items-center gap-3 px-4 border-b border-transparent bg-surface-root">
      {/* ── 展开/收起浮起侧边栏（floating 布局常驻；简单图标，无边框实底）── */}
      <SidebarTrigger
        aria-label={TERM.OPEN_GLOBAL_NAVIGATION}
        title={TERM.OPEN_GLOBAL_NAVIGATION}
        className="size-8 shrink-0 rounded-lg text-text-hint hover:bg-surface-hover hover:text-text-main"
      />

      {/* ── 分隔符 ── */}
      <div aria-hidden className="h-6 w-px shrink-0 bg-border-thin" />

      {/* ── 当前位置：页面短名称（截断保护） + 弱化任务域名（窄屏或单页域不显示） ── */}
      <div data-testid="app-bar-location" className="flex min-w-0 shrink items-baseline gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-text-main">{activeLabel || currentItem?.label}</span>
        {currentGroup && currentGroup.items.length > 1 && (
          <span className="hidden shrink-0 text-xs text-text-hint sm:block">{currentGroup.label}</span>
        )}
      </div>

      {/* ── Spacer（为未来账号 / 工作区菜单预留扩展位置） ── */}
      <div className="flex-1" />

      {/* ── 继续补齐：仅存在最小化补齐任务时占位的条件性图标按钮 ── */}
      {repairTask && onResumeRepair && (
        <button
          type="button"
          onClick={onResumeRepair}
          title={`${TERM.RESUME_REPAIR_ACTION} ${repairTask.title}`}
          aria-label={TERM.OPEN_REPAIR_TASK_ACTION}
          className={`${ACTION_BUTTON_CLASS} relative w-8 justify-center`}
        >
          <FilePenLine className="h-4 w-4 text-cyan-11" />
          <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-cyan-11" />
        </button>
      )}

      {/* ── 投稿：桌面图标+文字，窄屏纯图标；图标与内容管道族单源共用 ── */}
      <button
        type="button"
        onClick={onSubmitArticle}
        title={submissionLabel}
        aria-label={submissionLabel}
        aria-current={activeNav === "article-workflow" ? "page" : undefined}
        className={`${ACTION_BUTTON_CLASS} ${
          activeNav === "article-workflow" ? "bg-accent-bg text-[var(--color-accent-fg)] border-accent-base/40" : ""
        }`}
      >
        {SubmitIcon && <SubmitIcon className="h-4 w-4 shrink-0" />}
        <span className="hidden text-sm sm:inline">{TERM.ARTICLE_SUBMISSION}</span>
      </button>

      {/* ── 实体全景：所有断点纯图标（保留 tooltip/aria、选中态与状态点） ── */}
      <button
        type="button"
        onClick={onOpenEntityHub}
        title={TERM.ENTITY_OVERVIEW}
        aria-label={PAGE_HEADER_COPY.OPEN_ENTITY_HUB}
        aria-pressed={entityHubOpen}
        className={`${ACTION_BUTTON_CLASS} relative w-8 justify-center ${
          entityHubOpen ? "bg-accent-bg text-[var(--color-accent-fg)] border-accent-base/40" : ""
        }`}
      >
        <Box className="h-4 w-4 shrink-0" />
        {hasActiveEntity && (
          <span data-testid="entity-overview-status-dot" className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-accent-base" />
        )}
      </button>

      {/* ── 图谱管道：跨页面共享运行状态、门禁与日志 ── */}
      <GlobalPipelineControl />

      {/* ── 文档搜索 ── */}
      <FloatingSearch />
    </header>
  );
}
