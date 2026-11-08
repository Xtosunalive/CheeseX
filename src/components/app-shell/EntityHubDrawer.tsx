// EntityHubDrawer — 实体全景抽屉与全局入口。
// 聚合实体档案、直接关系、影响范围和数据质量问题。
import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, GitFork, FileText, ShieldCheck, Box, Wrench } from "lucide-react";
import { resolveObsidianSourcePath } from "@/lib/obsidian";
import { ObsidianLink } from "@/components/obsidian";
import { SidePanelAction, SidePanelSection } from "@/components/side-panel";
import { PoolShell, PoolRecallButton, useNarrowViewport, usePoolOccupancy } from "@/components/pool-panel";
import { useActiveEntityId, useSetActiveEntityId, useTopologyStats, useAdmittedNodes, useAdmittedEdges } from "@/lib/topology-store";
import { EdgeDetail, type HubSelection } from "@/features/data-dashboard/EntityDetailPanel";
import { useEntityHub } from "@/hooks/useEntityHub";
import { sliceWithRest } from "@/lib/format";
import { GAP_TYPE_LABEL, GAP_SEVERITY_STYLE } from "@/features/gap-engine/gap-types";
import { useHubDrawerState } from "./entity-hub-drawer-store";
import { TERM } from "@/constants/term-const";
import { relationTypeLabel } from "@/lib/ontology";
import { RelationOverview } from "@/features/impact-analysis/components/relation-overview";
import { buildAnomalyHandoffHash } from "@/lib/domain/anomaly-handoff";
import type { ImpactAnalysisResult } from "@/features/impact-analysis/impact-analysis-types";
import { navigate, safeNavigateHash } from "@/lib/navigation";
import { ENTITY_HUB_COPY, SHARED_UI_COPY, entityHubMoreEdges, entityHubMoreGaps, entityHubRelationAria } from "../components-copy";

const GRAPH_EXPLORER_HASH = "#/data-dashboard";

/** 契约 ImpactDirectionResult 无 totalNodes 字段——按服务端同口径从 byHop 推导（impact-analysis-service 对 nodeId 做 Set 去重） */
function impactNodeCount(direction: ImpactAnalysisResult["downstream"]): number {
  return new Set(direction.byHop.flatMap((hop) => hop.nodes.map((node) => node.nodeId))).size;
}

// ── Trigger button — bottom of left nav bar ──
// WP-146 件4：EntityHubTrigger 死组件已删（grep 零引用实证 2026-11-07，抽屉经
// entity-hub-drawer-store 的 focus({kind:"entity"}) 打开，无导航栏常驻入口）

function EntityHubObsidianButton({ sourcePath }: { sourcePath: string }) {
  return (
    <ObsidianLink
      sourcePath={sourcePath}
      className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-main transition-colors hover:bg-surface-root disabled:cursor-not-allowed disabled:opacity-50"
      title={ENTITY_HUB_COPY.OPEN_OBSIDIAN_TITLE}
    >
      <span className="h-3 w-3 rounded-full bg-accent-base" />
      {SHARED_UI_COPY.OPEN_OBSIDIAN}
    </ObsidianLink>
  );
}

// ── Main drawer component ──

