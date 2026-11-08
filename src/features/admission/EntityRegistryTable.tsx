// EntityRegistryTable — Tab 1: 实体多维大表
// QA-style filter panel: edit conditions → "查询" button or Enter to apply.

import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, CheckCircle, ChevronDown, FileSearch, Filter, Plus, X, RotateCcw } from "lucide-react";
import { useRegistryItems, useOpenDrawer } from "./admission-store";
import { type EntityRegistryItem } from "./admission-types";
import { admissionStatusDisplay } from "@/lib/domain/StatusDisplay";
import { TERM } from "@/constants/term-const";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader, type TableSortDirection } from "@/components/table-sort-header";
import { TablePagination, useTablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { Tag } from "@/components/ui/tag";
import { RowActions } from "@/components/row-actions/RowActions";
import { Statistic } from "@/components/statistic/Statistic";
import { ENTITY_CATEGORY, ENTITY_CATEGORY_ALIAS } from "@/lib/domain/EntityCategory";
import { ADMISSION_COPY, ENTITY_REGISTRY_COPY, registryFieldSelectAria, registryOpSelectAria, registryRemoveConditionAria, registryRowActionsAria, registryViewAction, registryVisibleCount } from "./admission-copy";

// ── QA-style filter engine ──

type FilterOp = "contains" | "eq" | "neq" | "not_contains";

interface ColumnFilter {
  field: string;       // __all__ | keyof EntityRegistryItem
  op: FilterOp;
  value: string;
}

type RegistrySortField = "componentName" | "layer" | "category" | "articlePath" | "admissionStatus";

const OP_LABELS: Record<FilterOp, string> = {
  contains: ENTITY_REGISTRY_COPY.OP_CONTAINS,
  eq: ENTITY_REGISTRY_COPY.OP_EQ,
  neq: ENTITY_REGISTRY_COPY.OP_NEQ,
  not_contains: ENTITY_REGISTRY_COPY.OP_NOT_CONTAINS,
};

const SEARCHABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "__all__", label: ENTITY_REGISTRY_COPY.ALL_FIELDS },
  { key: "componentName", label: ENTITY_REGISTRY_COPY.COMPONENT_NAME },
  { key: "layer", label: TERM.LAYER },
  { key: "category", label: TERM.CATEGORY },
  { key: "articlePath", label: TERM.GRAPH_SOURCE_DOCUMENT },
  { key: "admissionStatus", label: ADMISSION_COPY.ADMISSION_STATUS },
];

// ── Category color map（键＝类别数据值，按名引用 EntityCategory 单源；智能服务为存量别名原值着色）──

const CATEGORY_COLOR: Record<string, string> = {
  [ENTITY_CATEGORY.SERVICE]: "bg-blue-2 text-blue-11 ring-blue-6",
  [ENTITY_CATEGORY.INFRASTRUCTURE]: "bg-accent-bg text-accent-base ring-accent-base/20",
  [ENTITY_CATEGORY.SECURITY]: "bg-status-error-2 text-status-error ring-status-error-6",
  [ENTITY_CATEGORY.TERMINAL]: "bg-status-fact-2 text-status-fact ring-status-fact-6",
  [ENTITY_CATEGORY.DOMAIN]: "bg-status-warn-2 text-status-warn ring-status-warn-6",
  [ENTITY_CATEGORY.STORAGE]: "bg-status-error-2 text-status-error ring-status-error-6",
  [ENTITY_CATEGORY_ALIAS.SMART_SERVICE]: "bg-teal-2 text-teal-11 ring-teal-6",
  [ENTITY_CATEGORY.VERSION]: "bg-cyan-2 text-cyan-11 ring-cyan-6",
  [ENTITY_CATEGORY.PRODUCT]: "bg-orange-2 text-orange-11 ring-orange-6",
  [ENTITY_CATEGORY.OTHER]: "bg-slate-2 text-text-sub ring-slate-6",
};

// ── Filter helpers ──

function matchesOp(itemVal: string, q: string, op: FilterOp): boolean {
  const v = itemVal.toLowerCase();
  const query = q.toLowerCase();
  switch (op) {
    case "contains": return v.includes(query);
    case "eq": return v === query;
    case "neq": return v !== query;
    case "not_contains": return !v.includes(query);
  }
}

function getColumnValue(item: EntityRegistryItem, field: keyof EntityRegistryItem): string {
  const val = item[field];
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "false";
  return String(val);
}

