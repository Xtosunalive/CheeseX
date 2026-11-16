// DataDashboardView — 「图谱检索」枢纽（seq212：data-dashboard 路由冻结，原地整合拓扑+关系双入口）
// 拓扑 tab：修复后的 ArchProjFlow 真实拓扑（ReactFlow+Dagre）+ 三上下文侧栏 + 关系类型 chip + 范围切换
// 关系 tab：LocalGraph（Obsidian 式局部图）为主体＋RelationLibraryTab / RelationsPanel；TaxonomySidebar / BandStack 保留为折叠子视图
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Database, GitBranch, Network, Share2, FileSearch } from "lucide-react";
import { ArchitectureProjectionFlow, buildProjectionModel } from "@/components/architecture-projection";
import { TopologyStateGate } from "@/components/topology-state-gate";
import { TaxonomySidebar } from "@/features/data-dashboard/components/taxonomy-sidebar";
import { BandStack } from "@/features/data-dashboard/components/band-stack";
import { InternalTabs, type InternalTabItem } from "@/components/internal-tabs";
import { RelationLibraryTab } from "@/features/data-dashboard/components/relation-library-tab";
import { LocalGraph } from "@/features/data-dashboard/components/local-graph/LocalGraph";
import { RelationsPanel } from "@/features/data-dashboard/components/relations-panel";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";
import { GraphExplorerToolbar } from "./GraphExplorerToolbar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Panel } from "@/components/panel";
import { TERM, termTopologyScaleHint } from "@/constants/term-const";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import {
  useAdmittedNodes,
  useAdmittedEdges,
  useKnowledgeNodes,
  useTopologyStats,
  useTopologyLoading,
  useTopologyError,
  useTopologyScope,
  useSetTopologyScope,
  useLoadTopology,
} from "@/lib/topology-store";
import { PageContainer, PageSection } from "@/components/page-container";
import { BentoGrid } from "@/components/bento";
import { Statistic } from "@/components/statistic/Statistic";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ACTIVE_RELATION_TYPES, ENTITY_TYPES, relationTypeLabel, type RelationTypeName } from "@/lib/ontology";
import { ENTITY_CATEGORY } from "@/lib/domain/EntityCategory";
import { COMPOSITION_COPY, DD_VIEW_COPY, ontologyUsage } from "./data-dashboard-copy";
import { ReleaseMintCard } from "./components/release-mint-card";

type HubTab = "topo" | "relations";

const HUB_TABS: InternalTabItem<HubTab>[] = [
  { id: "topo", icon: Network, label: DD_VIEW_COPY.TAB_TOPO },
  { id: "relations", icon: Share2, label: TERM.RELATION },
];

type RelationsTab = "query" | "overview";
const RELATIONS_TABS: InternalTabItem<RelationsTab>[] = [
  { id: "query", icon: FileSearch, label: TERM.RELATION_QUERY },
  { id: "overview", icon: Share2, label: TERM.RELATION_OVERVIEW },
];

function ProjectionSubView({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Collapsible defaultOpen={false} className="group">
      <Panel padding="none" className="overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-text-main transition-colors hover:bg-surface-hover/40">
          <span aria-hidden="true" className="text-text-hint">{icon}</span>
          {title}
          <ChevronDown className="ml-auto h-4 w-4 text-text-hint transition-transform duration-[var(--duration-base)] group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border-thin p-4">
          {children}
        </CollapsibleContent>
      </Panel>
    </Collapsible>
  );
}