export function EntityHubDrawer() {
  const { open, setOpen, selection: hubSelection, focus: hubFocus } = useHubDrawerState();
  const activeEntityId = useActiveEntityId();
  const setActiveEntityId = useSetActiveEntityId();
  const stats = useTopologyStats();
  const allNodes = useAdmittedNodes();
  const allEdges = useAdmittedEdges();
  // 契约身份 union（release|worktree）：release 态才携带 releaseId/sourceCommit，in 守卫收窄
  const releaseIdentity = stats && "releaseId" in stats ? { releaseId: stats.releaseId, sourceCommit: stats.sourceCommit } : null;
  const { profile, oneHop, gaps, impact, impactLoading } = useEntityHub(activeEntityId);
  // WP-134 波4：缺口列举的可见集与折叠剩余数一处算出（旧式 slice(0,5) 与 length-5 分写两处）
  const gapFold = sliceWithRest(gaps, 5);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // 丙方案：边选中态——图谱检索点击关系边时，全景顶部内嵌边详情（是什么/从哪来），
  // activeEntityId 锚到边源端（一跳关系列表自然可达目标端）
  const focusEdge = hubSelection?.kind === "edge" ? allEdges.find((e) => e.edgeId === hubSelection.id) || null : null;
  useEffect(() => {
    if (focusEdge && focusEdge.source !== activeEntityId) setActiveEntityId(focusEdge.source);
  }, [focusEdge, activeEntityId, setActiveEntityId]);
  // 实体路径同步：focus({kind:"entity"}) 只开壳，数据锚点在此统一落位（首次修复空态根因：
  // 节点点击通路无人调 setActiveEntityId，全景 open 而 activeEntityId=null → 空态）
  useEffect(() => {
    if (hubSelection?.kind === "entity" && hubSelection.id !== activeEntityId) setActiveEntityId(hubSelection.id);
  }, [hubSelection, activeEntityId, setActiveEntityId]);

  const isEmpty = !activeEntityId;
  const sourcePath = resolveObsidianSourcePath(profile);
  const selectedEdge = [...oneHop.outgoing, ...oneHop.incoming].find((edge) => edge.edgeId === selectedEdgeId) || null;

  // PR-026 任务池化：窄视口（≤800px）面板隐藏，唤回钮强制恢复（面板状态本体保留）
  // 目检②互斥：全景被其他池顶掉时自动收起（setOpen(false)=最小化语义）
  const narrow = useNarrowViewport();
  const [revealed, setRevealed] = useState(false);
  const stillOwner = usePoolOccupancy("entity-hub", open);
  useEffect(() => { if (open && !stillOwner) setOpen(false); }, [open, stillOwner, setOpen]);
  const showPanel = open && (!narrow || revealed) && stillOwner;
  const showRecall = open && narrow && !revealed && stillOwner;

  if (!showPanel && !showRecall) return null;
  if (showRecall) return <PoolRecallButton label={ENTITY_HUB_COPY.RECALL} onClick={() => setRevealed(true)} />;

  return (
    <PoolShell title={TERM.ENTITY_OVERVIEW} onClose={() => { setOpen(false); setRevealed(false); }} closeLabel={ENTITY_HUB_COPY.CLOSE_ARIA}>
        {/* Master 2026-10-06 目检①：池壳已带标题行，内部 SidePanelHeader 重复显示删除 */}

        {focusEdge ? (
          /* 丙方案：关系边详情置顶（是什么/从哪来，含 provenance/审核状态）——
             下接源实体的常规四维度；点击边两端可切换锚定实体 */
          <div className="mb-2 space-y-1">
            <EdgeDetail
              edge={focusEdge}
              nodes={allNodes}
              onSelect={(sel: HubSelection) => {
                if (sel.kind === "node") setActiveEntityId(sel.nodeId);
                else hubFocus({ kind: "edge", id: sel.edgeId });
              }}
            />
            <div className="h-px bg-border-thin my-3" aria-hidden="true" />
          </div>
        ) : null}

        {isEmpty ? (
          /* ── Empty state: no entity selected ── */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Box className="h-5 w-5 text-text-placeholder mb-4" />
            <p className="text-sm text-text-hint">{ENTITY_HUB_COPY.EMPTY_TITLE}</p>
            <p className="text-xs text-text-placeholder mt-1 max-w-[280px]">
              {ENTITY_HUB_COPY.EMPTY_DESCRIPTION}
            </p>
            <SidePanelAction
              variant="primary"
              onClick={() => {
                setActiveEntityId(null);
                setOpen(false);
                navigate("data-dashboard"); // 原 GRAPH_EXPLORER_HASH 常量
              }}
              className="mt-4"
            >
              {ENTITY_HUB_COPY.GO_EXPLORER}
            </SidePanelAction>
          </div>
        ) : (
          /* ── 4-dimension hub ── */
          <div className="space-y-4">
            <div className="flex justify-end">
              <EntityHubObsidianButton sourcePath={sourcePath} />
            </div>

            {/* Dimension 1: 基础档案 */}
            <SidePanelSection title={ENTITY_HUB_COPY.PROFILE_SECTION} icon={FileText}>
              {profile ? (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.DT_NAME}</dt>
                    <dd className="text-text-main font-medium truncate">{profile.label}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.DT_CATEGORY}</dt>
                    <dd className="text-text-sub">{profile.category || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.DT_DEGREE}</dt>
                    <dd className="text-text-sub">{profile.degree ?? "—"}</dd>
                  </div>
                  {profile.labels && profile.labels.length > 0 && (
                    <div className="col-span-2">
                      <dt className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.DT_LABELS}</dt>
                      <dd className="flex flex-wrap gap-1 mt-0.5">
                        {profile.labels.map((l) => (
                          <span key={l} className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-sub">
                            {l}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                  {stats && <div className="col-span-2">
                    <dt className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.DT_RELEASE}</dt>
                    <dd className="break-all font-mono text-xs text-text-sub">{stats && "releaseId" in stats ? stats.releaseId : "—"}<br />{stats && "sourceCommit" in stats ? stats.sourceCommit : "—"}</dd>
                  </div>}
                </dl>
              ) : (
                <p className="text-sm text-text-placeholder">{ENTITY_HUB_COPY.PROFILE_NOT_FOUND}</p>
              )}
            </SidePanelSection>

            {/* Dimension 2: direct dependencies */}
            <SidePanelSection title={ENTITY_HUB_COPY.DEPS_SECTION} icon={GitFork} href={activeEntityId ? GRAPH_EXPLORER_HASH : undefined}>
              {oneHop.outgoing.length === 0 && oneHop.incoming.length === 0 ? (
                <p className="text-sm text-text-placeholder">{ENTITY_HUB_COPY.NO_DEPS}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <RelationList edges={oneHop.outgoing} title={TERM.OUT_DEP} onSelect={setSelectedEdgeId} />
                  <RelationList edges={oneHop.incoming} title={TERM.IN_DEP} onSelect={setSelectedEdgeId} />
                  {selectedEdge && <RelationOverview relation={{
                    edgeId: selectedEdge.edgeId,
                    source: selectedEdge.source,
                    target: selectedEdge.target,
                    relationType: selectedEdge.type,
                    sourcePath: selectedEdge.sourceFile,
                    sourceLine: selectedEdge.lineNumber,
                    evidenceHash: selectedEdge.evidenceHash,
                    freshness: "unknown",
                    releaseId: releaseIdentity?.releaseId,
                    sourceCommit: releaseIdentity?.sourceCommit,
                  }} defaultOpen />}
                </div>
              )}
            </SidePanelSection>

            {/* Dimension 3: 影响面简报 */}
            <SidePanelSection title={ENTITY_HUB_COPY.IMPACT_SECTION} icon={GitFork} href={activeEntityId ? `#/impact-analysis?seed=${encodeURIComponent(activeEntityId)}` : undefined}>
              {impactLoading ? (
                <div className="flex items-center gap-2 py-3 text-sm text-text-hint">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {ENTITY_HUB_COPY.ANALYZING}
                </div>
              ) : impact ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex gap-4">
                    <div>
                      <span className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.DOWNSTREAM}</span>
                      <span className="ml-2 text-text-main font-medium">{impactNodeCount(impact.downstream)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.UPSTREAM}</span>
                      <span className="ml-2 text-text-main font-medium">{impactNodeCount(impact.upstream)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-text-placeholder">{ENTITY_HUB_COPY.TRAVERSED}</span>
                      <span className="ml-2 text-text-main font-medium">{impact.meta.traversalEdgesFiltered}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-placeholder">{ENTITY_HUB_COPY.IMPACT_UNAVAILABLE}</p>
              )}
            </SidePanelSection>

            {/* Dimension 4: 缺口分析 */}
            <SidePanelSection title={ENTITY_HUB_COPY.QUALITY_SECTION} icon={ShieldCheck}>
              {gaps.length === 0 ? (
                <p className="text-sm text-text-placeholder">{ENTITY_HUB_COPY.NO_QUALITY_ISSUES}</p>
              ) : (
                <div className="space-y-2">
                  {gapFold.visible.map((g) => {
                    const style = GAP_SEVERITY_STYLE[g.severity];
                    return (
                      <div key={g.id} className={`flex items-start gap-2 rounded-md p-2.5 ${style.bg} ${style.border}`}>
                        <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${style.icon}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-xs ${style.badge}`}>
                              {GAP_TYPE_LABEL[g.type]}
                            </span>
                          </div>
                          <p className="text-xs text-text-sub mt-0.5 line-clamp-2">{g.detail}</p>
                          <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-text-hint hover:text-text-main" onClick={() => {
                            setOpen(false);
                            safeNavigateHash(buildAnomalyHandoffHash({
                              issueId: g.id,
                              objectKind: "entity",
                              objectId: activeEntityId,
                              sourcePath: g.filePath || sourcePath,
                              relationSource: g.edgeInfo?.from,
                              relationTarget: g.edgeInfo?.to,
                              relationType: g.edgeInfo?.type,
                              releaseId: releaseIdentity?.releaseId,
                              sourceCommit: releaseIdentity?.sourceCommit,
                            }));
                          }}><Wrench className="h-3 w-3" />{ENTITY_HUB_COPY.VIEW_IN_ANOMALIES}</button>
                        </div>
                      </div>
                    );
                  })}
                  {gapFold.rest > 0 && (
                    <p className="text-xs text-text-placeholder">{entityHubMoreGaps(gapFold.rest)}</p>
                  )}
                </div>
              )}
            </SidePanelSection>

            {/* Clear entity selection */}
            <SidePanelAction
              onClick={() => setActiveEntityId(null)}
              className="w-full text-xs"
            >
              {ENTITY_HUB_COPY.CLEAR_SELECTION}
            </SidePanelAction>
          </div>
        )}
    </PoolShell>
  );
}

function RelationList({ edges, title, onSelect }: {
  edges: Array<{ edgeId: string; type: string; sourceLabel: string; targetLabel: string }>;
  title: string;
  onSelect: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  if (edges.length === 0) return null;
  // WP-134 波4：关系列举可见集与「及其他 N 条」一处算出
  const edgeFold = sliceWithRest(edges, 8);
  return (
    <div>
      <p className="text-xs text-text-placeholder mb-1">{title} ({edges.length})</p>
      <div className="space-y-0.5">
        {edgeFold.visible.map((e) => (
          <button type="button" key={e.edgeId} onClick={() => onSelect((current) => current === e.edgeId ? null : e.edgeId)} className="flex w-full items-center gap-1.5 text-left text-xs hover:text-text-main" aria-label={entityHubRelationAria(e.sourceLabel, e.targetLabel)}>
            <span className="text-text-sub truncate max-w-[160px]">{e.sourceLabel}</span>
            <span className="text-[var(--color-accent-base)] shrink-0">→ {relationTypeLabel(e.type)} →</span>
            <span className="text-text-main truncate max-w-[160px]">{e.targetLabel}</span>
          </button>
        ))}
        {edgeFold.rest > 0 && (
          <p className="text-xs text-text-placeholder">{entityHubMoreEdges(edgeFold.rest)}</p>
        )}
      </div>
    </div>
  );
}
