// AnomalyIssueForm — W2 迁移（决策卡 §12.1）：骨架/密度/筛选/排序/分页走 DataTable＋useTableList；
// rowSpan 来源分组走基座 groupOf（组首行合并单元格＋span 组级计数）；行点击键盘可达（O3）；
// 来源链接 stopPropagation 选中隔离原样保留；问题类型徽章换 ui/tag（D6）。
import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useEffect, useMemo, useRef } from "react";
import { TERM } from "@/constants/term-const";
import { ExternalLink, HelpCircle, RotateCcw} from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { ObsidianLink } from "@/components/obsidian";
import { TablePagination } from "@/components/table-pagination";
import { TableSortHeader } from "@/components/table-sort-header";
import { DataTable } from "@/components/data-table/DataTable";
import { Panel } from "@/components/panel";
import type { Column } from "@/components/data-table/types";
import { useTableList } from "@/hooks/use-table-list";
import { Tag } from "@/components/ui/tag";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { evidencePath, evidencePathPresentation, fieldLabel, issueKindLabel, record, statusLabel, valueLabel, statusTone, ANOMALY_ISSUE_FORM_COPY, anomalyIssueCountText, anomalyIssueFormMetaText } from "@/features/anomaly-workbench/anomaly-workbench-copy";

type IssueSortField = "field" | "path" | "kind" | "current" | "expected" | "status";

function issueField(issue: AnomalyIssue) {
  const action = record(issue.proposedAction);
  if (typeof action.field === "string" && action.field.trim()) return fieldLabel(action.field);
  if (typeof action.group === "string" && action.group.trim()) return action.group;
  return issue.title;
}

function issueRow(issue: AnomalyIssue) {
  const action = record(issue.proposedAction);
  const expected = action.expected ?? (Array.isArray(action.allowedValues) && action.allowedValues.length ? action.allowedValues : null);
  const primaryLabel = issueField(issue);
  return {
    issue,
    action,
    field: primaryLabel,
    primaryLabel,
    detailLabel: typeof action.group === "string" ? action.group : issue.title,
    path: evidencePath(issue),
    kind: issueKindLabel(issue.issueKind),
    current: valueLabel(action.currentValue),
    expected: valueLabel(expected),
    status: statusLabel(issue.status),
  };
}

type IssueRow = ReturnType<typeof issueRow>;

