// AnomalySourceTable — W2 迁移（决策卡 §12.1）：骨架/密度/选择列/分页/排序/筛选走 DataTable＋useTableList；
// 行点击键盘可达（O3）与来源链接冒泡选中（#1798-B）原样保留；处理动作徽章保持既有形态
// （anomaly-source-table-handling.test 对其 class 有迁移测试约定断言，随徽章统一波另行处理）。
import { useEffect, useRef } from "react";
import { ExternalLink, FileText, Search } from "lucide-react";
import { ObsidianLink } from "@/components/obsidian";
import { FilterSelect } from "@/components/filter-select";
import { TablePagination } from "@/components/table-pagination";
import { TableSortHeader } from "@/components/table-sort-header";
import { DataTable } from "@/components/data-table/DataTable";
import { Panel } from "@/components/panel";
import type { Column } from "@/components/data-table/types";
import { useTableList } from "@/hooks/use-table-list";
import { Tag } from "@/components/ui/tag";
import type { ArticleGroup } from "@/features/anomaly-workbench/anomaly-article-groups";
import { evidencePathPresentation, handlingBadgeTexts, issueKindLabel, ANOMALY_EVIDENCE_COPY, ANOMALY_SOURCE_TABLE_COPY, sourceTableAggregateStatus, sourceTableRowAriaLabel, sourceTableMetaText } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { isAnomalyPending } from "@/features/anomaly-workbench/anomaly-workbench-types";

type SourceFilter = "all" | "pending" | "blocked" | "resolved";
type SourceSortField = "source" | "kind" | "status";

function matchesStatus(group: ArticleGroup, filter: SourceFilter) {
  if (filter === "all") return true;
  if (filter === "blocked") return group.issues.some((issue) => issue.status === "blocked");
  if (filter === "resolved") return group.issues.every((issue) => issue.status === "verified");
  return group.issues.some((issue) => isAnomalyPending(issue.status));
}

type Props = {
  groups: ArticleGroup[];
  selectedIssueId: string | null;
  selectedKeys?: string[];
  onSelect: (issueId: string) => void;
  onSelectionChange?: (keys: string[]) => void;
};

// 组聚合状态正名收编 copy 闭集（WP-150，sourceTableAggregateStatus——判定口径照旧：blocked 优先、isAnomalyPending 次之）
const aggregateStatus = sourceTableAggregateStatus;

function sourceSortValue(group: ArticleGroup) {
  return `${group.displayTitle} ${group.articleKey}`;
}

function kindSortValue(group: ArticleGroup) {
  return group.issueKindSummary.map(issueKindLabel).join("、");
}

