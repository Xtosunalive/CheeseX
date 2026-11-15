import { useEffect, useState } from "react";
import { Database, ShieldCheck, GitBranch, Tag, Clock, ChevronDown, ChevronRight } from "lucide-react";
import {
  useAdmittedNodes,
  useAdmittedEdges,
  useTopologyStats,
  useTopologyLoading,
  useTopologyError,
  useLoadTopology,
} from "@/lib/topology-store";
import { TopologyStateGate } from "@/components/topology-state-gate";
import type { TopologyStats } from "@/lib/topology-types";
import { ACTIVE_RELATION_TYPES, ENTITY_TYPES, relationTypeLabel, type RelationTypeName } from "@/lib/ontology";
import { navigate } from "@/lib/navigation";
import { apiFetchEnvelope } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { TERM } from "@/constants/term-const";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { ENTITY_CATEGORY } from "@/lib/domain/EntityCategory";
import { DASHBOARD_PUBLISH_COPY, DASHBOARD_SECTION_COPY, DASHBOARD_SYNC_COPY, dashboardPublished, dashboardRequestIncomplete, dashboardStaleHours, dashboardUsage } from "./dashboard-copy";

export function DashboardView() {
  const load = useLoadTopology();
  const loading = useTopologyLoading();
  const error = useTopologyError();
  const nodes = useAdmittedNodes();
  const edges = useAdmittedEdges();
  const stats = useTopologyStats();

  useEffect(() => { load(); }, [load]);

  // 待审关系＝拓扑边里 pending/未定状态数（本面板原评审状态行同口径）——MAIC 形态批（Master 裁 A）：
  // 三数汇总行撤，>0 时降级为一条可点链接（待办依附动作容器，零待办零渲染）
  const reviewPendingEdgeCount = edges.filter(e => e.reviewStatus === "pending" || !e.reviewStatus).length;

  return (
    <TopologyStateGate loading={loading} error={error} hasStats={Boolean(stats)} onLoad={load}>
      <PageContainer>
        {/* 2026-11-15 MAIC 形态批（Master 裁 A）：常驻数字仪表盘整块退役——规模/待办数字回归各自
            工作页与列表行（MAIC 形态：计数依附动作容器，无汇总卡行）；首页保留拓扑结构面＋同步面 */}

        <div data-dashboard-module="topology-summary">
          <Panel>
            <EntityTypeSection nodes={nodes} />
            <RelationTypeSection edges={edges} />
            <OntologySchemaSection nodes={nodes} edges={edges} />
          </Panel>
        </div>

        {reviewPendingEdgeCount > 0 && (
          <div data-dashboard-module="review-status">
            <Panel>
              <Button
                type="button"
                variant="link"
                onClick={() => navigate("review", { sub: "edges" })}
                className="h-auto gap-1.5 p-0 text-xs font-normal text-status-warn hover:text-status-warn-11 [&_svg]:size-3"
              >
                <ShieldCheck className="h-3 w-3" />
                {DASHBOARD_SECTION_COPY.REVIEW_PENDING_LINK}
                <ChevronRight className="h-3 w-3" />
              </Button>
            </Panel>
          </div>
        )}

        <div data-dashboard-module="sync-log">
          <Panel>
            <SyncLogSection stats={stats} />
          </Panel>
        </div>
      </PageContainer>
    </TopologyStateGate>
  );
}


// ── Section components ──

