// EdgeReviewPanel — W2 迁移（决策卡 §12.1）：骨架/三态/密度/筛选/排序/分页走 DataTable＋useTableList；
// 行内批准/驳回 toast 反馈（F2 瞬时路线）与阻断原因深链原样保留；
// 行内动作钮换 ui/button（B1，保留 spinner/禁用/动态 title）；关系类型/来源/文档徽章换 ui/tag（D6）。
// candidates become graph-fact Proposals; facts are approved on the Proposal page.
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useState, useEffect, useCallback } from "react";
import { useUniqueSorted } from "@/hooks/useUniqueSorted";
import { Check, X, RefreshCw, Loader2, GitBranch, FileText, Sparkles, Tags, Link2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader } from "@/components/table-sort-header";
import { TablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { useTableList } from "@/hooks/use-table-list";
import { compareZh } from "@/hooks/use-table-sort";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import { fetchPendingReview, reviewEdge } from "./review-api";
import { fetchRelationsBundle, saveRelations } from "@/lib/edge-api";
import { RELATION_TYPES, type RelationTypeName } from "@/lib/ontology";
import { relationTypeLabel } from "@/lib/ontology";
import { RELATION_TYPE_PROVENANCE, RELATION_TYPE_PROVENANCE_DEFAULT, relationSourceMeta, RELATION_SOURCE_KEYS } from "@/lib/domain";
import { buildAnomalyHandoffHash } from "@/lib/domain/anomaly-handoff";
import { TERM } from "@/constants/term-const";
import {
  EDGE_REVIEW_COPY,
  REVIEW_COPY,
  edgeReviewActionToast,
  edgeReviewBasisText,
  edgeReviewBlockerText,
  edgeReviewEvidenceTitle,
  edgeReviewMetaText,
} from "./review-copy";
import type { PendingEdge } from "./review-types";

type EdgeSortField = "source" | "target" | "type";

export function EdgeReviewPanel() {
  const [edges, setEdges] = useState<PendingEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingRevision, setWorkingRevision] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [bandByEdge, setBandByEdge] = useState<Record<string, "high" | "medium" | "low" | "">>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPendingReview();
      setEdges(data.edges.filter((e) => e.reviewStatus === "pending"));
      setWorkingRevision((data as typeof data & { workingRevision?: string }).workingRevision ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : TERM.LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const list = useTableList<PendingEdge, EdgeSortField>({
    rows: edges,
    search: (edge, q) => {
      const provenance = edgeProvenance(edge);
      return [edge.sourceLabel, edge.targetLabel, relationTypeLabel(edge.type), provenance.label, provenance.description]
        .some((value) => value.toLowerCase().includes(q));
    },
    filters: {
      type: { values: [], match: (edge, value) => edge.type === value },
      provenance: { values: [], match: (edge, value) => edgeProvenance(edge).label === value },
    },
    comparators: {
      source: (left, right) => compareZh(left.sourceLabel, right.sourceLabel),
      target: (left, right) => compareZh(left.targetLabel, right.targetLabel),
      type: (left, right) => compareZh(left.type, right.type),
    },
    initialSort: { field: "source", direction: "asc" },
  });

  const typeOptions = useUniqueSorted(edges, (e) => e.type);
  const provenanceOptions = useUniqueSorted(edges, (e) => edgeProvenance(e).label);
  const hasFilters = list.query.length > 0 || list.filterValues.type?.length > 0 || list.filterValues.provenance?.length > 0;
  const clearFilters = () => {
    list.setQuery("");
    list.clearFilters();
  };

  // R2：直接审批（写 review_actions 账本，读侧合并生效——F3/ADR054 D2：账本唯一事实源）
  const handleAction = async (edge: PendingEdge, action: "approved" | "rejected") => {
    const key = edge.edgeId;
    setActingId(key);
    try {
      // C7 双写（先档位后审核，两写幂等互不阻塞 fail-soft）：band 失败→不进审核可整体重试；审核失败→band 已在账单独重试
      // 写入与显示同链——预填未动即按建议档位双写（C7 第一腿不再静默缺失，红队 B 必修①/R9-8 同型病）；
      // 手选覆盖预填；显式选「不评分位」（""）仍不写——与 select 显示的 ?? 语义一致（屏上显示什么，批准就写什么）。
      const band = bandByEdge[edge.edgeId] !== undefined ? bandByEdge[edge.edgeId] : edge.suggestedConfidenceBand;
      let confidenceBandAudit: { source: string; target: string; type: string; relationsPath: string; revision: string } | undefined;
      if (band) {
        const { data: bundle } = await fetchRelationsBundle();
        const rest = (bundle.relations ?? []).filter((r) => !(r.source === edge.source && r.target === edge.target && r.type === edge.type && r.endpoint_domain === "graph"));
        const row = { source: edge.source, target: edge.target, type: edge.type, asserted_by: "human" as const, asserted_at: new Date().toISOString().slice(0, 10), endpoint_domain: "graph" as const, confidence_band: band };
        const { data: written } = await saveRelations({ relations: [...rest, row], revision: bundle.revision });
        confidenceBandAudit = { source: edge.source, target: edge.target, type: edge.type, relationsPath: written.relationsPath || "TheSchema/relations.yaml", revision: written.revision };
      }
      await reviewEdge({ edgeId: edge.edgeId, action, ...(confidenceBandAudit ? { confidenceBandAudit } : {}) });
      toast.success(edgeReviewActionToast(action, edge.sourceLabel, edge.targetLabel));
      setEdges((prev) => prev.filter((e) => e.edgeId !== edge.edgeId));
      setActingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : EDGE_REVIEW_COPY.ACTION_FAILED_RETRY);
      setActingId(null);
    }
  };

  const columns: Array<Column<PendingEdge>> = [
    {
      key: "source",
      title: <TableSortHeader label={EDGE_REVIEW_COPY.COL_SOURCE} active={list.sortField === "source"} direction={list.sortDirection} ascendingLabel={EDGE_REVIEW_COPY.COL_SOURCE_ASC} descendingLabel={EDGE_REVIEW_COPY.COL_SOURCE_DESC} onChange={(direction) => list.setSort("source", direction)} />,
      className: "max-w-[200px]",
      render: (edge) => <EndpointCell label={edge.sourceLabel} labels={edge.sourceLabels} />,
    },
    {
      key: "target",
      title: <TableSortHeader label={EDGE_REVIEW_COPY.COL_TARGET} active={list.sortField === "target"} direction={list.sortDirection} ascendingLabel={EDGE_REVIEW_COPY.COL_TARGET_ASC} descendingLabel={EDGE_REVIEW_COPY.COL_TARGET_DESC} onChange={(direction) => list.setSort("target", direction)} />,
      className: "max-w-[200px]",
      render: (edge) => <EndpointCell label={edge.targetLabel} labels={edge.targetLabels} />,
    },
    {
      key: "type",
      title: <TableSortHeader label={EDGE_REVIEW_COPY.COL_TYPE_SOURCE} active={list.sortField === "type"} direction={list.sortDirection} ascendingLabel={EDGE_REVIEW_COPY.COL_TYPE_ASC} descendingLabel={EDGE_REVIEW_COPY.COL_TYPE_DESC} onChange={(direction) => list.setSort("type", direction)} />,
      render: (edge) => (
        <span className="flex flex-col gap-0.5">
          <EdgeMeta edge={edge} />
          {edge.suggestedConfidence !== undefined && (
            <span className="text-[11px] leading-tight text-text-hint" title={edgeReviewEvidenceTitle(edge.suggestedConfidenceEvidence?.articleRefs ?? [], edge.suggestedConfidenceEvidence?.observedAt)}>
              {EDGE_REVIEW_COPY.SUGGEST_PREFIX}{edge.suggestedConfidence} · {edgeReviewBasisText(edge.suggestedConfidenceEvidence?.cooccurrenceCount)} · {EDGE_REVIEW_COPY.SOURCE_PREFIX}{confidenceSourceLabel(edge.confidenceSource)}
            </span>
          )}
          {edge.suggestedConfidence === undefined && edge.confidenceSource && edge.confidenceSource !== "none" && (
            <span className="text-[11px] leading-tight text-text-hint">{EDGE_REVIEW_COPY.CONFIDENCE_SOURCE_PREFIX}{confidenceSourceLabel(edge.confidenceSource)}</span>
          )}
        </span>
      ),
    },
    {
      key: "actions",
      title: EDGE_REVIEW_COPY.COL_ACTIONS,
      align: "right",
      render: (edge) => {
        const isActing = actingId === edge.edgeId;
        return (
          <div className="flex items-center justify-end gap-2">
            {/* WP-142 批⓪（SPEC-091 §一 R9-3）：有系统建议档位时预填（服务端按 confidence-bands
                单源换算下发，前端不换算）；用户手动选择（含改回「不评分位」）后以手动值为准。
                ?? 而非 ||：显式选「不评分位」（""）也须保留手动态，不回落建议档位。 */}
            <select
              value={bandByEdge[edge.edgeId] ?? edge.suggestedConfidenceBand ?? ""}
              onChange={(e) => setBandByEdge((prev) => ({ ...prev, [edge.edgeId]: e.target.value as "high" | "medium" | "low" | "" }))}
              className="rounded bg-surface-hover px-1 py-1 text-xs text-text-sub ring-1 ring-border-thin"
              title={EDGE_REVIEW_COPY.BAND_SELECT_TITLE}
            >
              <option value="">{EDGE_REVIEW_COPY.BAND_NONE}</option>
              <option value="high">{EDGE_REVIEW_COPY.BAND_HIGH}</option>
              <option value="medium">{EDGE_REVIEW_COPY.BAND_MEDIUM}</option>
              <option value="low">{EDGE_REVIEW_COPY.BAND_LOW}</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isActing}
              onClick={() => handleAction(edge, "approved")}
              title={(edge.blockers?.length ?? 0) > 0 ? EDGE_REVIEW_COPY.APPROVE_BLOCKED_TITLE : EDGE_REVIEW_COPY.APPROVE_TITLE}
              className="h-7 gap-1 bg-status-fact-2 px-2 text-xs text-status-fact hover:bg-jade-4"
            >
              {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{EDGE_REVIEW_COPY.APPROVE_ACTION}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isActing}
              onClick={() => handleAction(edge, "rejected")}
              title={EDGE_REVIEW_COPY.REJECT_TITLE}
              className="h-7 gap-1 bg-status-error-2 px-2 text-xs text-status-error hover:bg-red-4"
            >
              {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}{EDGE_REVIEW_COPY.REJECT_ACTION}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {/* WP-034：revision 哈希仅供防篡改对账（与写回 409 同判定）——照 property-gov 校验信息
          折叠范式收纳：默认收起、悬浮显全文；标题人话化（原「工作树关系候选」）。 */}
      <details className="rounded-lg bg-surface-root px-1 ring-1 ring-border-thin" data-testid="pending-review-working-revision">
        <summary className="cursor-pointer select-none px-2 py-1.5 text-xs text-text-hint">
          {EDGE_REVIEW_COPY.WORKING_REV_SUMMARY}<span className="ml-1 font-normal">{EDGE_REVIEW_COPY.WORKING_REV_COLLAPSED_HINT}</span>
        </summary>
        <div className="px-2 pb-2 text-xs text-text-hint">
          {workingRevision
            ? <span className="font-mono" title={workingRevision}>{workingRevision.replace("sha256:", "").slice(0, 12)}</span>
            : <span>{EDGE_REVIEW_COPY.WORKING_REV_MISSING}</span>}
        </div>
      </details>
      <DataTable
        ariaLabel={EDGE_REVIEW_COPY.TABLE_ARIA}
        columns={columns}
        rows={list.items}
        rowKey={(edge) => edge.edgeId}
        density="md"
        minWidth={760}
        loading={loading}
        loadingLabel={EDGE_REVIEW_COPY.LOADING_LABEL}
        error={error}
        onRetry={load}
        empty={edges.length === 0 ? { title: EDGE_REVIEW_COPY.EMPTY_ALL_REVIEWED } : { title: REVIEW_COPY.EMPTY_NO_MATCH }}
        toolbar={
          <TableToolbar>
            <TableToolbarSearch ariaLabel={EDGE_REVIEW_COPY.SEARCH_ARIA} placeholder={EDGE_REVIEW_COPY.SEARCH_PLACEHOLDER} value={list.query} onChange={(event) => list.setQuery(event.target.value)} />
            <FilterSelect ariaLabel={EDGE_REVIEW_COPY.FILTER_TYPE_ARIA} title={EDGE_REVIEW_COPY.FILTER_TYPE_TITLE} searchPlaceholder={EDGE_REVIEW_COPY.FILTER_TYPE_SEARCH} multiple variant="filter" value={list.filterValues.type ?? []} onValueChange={(value) => list.setFilter("type", value as string[])} emptyLabel={EDGE_REVIEW_COPY.EMPTY_ALL_TYPES} placeholder={EDGE_REVIEW_COPY.PLACEHOLDER_TYPE} options={typeOptions.map((value) => ({ value, label: relationTypeLabel(value), group: EDGE_REVIEW_COPY.GROUP_TYPE }))} />
            <FilterSelect ariaLabel={EDGE_REVIEW_COPY.FILTER_SOURCE_ARIA} title={EDGE_REVIEW_COPY.FILTER_SOURCE_TITLE} searchPlaceholder={EDGE_REVIEW_COPY.FILTER_SOURCE_SEARCH} multiple variant="filter" value={list.filterValues.provenance ?? []} onValueChange={(value) => list.setFilter("provenance", value as string[])} emptyLabel={EDGE_REVIEW_COPY.EMPTY_ALL_SOURCES} placeholder={EDGE_REVIEW_COPY.PLACEHOLDER_SOURCE} options={provenanceOptions.map((value) => ({ value, label: value, group: EDGE_REVIEW_COPY.GROUP_SOURCE }))} />
            <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={TERM.CLEAR_FILTER_ACTION} disabled={!hasFilters} onClick={clearFilters} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30"><RotateCcw className="h-4 w-4" /></button>
            <button type="button" title={EDGE_REVIEW_COPY.REFRESH} aria-label={EDGE_REVIEW_COPY.REFRESH} onClick={load} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main"><RefreshCw className="h-4 w-4" /></button>
          </TableToolbar>
        }
        meta={<span className="tabular-nums text-kg-xs text-text-hint">{edgeReviewMetaText(list.visibleCount, edges.length)}</span>}
        pagination={<TablePagination ariaLabel={EDGE_REVIEW_COPY.PAGINATION_ARIA} page={list.page} pageSize={list.pageSize} total={list.visibleCount} loading={loading} onPageChange={list.setPage} />}
      />
    </div>
  );
}

function EndpointCell({ label, labels }: { label: string; labels?: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="truncate text-text-main" title={label}>{label}</span>
      {Array.isArray(labels) && labels.includes("Document") && (
        // PR-045：文档节点类型徽章（读侧透传 labels，前端标注——此前被抹成与普通实体无异）；
        // 色取分类色「文档」档（topology-types CATEGORY_COLORS 同键）的既有点缀类
        <Tag className="shrink-0 bg-pink-2 px-1.5 py-0.5 text-kg-xs text-pink-11 ring-pink-6">{EDGE_REVIEW_COPY.DOC_BADGE}</Tag>
      )}
    </div>
  );
}

function EdgeMeta({ edge }: { edge: PendingEdge }) {
  const kind = relationMeta(edge.type);
  const provenance = edgeProvenance(edge);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag className={kind.color} title={kind.description}>
          <kind.icon className="h-3 w-3" />
          {kind.label}
        </Tag>
        <Tag className={provenance.color} title={provenance.description}>
          <provenance.icon className="h-3 w-3" />
          {provenance.label}
        </Tag>
      </div>
      <div className="text-kg-xs leading-4 text-text-hint">
        <span>{kind.label}</span>
        <span className="mx-1">·</span>
        <span>{provenance.description}</span>
      </div>
      {/* PR-045：阻断原因前置——批准前即可见被拦原因并跳转异常工作台处理；
          读侧只呈现不执法，批准仍由写门 409 裁决（同一 openBlockersForEdge 判定） */}
      {(edge.blockers?.length ?? 0) > 0 && (
        <div className="space-y-1 rounded-md bg-status-warn-2 px-2 py-1.5 ring-1 ring-status-warn-6" aria-label={EDGE_REVIEW_COPY.BLOCKERS_ARIA}>
          {edge.blockers!.map((blocker, index) => (
            <a
              key={blocker.issueId || `blocker-${index}`}
              href={buildAnomalyHandoffHash({ issueId: blocker.issueId ?? undefined, objectKind: "entity", objectId: blocker.entityId ?? "" })}
              className="block truncate text-kg-xs text-status-warn underline-offset-2 hover:underline"
              title={EDGE_REVIEW_COPY.BLOCKER_LINK_TITLE}
            >
              {edgeReviewBlockerText(blocker.issueKind === "missing_entity" ? EDGE_REVIEW_COPY.BLOCKER_KIND_MISSING_ENTITY : EDGE_REVIEW_COPY.BLOCKER_KIND_UNRECOGNIZED, blocker.entityId)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function relationMeta(type: string) {
  const def = RELATION_TYPES[type];
  // WP-032 红队瑕疵2：正名回落第二实现收编——label 经 relationTypeLabel（口径唯一）
  return {
    label: relationTypeLabel(type),
    description: def?.description ?? EDGE_REVIEW_COPY.UNREGISTERED_RELATION_TYPE,
    color: def
      ? "bg-cyan-2 text-cyan-11 ring-cyan-6"
      : "bg-slate-2 text-text-sub ring-slate-6",
    icon: def ? GitBranch : Link2,
  };
}

// WP-034/PR-149：置信度来源值域的人话映射（裸枚举不上屏；未知值兜底「未标记」——
// 满配钉在 src/test/review-leaks.test.ts：值域加值不登记即红）。
// WP-150：映射值文案收编 review-copy（闭集）；本处沿用既有导出形态（Record＋兜底函数，导入路径不变）。
export const CONFIDENCE_SOURCE_LABEL: Record<string, string> = EDGE_REVIEW_COPY.CONFIDENCE_SOURCE_LABEL;
export function confidenceSourceLabel(raw: unknown): string {
  return typeof raw === "string" && CONFIDENCE_SOURCE_LABEL[raw] ? CONFIDENCE_SOURCE_LABEL[raw] : EDGE_REVIEW_COPY.CONFIDENCE_SOURCE_UNLABELED;
}

function edgeProvenance(edge: PendingEdge) {
  const source = edge.properties?.source;
  const type = edge.type;
  const typeMeta = RELATION_TYPE_PROVENANCE[type];
  if (typeMeta) {
    return {
      ...typeMeta,
      color: PROVENANCE_STYLE[type] ?? DEFAULT_PROVENANCE_STYLE,
      icon: PROVENANCE_ICON[type] ?? Link2,
    };
  }
  if (typeof source === "string" && (RELATION_SOURCE_KEYS as readonly string[]).includes(source)) {
    const meta = relationSourceMeta(source);
    return {
      label: meta.label,
      description: meta.description,
      color: PROVENANCE_STYLE[source] ?? DEFAULT_PROVENANCE_STYLE,
      icon: PROVENANCE_ICON[source] ?? Link2,
    };
  }
  return {
    ...RELATION_TYPE_PROVENANCE_DEFAULT,
    color: DEFAULT_PROVENANCE_STYLE,
    icon: Link2,
  };
}

// WP-032/PR-147：来源文案单源＝域 RelationProvenance（关系类型轴 RELATION_TYPE_PROVENANCE＋
// 来源键轴 relationSourceMeta——同键分叉取域，category-path 两页统一「结构关联」）；
// 本文件只保留呈现层（配色/图标），键与域对齐。
// 键名从生成物驱动（WP-138 R5a·收紧）：双轴全穷尽 Record<ProvenanceKey, V>——关系类型轴
// （单源＝ontology.ts 对生成物 RELATION_TYPES 键集的派生）＋来源说明轴（单源＝域
// RELATION_SOURCE_KEYS）。任一轴新增键而本表未配色、或改名/删名留陈旧键，typecheck 即红。
// 手抄期未入表的 27 键（12 关系＋15 来源）显式补条目，值＝各自运行时兜底
// （DEFAULT_PROVENANCE_STYLE / Link2，补前后渲染 bit 级相同）；联合之外未登记键仍经
// ?? 兜底。跨轴无键碰撞（两轴查找各有关卡把门），补条目不串轴。
type ProvenanceKey = RelationTypeName | (typeof RELATION_SOURCE_KEYS)[number];

const DEFAULT_PROVENANCE_STYLE = "bg-surface-hover/10 text-text-sub ring-mauve-6";

const PROVENANCE_STYLE: Record<string, string> = {
  BELONGS_TO: "bg-sky-2 text-sky-11 ring-sky-6",
  DOCUMENTS: "bg-lime-2 text-lime-11 ring-lime-6",
  REFERENCES: "bg-plum-2 text-plum-11 ring-plum-6",
  DEPENDS_ON: "bg-status-warn-2 text-status-warn ring-status-warn-6",
  HAS_VERSION: "bg-status-fact-2 text-status-fact ring-status-fact-6",
  APPLIES_TO: "bg-accent-bg text-accent-base ring-accent-base/20",
  MENTIONS: "bg-pink-2 text-pink-11 ring-pink-6",
  HAS_SYMPTOM: "bg-orange-2 text-orange-11 ring-orange-6",
  ASSOCIATED_WITH: "bg-teal-2 text-teal-11 ring-teal-6",
  "entity-wikilink": "bg-plum-2 text-plum-11 ring-plum-6",
  "category-path": "bg-sky-2 text-sky-11 ring-sky-6",
  "document-body": "bg-status-warn-2 text-status-warn ring-status-warn-6",
  // 关系轴缺席键显式补条目（值＝?? DEFAULT_PROVENANCE_STYLE 兜底，渲染不变）
  USES: DEFAULT_PROVENANCE_STYLE, RELATED: DEFAULT_PROVENANCE_STYLE,
  BACKS_UP: DEFAULT_PROVENANCE_STYLE, STORES_IN: DEFAULT_PROVENANCE_STYLE,
  CONNECTS_TO: DEFAULT_PROVENANCE_STYLE, INDEXES: DEFAULT_PROVENANCE_STYLE,
  ENCRYPTS: DEFAULT_PROVENANCE_STYLE,
  derivation: DEFAULT_PROVENANCE_STYLE, usage: DEFAULT_PROVENANCE_STYLE,
  reference: DEFAULT_PROVENANCE_STYLE, co_editing: DEFAULT_PROVENANCE_STYLE,
  containment: DEFAULT_PROVENANCE_STYLE,
  // 来源轴缺席键显式补条目（值＝?? DEFAULT_PROVENANCE_STYLE 兜底，渲染不变；键序随 RELATION_SOURCE_KEYS）
  "document-frontmatter": DEFAULT_PROVENANCE_STYLE, "document-body-version": DEFAULT_PROVENANCE_STYLE,
  "concept-body": DEFAULT_PROVENANCE_STYLE, "multi-source-inference": DEFAULT_PROVENANCE_STYLE,
  "plate-aggregation": DEFAULT_PROVENANCE_STYLE, "plate-product-link": DEFAULT_PROVENANCE_STYLE,
  "plate-system-aggregation": DEFAULT_PROVENANCE_STYLE, "plate-version-aggregation": DEFAULT_PROVENANCE_STYLE,
  "canvas-module-alias": DEFAULT_PROVENANCE_STYLE, "auto-discovered": DEFAULT_PROVENANCE_STYLE,
  "extract_graph.py": DEFAULT_PROVENANCE_STYLE, "extract_graph.py v2.0": DEFAULT_PROVENANCE_STYLE,
  "extract_graph.py v2.0 (cache)": DEFAULT_PROVENANCE_STYLE,
  "team-placeholder": DEFAULT_PROVENANCE_STYLE, "team-unassigned": DEFAULT_PROVENANCE_STYLE,
} satisfies Record<ProvenanceKey, string>;

const PROVENANCE_ICON: Record<string, typeof Link2> = {
  BELONGS_TO: Tags,
  DOCUMENTS: FileText,
  REFERENCES: Link2,
  DEPENDS_ON: GitBranch,
  HAS_VERSION: Sparkles,
  APPLIES_TO: GitBranch,
  MENTIONS: Sparkles,
  HAS_SYMPTOM: Tags,
  ASSOCIATED_WITH: Link2,
  "entity-wikilink": FileText,
  "category-path": Tags,
  "document-body": Sparkles,
  // 关系轴缺席键显式补条目（值＝?? Link2 兜底，渲染不变）
  USES: Link2, RELATED: Link2, BACKS_UP: Link2, STORES_IN: Link2,
  CONNECTS_TO: Link2, INDEXES: Link2, ENCRYPTS: Link2,
  derivation: Link2, usage: Link2, reference: Link2, co_editing: Link2, containment: Link2,
  // 来源轴缺席键显式补条目（值＝?? Link2 兜底，渲染不变；键序随 RELATION_SOURCE_KEYS）
  "document-frontmatter": Link2, "document-body-version": Link2, "concept-body": Link2,
  "multi-source-inference": Link2, "plate-aggregation": Link2, "plate-product-link": Link2,
  "plate-system-aggregation": Link2, "plate-version-aggregation": Link2,
  "canvas-module-alias": Link2, "auto-discovered": Link2, "extract_graph.py": Link2,
  "extract_graph.py v2.0": Link2, "extract_graph.py v2.0 (cache)": Link2,
  "team-placeholder": Link2, "team-unassigned": Link2,
} satisfies Record<ProvenanceKey, typeof Link2>;