export function AnomalySourceTable({ groups, selectedIssueId, selectedKeys = [], onSelect, onSelectionChange = () => undefined }: Props) {
  const list = useTableList<ArticleGroup, SourceSortField>({
    rows: groups,
    search: (group, q) =>
      `${group.articleKey} ${group.displayTitle} ${group.issues.map((i) => issueKindLabel(i.issueKind)).join(" ")}`.toLowerCase().includes(q),
    filters: {
      status: { values: [], match: (group, value) => matchesStatus(group, value as SourceFilter) },
    },
    comparators: {
      source: (left, right) =>
        sourceSortValue(left).localeCompare(sourceSortValue(right), "zh-CN", { numeric: true }) || left.articleKey.localeCompare(right.articleKey, "zh-CN"),
      kind: (left, right) =>
        kindSortValue(left).localeCompare(kindSortValue(right), "zh-CN", { numeric: true }) || left.articleKey.localeCompare(right.articleKey, "zh-CN"),
      status: (left, right) =>
        aggregateStatus(left).localeCompare(aggregateStatus(right), "zh-CN", { numeric: true }) || left.articleKey.localeCompare(right.articleKey, "zh-CN"),
    },
    initialSort: { field: "source", direction: "asc" },
  });

  const statusFilter = (list.filterValues.status?.[0] ?? "all") as SourceFilter;
  // 新来源进入时清空搜索与筛选（防陈旧过滤把新问题挡在视野外）
  const sourceSignature = groups.map((group) => group.articleKey).sort().join("\n");
  const previousSourceSignature = useRef(sourceSignature);
  useEffect(() => {
    if (previousSourceSignature.current === sourceSignature) return;
    previousSourceSignature.current = sourceSignature;
    list.setQuery("");
    list.setFilter("status", []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSignature]);

  const columns: Array<Column<ArticleGroup>> = [
    {
      key: "source",
      title: <TableSortHeader label={ANOMALY_SOURCE_TABLE_COPY.COL_SOURCE} active={list.sortField === "source"} direction={list.sortDirection} ascendingLabel={ANOMALY_SOURCE_TABLE_COPY.COL_SOURCE_ASC} descendingLabel={ANOMALY_SOURCE_TABLE_COPY.COL_SOURCE_DESC} onChange={(direction) => list.setSort("source", direction)} />,
      width: "46%",
      render: (group) => {
        const pathPresentation = group.sourcePath ? evidencePathPresentation(group.sourcePath) : { displayName: group.displayTitle, label: group.isSystemDiagnostic ? ANOMALY_SOURCE_TABLE_COPY.FALLBACK_SYSTEM_DIAGNOSTIC : ANOMALY_SOURCE_TABLE_COPY.FALLBACK_ARTICLE, openableInObsidian: false, description: group.displayTitle };
        return (
          <div className="flex min-w-0 items-center gap-1.5 text-text-main">
            <FileText className="h-4 w-4 shrink-0 text-text-hint" />
            {pathPresentation.openableInObsidian && group.sourcePath ? (
              <ObsidianLink
                sourcePath={group.sourcePath}
                aria-label={`${ANOMALY_EVIDENCE_COPY.OBSIDIAN_OPEN_ARIA_PREFIX}${group.sourcePath}`}
                title={ANOMALY_EVIDENCE_COPY.OBSIDIAN_OPEN_TITLE}
                className="group flex min-w-0 items-center gap-1.5 text-left text-text-sub hover:text-text-main"
              >
                <span className="truncate" title={pathPresentation.description}>{pathPresentation.displayName}</span>
                <ExternalLink className="h-4 w-4 shrink-0 text-text-hint transition-colors group-hover:text-text-main" />
              </ObsidianLink>
            ) : (
              <span className="truncate text-text-sub" title={pathPresentation.description}>{pathPresentation.displayName}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "kind",
      title: <TableSortHeader label={ANOMALY_SOURCE_TABLE_COPY.COL_KIND} active={list.sortField === "kind"} direction={list.sortDirection} ascendingLabel={ANOMALY_SOURCE_TABLE_COPY.COL_KIND_ASC} descendingLabel={ANOMALY_SOURCE_TABLE_COPY.COL_KIND_DESC} onChange={(direction) => list.setSort("kind", direction)} />,
      width: "38%",
      render: (group) => {
        const handlingBadges = handlingBadgeTexts(group.issues);
        return (
          <div>
            <div className="truncate text-text-hint" title={group.issueKindSummary.map(issueKindLabel).join("、")}>{group.issueKindSummary.map(issueKindLabel).join("、")}</div>
            {handlingBadges.length > 0 && <div className="mt-1 flex flex-wrap items-center gap-1"><span className="text-kg-xs text-text-hint">{ANOMALY_SOURCE_TABLE_COPY.HANDLING_BADGES_TITLE}</span>{handlingBadges.map((badge) => <Tag key={badge} tone="neutral">{badge}</Tag>)}</div>}
          </div>
        );
      },
    },
    {
      key: "status",
      title: <TableSortHeader label={ANOMALY_SOURCE_TABLE_COPY.COL_STATUS} active={list.sortField === "status"} direction={list.sortDirection} ascendingLabel={ANOMALY_SOURCE_TABLE_COPY.COL_STATUS_ASC} descendingLabel={ANOMALY_SOURCE_TABLE_COPY.COL_STATUS_DESC} onChange={(direction) => list.setSort("status", direction)} />,
      width: 80,
      render: (group) => {
        const label = aggregateStatus(group);
        const tone = label === ANOMALY_SOURCE_TABLE_COPY.STATUS_BLOCKED ? "error" : label === ANOMALY_SOURCE_TABLE_COPY.STATUS_PENDING ? "warn" : "fact";
        return <Tag tone={tone as "error" | "warn" | "fact"}>{label}</Tag>;
      },
    },
  ];

  return (
    <Panel padding="none" className="shrink-0 overflow-hidden" ariaLabel={ANOMALY_SOURCE_TABLE_COPY.PANEL_ARIA}>
      <DataTable
        ariaLabel={ANOMALY_SOURCE_TABLE_COPY.TABLE_ARIA}
        columns={columns}
        rows={list.items}
        rowKey={(group) => group.articleKey}
        density="md"
        stickyHeader
        scrollClassName="max-h-56 overflow-y-auto"
        tableClassName="table-fixed"
        empty={{ title: ANOMALY_SOURCE_TABLE_COPY.EMPTY_NO_MATCH }}
        rowSelection={{
          selectedKeys: new Set(selectedKeys),
          headerLabel: ANOMALY_SOURCE_TABLE_COPY.SELECT_HEADER,
          rowLabel: (group) => {
            const pathPresentation = group.sourcePath ? evidencePathPresentation(group.sourcePath) : { displayName: group.displayTitle };
            return sourceTableRowAriaLabel(pathPresentation.displayName);
          },
          onToggle: (group) => onSelectionChange(selectedKeys.includes(group.articleKey) ? selectedKeys.filter((key) => key !== group.articleKey) : [...selectedKeys, group.articleKey]),
        }}
        onRowClick={(group) => onSelect(group.issues[0].issueId)}
        rowClassName={(group) => (group.issues.some((issue) => issue.issueId === selectedIssueId) || selectedKeys.includes(group.articleKey) ? "bg-accent-bg/40" : "")}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">{ANOMALY_SOURCE_TABLE_COPY.SEARCH_SR}</span>
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-text-hint" />
              <input aria-label={ANOMALY_SOURCE_TABLE_COPY.SEARCH_SR} value={list.query} onChange={(event) => list.setQuery(event.target.value)} placeholder={ANOMALY_SOURCE_TABLE_COPY.SEARCH_PLACEHOLDER} className="h-8 w-full bg-transparent pl-8 pr-3 text-xs text-text-main outline-none placeholder:text-text-hint" />
            </label>
            <FilterSelect ariaLabel={ANOMALY_SOURCE_TABLE_COPY.FILTER_STATUS_ARIA} title={ANOMALY_SOURCE_TABLE_COPY.FILTER_STATUS_TITLE} variant="filter" value={statusFilter} onValueChange={(value) => list.setFilter("status", value === "all" ? [] : [value as string])} options={[
              { value: "all", label: ANOMALY_SOURCE_TABLE_COPY.FILTER_ALL_SOURCES, count: groups.length },
              { value: "pending", label: ANOMALY_SOURCE_TABLE_COPY.STATUS_PENDING },
              { value: "blocked", label: ANOMALY_SOURCE_TABLE_COPY.STATUS_BLOCKED },
              { value: "resolved", label: ANOMALY_SOURCE_TABLE_COPY.STATUS_DONE },
            ]} />
          </div>
        }
        meta={<span className="tabular-nums text-kg-xs text-text-hint">{sourceTableMetaText(list.visibleCount, groups.length)}</span>}
        pagination={<TablePagination ariaLabel={ANOMALY_SOURCE_TABLE_COPY.PAGINATION_ARIA} page={list.page} pageSize={list.pageSize} total={list.visibleCount} onPageChange={list.setPage} />}
      />
    </Panel>
  );
}
