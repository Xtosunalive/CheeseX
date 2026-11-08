// RelationLibraryTab — W1 迁移（决策卡 §12.1）：骨架/密度/分页/排序/筛选走 DataTable＋useTableList；
// 三分支空态归因（#1416）原样保留并进基座 empty 插槽；URL 同步（N1 六表之一，key=rel）。
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { REVIEW_STATUS_VALUES, reviewStatusDisplay } from "@/lib/domain/ReviewStatus";
import { useEffect, useMemo } from "react";
import { RotateCcw, FileSearch, Link2, GitBranch, Sparkles, Tags, FileText, ShieldCheck } from "lucide-react";
import { useKnowledgeEdges, useKnowledgeNodes } from "@/lib/topology-store";
import { RELATION_TYPES, relationTypeLabel } from "@/lib/ontology";
import { RELATION_PROVENANCE_GROUP, RELATION_SOURCE_GROUP_ALL, RELATION_SOURCE_GROUPS, RELATION_SOURCE_KEYS, relationSourceMeta, type RelationProvenanceGroup, type RelationSourceGroup } from "@/lib/domain";
import { nodeNameLabel } from "@/lib/domain";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader } from "@/components/table-sort-header";
import { TablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column, TableEmptyProps } from "@/components/data-table/types";
import { useTableList } from "@/hooks/use-table-list";
import { compareZh } from "@/hooks/use-table-sort";
import { Tag } from "@/components/ui/tag";
import { readTableUrlState, writeTableUrlState } from "@/lib/table-url";
import { TERM } from "@/constants/term-const";
import { RELATION_LIBRARY_COPY, relationLibraryCount, relationLibraryNodeNoEdges } from "@/features/data-dashboard/data-dashboard-copy";

/** 三筛选共用「全部」哨兵（属数据非文案——单源 RelationProvenance，按名引用） */
const ALL = RELATION_SOURCE_GROUP_ALL;
const STATE_FILTERS = [ALL, ...REVIEW_STATUS_VALUES] as const;

type SourceGroup = RelationSourceGroup;
type StateFilter = (typeof STATE_FILTERS)[number];
type RelationSortField = "source" | "target" | "type" | "group" | "sourceKey" | "reviewStatus";

type RelationRow = {
  edgeKey: string;
  sourceId: string;
  targetId: string;
  type: string;
  sourceLabel: string;
  targetLabel: string;
  sourceKey: string;
  group: RelationProvenanceGroup;
  metaLabel: string;
  reviewStatus: string;
};

const GROUP_BADGES: Record<RelationProvenanceGroup, { tone: string; icon: typeof Link2 }> = {
  [RELATION_PROVENANCE_GROUP.BODY_REFERENCE]: { tone: "bg-plum-2 text-plum-11 ring-plum-6", icon: FileText },
  [RELATION_PROVENANCE_GROUP.STRUCTURE_LINK]: { tone: "bg-sky-2 text-sky-11 ring-sky-6", icon: Tags },
  [RELATION_PROVENANCE_GROUP.BODY_INFERENCE]: { tone: "bg-status-warn-2 text-status-warn ring-status-warn-6", icon: Sparkles },
  [RELATION_PROVENANCE_GROUP.AGGREGATE_INFERENCE]: { tone: "bg-accent-bg text-accent-base ring-accent-base/20", icon: GitBranch },
  [RELATION_PROVENANCE_GROUP.PLATE_DERIVED]: { tone: "bg-teal-2 text-teal-11 ring-teal-6", icon: Link2 },
  [RELATION_PROVENANCE_GROUP.SYSTEM_SOURCE]: { tone: "bg-surface-hover/10 text-text-sub ring-mauve-6", icon: ShieldCheck },
};

function relationKind(type: string) {
  const def = RELATION_TYPES[type];
  return { label: relationTypeLabel(type), description: def?.description ?? RELATION_LIBRARY_COPY.RELATION_DESC_FALLBACK };
}

// REVIEW-STATUS-001：显示经域单源（review-status）——本文件不再私设状态映射
function stateLabel(state: string) {
  return reviewStatusDisplay(state).label;
}