/** Collect all searchable column values into one string for __all__ search */
function getAllColumnText(item: EntityRegistryItem): string {
  return ["componentName", "layer", "category", "articlePath", "admissionStatus"]
    .map((k) => getColumnValue(item, k as keyof EntityRegistryItem))
    .join(" ");
}

// ══════════════════════════════════════════════════════════════

export function EntityRegistryTable() {
  const items = useRegistryItems();
  const onOpen = useOpenDrawer();

  // ── Draft filters — default: one "全部字段" condition visible on open ──
  const [draftFilters, setDraftFilters] = useState<ColumnFilter[]>([
    { field: "__all__", op: "contains", value: "" },
  ]);
  const [appliedFilters, setAppliedFilters] = useState<ColumnFilter[]>([]);
  const [quickQuery, setQuickQuery] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [sortField, setSortField] = useState<RegistrySortField>("componentName");
  const [sortDirection, setSortDirection] = useState<TableSortDirection>("asc");

  const addFilter = () =>
    setDraftFilters((prev) => {
      const next: ColumnFilter[] = [...prev, { field: "__all__", op: "contains", value: "" }];
      draftFiltersRef.current = next;
      return next;
    });
  const removeFilter = (i: number) =>
    setDraftFilters((prev) => {
      const next = prev.filter((_, j) => j !== i);
      draftFiltersRef.current = next;
      return next;
    });
  const updateFilter = (i: number, k: keyof ColumnFilter, v: string) =>
    setDraftFilters((prev) => {
      const next = prev.map((c, j) => (j === i ? { ...c, [k]: v } : c));
      draftFiltersRef.current = next;
      return next;
    });

  // Ref keeps latest draftFilters — updated synchronously in every setter above.
  // useEffect fallback for any edge case (first render, etc).
  const draftFiltersRef = useRef(draftFilters);
  useEffect(() => { draftFiltersRef.current = draftFilters; }, [draftFilters]);

  const applyFilters = useCallback(() => {
    const active = draftFiltersRef.current.filter((f) => f.value.trim());
    setAppliedFilters(active);
  }, []); // stable ref — never stale

  const resetAll = () => {
    setDraftFilters([{ field: "__all__", op: "contains", value: "" }]);
    setAppliedFilters([]);
    setQuickQuery("");
  };

  // Enter key anywhere in panel → apply
  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") applyFilters();
  };

  // ── Filter logic: appliedFilters ANDed, __all__ matches any column ──
  const filtered = useMemo(() => {
    const normalizedQuickQuery = quickQuery.trim().toLowerCase();
    if (appliedFilters.length === 0 && !normalizedQuickQuery) return items;
    return items.filter((item) => {
      if (normalizedQuickQuery && !getAllColumnText(item).toLowerCase().includes(normalizedQuickQuery)) return false;
      for (const f of appliedFilters) {
        const haystack = f.field === "__all__"
          ? getAllColumnText(item)
          : getColumnValue(item, f.field as keyof EntityRegistryItem);
        if (!matchesOp(haystack, f.value, f.op)) return false;
      }
      return true;
    });
  }, [appliedFilters, items, quickQuery]);

  const sorted = useMemo(() => [...filtered].sort((left, right) => {
    const comparison = getColumnValue(left, sortField).localeCompare(getColumnValue(right, sortField), "zh-CN");
    return sortDirection === "asc" ? comparison : -comparison;
  }), [filtered, sortDirection, sortField]);
  const { page, pageItems, pageSize, setPage } = useTablePagination(sorted);

  const approvedCount = items.filter((i) => i.admissionStatus === "APPROVED").length;
  const passRate =
    items.length > 0 ? `${Math.round((approvedCount / items.length) * 100)}%` : "--";
  const activeFilterCount = appliedFilters.length + (quickQuery.trim() ? 1 : 0);

  const columns: Array<Column<EntityRegistryItem>> = [
    {
      key: "componentName",
      title: <TableSortHeader label={ENTITY_REGISTRY_COPY.COMPONENT_NAME} active={sortField === "componentName"} direction={sortDirection} ascendingLabel={ENTITY_REGISTRY_COPY.NAME_ASC} descendingLabel={ENTITY_REGISTRY_COPY.NAME_DESC} onChange={(direction) => { setSortField("componentName"); setSortDirection(direction); }} />,
      dataIndex: "componentName",
      className: "font-semibold text-text-main",
    },
    {
      key: "layer",
      title: <TableSortHeader label={TERM.LAYER} active={sortField === "layer"} direction={sortDirection} ascendingLabel={ENTITY_REGISTRY_COPY.LAYER_ASC} descendingLabel={ENTITY_REGISTRY_COPY.LAYER_DESC} onChange={(direction) => { setSortField("layer"); setSortDirection(direction); }} />,
      render: (item) => <Tag tone="neutral" className="font-mono">{item.layer}</Tag>,
    },
    {
      key: "category",
      title: <TableSortHeader label={TERM.CATEGORY} active={sortField === "category"} direction={sortDirection} ascendingLabel={ENTITY_REGISTRY_COPY.CATEGORY_ASC} descendingLabel={ENTITY_REGISTRY_COPY.CATEGORY_DESC} onChange={(direction) => { setSortField("category"); setSortDirection(direction); }} />,
      render: (item) => <Tag className={`font-medium ${CATEGORY_COLOR[item.category] || "bg-slate-2 text-text-sub ring-slate-6"}`}>{item.category}</Tag>,
    },
    {
      key: "articlePath",
      title: <TableSortHeader label={TERM.GRAPH_SOURCE_DOCUMENT} active={sortField === "articlePath"} direction={sortDirection} ascendingLabel={ENTITY_REGISTRY_COPY.DOC_ASC} descendingLabel={ENTITY_REGISTRY_COPY.DOC_DESC} onChange={(direction) => { setSortField("articlePath"); setSortDirection(direction); }} />,
      render: (item) => item.articlePath
        ? <span className="inline-block max-w-[150px] truncate font-mono text-text-hint">.../{item.articlePath.split("/").slice(-1)[0]}</span>
        : <span className="text-text-placeholder">—</span>,
    },
    {
      key: "admissionStatus",
      title: <TableSortHeader label={ADMISSION_COPY.ADMISSION_STATUS} active={sortField === "admissionStatus"} direction={sortDirection} ascendingLabel={ENTITY_REGISTRY_COPY.STATUS_ASC} descendingLabel={ENTITY_REGISTRY_COPY.STATUS_DESC} onChange={(direction) => { setSortField("admissionStatus"); setSortDirection(direction); }} />,
      render: (item) => {
        const display = admissionStatusDisplay(item.admissionStatus);
        return <Tag tone={display.tone}><CheckCircle className="h-3 w-3" />{display.label}</Tag>;
      },
    },
    {
      key: "detail",
      title: ADMISSION_COPY.SOURCE_DOC_DETAIL,
      align: "right",
      render: (item) => (
        <RowActions
          row={item}
          actions={[{ key: "view", label: registryViewAction(item.componentName), onRun: () => onOpen(item.entityId), icon: FileSearch }]}
          ariaLabel={registryRowActionsAria(item.componentName)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <TableToolbar testId="admission-filter-toolbar">
        <TableToolbarSearch ariaLabel={ENTITY_REGISTRY_COPY.SEARCH_ARIA} placeholder={ENTITY_REGISTRY_COPY.SEARCH_PLACEHOLDER} value={quickQuery} onChange={(event) => setQuickQuery(event.target.value)} />
        <button
          type="button"
          aria-label={ENTITY_REGISTRY_COPY.ADVANCED_FILTER}
          aria-expanded={showPanel}
          onClick={() => setShowPanel(!showPanel)}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${
            showPanel
              ? "bg-surface-hover text-text-main ring-1 ring-border-thin"
              : "text-text-sub hover:bg-surface-hover hover:text-text-main"
          }`}
        >
          <Filter className="h-4 w-4" />
          <span>{ENTITY_REGISTRY_COPY.ADVANCED_FILTER}</span>
          {activeFilterCount > 0 && (
            <span className="rounded-sm bg-accent-bg px-1.5 py-0.5 text-kg-xs leading-none text-accent-base">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown className={`h-4 w-4 transition-transform ${showPanel ? "rotate-180" : ""}`} />
        </button>
        <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={ENTITY_REGISTRY_COPY.CLEAR_FILTER_ARIA} disabled={activeFilterCount === 0} onClick={resetAll} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30">
          <RotateCcw className="h-4 w-4" />
        </button>
      </TableToolbar>

      <div className="flex items-center justify-between px-1 text-kg-xs text-text-hint">
        {items.length > 0 && <span>{registryVisibleCount(sorted.length, items.length)}</span>}
        <div className="flex items-center gap-1.5">
          <Statistic label={ENTITY_REGISTRY_COPY.PASS_RATE_LABEL} value={passRate} tone="text-status-fact font-mono" />
        </div>
      </div>

      {/* ── QA-style advanced filter panel ── */}
      {showPanel && (
        <div
          className="space-y-2 rounded-lg bg-surface-root p-3 ring-1 ring-border-thin"
          onKeyDown={handlePanelKeyDown}
        >
          {draftFilters.length === 0 && (
            <p className="text-xs text-text-hint">{ENTITY_REGISTRY_COPY.NO_CONDITIONS}</p>
          )}
          {draftFilters.map((f, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[144px_112px_minmax(180px,1fr)_32px]">
              {/* Field select */}
              <FilterSelect ariaLabel={registryFieldSelectAria(i + 1)} title={ENTITY_REGISTRY_COPY.FIELD_SELECT_TITLE} searchPlaceholder={ENTITY_REGISTRY_COPY.FIELD_SELECT_SEARCH} value={f.field} onValueChange={(value) => updateFilter(i, "field", value as string)} className="h-8 w-full rounded text-xs" options={SEARCHABLE_COLUMNS.map((col) => ({ value: col.key, label: col.label, group: ENTITY_REGISTRY_COPY.FIELD_OPTION_GROUP }))} />

              {/* Operator select */}
              <FilterSelect ariaLabel={registryOpSelectAria(i + 1)} title={ENTITY_REGISTRY_COPY.OP_SELECT_TITLE} searchPlaceholder={ENTITY_REGISTRY_COPY.OP_SELECT_SEARCH} value={f.op} onValueChange={(value) => updateFilter(i, "op", value as FilterOp)} className="h-8 w-full rounded text-xs" options={(Object.entries(OP_LABELS) as [FilterOp, string][]).map(([key, label]) => ({ value: key, label, group: ENTITY_REGISTRY_COPY.OP_OPTION_GROUP }))} />

              {/* Value input */}
              <input
                type="text"
                value={f.value}
                onChange={(e) => updateFilter(i, "value", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder={ENTITY_REGISTRY_COPY.VALUE_PLACEHOLDER}
                className="h-8 min-w-0 rounded bg-surface-root px-2 text-xs text-text-main outline-none ring-1 ring-border-thin placeholder:text-text-hint focus:ring-border-focus"
              />

              {/* Remove */}
              <button
                onClick={() => removeFilter(i)}
                aria-label={registryRemoveConditionAria(i + 1)}
                className="flex h-8 w-8 items-center justify-center justify-self-end rounded text-text-hint transition hover:bg-surface-hover hover:text-text-main md:justify-self-auto"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={applyFilters}
              className="flex h-8 items-center gap-1 rounded bg-accent-base px-3 text-xs font-medium text-accent-contrast transition hover:opacity-90"
            >
              <Search className="h-4 w-4" /> {ENTITY_REGISTRY_COPY.APPLY_FILTERS}
            </button>
            <button
              onClick={addFilter}
              className="flex h-8 items-center gap-1 rounded px-2.5 text-xs text-text-sub ring-1 ring-border-thin transition hover:bg-surface-hover hover:text-text-main"
            >
              <Plus className="h-3 w-3" /> {ENTITY_REGISTRY_COPY.ADD_CONDITION}
            </button>
            <button
              onClick={resetAll}
              className="flex h-8 items-center gap-1 rounded px-2.5 text-xs text-text-hint ring-1 ring-border-thin transition hover:bg-surface-hover hover:text-text-main"
            >
              <RotateCcw className="h-3 w-3" /> {ENTITY_REGISTRY_COPY.CLEAR_ALL}
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <DataTable
        ariaLabel={ENTITY_REGISTRY_COPY.TABLE_ARIA}
        columns={columns}
        rows={pageItems}
        rowKey={(item) => item.entityId}
        empty={items.length === 0 ? {
          // WP-037 P4 红队修：全量 0＝no-data（引导），不再是错用的筛选话术
          icon: Search, title: <span className="text-sm font-medium text-text-sub">{ENTITY_REGISTRY_COPY.EMPTY_NO_ITEMS}</span>,
        } : {
          icon: Search, title: <span className="text-sm font-medium text-text-sub">{ENTITY_REGISTRY_COPY.EMPTY_NO_MATCH}</span>,
          description: <span className="mx-auto block max-w-[340px] text-xs leading-relaxed">{ENTITY_REGISTRY_COPY.EMPTY_NO_MATCH_DESC}</span>,
        }}
        minWidth={900}
        pagination={<TablePagination ariaLabel={ENTITY_REGISTRY_COPY.PAGINATION_ARIA} page={page} pageSize={pageSize} total={sorted.length} onPageChange={setPage} />}
      />
    </div>
  );
}
