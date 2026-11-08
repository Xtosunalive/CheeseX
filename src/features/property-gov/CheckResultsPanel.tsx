// CheckResultsPanel — 架构组件属性结果列表
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useEffect, useMemo, useState } from "react";
import { CHECK_LABELS, CHECK_RESULTS_COPY, PROPERTY_GOV_SHARED_COPY, checkResultsNoMatchQuery, failedCheckLabels } from "./property-gov-copy";
import { FileSearch} from "lucide-react";
import { ClearFilterButton } from "./property-gov-ui";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader, type TableSortDirection } from "@/components/table-sort-header";
import { TablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { Statistic } from "@/components/statistic/Statistic";
import { StatusDot, type StatusDotTone } from "@/components/status-dot/StatusDot";
import { Tag } from "@/components/ui/tag";
import { TERM } from "@/constants/term-const";
import {
  usePropertyStore,
  useCheckSummary,
  useCheckResults,
  usePropertyLoading,
  usePropertyError,
} from "./property-store";
import type { CheckResultItem, CheckFilter } from "./property-types";
import { ComponentCheckDetail } from "./ComponentCheckDetail";

const PAGE_SIZE = 20; // W1 分页口径统一（决策卡 §十：20 对齐默认；原 30）
type CheckSortField = "name" | "module" | "layer" | "status";

// ── Filter definitions ──

interface FilterOption { key: CheckFilter; label: string; }

const FILTERS: FilterOption[] = [
  { key: "all", label: PROPERTY_GOV_SHARED_COPY.ALL },
  { key: "blocker", label: TERM.BLOCKER },
  { key: "warning", label: TERM.WARNING },
  { key: "missing_module", label: CHECK_LABELS.missing_module },
  { key: "invalid_module", label: CHECK_LABELS.invalid_module },
  // 筛选键 "stale" 是既有过滤行为键（非检查键），标签取 stale_property 的单源文案
  { key: "stale", label: CHECK_LABELS.stale_property },
  { key: "mount_mismatch", label: CHECK_LABELS.mount_mismatch },
  { key: "format_artifact", label: CHECK_LABELS.format_artifact },
  { key: "document_module_entity", label: CHECK_LABELS.document_module_entity },
];

// ── Status helpers ──

type ItemStatus = "blocker" | "warning" | "healthy";

function getItemStatus(item: CheckResultItem): ItemStatus {
  const c = item.checks;
  if (!c.missing_module.passed || !c.invalid_module.passed || !c.mount_mismatch.passed) return "blocker";
  if (c.document_module_entity && !c.document_module_entity.passed) return "blocker";
  if (!c.stale_property.passed || !c.format_artifact.passed) return "warning";
  return "healthy";
}

const STATUS_TONE: Record<ItemStatus, StatusDotTone> = {
  blocker: "error",
  warning: "warn",
  healthy: "fact",
};
const STATUS_LABEL: Record<ItemStatus, string> = {
  blocker: TERM.BLOCKER, warning: TERM.WARNING, healthy: PROPERTY_GOV_SHARED_COPY.PASSED,
};
const STATUS_TEXT: Record<ItemStatus, string> = {
  blocker: "text-status-error", warning: "text-status-warn", healthy: "text-status-fact",
};

// ── Main component ──

export function CheckResultsPanel() {
  const store = usePropertyStore();
  const summary = useCheckSummary();
  const results = useCheckResults();
  const loading = usePropertyLoading();
  const error = usePropertyError();
  const workingRevisions = store.workingRevisions;

  const [q, setQ] = useState(store.query);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<CheckSortField>("name");
  const [sortDirection, setSortDirection] = useState<TableSortDirection>("asc");

  useEffect(() => { store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = (id: string) => setExpandedId((prev) => (prev === id ? null : id));
  const doSearch = () => { store.setQuery(q); setPage(0); void store.load(); };

  const safeResults = useMemo(() => results ?? [], [results]);
  const sortedResults = useMemo(() => [...safeResults].sort((left, right) => {
    const leftStatus = getItemStatus(left);
    const rightStatus = getItemStatus(right);
    const comparison = sortField === "name"
      ? `${left.label || left.componentId} ${left.componentId}`.localeCompare(`${right.label || right.componentId} ${right.componentId}`, "zh-CN")
      : sortField === "module"
        ? (left.module || "").localeCompare(right.module || "", "zh-CN")
        : sortField === "layer"
          ? (left.archLayer || "").localeCompare(right.archLayer || "", "zh-CN")
          : leftStatus.localeCompare(rightStatus, "zh-CN");
    return sortDirection === "asc" ? comparison : -comparison;
  }), [safeResults, sortDirection, sortField]);
  const paginated = sortedResults.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const showEmpty = safeResults.length === 0 && !loading;
  const filterOptions = FILTERS.map((option) => ({
    value: option.key === "all" ? "" : option.key,
    label: option.label,
    group: option.key === "all" ? PROPERTY_GOV_SHARED_COPY.SCOPE_GROUP : ["blocker", "warning"].includes(option.key) ? CHECK_RESULTS_COPY.FILTER_GROUP_SEVERITY : CHECK_RESULTS_COPY.FILTER_GROUP_CHECK,
  }));
  const hasFilters = q.length > 0 || store.filter !== "all";
  const clearFilters = () => {
    setQ("");
    store.setQuery("");
    setPage(0);
    if (store.filter === "all") void store.load();
    else store.setFilter("all");
  };

  const columns: Array<Column<CheckResultItem>> = [
    {
      key: "name",
      title: <TableSortHeader label={CHECK_RESULTS_COPY.COL_NAME} active={sortField === "name"} direction={sortDirection} ascendingLabel={CHECK_RESULTS_COPY.COL_NAME_ASC} descendingLabel={CHECK_RESULTS_COPY.COL_NAME_DESC} onChange={(direction) => { setSortField("name"); setSortDirection(direction); }} />,
      render: (item) => {
        const status = getItemStatus(item);
        const isExpanded = expandedId === item.componentId;
        return (
          <button type="button" aria-label={`${isExpanded ? TERM.COLLAPSE_ACTION : TERM.EXPAND_ACTION} ${item.label || item.componentId}`} aria-expanded={isExpanded} onClick={() => toggleExpand(item.componentId)} className="flex min-w-0 items-center gap-2 text-left text-text-main hover:text-accent-base">
            <StatusDot tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
            <span className="truncate font-mono text-xs font-medium">{item.label || item.componentId}</span>
          </button>
        );
      },
      width: "48%",
    },
    {
      key: "module",
      title: <TableSortHeader label={CHECK_RESULTS_COPY.COL_MODULE} active={sortField === "module"} direction={sortDirection} ascendingLabel={CHECK_RESULTS_COPY.COL_MODULE_ASC} descendingLabel={CHECK_RESULTS_COPY.COL_MODULE_DESC} onChange={(direction) => { setSortField("module"); setSortDirection(direction); }} />,
      render: (item) => item.module || "—",
      align: "right",
      ellipsis: true,
      width: 128,
      className: "font-mono text-kg-xs text-text-hint",
    },
    {
      key: "layer",
      title: <TableSortHeader label={TERM.LAYER} active={sortField === "layer"} direction={sortDirection} ascendingLabel={CHECK_RESULTS_COPY.COL_LAYER_ASC} descendingLabel={CHECK_RESULTS_COPY.COL_LAYER_DESC} onChange={(direction) => { setSortField("layer"); setSortDirection(direction); }} />,
      render: (item) => item.archLayer || "—",
      align: "right",
      ellipsis: true,
      width: 112,
      className: "font-mono text-kg-xs text-text-hint",
    },
    {
      key: "status",
      title: <TableSortHeader label={CHECK_RESULTS_COPY.COL_STATUS} active={sortField === "status"} direction={sortDirection} ascendingLabel={CHECK_RESULTS_COPY.COL_STATUS_ASC} descendingLabel={CHECK_RESULTS_COPY.COL_STATUS_DESC} onChange={(direction) => { setSortField("status"); setSortDirection(direction); }} />,
      render: (item) => {
        const status = getItemStatus(item);
        return <span className={`font-mono text-kg-xs ${STATUS_TEXT[status]}`}>{STATUS_LABEL[status]}</span>;
      },
      align: "right",
      width: 96,
    },
  ];

  return (
    <div className="space-y-3">
      {/* WP-033：校验信息收纳（照 AnomalyPeekPanel 折叠范式）——工作副本 revision 哈希仅供
          防篡改对账（与写回 409 同判定），非日常信息：默认收起、悬浮显全文、不再常显主界面。 */}
      <details className="rounded-lg bg-surface-root ring-1 ring-border-thin" data-testid="property-working-revisions">
        <summary className="cursor-pointer select-none px-3 py-2 text-kg-xs text-text-hint">
          {CHECK_RESULTS_COPY.WORKING_REV_SUMMARY}<span className="ml-1 font-normal">{CHECK_RESULTS_COPY.WORKING_REV_COLLAPSED_HINT}</span>
        </summary>
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-kg-xs text-text-hint">
          {Object.entries(workingRevisions).length > 0
            ? Object.entries(workingRevisions).map(([name, revision]) => (
              <span key={name} title={revision ?? CHECK_RESULTS_COPY.REVISION_UNAVAILABLE_TITLE} className="font-mono">{name}: {typeof revision === "string" ? revision.replace("sha256:", "").slice(0, 10) : CHECK_RESULTS_COPY.REVISION_UNAVAILABLE}</span>
            ))
            : <span>{CHECK_RESULTS_COPY.WORKING_REV_MISSING}</span>}
        </div>
      </details>
      {store.lastApplySummary && (
        <p className="rounded-lg bg-status-fact-2 px-3 py-2 text-xs text-status-fact ring-1 ring-status-fact-6" role="status">
          {CHECK_RESULTS_COPY.APPLIED_PREFIX}<span className="font-mono">{store.lastApplySummary}</span>
        </p>
      )}
      {/* ── Summary ── */}
      {summary && (
        <div data-testid="property-check-summary" className="space-y-1.5">
          <div className="px-0.5 text-kg-xs font-medium text-text-hint">{CHECK_RESULTS_COPY.SUMMARY_TITLE}</div>
          <div data-testid="property-check-summary-grid" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-4">
            <Statistic testId="property-check-stat" label={CHECK_RESULTS_COPY.STAT_COVERAGE_LABEL} value={`${(summary.coverageRatio * 100).toFixed(0)}%`} tone={summary.coverageRatio >= 0.8 ? "text-status-fact" : "text-status-warn"}
              hint={CHECK_RESULTS_COPY.STAT_COVERAGE_HINT} />
            <Statistic testId="property-check-stat" label={CHECK_RESULTS_COPY.STAT_BLOCKER_LABEL} value={summary.blockerCount} tone={summary.blockerCount > 0 ? "text-status-error" : "text-status-fact"}
              hint={CHECK_RESULTS_COPY.STAT_BLOCKER_HINT} />
            <Statistic testId="property-check-stat" label={CHECK_RESULTS_COPY.STAT_WARNING_LABEL} value={summary.warningCount} tone={summary.warningCount > 0 ? "text-status-warn" : "text-status-fact"}
              hint={CHECK_RESULTS_COPY.STAT_WARNING_HINT} />
            <Statistic testId="property-check-stat" label={CHECK_RESULTS_COPY.STAT_TOTAL_LABEL} value={summary.totalComponents} tone="text-text-sub"
              hint={CHECK_RESULTS_COPY.STAT_TOTAL_HINT} />
          </div>
        </div>
      )}

      <TableToolbar testId="property-check-toolbar">
        <TableToolbarSearch ariaLabel={CHECK_RESULTS_COPY.SEARCH_ARIA} placeholder={CHECK_RESULTS_COPY.SEARCH_PLACEHOLDER} value={q} onChange={(event) => setQ(event.target.value)} onEnter={() => doSearch()} />
        <FilterSelect ariaLabel={CHECK_RESULTS_COPY.FILTER_ARIA} title={CHECK_RESULTS_COPY.FILTER_TITLE} searchPlaceholder={CHECK_RESULTS_COPY.FILTER_SEARCH} variant="filter" value={store.filter === "all" ? "" : store.filter} onValueChange={(value) => { store.setFilter(((value as string) || "all") as CheckFilter); setPage(0); }} emptyTriggerLabel={CHECK_RESULTS_COPY.FILTER_TRIGGER} placeholder={CHECK_RESULTS_COPY.FILTER_TRIGGER} options={filterOptions} />
        <ClearFilterButton label={CHECK_RESULTS_COPY.CLEAR_FILTERS} disabled={!hasFilters} onClick={clearFilters} />
      </TableToolbar>

      {/* ── Error ── */}
      {error && (
        <div className="rounded ring-1 ring-status-error-6 bg-status-error-2 px-3 py-2 font-mono text-xs text-status-error">
          {error}
          <button onClick={() => store.load()} className="ml-2 underline text-status-error">{TERM.RETRY_ACTION}</button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && !summary && (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-text-hint">{CHECK_RESULTS_COPY.LOADING}</p>
        </div>
      )}

      <DataTable
        ariaLabel={CHECK_RESULTS_COPY.TABLE_ARIA}
        columns={columns}
        rows={showEmpty ? [] : paginated}
        rowKey={(item) => item.componentId}
        loading={loading && Boolean(summary)}
        empty={{
          icon: FileSearch,
          title: <span className="text-sm font-medium text-text-sub">{CHECK_RESULTS_COPY.EMPTY_TITLE}</span>,
          description: (
            <span className="mx-auto block max-w-[340px] text-xs leading-relaxed">
              {q.trim()
                ? checkResultsNoMatchQuery(q)
                : store.filter !== "all"
                  ? PROPERTY_GOV_SHARED_COPY.NO_FILTER_RESULT
                  : CHECK_RESULTS_COPY.EMPTY_ALL_PASSED}
            </span>
          ),
        }}
        minWidth={680}
        expandable={{
          rowExpanded: (item) => expandedId === item.componentId,
          onToggle: (item) => toggleExpand(item.componentId),
          render: (item) => <ExpandedDetail item={item} />,
          toggleColumn: false,
        }}
        pagination={showEmpty ? undefined : <TablePagination ariaLabel={CHECK_RESULTS_COPY.PAGINATION_ARIA} page={page} pageSize={PAGE_SIZE} total={safeResults.length} loading={loading} onPageChange={setPage} />}
      />
    </div>
  );
}

// ── 展开详情（W1：原内联块抽出，徽章换 ui/tag）──

function ExpandedDetail({ item }: { item: CheckResultItem }) {
  const c = item.checks;
  const failedChecks = failedCheckLabels(c);
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap gap-1">
        {failedChecks.length > 0
          ? failedChecks.map((f) => (
              <Tag key={f} tone="error" className="font-mono text-kg-2xs">{f}</Tag>
            ))
          : <Tag tone="fact" className="font-mono text-kg-2xs">{CHECK_RESULTS_COPY.ALL_PASSED}</Tag>}
      </div>
      <ComponentCheckDetail item={item} />
    </div>
  );
}