function EntityTypeSection({ nodes }: { nodes: { category: string }[] }) {
  const EXCLUDED = new Set<string>([ENTITY_CATEGORY.DOMAIN, ENTITY_CATEGORY.OTHER]);
  const counts: Record<string, number> = {};
  for (const n of nodes) {
    if (EXCLUDED.has(n.category)) continue;
    counts[n.category] = (counts[n.category] || 0) + 1;
  }
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <Section title={DASHBOARD_SECTION_COPY.CATEGORY_DISTRIBUTION} icon={<Tag className="h-3 w-3" />}>
      <div className="space-y-1.5">
        {entries.length === 0 ? (
          /* WP-145 N1：Section 体整块空态改走 EmptyState 介质；渲染条件与文案（TERM.CATEGORY 组句）不变 */
          <EmptyState title={DASHBOARD_SECTION_COPY.CATEGORY_EMPTY} />
        ) : (
          /* 2026-11-15 MAIC 形态批（Master 裁 A）：行尾绝对数撤——构成占比由条宽表达 */
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
    </Section>
  );
}

// 键名从生成物驱动（WP-138 R5a·收紧）：全穷尽 Record<RelationTypeName, string>（键单源＝
// ontology.ts 对生成物 RELATION_TYPES 键集的派生）——registry 新增关系类型而本表未配色、或
// 改名/删名留陈旧键，typecheck 即红。治理语义边（derivation/usage/reference/co_editing/
// containment）手抄期不入表、经 `|| "text-text-sub"` 兜底——显式入表并取该兜底值，渲染
// bit 级不变；未登记类型（不在联合内）仍经 `|| "text-text-sub"` 运行时兜底。USES 为
// legacy_policy=delete 的退役类型，保留手抄期既定配色档；registry 删除该键时此处编译红，
// 由维护者届时显式决定去留。
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

function RelationTypeSection({ edges }: { edges: { type: string }[] }) {
  const counts: Record<string, number> = {};
  for (const e of edges) {
    const t = e.type || "?";
    counts[t] = (counts[t] || 0) + 1;
  }
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const total = edges.length;

  return (
    <Section title={DASHBOARD_SECTION_COPY.RELATION_TYPE_DISTRIBUTION} icon={<GitBranch className="h-3 w-3" />}>
      <div className="space-y-1.5">
        {entries.length === 0 ? (
          /* WP-145 N1：Section 体整块空态改走 EmptyState 介质；渲染条件与文案（TERM.RELATION 组句）不变 */
          <EmptyState title={DASHBOARD_SECTION_COPY.RELATION_TYPE_EMPTY} />
        ) : (
          /* 2026-11-15 MAIC 形态批（Master 裁 A）：行尾绝对数撤——构成占比由条宽表达 */
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
    </Section>
  );
}

function OntologySchemaSection({ nodes, edges }: { nodes: { category: string }[]; edges: { type: string }[] }) {
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
      <button onClick={() => setOpen(!open)} className="mb-2 flex items-center gap-1.5 text-xs text-text-hint hover:text-text-main transition">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Database className="h-3 w-3" /> {DASHBOARD_SECTION_COPY.RULE_USAGE}
      </button>
      {open && (
        <div className="space-y-2 rounded-lg ring-1 ring-border-thin bg-surface-root p-3">
          <div>
            <div className="mb-1 font-mono text-xs text-text-hint">
              {TERM.CATEGORY} {dashboardUsage(Object.keys(usedCategories).length, ENTITY_TYPES.length)}
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
              {DASHBOARD_SECTION_COPY.RELATION_TYPE_LABEL} {dashboardUsage(Object.keys(usedRelations).filter(key => key in ACTIVE_RELATION_TYPES).length, Object.keys(ACTIVE_RELATION_TYPES).length)}
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

function SyncLogSection({ stats }: { stats: TopologyStats | null }) {
  const freshness = stats?.dataFreshness;
  const version = freshness?.version ?? "—";
  const updatedAt = freshness?.updatedAt ?? "";

  return (
    <Section title={DASHBOARD_SYNC_COPY.SECTION_TITLE} icon={<Clock className="h-3 w-3" />}>
      <div className="space-y-2">
        <div className="rounded-lg ring-1 ring-border-thin bg-surface-root px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-text-sub">
            <span className={`h-2 w-2 rounded-full ${freshness?.fresh !== false ? "bg-grass-11" : "bg-status-warn"}`} />
            <span className="font-mono text-xs">{DASHBOARD_SYNC_COPY.LAST_GENERATED_PREFIX}{updatedAt ? new Date(updatedAt).toLocaleString("zh-CN") : "—"}</span>
          </div>
          {/* 2026-11-15 MAIC 形态批（Master 裁 A）：行尾「N 实体 · N 关系」库总量撤（全站已裁口径的最后残留）——本板块职责＝新鲜度与版本 */}
          <div className="mt-1 font-mono text-xs text-text-placeholder">
            {DASHBOARD_SYNC_COPY.VERSION_PREFIX}{version}
          </div>
          {freshness && !freshness.fresh && (
            <div className="mt-1 font-mono text-xs text-status-warn">
              {DASHBOARD_SYNC_COPY.FRESHNESS_WARNING_PREFIX}{typeof freshness.ageHours === "number" ? dashboardStaleHours(freshness.ageHours.toFixed(1)) : DASHBOARD_SYNC_COPY.UPDATED_AT_UNKNOWN}
            </div>
          )}
        </div>
        <PublishCard />
      </div>
    </Section>
  );
}

// WP-017 独立发布入口：人工触发全库定版（不绑文章审批）。铸版语义与文章审批发布同源；
// 新库/无文章场景由此获得首个发布（发布前消费面 404 NO_CURRENT_RELEASE，发布后按 SPEC-029 呈空态或内容）。
async function mintCurrentRelease(): Promise<{ releaseId: string; artifactCount: number }> {
  // 信封出口消费（ADR-019 §二）：POST /api/releases/mint 走仓内 api 层信封解析（trace_id 并入错误文案——同页惯例）
  const envelope = await apiFetchEnvelope<{ releaseId: string; artifactCount: number }>("/api/releases/mint", { method: "POST" });
  if (!envelope.ok || !envelope.data) {
    throw new Error(envelope.error || dashboardRequestIncomplete(envelope.status));
  }
  return envelope.data;
}

export function PublishCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // PR-321/WP-178：两段式确认——单击先出后果说明，确认才铸版（铸版＋切 current 指针＋触发全量重建属高危动作）
  const [confirming, setConfirming] = useState(false);
  const onPublish = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const minted = await mintCurrentRelease();
      setResult(dashboardPublished(minted.artifactCount)); // WP-035：截断哈希不上屏（版本号在版本分析页可查）
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <div className="rounded-lg ring-1 ring-border-thin bg-surface-root px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-sub">{DASHBOARD_PUBLISH_COPY.DESCRIPTION}</span>
        {!confirming && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
            {busy ? DASHBOARD_PUBLISH_COPY.PUBLISHING : DASHBOARD_PUBLISH_COPY.PUBLISH}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-1.5 flex items-center gap-1.5" data-testid="publish-confirm">
          <Button type="button" size="sm" onClick={onPublish} disabled={busy}>{DASHBOARD_PUBLISH_COPY.CONFIRM_YES}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>{DASHBOARD_PUBLISH_COPY.CONFIRM_NO}</Button>
        </div>
      )}
      {result && <div className="mt-1 font-mono text-xs text-grass-11" data-testid="publish-result">{result}</div>}
      {error && <div className="mt-1 font-mono text-xs text-status-warn" data-testid="publish-error">{error}</div>}
    </div>
  );
}

// ── Atoms ──

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {icon}<h2 className="text-sm font-semibold text-text-main">{title}</h2>
      </div>
      {children}
    </section>
  );
}
export const __poison2 = <i style={{ color: "#ff0000" }}>x</i>;