export function AnomalyIssueForm({ issues, selectedIssueId, onSelect }: { issues: AnomalyIssue[]; selectedIssueId: string | null; onSelect: (issueId: string) => void }) {
  const rows = useMemo(() => issues.map(issueRow), [issues]);

  const list = useTableList<IssueRow, IssueSortField>({
    rows,
    search: (row, q) =>
      [row.primaryLabel, row.detailLabel, row.path, row.kind, row.current, row.expected, row.action.hint, row.status]
        .some((value) => String(value || "").toLowerCase().includes(q)),
    filters: {
      path: { values: [], match: (row, value) => row.path === value },
      kind: { values: [], match: (row, value) => row.issue.issueKind === value },
      status: { values: [], match: (row, value) => row.issue.status === value },
    },
    // 非 path 字段排序时先按来源路径稳定分组，再比字段值（迁移前口径；
    // desc 时组序随方向反转——useTableList 统一取反语义，非契约钉死项）
    comparators: {
      path: (left, right) =>
        left.path.localeCompare(right.path, "zh-CN", { numeric: true }) || left.issue.issueId.localeCompare(right.issue.issueId),
      field: withPathGrouping((row) => row.field),
      kind: withPathGrouping((row) => row.kind),
      current: withPathGrouping((row) => row.current),
      expected: withPathGrouping((row) => row.expected),
      status: withPathGrouping((row) => row.status),
    },
    initialSort: { field: "path", direction: "asc" },
  });

  // 议题集合变化（新议题进场）时清空搜索与筛选，防陈旧过滤遮挡
  const issueSignature = issues.map((issue) => issue.issueId).sort().join("\n");
  const previousIssueSignature = useRef(issueSignature);
  useEffect(() => {
    if (previousIssueSignature.current === issueSignature) return;
    previousIssueSignature.current = issueSignature;
    list.setQuery("");
    list.clearFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueSignature]);

  const pathOptions = useMemo(() => [...new Set(rows.map((row) => row.path))].sort((left, right) => left.localeCompare(right, "zh-CN")), [rows]);
  const kindOptions = useMemo(() => [...new Map(rows.map((row) => [row.issue.issueKind, row.kind])).entries()].sort((left, right) => left[1].localeCompare(right[1], "zh-CN")), [rows]);
  const statusOptions = useMemo(() => [...new Map(rows.map((row) => [row.issue.status, row.status])).entries()].sort((left, right) => left[1].localeCompare(right[1], "zh-CN")), [rows]);
  const hasFilters = list.query.length > 0 || list.filterValues.path?.length > 0 || list.filterValues.kind?.length > 0 || list.filterValues.status?.length > 0;
  const clearFilters = () => {
    list.setQuery("");
    list.clearFilters();
  };

  const columns: Array<Column<IssueRow>> = [
    {
      key: "path",
      title: <TableSortHeader label={ANOMALY_ISSUE_FORM_COPY.COL_PATH} active={list.sortField === "path"} direction={list.sortDirection} ascendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_PATH_ASC} descendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_PATH_DESC} onChange={(direction) => list.setSort("path", direction)} />,
      width: "25%",
      groupOf: (row) => row.path,
      className: "border-r border-border-thin",
      render: (row, _index, span) => {
        const basePathPresentation = evidencePathPresentation(row.path);
        const pathPresentation = row.issue.issueKind === "stale_source"
          ? { ...basePathPresentation, openableInObsidian: false, description: ANOMALY_ISSUE_FORM_COPY.STALE_SOURCE_PATH_DESC }
          : basePathPresentation;
        return (
          <div>
            {pathPresentation.openableInObsidian ? (
              <ObsidianLink sourcePath={row.path} aria-label={`${ANOMALY_ISSUE_FORM_COPY.OBSIDIAN_OPEN_ARIA_PREFIX}${row.path}`} title={ANOMALY_ISSUE_FORM_COPY.OBSIDIAN_OPEN_TITLE} onClick={(event) => event.stopPropagation()} className="group flex w-full items-start gap-1.5 text-left text-kg-xs leading-5 text-text-sub hover:text-text-main">
                <span className="break-all">{pathPresentation.displayName}</span>
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-text-hint transition-colors group-hover:text-text-main" />
              </ObsidianLink>
            ) : (
              <div title={pathPresentation.description} className="text-kg-xs leading-5 text-text-sub"><span className="break-all">{pathPresentation.displayName}</span></div>
            )}
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-kg-xs tabular-nums text-text-hint"><span className="rounded bg-surface-hover px-1.5 py-0.5">{pathPresentation.label}</span><span>{anomalyIssueCountText(span ?? 1)}</span></p>
          </div>
        );
      },
    },
    {
      key: "field",
      title: <TableSortHeader label={ANOMALY_ISSUE_FORM_COPY.COL_FIELD} active={list.sortField === "field"} direction={list.sortDirection} ascendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_FIELD_ASC} descendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_FIELD_DESC} onChange={(direction) => list.setSort("field", direction)} />,
      width: "18%",
      render: (row) => <div><p className="font-medium text-text-main">{row.primaryLabel}</p>{row.detailLabel !== row.primaryLabel && <p className="mt-1 text-text-hint">{row.detailLabel}</p>}</div>,
    },
    {
      key: "kind",
      title: <TableSortHeader label={ANOMALY_ISSUE_FORM_COPY.COL_KIND} active={list.sortField === "kind"} direction={list.sortDirection} ascendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_KIND_ASC} descendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_KIND_DESC} onChange={(direction) => list.setSort("kind", direction)} />,
      width: "13%",
      render: (row) => <Tag tone="neutral">{row.kind}</Tag>,
    },
    {
      key: "current",
      title: <TableSortHeader label={ANOMALY_ISSUE_FORM_COPY.COL_CURRENT} active={list.sortField === "current"} direction={list.sortDirection} ascendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_CURRENT_ASC} descendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_CURRENT_DESC} onChange={(direction) => list.setSort("current", direction)} />,
      width: "11%",
      render: (row) => <span className="break-words text-text-sub">{row.current}</span>,
    },
    {
      key: "expected",
      title: <TableSortHeader label={ANOMALY_ISSUE_FORM_COPY.COL_EXPECTED} active={list.sortField === "expected"} direction={list.sortDirection} ascendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_EXPECTED_ASC} descendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_EXPECTED_DESC} onChange={(direction) => list.setSort("expected", direction)} />,
      width: "25%",
      render: (row) => <div className="break-words text-text-sub"><p>{row.expected}</p>{typeof row.action.hint === "string" && row.action.hint && <p className="mt-1 text-text-hint">{row.action.hint}</p>}</div>,
    },
    {
      key: "status",
      title: <TableSortHeader label={ANOMALY_ISSUE_FORM_COPY.COL_STATUS} active={list.sortField === "status"} direction={list.sortDirection} ascendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_STATUS_ASC} descendingLabel={ANOMALY_ISSUE_FORM_COPY.COL_STATUS_DESC} onChange={(direction) => list.setSort("status", direction)} />,
      width: "8%",
      render: (row) => <Tag tone={statusTone(row.issue.status)}>{statusLabel(row.issue.status)}</Tag>,
    },
  ];

  return (
    <Panel className="space-y-3" ariaLabel={ANOMALY_ISSUE_FORM_COPY.PANEL_ARIA}>
      <div className="flex items-center gap-2 px-1">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-text-hint">{ANOMALY_ISSUE_FORM_COPY.HEADER_TITLE}</p>
        <span className="inline-flex items-center gap-0.5 text-kg-xs text-text-placeholder cursor-help" title={ANOMALY_ISSUE_FORM_COPY.HEADER_HELP_TITLE}>
          <HelpCircle className="h-3 w-3" />
        </span>
      </div>
      <DataTable
        ariaLabel={ANOMALY_ISSUE_FORM_COPY.TABLE_ARIA}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.issue.issueId}
        density="md"
        minWidth={960}
        tableClassName="table-fixed"
        empty={{ title: ANOMALY_ISSUE_FORM_COPY.EMPTY_NO_MATCH }}
        onRowClick={(row) => onSelect(row.issue.issueId)}
        rowClassName={(row) => (row.issue.issueId === selectedIssueId ? "bg-accent-bg/40" : "")}
        toolbar={
          <TableToolbar>
            <TableToolbarSearch ariaLabel={ANOMALY_ISSUE_FORM_COPY.SEARCH_ARIA} placeholder={ANOMALY_ISSUE_FORM_COPY.SEARCH_PLACEHOLDER} value={list.query} onChange={(event) => list.setQuery(event.target.value)} />
            <FilterSelect ariaLabel={ANOMALY_ISSUE_FORM_COPY.FILTER_PATH_ARIA} title={ANOMALY_ISSUE_FORM_COPY.FILTER_PATH_TITLE} searchPlaceholder={ANOMALY_ISSUE_FORM_COPY.FILTER_PATH_SEARCH} variant="filter" value={list.filterValues.path?.[0] ?? "all"} onValueChange={(value) => list.setFilter("path", value === "all" ? [] : [value as string])} options={[{ value: "all", label: ANOMALY_ISSUE_FORM_COPY.COL_PATH, group: ANOMALY_ISSUE_FORM_COPY.FILTER_ALL_GROUP }, ...pathOptions.map((value) => ({ value, label: evidencePathPresentation(value).displayName, group: ANOMALY_ISSUE_FORM_COPY.COL_PATH }))]} />
            <FilterSelect ariaLabel={ANOMALY_ISSUE_FORM_COPY.FILTER_KIND_ARIA} title={ANOMALY_ISSUE_FORM_COPY.FILTER_KIND_TITLE} searchPlaceholder={ANOMALY_ISSUE_FORM_COPY.FILTER_KIND_SEARCH} variant="filter" value={list.filterValues.kind?.[0] ?? "all"} onValueChange={(value) => list.setFilter("kind", value === "all" ? [] : [value as string])} options={[{ value: "all", label: ANOMALY_ISSUE_FORM_COPY.COL_KIND, group: ANOMALY_ISSUE_FORM_COPY.FILTER_ALL_GROUP }, ...kindOptions.map(([value, label]) => ({ value, label, group: ANOMALY_ISSUE_FORM_COPY.COL_KIND }))]} />
            <FilterSelect ariaLabel={ANOMALY_ISSUE_FORM_COPY.FILTER_STATUS_ARIA} title={ANOMALY_ISSUE_FORM_COPY.FILTER_STATUS_TITLE} searchPlaceholder={ANOMALY_ISSUE_FORM_COPY.FILTER_STATUS_SEARCH} variant="filter" value={list.filterValues.status?.[0] ?? "all"} onValueChange={(value) => list.setFilter("status", value === "all" ? [] : [value as string])} options={[{ value: "all", label: ANOMALY_ISSUE_FORM_COPY.FILTER_STATUS_GROUP, group: ANOMALY_ISSUE_FORM_COPY.FILTER_ALL_GROUP }, ...statusOptions.map(([value, label]) => ({ value, label, group: ANOMALY_ISSUE_FORM_COPY.FILTER_STATUS_GROUP }))]} />
            <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={ANOMALY_ISSUE_FORM_COPY.CLEAR_ARIA} disabled={!hasFilters} onClick={clearFilters} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30"><RotateCcw className="h-4 w-4" /></button>
          </TableToolbar>
        }
        meta={<span className="tabular-nums text-kg-xs text-text-hint">{anomalyIssueFormMetaText(list.visibleCount, issues.length)}</span>}
        pagination={<TablePagination ariaLabel={ANOMALY_ISSUE_FORM_COPY.PAGINATION_ARIA} page={list.page} pageSize={list.pageSize} total={list.visibleCount} onPageChange={list.setPage} />}
      />
    </Panel>
  );
}

/** 非路径字段的排序包装：先按来源路径分组（分组视觉稳定），再按字段值、issueId 决胜 */
function withPathGrouping(valueOf: (row: IssueRow) => string) {
  return (left: IssueRow, right: IssueRow) => {
    const pathComparison = left.path.localeCompare(right.path, "zh-CN", { numeric: true });
    if (pathComparison) return pathComparison;
    const comparison = valueOf(left).localeCompare(valueOf(right), "zh-CN", { numeric: true });
    return comparison || left.issue.issueId.localeCompare(right.issue.issueId);
  };
}
