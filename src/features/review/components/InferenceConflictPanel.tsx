// InferenceConflictPanel — W1 迁移（决策卡 §12.1）：骨架/三态/分页/排序/搜索走 DataTable＋useTableList；
// conflictId 深链自动展开（action-routing ②A）原样保留；formatDate 收敛到 formatDateTime（D9）。
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useEffect } from "react";
import { EFFECT_LABELS as SHARED_EFFECT_LABELS } from "@/lib/domain";
import { ChevronDown, ChevronUp, RotateCcw} from "lucide-react";
import { TERM } from "@/constants/term-const";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader } from "@/components/table-sort-header";
import { TablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { useTableList } from "@/hooks/use-table-list";
import { compareZh } from "@/hooks/use-table-sort";
import { Tag } from "@/components/ui/tag";
import { formatDateTime } from "@/lib/format";
import { readTableUrlState, writeTableUrlState } from "@/lib/table-url";
import { getNavQueryParam } from "@/lib/navigation";
import type { InferenceConflict } from "@/features/review/review-types";
import { useInferenceConflictStore } from "@/features/review/inference-conflict-store";
import { INFERENCE_CONFLICT_COPY, REVIEW_COPY, inferenceConflictExpandAria, inferenceConflictMetaText } from "@/features/review/review-copy";

type ConflictSortField = "scope" | "conclusionKey" | "conclusions" | "status" | "resolvedAt";
type ConclusionEffect = InferenceConflict["conclusions"][number]["effect"];

const STATUS_OPTIONS = [
  { value: "all", label: INFERENCE_CONFLICT_COPY.STATUS_ALL, group: INFERENCE_CONFLICT_COPY.GROUP_STATUS },
  { value: "unresolved", label: INFERENCE_CONFLICT_COPY.STATUS_UNRESOLVED, group: INFERENCE_CONFLICT_COPY.GROUP_STATUS },
  { value: "resolved", label: INFERENCE_CONFLICT_COPY.STATUS_RESOLVED, group: INFERENCE_CONFLICT_COPY.GROUP_STATUS },
];

function statusLabel(status: InferenceConflict["status"]) {
  return status === "resolved" ? INFERENCE_CONFLICT_COPY.STATUS_RESOLVED : INFERENCE_CONFLICT_COPY.STATUS_UNRESOLVED;
}

// WP-035：EFFECT 四词单源 lib/domain（本文件原 typed 权威形态提升共享）
export const EFFECT_LABELS: Record<ConclusionEffect, string> = SHARED_EFFECT_LABELS as Record<ConclusionEffect, string>;

function scopeLabel(conflict: InferenceConflict) {
  const scope = conflict.conclusions[0]?.scope;
  return scope ? `${scope.product} ${scope.version}` : INFERENCE_CONFLICT_COPY.SCOPE_FALLBACK;
}

function conclusionLabel(key: string) {
  return key === "architecture-change-disposition" ? INFERENCE_CONFLICT_COPY.CONCLUSION_ARCH_CHANGE : INFERENCE_CONFLICT_COPY.CONCLUSION_BUSINESS;
}

function effectLabels(conflict: InferenceConflict) {
  return [...new Set(conflict.conclusions.map((item) => EFFECT_LABELS[item.effect]))];
}

function ConflictDetail({ conflict }: { conflict: InferenceConflict }) {
  return (
    <div className="space-y-3 px-4 py-3">
      {conflict.status === "unresolved" ? (
        <p className="text-xs text-status-warn">{INFERENCE_CONFLICT_COPY.BLOCKED_NOTE}</p>
      ) : (
        <div className="space-y-1">
          <div className="text-kg-xs text-text-hint">{INFERENCE_CONFLICT_COPY.AUDIT_NOTE}</div>
          <div className="space-y-1">
            <div className="text-kg-xs text-text-hint">{INFERENCE_CONFLICT_COPY.HISTORY_ADOPTED}</div>
            <div className="text-xs text-text-sub">{conflict.decision?.selectedEffect ? EFFECT_LABELS[conflict.decision.selectedEffect] : conflict.resolution || INFERENCE_CONFLICT_COPY.DECISION_UNSTRUCTURED}</div>
            {conflict.decision?.note && <div className="text-kg-xs text-text-hint">{conflict.decision.note}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function InferenceConflictPanel() {
  const store = useInferenceConflictStore();

  useEffect(() => {
    void store.load();
  }, [store.statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // 消费端（2026-10-06 action-routing ②A，Master 裁 A）：URL 携带的 conflictId 自动展开
  // 该条冲突——此前该参数被携带但无人读（门禁抓出的半失效参数：只到页签不定位条目）。
  useEffect(() => {
    const conflictId = getNavQueryParam("conflictId");
    if (conflictId) {
      const exists = store.conflicts.some((c) => c.conflictId === conflictId);
      if (exists && !store.expandedIds.has(conflictId)) store.toggleExpand(conflictId);
    }
  }, [store.conflicts, store.expandedIds, store]);  

  const list = useTableList<InferenceConflict, ConflictSortField>({
    rows: store.conflicts,
    search: (row, q) =>
      [row.subjectNodeId, row.conclusionKey, row.ruleIds.join(" "), row.resolution || "", row.resolvedBy || ""]
        .some((value) => value.toLowerCase().includes(q)),
    filters: {
      status: { values: [], match: (row, value) => row.status === value },
    },
    comparators: {
      scope: (a, b) => compareZh(scopeLabel(a), scopeLabel(b)),
      conclusionKey: (a, b) => compareZh(a.conclusionKey, b.conclusionKey),
      conclusions: (a, b) => compareZh(effectLabels(a).join(","), effectLabels(b).join(",")),
      status: (a, b) => compareZh(a.status, b.status),
      resolvedAt: (a, b) => compareZh(a.resolvedAt || "", b.resolvedAt || ""),
    },
    initialSort: { field: "scope", direction: "asc" },
  });

  // 状态筛选由 store 承载（load 依赖它）——单向同步进 hook 筛选通道
  useEffect(() => {
    list.setFilter("status", store.statusFilter === "all" ? [] : [store.statusFilter]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.statusFilter]);

  // URL 同步（N1 六表之一，key=conf）
  useEffect(() => {
    const restored = readTableUrlState("conf");
    if (restored.query) list.setQuery(restored.query);
    if (restored.sortField && restored.sortDirection) list.setSort(restored.sortField as ConflictSortField, restored.sortDirection);
    if (restored.page) list.setPage(restored.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    writeTableUrlState("conf", {
      query: list.query,
      sortField: list.sortField,
      sortDirection: list.sortDirection,
      page: list.page,
    });
  }, [list.query, list.sortField, list.sortDirection, list.page]);

  const hasFilters = list.query.length > 0 || store.statusFilter !== "all";
  const clearFilters = () => {
    list.setQuery("");
    store.setStatusFilter("all");
  };

  const columns: Array<Column<InferenceConflict>> = [
    {
      key: "scope",
      title: <TableSortHeader label={INFERENCE_CONFLICT_COPY.COL_SCOPE} active={list.sortField === "scope"} direction={list.sortDirection} ascendingLabel={INFERENCE_CONFLICT_COPY.COL_SCOPE_ASC} descendingLabel={INFERENCE_CONFLICT_COPY.COL_SCOPE_DESC} onChange={(direction) => list.setSort("scope", direction)} />,
      render: (row) => scopeLabel(row),
      ellipsis: true,
      className: "max-w-[180px] text-text-main",
    },
    {
      key: "conclusionKey",
      title: <TableSortHeader label={INFERENCE_CONFLICT_COPY.COL_CONCLUSION} active={list.sortField === "conclusionKey"} direction={list.sortDirection} ascendingLabel={INFERENCE_CONFLICT_COPY.COL_CONCLUSION_ASC} descendingLabel={INFERENCE_CONFLICT_COPY.COL_CONCLUSION_DESC} onChange={(direction) => list.setSort("conclusionKey", direction)} />,
      render: (row) => conclusionLabel(row.conclusionKey),
      ellipsis: true,
      className: "max-w-[160px]",
    },
    {
      key: "conclusions",
      title: <TableSortHeader label={INFERENCE_CONFLICT_COPY.COL_CANDIDATES} active={list.sortField === "conclusions"} direction={list.sortDirection} ascendingLabel={INFERENCE_CONFLICT_COPY.COL_CANDIDATES_ASC} descendingLabel={INFERENCE_CONFLICT_COPY.COL_CANDIDATES_DESC} onChange={(direction) => list.setSort("conclusions", direction)} />,
      render: (row) => effectLabels(row).join(" / "),
      className: "max-w-[240px]",
    },
    {
      key: "status",
      title: <TableSortHeader label={INFERENCE_CONFLICT_COPY.COL_STATUS} active={list.sortField === "status"} direction={list.sortDirection} ascendingLabel={INFERENCE_CONFLICT_COPY.COL_STATUS_ASC} descendingLabel={INFERENCE_CONFLICT_COPY.COL_STATUS_DESC} onChange={(direction) => list.setSort("status", direction)} />,
      render: (row) => <Tag tone={row.status === "resolved" ? "neutral" : "warn"}>{statusLabel(row.status)}</Tag>,
    },
    {
      key: "resolvedAt",
      title: <TableSortHeader label={INFERENCE_CONFLICT_COPY.COL_ADOPTED} active={list.sortField === "resolvedAt"} direction={list.sortDirection} ascendingLabel={INFERENCE_CONFLICT_COPY.COL_ADOPTED_ASC} descendingLabel={INFERENCE_CONFLICT_COPY.COL_ADOPTED_DESC} onChange={(direction) => list.setSort("resolvedAt", direction)} />,
      render: (row) => (
        <div>
          <div className="max-w-[220px] truncate text-text-sub">{row.decision?.selectedEffect ? EFFECT_LABELS[row.decision.selectedEffect] : row.resolution || INFERENCE_CONFLICT_COPY.ADOPTED_UNDECIDED}</div>
          <div className="mt-0.5 text-kg-xs text-text-hint">{row.resolvedBy ? `${row.resolvedBy} · ${formatDateTime(row.resolvedAt || "")}` : "—"}</div>
        </div>
      ),
    },
    {
      key: "actions",
      title: INFERENCE_CONFLICT_COPY.COL_ACTIONS,
      align: "right",
      width: 64,
      render: (row) => {
        const expanded = store.expandedIds.has(row.conflictId);
        return (
          <button
            type="button"
            aria-label={inferenceConflictExpandAria(expanded, scopeLabel(row))}
            aria-expanded={expanded}
            onClick={() => store.toggleExpand(row.conflictId)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-text-hint hover:bg-surface-hover hover:text-text-main"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        ariaLabel={INFERENCE_CONFLICT_COPY.TABLE_ARIA}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.conflictId}
        loading={store.status === "loading"}
        error={store.error}
        onRetry={() => void store.load()}
        empty={store.conflicts.length === 0 ? { title: INFERENCE_CONFLICT_COPY.EMPTY_EMPTY } : { title: REVIEW_COPY.EMPTY_NO_MATCH }}
        minWidth={860}
        expandable={{
          rowExpanded: (row) => store.expandedIds.has(row.conflictId),
          onToggle: (row) => store.toggleExpand(row.conflictId),
          render: (row) => <ConflictDetail conflict={row} />,
          toggleColumn: false,
        }}
        toolbar={
          <TableToolbar>
            <TableToolbarSearch ariaLabel={INFERENCE_CONFLICT_COPY.SEARCH_ARIA} placeholder={INFERENCE_CONFLICT_COPY.SEARCH_PLACEHOLDER} value={list.query} onChange={(event) => list.setQuery(event.target.value)} />
            <FilterSelect ariaLabel={INFERENCE_CONFLICT_COPY.FILTER_STATUS_ARIA} title={INFERENCE_CONFLICT_COPY.FILTER_STATUS_TITLE} searchPlaceholder={INFERENCE_CONFLICT_COPY.FILTER_STATUS_SEARCH} variant="filter" value={store.statusFilter} onValueChange={(value) => store.setStatusFilter(value as typeof store.statusFilter)} options={STATUS_OPTIONS} />
            <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={INFERENCE_CONFLICT_COPY.CLEAR_ARIA} disabled={!hasFilters} onClick={clearFilters} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30"><RotateCcw className="h-4 w-4" /></button>
          </TableToolbar>
        }
        meta={<span className="tabular-nums text-kg-xs text-text-hint">{inferenceConflictMetaText(list.visibleCount, store.total)}</span>}
        pagination={<TablePagination ariaLabel={INFERENCE_CONFLICT_COPY.PAGINATION_ARIA} page={list.page} pageSize={list.pageSize} total={list.visibleCount} loading={store.status === "loading"} onPageChange={list.setPage} />}
      />
    </div>
  );
}
