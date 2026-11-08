import { useEffect, useMemo, useState } from "react";
import { TERM } from "@/constants/term-const";
import { ChevronDown, ChevronRight, Filter, PanelRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { AnomalyActionToolbar, AnomalyEntityRepairDrawer, DerivedGraphRepairPanel } from "./components";
import { projectActionsForIssues } from "./anomaly-action-registry";
import { safeNavigateHash } from "@/lib/navigation";
import { AnomalyIssueList, type IssueGroupTab } from "./components/AnomalyIssueList";
import { AnomalyPeekPanel } from "./components/AnomalyPeekPanel";
import { useAnomalyWorkbenchStore } from "./anomaly-workbench-store";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { isDerivedGraphRepairIssue, HANDLING_LABELS, HANDLING_GROUP_HINTS, issueKindLabel, VIEW_TAB_LABELS, GROUPING_LABELS, ANOMALY_VIEW_COPY, anomalySourcesCountText, anomalyFilterCountSuffix } from "./anomaly-workbench-copy";
import { groupIssuesByArticle, selectKeysWithinGroups } from "./anomaly-article-groups";
import type { AnomalyIssue } from "./anomaly-workbench-types";
import type { AnomalyActionKind, ProjectedAction } from "./anomaly-action-registry";

/**
 * 待处理问题 · Linear 壳（task/anomaly-workbench-linear-shell，Master 14:41 批三口径）。
 * 三栏：侧栏来源文章过滤 / 主列表（组页签+行+视图页签）/ peek 侧栏。
 * 复用链（复用机制实战）：store/load·operate·reconcileAndLoad 原样；五形态表单=ResolutionForm
 * 直嵌 peek；操作条=AnomalyActionToolbar（registry 投影，hash 经 ACTION_ROUTING）；
 * derived 族独立面板保留；实体修复抽屉保留（B1 批量分流）。
 * 退役：AnomalySourceTable / 旧详情区（EvidencePanel·DecisionPanel·ActionPreview 的职能吸收进 peek）。
 */

/** 视图页签 → 状态集（确认 3：已处理=verified+closed；后端无 rejected）；页签标签迁 copy 闭集（VIEW_TAB_LABELS） */
type ViewTab = "pending" | "settled" | "all";
const SETTLED_STATUSES = new Set(["verified", "closed"]);
/** 处置模式分组序（照原型：可重试置顶 → 需处理 → 需评审 → 无需处理） */
const MODE_ORDER: AnomalyIssue["handling"][] = ["operate", "fix", "adjudicate", "note"];
/** 分组维度键（标签文案迁 copy 闭集——GROUPING_LABELS） */
type Grouping = keyof typeof GROUPING_LABELS;
/** 类型分组页签色点（与行芯片家族色同源——整改 1/4 联动） */
const KIND_TAB_DOT: Partial<Record<AnomalyIssue["issueKind"], string>> = {
  missing_field: "bg-status-error", version_scope: "bg-status-error", unrecognized_entity: "bg-status-error",
  missing_entity: "bg-status-fact",
  relation_conflict: "bg-purple-9", article_association: "bg-purple-9",
  wild_tag: "bg-orange-9",
  pipeline_failure: "bg-sky-9", release_publication_failure: "bg-sky-9",
  missing_lineage: "bg-teal-9",
  standardization_warning: "bg-text-placeholder", stale_source: "bg-text-placeholder",
};

export function AnomalyWorkbenchView() {
  const { issues, selectedIssueId, selectedArticleKeys, status, error, operationApiError, load, select, setArticleKeys, operate, reconcileAndLoad } = useAnomalyWorkbenchStore();
  const [repairDrawerIssueIds, setRepairDrawerIssueIds] = useState<string[]>([]);
  const [viewTab, setViewTab] = useState<ViewTab>("pending");
  const [activeGroup, setActiveGroup] = useState<string>("all");
  const [articleFilter, setArticleFilter] = useState<string | null>(null);
  // 整改五轮：peek 常驻化——默认展开（空态引导），手动收起才隐藏（会话内保持）；候选自动打开契约不变
  const [peekOpen, setPeekOpen] = useState(true);
  // 整改 2/3 新增交互态：Filter 多选（模式+类型）/ Display 分组维度 / 来源侧栏收展
  const [fMode, setFMode] = useState<Set<AnomalyIssue["handling"]>>(new Set());
  const [fKind, setFKind] = useState<Set<AnomalyIssue["issueKind"]>>(new Set());
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [grouping, setGrouping] = useState<Grouping>("mode");
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  // 挂载首拉带 preferActionable 参数（语义差异，留原 effect 不并入 hook）
  useEffect(() => { void load({ preferActionable: true }); }, [load]);
  // WP-145：聚焦/回前台重拉收编共享 hook
  useRefetchOnFocus(load);

  const derivedGraphIssues = useMemo(() => issues.filter(isDerivedGraphRepairIssue), [issues]);
  const regularIssues = useMemo(() => issues.filter((item) => !isDerivedGraphRepairIssue(item)), [issues]);
  const articleGroups = useMemo(() => groupIssuesByArticle(regularIssues), [regularIssues]);

  useEffect(() => {
    // #1798：groups 空时保留勾选（selectKeysWithinGroups 语义），修「补齐字段按钮随刷新消失」
    setArticleKeys((current) => selectKeysWithinGroups(current, articleGroups));
  }, [articleGroups, setArticleKeys]);

  /** 视图页签过滤（确认 3 口径）+ Filter 多选（整改 2：模式/类型与来源过滤可叠加） */
  const viewIssues = useMemo(() => {
    let list = regularIssues;
    if (viewTab === "pending") list = list.filter((item) => !SETTLED_STATUSES.has(item.status));
    else if (viewTab === "settled") list = list.filter((item) => SETTLED_STATUSES.has(item.status));
    if (fMode.size > 0) list = list.filter((item) => fMode.has(item.handling));
    if (fKind.size > 0) list = list.filter((item) => fKind.has(item.issueKind));
    return list;
  }, [regularIssues, viewTab, fMode, fKind]);
  const filterCount = fMode.size + fKind.size;

  /** 侧栏来源过滤 */
  const filteredIssues = useMemo(
    () => (articleFilter ? viewIssues.filter((item) => articleGroups.find((g) => g.issues.includes(item))?.articleKey === articleFilter) : viewIssues),
    [viewIssues, articleFilter, articleGroups],
  );

  /** 组页签（处置模式四态恒常渲染——整改 1：0 计数也显示（数字弱化），带状态圈图标；
   *  计数=当前视图+过滤后实时值；Display 分组维度切换时由分组函数另行生成（整改 2） */
  const groupTabs: IssueGroupTab[] = useMemo(() => {
    if (grouping === "mode") {
      return MODE_ORDER.map((mode) => ({
        key: mode,
        name: HANDLING_LABELS[mode],
        count: filteredIssues.filter((item) => item.handling === mode).length,
        hint: HANDLING_GROUP_HINTS[mode],
        dot: mode === "fix" ? "bg-status-error" : mode === "adjudicate" ? "bg-status-warn" : mode === "operate" ? "bg-sky-9" : "bg-text-placeholder",
      }));
    }
    if (grouping === "kind") {
      const seen: AnomalyIssue["issueKind"][] = [];
      for (const item of filteredIssues) if (!seen.includes(item.issueKind)) seen.push(item.issueKind);
      return seen.map((kind) => ({
        key: kind,
        name: issueKindLabel(kind),
        count: filteredIssues.filter((item) => item.issueKind === kind).length,
        dot: KIND_TAB_DOT[kind],
      }));
    }
    // grouping === "source"：来源文章分组（key=articleKey，文案=组显示名）
    const keys: string[] = [];
    for (const item of filteredIssues) {
      const key = articleGroups.find((g) => g.issues.includes(item))?.articleKey;
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys.map((key) => {
      const group = articleGroups.find((g) => g.articleKey === key)!;
      return { key, name: group.displayTitle, count: group.issues.filter((i) => filteredIssues.includes(i)).length, hint: group.sourcePath };
    });
  }, [filteredIssues, grouping, articleGroups]);

  /** 页签点选只展开该组；「全部」平铺（组键随 grouping 维度换——整改 2） */
  const listIssues = useMemo(
    () => {
      if (activeGroup === "all") return filteredIssues;
      if (grouping === "mode") return filteredIssues.filter((item) => item.handling === activeGroup);
      if (grouping === "kind") return filteredIssues.filter((item) => item.issueKind === activeGroup);
      return filteredIssues.filter((item) => articleGroups.find((g) => g.issues.includes(item))?.articleKey === activeGroup);
    },
    [filteredIssues, activeGroup, grouping, articleGroups],
  );

  // 整改 6：所选条目离开可见集（视图页签/过滤/分组切换）→ 清空选择，peek 回空态。
  // 直置 null（select("") 会留空串且 load 的保留逻辑可能重选）；候选自动开 peek 的
  // effect 以 peekIssue 为准，清空后 peekIssue=null 不被绕过。
  useEffect(() => {
    if (selectedIssueId !== null && !listIssues.some((item) => item.issueId === selectedIssueId)) {
      useAnomalyWorkbenchStore.setState({ selectedIssueId: null });
    }
  }, [listIssues, selectedIssueId]);

  const peekIssue = useMemo(() => issues.find((item) => item.issueId === selectedIssueId) ?? null, [issues, selectedIssueId]);
  // 候选版本组：选中条所在文章组内全部候选 issue（旧 View candidateIssues 平铺语义）
  const siblingCandidateIssues = useMemo(() => {
    if (!peekIssue?.relationCandidate) return [];
    const group = articleGroups.find((g) => g.issues.some((item) => item.issueId === peekIssue.issueId));
    return group ? group.issues.filter((item) => item.relationCandidate) : [peekIssue];
  }, [peekIssue, articleGroups]);
  const repairDrawerIssues = repairDrawerIssueIds.map((issueId) => issues.find((item) => item.issueId === issueId)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const repairDrawerIssue = repairDrawerIssues[0] || null;

  // 候选类（relationCandidate）选中即开 peek——裁决流是高频主路径（三元组证据链+拒绝表单
  // 都在 peek 内），不要求用户先知道双击手势（relation-candidate-contract 契约语义）。
  // 整改五轮：依赖含 selectedIssueId——手动收起后再点候选行（含换选另一条候选）仍自动弹开，
  // 契约优先于手动收起的会话持久性。
  useEffect(() => {
    if (peekIssue?.relationCandidate) setPeekOpen(true);
  }, [peekIssue?.relationCandidate, selectedIssueId]);

  const handleSelectionChange = (keys: string[]) => {
    // WP-146 件2：组勾选→组内行全亮 + 单组勾选联动面板首条（#1800 语义保持）；
    // 勾选集住 store（selectedArticleKeys 单一状态源），行选方向由 store.select 并入组键。
    setArticleKeys(keys);
    if (keys.length === 1) {
      const group = articleGroups.find((item) => item.articleKey === keys[0]);
      if (group) select(group.issues[0].issueId);
    }
  };
  const handleToggleCheck = (articleKey: string, _issueId: string) => {
    // 勾选粒度=文章组（与 Toolbar selectIssuesForKeys 对账）；#1800 联动语义保持：
    // 单组勾选→selectedIssueId 联动该组首条（与旧 handleSelectionChange 同路径，不旁路）
    const keys = selectedArticleKeys.includes(articleKey)
      ? selectedArticleKeys.filter((k) => k !== articleKey)
      : [...selectedArticleKeys, articleKey];
    handleSelectionChange(keys);
  };
  const handleToolbarAction = (kind: AnomalyActionKind, issueIds: ProjectedAction["issueIds"]) => {
    if (kind === "entity-repair" && issueIds.length > 0) {
      const firstIssue = issues.find((item) => item.issueId === issueIds[0]);
      const sourceKey = firstIssue?.proposedAction && typeof firstIssue.proposedAction === "object" && !Array.isArray(firstIssue.proposedAction)
        ? String((firstIssue.proposedAction as Record<string, unknown>).sourceKey || "")
        : "";
      const scopedIds = issueIds.filter((issueId) => {
        const candidate = issues.find((item) => item.issueId === issueId);
        const action = candidate?.proposedAction && typeof candidate.proposedAction === "object" && !Array.isArray(candidate.proposedAction)
          ? candidate.proposedAction as Record<string, unknown>
          : {};
        return action.type === "entity-repair" && action.sourceKey === sourceKey;
      });
      select(scopedIds[0]);
      setRepairDrawerIssueIds(scopedIds);
    } else if (issueIds.length > 0) {
      // 2026-10-08 修复：handoff 动作执行 hash 导航（Linear 壳改造后此链断裂——
      // 按钮点了只开 peek 不跳转，「一键补齐/源文档检查」等交接全部失效）。
      // hash 由 registry push 时经 buildHandoffHash 生成（登记表单源）；无 hash 的动作退回 peek。
      const action = projectActionsForIssues(issues.filter((item) => issueIds.includes(item.issueId)))
        .find((candidate) => candidate.issueIds.some((id) => issueIds.includes(id)));
      if (action && action.scope === "handoff" && action.hash) {
        // hash 单源=登记表（buildHandoffHash 生成）；经守卫跳转（非法目标 console.error 不跳，
        // 直写 location.hash 会绕过 NAV_ROUTES 校验——check-navigation 红项，2026-10-09 修）。
        safeNavigateHash(action.hash);
        return;
      }
      select(issueIds[0]);
      setPeekOpen(true);
    }
  };

  const checkedIssueIds = useMemo(
    () => articleGroups.filter((g) => selectedArticleKeys.includes(g.articleKey)).flatMap((g) => g.issues.map((i) => i.issueId)),
    [articleGroups, selectedArticleKeys],
  );

  return (
    <div className="flex min-h-full flex-col gap-4 md:gap-6" data-testid="anomaly-workbench">
      {/* 页头信息位与重检按钮均退役（Master 裁 2026-10-14）；FeaturePageHeader 无参空壳亦删
          （2026-10-16 Master 指认间距不一致：空 div＋gap-5 使工作区卡起点比其他页低一截） */}

      {status === "error" && <div className="rounded-lg bg-status-error-2 p-5 text-center ring-1 ring-status-error-6"><p className="text-sm text-status-error">{error}</p><Button className="mt-3" size="sm" onClick={() => void load()}>{TERM.RETRY_ACTION}</Button></div>}
      {status === "empty" && (
        /* Master 2026-10-29：空态即结构——工作台三栏骨架照常（列头在、行区空），不放引导卡 */
        <Panel padding="none" className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)]">
          <div className="min-h-0 border-r border-border-thin p-3 text-kg-xs font-medium text-text-hint">{anomalySourcesCountText(0)}</div>
          <div className="min-h-0" />
        </Panel>
      )}
      {status === "loading" && <p className="py-12 text-center text-sm text-text-hint">{ANOMALY_VIEW_COPY.LOADING_TEXT}</p>}

      {issues.length > 0 && (
        <>
          {derivedGraphIssues.length > 0 && <DerivedGraphRepairPanel issues={derivedGraphIssues} />}

          {/* 三栏＝分隔面板式（Master 2026-10-16，Linear 参考设计）：单工作区表面、栏间 1px 分隔线，各栏不再独立浮卡；窄屏堆叠改横向分隔 */}
          <Panel
            padding="none"
            contentClassName="contents"
            className={`grid min-h-0 flex-1 overflow-hidden ${peekOpen ? "xl:grid-cols-[240px_minmax(0,1fr)_380px]" : "xl:grid-cols-[240px_minmax(0,1fr)]"}`}
          >
            {/* ── 侧栏：来源文章分区（整改 3：可收展、默认展开、窄屏可达不 hidden） ── */}
            <nav
              className={`${sourcesOpen ? "flex" : "hidden"} min-h-0 flex-col gap-0.5 overflow-y-auto p-2 xl:max-h-full`}
              aria-label={ANOMALY_VIEW_COPY.SOURCES_LABEL}
            >
              <button
                type="button"
                onClick={() => setSourcesOpen((v) => !v)}
                aria-expanded={sourcesOpen}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 pb-1 pt-2 text-left text-kg-xs font-medium text-text-hint hover:bg-surface-hover"
              >
                {sourcesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="flex-1">{anomalySourcesCountText(articleGroups.length)}</span>
              </button>
              {sourcesOpen && (
                <>
                  {articleGroups.map((group) => {
                    const topMode = MODE_ORDER.find((mode) => group.issues.some((item) => item.handling === mode)) ?? "note";
                    const dotClass = topMode === "fix" ? "bg-status-error" : topMode === "adjudicate" ? "bg-status-warn" : topMode === "operate" ? "bg-sky-9" : "bg-text-placeholder";
                    const active = articleFilter === group.articleKey;
                    return (
                      <button
                        key={group.articleKey}
                        type="button"
                        aria-pressed={active}
                        title={group.sourcePath || group.displayTitle}
                        onClick={() => { setArticleFilter(active ? null : group.articleKey); setActiveGroup("all"); }}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${active ? "bg-accent-bg text-text-main ring-1 ring-border-focus" : "text-text-sub hover:bg-surface-hover"}`}
                      >
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{group.displayTitle}</span>
                        <span className="tabular-nums text-kg-xs text-text-hint">{group.issues.length}</span>
                      </button>
                    );
                  })}
                  {articleGroups.length === 0 && <p className="px-2 py-3 text-kg-xs text-text-hint">{ANOMALY_VIEW_COPY.SOURCES_EMPTY}</p>}
                </>
              )}
            </nav>

            {/* ── 主列表：视图页签 + Filter/Display/Open details（整改 2）+ 组页签 + 行 ── */}
            <section className="flex min-h-0 flex-col gap-2 overflow-hidden border-t border-border-thin p-3 xl:border-t-0 xl:border-l" aria-label={ANOMALY_VIEW_COPY.MAIN_LIST_ARIA}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1" role="tablist" aria-label={ANOMALY_VIEW_COPY.VIEW_TABS_ARIA}>
                  {(Object.keys(VIEW_TAB_LABELS) as ViewTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={viewTab === tab}
                      onClick={() => { setViewTab(tab); setActiveGroup("all"); }}
                      className={`border-b px-2 py-1 text-xs transition-colors ${
                        viewTab === tab ? "border-accent-base text-text-main" : "border-transparent text-text-sub hover:text-text-main"
                      }`}
                    >
                      {VIEW_TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>
                {articleFilter && (
                  <button type="button" onClick={() => setArticleFilter(null)} className="rounded-full bg-accent-bg px-2 py-0.5 text-kg-xs text-text-main ring-1 ring-border-thin">
                    {ANOMALY_VIEW_COPY.FILTERING_BY_SOURCE}
                  </button>
                )}
                <span className="ml-auto" />
                {/* Filter 筹码：模式/类型多选（菜单内清除全部；激活高亮+计数） */}
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={filterMenuOpen}
                    onClick={() => { setFilterMenuOpen((v) => !v); setDisplayMenuOpen(false); }}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-kg-xs ring-1 transition-colors ${filterCount > 0 ? "bg-accent-bg text-text-main ring-border-focus" : "text-text-sub ring-border-thin hover:bg-surface-hover"}`}
                  >
                    <Filter className="h-3 w-3" />{ANOMALY_VIEW_COPY.FILTER_LABEL}{filterCount > 0 ? anomalyFilterCountSuffix(filterCount) : ""}
                  </button>
                  {filterMenuOpen && (
                    <div role="menu" aria-label={ANOMALY_VIEW_COPY.FILTER_LABEL} className="absolute right-0 top-full z-docked mt-1 w-64 rounded-md bg-surface-card p-1.5 shadow-popover ring-1 ring-border-thin">
                      <p className="px-2 py-1 text-kg-xs font-medium text-text-hint">{ANOMALY_VIEW_COPY.GROUPING_MODE_LABEL}</p>
                      {MODE_ORDER.map((mode) => (
                        <label key={mode} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-text-main hover:bg-surface-hover">
                          <input type="checkbox" checked={fMode.has(mode)} onChange={() => setFMode((prev) => { const next = new Set(prev); if (next.has(mode)) { next.delete(mode); } else { next.add(mode); } return next; })} className="h-3 w-3 accent-[var(--color-accent-base)]" />
                          {HANDLING_LABELS[mode]}
                        </label>
                      ))}
                      <p className="mt-1 px-2 py-1 text-kg-xs font-medium text-text-hint">{ANOMALY_VIEW_COPY.GROUPING_KIND_LABEL}</p>
                      <div className="max-h-40 overflow-y-auto">
                        {KIND_TAB_DOT && Object.entries(KIND_TAB_DOT).map(([kind]) => (
                          <label key={kind} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-text-main hover:bg-surface-hover">
                            <input type="checkbox" checked={fKind.has(kind as AnomalyIssue["issueKind"])} onChange={() => setFKind((prev) => { const next = new Set(prev); const k = kind as AnomalyIssue["issueKind"]; if (next.has(k)) { next.delete(k); } else { next.add(k); } return next; })} className="h-3 w-3 accent-[var(--color-accent-base)]" />
                            {issueKindLabel(kind as AnomalyIssue["issueKind"])}
                          </label>
                        ))}
                      </div>
                      <button type="button" role="menuitem" onClick={() => { setFMode(new Set()); setFKind(new Set()); setFilterMenuOpen(false); }} className="mt-1 w-full rounded-md px-2 py-1 text-left text-kg-xs text-text-hint hover:bg-surface-hover">
                        {ANOMALY_VIEW_COPY.CLEAR_ALL_FILTERS}
                      </button>
                    </div>
                  )}
                </div>
                {/* Display 筹码：分组维度三选 */}
                <div className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={displayMenuOpen}
                    onClick={() => { setDisplayMenuOpen((v) => !v); setFilterMenuOpen(false); }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-kg-xs text-text-sub ring-1 ring-border-thin transition-colors hover:bg-surface-hover"
                  >
                    <SlidersHorizontal className="h-3 w-3" />{ANOMALY_VIEW_COPY.GROUPING_CHIP_LABEL}
                  </button>
                  {displayMenuOpen && (
                    <div role="menu" aria-label={ANOMALY_VIEW_COPY.GROUPING_MENU_ARIA} className="absolute right-0 top-full z-docked mt-1 w-56 rounded-md bg-surface-card p-1.5 shadow-popover ring-1 ring-border-thin">
                      <p className="px-2 py-1 text-kg-xs font-medium text-text-hint">{ANOMALY_VIEW_COPY.GROUPING_MENU_ARIA}</p>
                      {(Object.keys(GROUPING_LABELS) as Grouping[]).map((dim) => (
                        <button
                          key={dim}
                          type="button"
                          role="menuitemradio"
                          aria-checked={grouping === dim}
                          onClick={() => { setGrouping(dim); setActiveGroup("all"); setDisplayMenuOpen(false); }}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${grouping === dim ? "bg-accent-bg text-text-main" : "text-text-sub hover:bg-surface-hover"}`}
                        >
                          {GROUPING_LABELS[dim]}{grouping === dim && <span aria-hidden>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Open details：peek 开关（整改 2/3——peek 三路径之一） */}
                <button
                  type="button"
                  aria-pressed={peekOpen}
                  aria-label={ANOMALY_VIEW_COPY.PEEK_OPEN_ARIA}
                  title={peekOpen ? ANOMALY_VIEW_COPY.PEEK_COLLAPSE_TITLE : ANOMALY_VIEW_COPY.PEEK_EXPAND_TITLE}
                  onClick={() => setPeekOpen((v) => !v)}
                  className={`rounded-md p-1.5 ring-1 transition-colors ${peekOpen ? "bg-accent-bg text-text-main ring-border-focus" : "text-text-sub ring-border-thin hover:bg-surface-hover"}`}
                >
                  <PanelRight className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                <AnomalyIssueList
                  issues={listIssues}
                  groups={groupTabs}
                  activeGroup={activeGroup}
                  onGroupChange={setActiveGroup}
                  selectedIssueId={selectedIssueId}
                  checkedArticleKeys={selectedArticleKeys}
                  checkedIssueIds={checkedIssueIds}
                  onSelect={select}
                  onOpenPeek={(issueId) => { select(issueId); setPeekOpen(true); }}
                  onToggleCheck={handleToggleCheck}
                />
              </div>
              {/* 底部操作条（registry 投影；勾选=文章组粒度） */}
              <AnomalyActionToolbar groups={articleGroups} selectedKeys={selectedArticleKeys} onSelectionChange={handleSelectionChange} onAction={handleToolbarAction} />
            </section>

            {/* ── peek 侧栏（三路径开合：Open details 按钮/双击·Enter/×——整改 3） ── */}
            <AnomalyPeekPanel
              issue={peekIssue}
              siblingCandidateIssues={siblingCandidateIssues}
              open={peekOpen}
              onClose={() => setPeekOpen(false)}
              onOperate={(operation, payload) => void operate(operation, payload)}
            />
          </Panel>
        </>
      )}

      {/* 实体修复共享弹窗（B1 批量分流保留） */}
      {repairDrawerIssue && (
        <AnomalyEntityRepairDrawer
          issue={repairDrawerIssue}
          relatedIssues={repairDrawerIssues}
          error={error}
          apiError={operationApiError}
          onPreview={(payload) => void operate("preview", payload)}
          onBatchApplied={() => {
            // B1 批量修复直连 entity-repair 写回后：reconcile 让「不再检出」的字段缺失 issue 自动销账（N3）
            void reconcileAndLoad();
            setRepairDrawerIssueIds([]);
          }}
          onConfirm={(previewId) => void operate("confirm", { previewId }).then((confirmed) => {
            if (confirmed) setRepairDrawerIssueIds([]);
          })}
          onClose={() => setRepairDrawerIssueIds([])}
        />
      )}
    </div>
  );
}