// 键名从生成物驱动（WP-138 R5a·收紧）：全穷尽 Record<RelationTypeName, string>（键单源＝
// ontology.ts 对生成物 RELATION_TYPES 键集的派生）——registry 新增关系类型而本表未配色、或
// 改名/删名留陈旧键，typecheck 即红。治理语义边（derivation/usage/reference/co_editing/
// containment）手抄期不入表、经 `|| "text-text-sub"` 兜底——显式入表并取该兜底值，渲染
// bit 级不变；未登记类型（不在联合内）仍经 `|| "text-text-sub"` 运行时兜底。USES 为
// legacy_policy=delete 的退役类型，保留手抄期既定配色档；registry 删除该键时此处编译红，
// 由维护者届时显式决定去留。（2026-11-15 运行概览退役批自 dashboard 页迁入）
const RELATION_TYPE_COLORS: Record<string, string> = {
  CONNECTS_TO: "text-status-loading", DEPENDS_ON: "text-status-warn", BACKS_UP: "text-grass-11",
  INDEXES: "text-purple-10", STORES_IN: "text-blue-9", ENCRYPTS: "text-status-error",
  BELONGS_TO: "text-sky-10", DOCUMENTS: "text-lime-10",
  REFERENCES: "text-plum-10", MENTIONS: "text-pink-10", RELATED: "text-text-hint",
  HAS_VERSION: "text-status-fact", HAS_SYMPTOM: "text-orange-10", USES: "text-yellow-9",
  APPLIES_TO: "text-status-inferred", ASSOCIATED_WITH: "text-teal-10",
  derivation: "text-text-sub", usage: "text-text-sub", reference: "text-text-sub",
  co_editing: "text-text-sub", containment: "text-text-sub",
} satisfies Record<RelationTypeName, string>;

function CompositionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-main">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** 实体类别分布（占比条；行尾绝对数已随 MAIC 形态批撤——构成占比由条宽表达） */
function EntityTypeBars({ nodes }: { nodes: { category: string }[] }) {
  const EXCLUDED = new Set<string>([ENTITY_CATEGORY.DOMAIN, ENTITY_CATEGORY.OTHER]);
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    if (EXCLUDED.has(n.category)) continue;
    counts[n.category] = (counts[n.category] || 0) + 1;
  }
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <CompositionSection title={COMPOSITION_COPY.CATEGORY_DISTRIBUTION}>
      <div className="space-y-1.5">
        {entries.length === 0 ? (
          <EmptyState title={COMPOSITION_COPY.CATEGORY_EMPTY} />
        ) : (
          entries.map(([type, count]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="w-20 font-mono text-xs text-text-sub">{type}</span>
              <div className="h-3 flex-1 rounded-full bg-surface-root">
                <div className="h-full rounded-full bg-text-sub/40" style={{ width: `${(count / total) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </CompositionSection>
  );
}

/** 关系类型分布（占比条） */
function RelationTypeBars({ edges }: { edges: { type: string }[] }) {
  const counts: Record<string, number> = {};
  for (const e of edges) {
    const t = e.type || "?";
    counts[t] = (counts[t] || 0) + 1;
  }
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const total = edges.length;

  return (
    <CompositionSection title={COMPOSITION_COPY.RELATION_TYPE_DISTRIBUTION}>
      <div className="space-y-1.5">
        {entries.length === 0 ? (
          <EmptyState title={COMPOSITION_COPY.RELATION_TYPE_EMPTY} />
        ) : (
          entries.map(([type, count]) => (
            <div key={type} className="flex items-center gap-2">
              <span className={`w-24 text-xs ${RELATION_TYPE_COLORS[type] || "text-text-sub"}`}>{relationTypeLabel(type)}</span>
              <div className="h-3 flex-1 rounded-full bg-surface-root">
                <div className="h-full rounded-full bg-status-loading-6" style={{ width: `${(count / total) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </CompositionSection>
  );
}

/** 图谱规则使用情况（本体注册与主图实际内容的对照；默认收起） */
function RuleUsageSection({ nodes, edges }: { nodes: { category: string }[]; edges: { type: string }[] }) {
  const [open, setOpen] = useState(false);

  const usedCategories: Record<string, number> = {};
  for (const n of nodes) {
    const cat = n.category || "?";
    usedCategories[cat] = (usedCategories[cat] || 0) + 1;
  }

  const usedRelations: Record<string, number> = {};
  for (const e of edges) {
    const t = e.type || "";
    if (t) usedRelations[t] = (usedRelations[t]) + 1;
  }

  return (
    <section>
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} className="mb-2 -ml-2 gap-1.5 text-xs text-text-hint hover:text-text-main">
        <Database className="h-3 w-3" /> {COMPOSITION_COPY.RULE_USAGE}
      </Button>
      {open && (
        <div className="space-y-2 rounded-lg ring-1 ring-border-thin bg-surface-root p-3">
          <div>
            <div className="mb-1 font-mono text-xs text-text-hint">
              {TERM.CATEGORY} {ontologyUsage(Object.keys(usedCategories).length, ENTITY_TYPES.length)}
            </div>
            <div className="flex flex-wrap gap-1">
              {ENTITY_TYPES.map(t => (
                <span key={t} className={`rounded px-1.5 py-0.5 font-mono text-xs ${usedCategories[t] ? "bg-blue-2 text-blue-9" : "bg-surface-card text-text-placeholder"}`}>
                  {t}{usedCategories[t] ? ` (${usedCategories[t]})` : ""}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 font-mono text-xs text-text-hint">
              {COMPOSITION_COPY.RELATION_TYPE_LABEL} {ontologyUsage(Object.keys(usedRelations).filter(key => key in ACTIVE_RELATION_TYPES).length, Object.keys(ACTIVE_RELATION_TYPES).length)}
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(ACTIVE_RELATION_TYPES).map(([key, def]) => (
                <span key={key} className={`rounded px-1.5 py-0.5 font-mono text-xs ${usedRelations[key] ? "bg-status-loading-2 text-status-loading" : "bg-surface-card text-text-placeholder"}`}>
                  {def.label}{usedRelations[key] ? ` x${usedRelations[key]}` : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function DataDashboardView() {
  const load = useLoadTopology();
  const loading = useTopologyLoading();
  const error = useTopologyError();
  const nodes = useAdmittedNodes();
  const edges = useAdmittedEdges();
  const knowledgeNodes = useKnowledgeNodes();
  const stats = useTopologyStats();
  const scope = useTopologyScope();
  const setScope = useSetTopologyScope();

  const hubFocus = useHubDrawerState((s) => s.focus);
  const [tab, setTab] = useState<HubTab>("topo");
  const [relationsTab, setRelationsTab] = useState<RelationsTab>("query");
  const [relFilter, setRelFilter] = useState<Set<string>>(new Set());

  useEffect(() => { load(); }, [load]);

  // 图随文件变（Master 2026-10-29）：vault 文件外部写→服务端监听→增量抽取→运行时摄取，
  // 派生库秒级更新；前端进页拉一次不够——窗口聚焦/回到前台自动重拉，配 store 未变守卫＝数据变了才重渲染。
  // WP-145：监听部分收编共享 hook（行为同原 effect）。
  useRefetchOnFocus(load);

  const availableTypes = useMemo(() => [...new Set(edges.map((e) => e.type))].sort(), [edges]);
  const visibleEdges = useMemo(
    () => (relFilter.size === 0 ? edges : edges.filter((e) => relFilter.has(e.type))),
    [edges, relFilter],
  );

  // 模型：拓扑层 + 缺口层一并构建（缺口默认由 Flow 内的「缺口叠加」开关藏起——scope=architecture 才有诊断数据）
  const model = useMemo(() => buildProjectionModel(
    {
      seedCount: stats?.seedCount,
      seedComponentIds: stats?.seedComponentIds,
      implicitPaths: stats?.implicitPaths,
      unresolvedPairs: stats?.unresolvedPairs,
      missingSeeds: stats?.missingSeeds,
    },
    { nodes, edges: visibleEdges },
    { showGaps: true },
  ), [stats, nodes, visibleEdges]);

  const toggleRelType = (type: string) => {
    setRelFilter((prev) => {
      // 空集 = 全部；从全部进入时以「仅剩其他类型」起步，再点当前 chip 即恢复全部
      if (prev.size === 0) return new Set(availableTypes.filter((t) => t !== type));
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  return (
    <TopologyStateGate loading={loading} error={error} hasStats={Boolean(stats)} onLoad={load}>
      {(() => {
        const taxonomyTree = stats?.taxonomyTree || [];
        return (
          <PageContainer>
            <PageSection
              action={
                stats?.dataSource === "worktree" ? (
                  <span className="rounded bg-status-warn-2 px-1.5 py-0.5 text-xs text-status-warn ring-1 ring-status-warn-6" title={DD_VIEW_COPY.WORKTREE_BADGE_TITLE}>{DD_VIEW_COPY.WORKTREE_BADGE}</span>
                ) : null
              }
            />

            <InternalTabs ariaLabel={DD_VIEW_COPY.HUB_TABS_ARIA} items={HUB_TABS} value={tab} onValueChange={setTab} />

            {/* WP-037 P7 锚点：图谱规模主视觉（实体 xl 跨两列＋关系 lg）——检索前先给规模感 */}
            {tab === "topo" && (
              <>
                <BentoGrid>
                  <Statistic size="xl" className="lg:col-span-2" label={DD_VIEW_COPY.STAT_ENTITY_LABEL} value={stats?.totalNodes ?? null} hint={DD_VIEW_COPY.STAT_ENTITY_HINT} />
                  <Statistic size="lg" label={DD_VIEW_COPY.STAT_RELATION_LABEL} value={stats?.totalEdges ?? null} hint={DD_VIEW_COPY.STAT_RELATION_HINT} />
                </BentoGrid>
                <Alert
                  variant="info"
                  description={
                    <span className="flex flex-wrap items-center gap-x-1 gap-y-1">
                      {/* 规模口径说明句＝term-const 闭集单源（WP-145 N3：裸标签 ArchitectureComponent/Module 正名消费 TERM 词条） */}
                      {termTopologyScaleHint(knowledgeNodes.length, nodes.length)}
                      <Button variant="link" className="h-auto px-0.5 py-0 text-xs" onClick={() => setTab("relations")}>
                        {DD_VIEW_COPY.GO_RELATIONS_LINK}
                      </Button>
                    </span>
                  }
                >
                  {DD_VIEW_COPY.SCALE_ALERT_TITLE}
                </Alert>
              </>
            )}

            {tab === "topo" ? (
              <div className="flex flex-col gap-4">
                <GraphExplorerToolbar
                  availableTypes={availableTypes}
                  enabledTypes={relFilter}
                  onToggleType={toggleRelType}
                  scope={scope}
                  onScopeChange={setScope}
                  shownEdges={visibleEdges.length}
                  totalEdges={edges.length}
                />
                <ArchitectureProjectionFlow
                  model={model}
                  highlightNodeIds={null}
                  onHighlight={() => { /* 枢纽内不使用跨组件高亮联动 */ }}
                  onNodeClickEvidence={() => { /* 缺口证据面板由 Flow 内部承载 */ }}
                  onSelect={(sel) => { hubFocus(sel.kind === "node" ? { kind: "entity", id: sel.nodeId } : { kind: "edge", id: sel.edgeId }); }}
                />

                {/* 投影维度（保留能力，默认折叠） */}
                <ProjectionSubView title={DD_VIEW_COPY.TAXONOMY_SUBVIEW} icon={<GitBranch className="h-4 w-4" />}>
                  <TaxonomySidebar tree={taxonomyTree} />
                </ProjectionSubView>
                <ProjectionSubView title={DD_VIEW_COPY.BAND_SUBVIEW} icon={<Network className="h-4 w-4" />}>
                  <BandStack nodes={nodes} />
                </ProjectionSubView>
                {/* 图谱构成分布（2026-11-15 运行概览退役批自 dashboard 页迁入——本体注册对照表，
                    受众＝本体调整时的对账；默认折叠挂拓扑页签尾，行尾绝对数已随 MAIC 形态批撤） */}
                <ProjectionSubView title={COMPOSITION_COPY.SUBVIEW_TITLE} icon={<GitBranch className="h-4 w-4" />}>
                  <div className="space-y-6">
                    <EntityTypeBars nodes={nodes} />
                    <RelationTypeBars edges={edges} />
                    <RuleUsageSection nodes={nodes} edges={edges} />
                  </div>
                </ProjectionSubView>
                {/* 全库定版发布卡（发布永不自动＝人 gate；定版紧挨着它冻结的图） */}
                <ReleaseMintCard />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <InternalTabs ariaLabel={DD_VIEW_COPY.RELATIONS_TABS_ARIA} items={RELATIONS_TABS} value={relationsTab} onValueChange={setRelationsTab} />
                <div className="min-h-0 flex-1">
                  {relationsTab === "query" && (
                    <div className="flex flex-col gap-4">
                      {/* 批13：图为主体（Obsidian 式局部展开，自配置页迁入正名）；关系清单在其下 */}
                      <LocalGraph />
                      <RelationLibraryTab />
                    </div>
                  )}
                  {relationsTab === "overview" && <RelationsPanel />}
                </div>
              </div>
            )}
          </PageContainer>
        );
      })()}
    </TopologyStateGate>
  );
}
