// DataDashboardView — 「图谱检索」枢纽（seq212：data-dashboard 路由冻结，原地整合拓扑+关系双入口）
// 拓扑 tab：修复后的 ArchProjFlow 真实拓扑（ReactFlow+Dagre）+ 三上下文侧栏 + 关系类型 chip + 范围切换
// 关系 tab：LocalGraph（Obsidian 式局部图）为主体＋RelationLibraryTab / RelationsPanel；TaxonomySidebar / BandStack 保留为折叠子视图
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, GitBranch, Network, Share2, FileSearch } from "lucide-react";
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
import { Statistic } from "@/components/statistic";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DD_VIEW_COPY } from "./data-dashboard-copy";

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
                  <Statistic size="xl" className="lg:col-span-2" label={DD_VIEW_COPY.STAT_ENTITY_LABEL} value={nodes.length} hint={DD_VIEW_COPY.STAT_ENTITY_HINT} />
                  <Statistic size="lg" label={DD_VIEW_COPY.STAT_RELATION_LABEL} value={edges.length} hint={DD_VIEW_COPY.STAT_RELATION_HINT} />
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