// tone 亦经域单源（REVIEW-STATUS-001 复查补漏——tone 半副本 STATE_TONE 已删，label+tone 同源 reviewStatusDisplay）

export function RelationLibraryTab() {
  const edges = useKnowledgeEdges();
  const nodes = useKnowledgeNodes();
  const nodeLabels = useMemo(() => new Map(nodes.map((node) => [node.id, nodeNameLabel(node)])), [nodes]);

  const rows = useMemo<RelationRow[]>(() =>
    edges.map((edge) => {
      const rawSource = edge.properties?.source;
      const meta = relationSourceMeta(rawSource);
      const reviewStatus = typeof edge.reviewStatus === "string" ? edge.reviewStatus : "pending";
      return {
        edgeKey: `${edge.source}-${edge.target}-${edge.type}`,
        sourceId: edge.source,
        targetId: edge.target,
        type: edge.type,
        sourceLabel: nodeNameLabel(nodeLabels.get(edge.source)),
        targetLabel: nodeNameLabel(nodeLabels.get(edge.target)),
        sourceKey: typeof rawSource === "string" ? rawSource : "",
        group: meta.group,
        metaLabel: meta.label,
        reviewStatus,
      };
    }), [edges, nodeLabels]);

  const list = useTableList<RelationRow, RelationSortField>({
    rows,
    search: (row, q) =>
      [row.sourceLabel, row.targetLabel, relationTypeLabel(row.type), row.sourceKey, row.metaLabel, row.group]
        .some((v) => String(v || "").toLowerCase().includes(q)),
    filters: {
      group: { values: [], match: (row, v) => row.group === v },
      source: { values: [], match: (row, v) => row.sourceKey === v },
      state: { values: [], match: (row, v) => row.reviewStatus === v }, // REVIEW-STATUS-001：按原始态匹配（曾按有损显示名——待审核混入已生效）
    },
    comparators: {
      source: (a, b) => compareZh(a.sourceLabel, b.sourceLabel),
      target: (a, b) => compareZh(a.targetLabel, b.targetLabel),
      type: (a, b) => compareZh(a.type, b.type),
      group: (a, b) => compareZh(a.group, b.group),
      sourceKey: (a, b) => compareZh(a.sourceKey, b.sourceKey),
      reviewStatus: (a, b) => compareZh(a.reviewStatus, b.reviewStatus),
    },
    initialSort: { field: "source", direction: "asc" },
  });

  const group = (list.filterValues.group?.[0] ?? ALL) as SourceGroup;
  const source = list.filterValues.source?.[0] ?? ALL;
  const state = (list.filterValues.state?.[0] ?? ALL) as StateFilter;
  const setSingle = (key: "group" | "source" | "state", value: string) =>
    list.setFilter(key, value === ALL ? [] : [value]);
  const resetAll = () => {
    list.setQuery("");
    list.clearFilters();
  };
  const hasFilters = list.draftQuery.length > 0 || list.query.length > 0 || group !== ALL || source !== ALL || state !== ALL;

  // URL 同步（N1）：挂载恢复＋条件变更写回（replaceState 不污染回退栈）
  useEffect(() => {
    const restored = readTableUrlState("rel");
    if (restored.query) list.setQuery(restored.query);
    for (const [key, values] of Object.entries(restored.filters ?? {})) {
      if (values.length > 0) list.setFilter(key, values);
    }
    if (restored.sortField && restored.sortDirection) {
      list.setSort(restored.sortField as RelationSortField, restored.sortDirection);
    }
    if (restored.page) list.setPage(restored.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    writeTableUrlState("rel", {
      query: list.query,
      filters: list.filterValues,
      sortField: list.sortField,
      sortDirection: list.sortDirection,
      page: list.page,
    });
  }, [list.query, list.filterValues, list.sortField, list.sortDirection, list.page]);

  // 空态归因（#1416）：三分支——实体已存在无边／全库无边／真无匹配
  const empty = useMemo<TableEmptyProps>(() => {
    const q = list.query.trim().toLowerCase();
    const matchedNode = q ? nodes.find((node) => (node.label || "").toLowerCase().includes(q)) : null;
    if (matchedNode) {
      return {
        icon: FileSearch,
        title: relationLibraryNodeNoEdges(matchedNode.label),
        description: <span className="block">{RELATION_LIBRARY_COPY.EMPTY_NODE_NO_EDGES_DESC}</span>,
      };
    }
    if (edges.length === 0) {
      return {
        icon: FileSearch,
        title: RELATION_LIBRARY_COPY.EMPTY_NO_EDGES_TITLE,
        description: <span className="block">{RELATION_LIBRARY_COPY.EMPTY_NO_EDGES_DESC}</span>,
      };
    }
    return { icon: FileSearch, title: RELATION_LIBRARY_COPY.EMPTY_NO_MATCH };
  }, [list.query, nodes, edges.length]);

  const columns: Array<Column<RelationRow>> = [
    {
      key: "source",
      title: <TableSortHeader label={RELATION_LIBRARY_COPY.COL_SOURCE} active={list.sortField === "source"} direction={list.sortDirection} ascendingLabel={RELATION_LIBRARY_COPY.COL_SOURCE_ASC} descendingLabel={RELATION_LIBRARY_COPY.COL_SOURCE_DESC} onChange={(direction) => list.setSort("source", direction)} />,
      dataIndex: "sourceLabel",
      className: "text-text-main",
    },
    {
      key: "target",
      title: <TableSortHeader label={RELATION_LIBRARY_COPY.COL_TARGET} active={list.sortField === "target"} direction={list.sortDirection} ascendingLabel={RELATION_LIBRARY_COPY.COL_TARGET_ASC} descendingLabel={RELATION_LIBRARY_COPY.COL_TARGET_DESC} onChange={(direction) => list.setSort("target", direction)} />,
      dataIndex: "targetLabel",
      className: "text-text-main",
    },
    {
      key: "type",
      title: <TableSortHeader label={RELATION_LIBRARY_COPY.COL_TYPE} active={list.sortField === "type"} direction={list.sortDirection} ascendingLabel={RELATION_LIBRARY_COPY.COL_TYPE_ASC} descendingLabel={RELATION_LIBRARY_COPY.COL_TYPE_DESC} onChange={(direction) => list.setSort("type", direction)} />,
      render: (row) => {
        const relation = relationKind(row.type);
        return (
          <div className="flex flex-col items-start gap-1">
            <Tag tone="neutral">{relation.label}</Tag>
            <span className="text-xs leading-4 text-text-hint">{relation.description}</span>
          </div>
        );
      },
    },
    {
      key: "group",
      title: <TableSortHeader label={RELATION_LIBRARY_COPY.COL_GROUP} active={list.sortField === "group"} direction={list.sortDirection} ascendingLabel={RELATION_LIBRARY_COPY.COL_GROUP_ASC} descendingLabel={RELATION_LIBRARY_COPY.COL_GROUP_DESC} onChange={(direction) => list.setSort("group", direction)} />,
      render: (row) => {
        const badge = GROUP_BADGES[row.group];
        const Icon = badge.icon;
        return (
          <Tag className={badge.tone}>
            <Icon className="h-3 w-3" />
            {row.group}
          </Tag>
        );
      },
    },
    {
      key: "sourceKey",
      title: <TableSortHeader label={RELATION_LIBRARY_COPY.COL_SOURCE_KEY} active={list.sortField === "sourceKey"} direction={list.sortDirection} ascendingLabel={RELATION_LIBRARY_COPY.COL_SOURCE_KEY_ASC} descendingLabel={RELATION_LIBRARY_COPY.COL_SOURCE_KEY_DESC} onChange={(direction) => list.setSort("sourceKey", direction)} />,
      render: (row) => <span title={relationSourceMeta(row.sourceKey).description}>{row.metaLabel}</span>,
      className: "text-text-hint",
    },
    {
      key: "reviewStatus",
      title: <TableSortHeader label={TERM.REVIEW_STATUS} active={list.sortField === "reviewStatus"} direction={list.sortDirection} ascendingLabel={RELATION_LIBRARY_COPY.COL_STATUS_ASC} descendingLabel={RELATION_LIBRARY_COPY.COL_STATUS_DESC} onChange={(direction) => list.setSort("reviewStatus", direction)} />,
      render: (row) => <Tag tone={reviewStatusDisplay(row.reviewStatus).tone}>{stateLabel(row.reviewStatus)}</Tag>,
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        ariaLabel={RELATION_LIBRARY_COPY.TABLE_ARIA}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.edgeKey}
        empty={empty}
        minWidth={900}
        toolbar={
          <TableToolbar>
            <TableToolbarSearch ariaLabel={RELATION_LIBRARY_COPY.SEARCH_ARIA} placeholder={RELATION_LIBRARY_COPY.SEARCH_PLACEHOLDER} value={list.draftQuery} onChange={(event) => list.setDraftQuery(event.target.value)} onEnter={() => list.applyQuery()} />
            <button type="button" title={RELATION_LIBRARY_COPY.RUN_QUERY} aria-label={RELATION_LIBRARY_COPY.RUN_QUERY} onClick={list.applyQuery} className="h-8 shrink-0 rounded-md px-3 text-xs font-medium text-text-sub ring-1 ring-border-thin transition-colors hover:bg-surface-hover hover:text-text-main">{RELATION_LIBRARY_COPY.QUERY}</button>
            <FilterSelect ariaLabel={RELATION_LIBRARY_COPY.GROUP_FILTER_ARIA} title={RELATION_LIBRARY_COPY.GROUP_FILTER_TITLE} searchPlaceholder={RELATION_LIBRARY_COPY.GROUP_FILTER_ARIA} variant="filter" value={group} onValueChange={(value) => setSingle("group", value as string)} options={RELATION_SOURCE_GROUPS.map((value) => ({ value, label: value === ALL ? RELATION_LIBRARY_COPY.ALL_GROUPS : value, group: RELATION_LIBRARY_COPY.COL_GROUP }))} />
            <FilterSelect ariaLabel={RELATION_LIBRARY_COPY.SOURCE_FILTER_ARIA} title={RELATION_LIBRARY_COPY.SOURCE_FILTER_TITLE} searchPlaceholder={RELATION_LIBRARY_COPY.SOURCE_FILTER_ARIA} variant="filter" value={source} onValueChange={(value) => setSingle("source", value as string)} options={[{ value: ALL, label: RELATION_LIBRARY_COPY.ALL_SOURCES, group: RELATION_LIBRARY_COPY.OPTION_GROUP_SCOPE }, ...RELATION_SOURCE_KEYS.map((value) => ({ value, label: relationSourceMeta(value).label, group: RELATION_LIBRARY_COPY.COL_SOURCE_KEY }))]} />
            <FilterSelect ariaLabel={RELATION_LIBRARY_COPY.STATUS_FILTER_ARIA} title={RELATION_LIBRARY_COPY.STATUS_FILTER_TITLE} searchPlaceholder={RELATION_LIBRARY_COPY.STATUS_FILTER_ARIA} variant="filter" value={state} onValueChange={(value) => setSingle("state", value as string)} options={STATE_FILTERS.map((value) => ({ value, label: value === ALL ? RELATION_LIBRARY_COPY.ALL_STATUSES : stateLabel(value), group: TERM.REVIEW_STATUS }))} />
            <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={TERM.CLEAR_FILTER_ACTION} disabled={!hasFilters} onClick={resetAll} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30"><RotateCcw className="h-4 w-4" /></button>
          </TableToolbar>
        }
        meta={<span className="tabular-nums text-kg-xs text-text-hint">{relationLibraryCount(list.visibleCount, edges.length)}</span>}
        pagination={<TablePagination ariaLabel={RELATION_LIBRARY_COPY.PAGINATION_ARIA} page={list.page} pageSize={list.pageSize} total={list.visibleCount} onPageChange={list.setPage} />}
      />
    </div>
  );
}
