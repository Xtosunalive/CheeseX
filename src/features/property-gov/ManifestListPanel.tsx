// ManifestListPanel — 文章图谱映射列表
// W1 迁移（决策卡 §12.1）：骨架/空态走 DataTable；SummaryMetric→Statistic（D8）、
// 状态点→StatusDot（D7）、类型徽章→ui/tag（D6）。服务端分页：LIMIT=50 保留并显式标注
// （卡 §十裁定：T07 服务端 pageSize 由接口定——勿改回 useTablePagination 默认）。

import { TableToolbar, TableToolbarSearch } from "@/components/table-toolbar";
import { useState, useEffect, useCallback, useMemo } from "react";
import { FileSearch} from "lucide-react";
import { ClearFilterButton } from "./property-gov-ui";
import { FilterSelect } from "@/components/filter-select";
import { TableSortHeader } from "@/components/table-sort-header";
import { TablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import type { Column } from "@/components/data-table/types";
import { Statistic } from "@/components/statistic/Statistic";
import { BentoGrid } from "@/components/bento";
import { StatusDot, type StatusDotTone } from "@/components/status-dot/StatusDot";
import { Tag } from "@/components/ui/tag";
import { compareZh } from "@/hooks/use-table-sort";
import { TERM } from "@/constants/term-const";
import {
  type ManifestItem,
  type ManifestListData,
  type LegacySummary,
  isCoverageSummary,
  LEGACY_FILTERS,
  COVERAGE_FILTERS,
  FILTER_LABELS,
} from "./property-types";
import { fetchArticleManifests } from "./property-api";
import { MANIFEST_LIST_COPY, PROPERTY_GOV_SHARED_COPY, manifestCoverageHint, manifestCoverageSub, manifestNoMatchQuery } from "./property-gov-copy";

const LIMIT = 50; // 服务端口径（接口侧分页，Master 裁定保留 50 并标注）
type ManifestSortField = "title" | "mode" | "directRelationCount" | "status";

export function ManifestListPanel() {
  const [filter, setFilter] = useState<string>("missing");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ManifestListData | null>(null);
  const [sortField, setSortField] = useState<ManifestSortField>("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const fetchList = useCallback(
    async (f: string, query: string, off: number) => {
      setLoading(true);
      setError(null);
      const env = await fetchArticleManifests({ filter: f, q: query, limit: LIMIT, offset: off });
      if (!env.ok) { setError(env.error || TERM.REQUEST_FAILED); setLoading(false); return; }
      setData(env.data ?? null);
      setLoading(false);
    },
    [],
  );

  useEffect(() => { fetchList(filter, q, offset); }, [filter, q, offset, fetchList]);

  const doSearch = () => { setOffset(0); fetchList(filter, q, 0); };

  const s = data?.summary;
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const isEmpty = items.length === 0 && !loading;
  const sortedItems = useMemo(() => [...items].sort((left, right) => {
    const leftMode = left.excluded ? "excluded" : left.manifestMode || "unknown";
    const rightMode = right.excluded ? "excluded" : right.manifestMode || "unknown";
    const comparison = sortField === "title"
      ? compareZh(`${left.title} ${left.sourcePath}`, `${right.title} ${right.sourcePath}`)
      : sortField === "mode"
        ? compareZh(leftMode, rightMode)
        : sortField === "directRelationCount"
          ? left.directRelationCount - right.directRelationCount
          : compareZh(left.manifest.status, right.manifest.status);
    return sortDirection === "asc" ? comparison : -comparison;
  }), [items, sortDirection, sortField]);

  // ── Coverage-aware summary ──
  // WP-037：P7 映射覆盖率升主视觉（xl 跨两列）；P5 整页无数据不渲染 0 值统计堆；P1 gap 化。
  const renderSummary = () => {
    if (!s || totalItems === 0) return null;
    if (isCoverageSummary(s)) {
      const pct = (s.coverageRatio * 100).toFixed(0);
      return (
        <div data-testid="manifest-summary">
          <BentoGrid data-testid="manifest-summary-grid">
            <Statistic size="xl" className="lg:col-span-2" label={TERM.MAPPING_COVERAGE} value={`${pct}%`} sub={manifestCoverageSub(s.coveredSources, s.eligibleSources)} tone={s.coverageRatio >= 0.8 ? "text-status-fact" : "text-status-warn"} hint={manifestCoverageHint(s.coveredSources, s.eligibleSources, pct)} />
            <Statistic testId="manifest-summary-metric" label={TERM.GRAPH_SOURCE_DOCUMENT} value={s.totalSourcesRaw} tone="text-text-main" hint={MANIFEST_LIST_COPY.SUMMARY_TOTAL_RAW_HINT} />
            <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.excluded} value={s.excludedSources} tone="text-text-hint" hint={MANIFEST_LIST_COPY.SUMMARY_EXCLUDED_HINT} />
            <Statistic testId="manifest-summary-metric" label={MANIFEST_LIST_COPY.SUMMARY_ELIGIBLE_LABEL} value={s.eligibleSources} tone="text-text-sub" hint={MANIFEST_LIST_COPY.SUMMARY_ELIGIBLE_HINT} />
            <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.fresh} value={s.fresh} tone="text-status-fact" hint={MANIFEST_LIST_COPY.SUMMARY_FRESH_HINT} />
            <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.stale} value={s.stale} tone="text-status-warn" hint={MANIFEST_LIST_COPY.SUMMARY_STALE_HINT} />
            <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.missing} value={s.missingEligible} tone={s.missingEligible > 0 ? "text-status-error" : "text-text-hint"} hint={MANIFEST_LIST_COPY.SUMMARY_MISSING_ELIGIBLE_HINT} />
          </BentoGrid>
        </div>
      );
    }
    return (
      <div data-testid="manifest-summary">
        <BentoGrid data-testid="manifest-summary-grid">
          <Statistic testId="manifest-summary-metric" label={TERM.GRAPH_SOURCE_DOCUMENT} value={s.totalSources} tone="text-text-main" hint={MANIFEST_LIST_COPY.LEGACY_TOTAL_HINT} />
          <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.fresh} value={s.fresh} tone="text-status-fact" hint={MANIFEST_LIST_COPY.SUMMARY_FRESH_HINT} />
          <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.stale} value={s.stale} tone="text-status-warn" hint={MANIFEST_LIST_COPY.LEGACY_STALE_HINT} />
          <Statistic testId="manifest-summary-metric" label={FILTER_LABELS.missing} value={s.missing} tone="text-status-error" hint={MANIFEST_LIST_COPY.LEGACY_MISSING_HINT} />
        </BentoGrid>
      </div>
    );
  };

  const renderKindBadge = (item: ManifestItem) => {
    if (item.excluded) {
      return (
        <Tag tone="neutral" className="font-mono text-kg-xs" title={item.exclusionReason || undefined}>
          {FILTER_LABELS.excluded}{item.exclusionReason ? `: ${item.exclusionReason}` : ""}
        </Tag>
      );
    }
    if (item.kind === "standard_article")
      return <Tag tone="loading" className="font-mono text-kg-xs">{MANIFEST_LIST_COPY.KIND_ARTICLE}</Tag>;
    if (item.kind === "wiki_entity")
      return <Tag className="bg-blue-2 font-mono text-kg-xs text-blue-9 ring-blue-6">{MANIFEST_LIST_COPY.KIND_WIKI_ENTITY}</Tag>;
    return <Tag tone="neutral" className="font-mono text-kg-xs">{MANIFEST_LIST_COPY.KIND_OTHER}</Tag>;
  };

  const renderStatusExtra = (item: ManifestItem) => {
    if (item.excluded) return null;
    if (item.manifestMode === "source_only")
      return <span className="font-mono text-kg-2xs text-blue-11">{MANIFEST_LIST_COPY.MODE_SOURCE_ONLY_HINT}</span>;
    if (item.manifestMode === "relational" && item.manifest.status === "fresh")
      return <span className="font-mono text-kg-2xs text-status-fact-11">{MANIFEST_LIST_COPY.MODE_RELATIONAL_FRESH_HINT}</span>;
    return null;
  };

  // ── Filter counts from summary ──
  const getCount = (key: string): number | null => {
    if (!s) return null;
    if (key === "all") return isCoverageSummary(s) ? s.totalSourcesRaw : s.totalSources;
    if (key === "missing") return s.missing;
    if (key === "fresh")   return s.fresh;
    if (key === "stale")   return s.stale;
    if (key === "unknown") return (s as LegacySummary).unknown ?? 0;
    if (key === "relational" && isCoverageSummary(s)) return s.relationalManifests;
    if (key === "source_only" && isCoverageSummary(s)) return s.sourceOnlyManifests;
    if (key === "excluded" && isCoverageSummary(s))   return s.excludedSources;
    if (key === "missing_eligible" && isCoverageSummary(s)) return s.missingEligible;
    return null;
  };
  const activeFilterCount = getCount(filter);
  useEffect(() => {
    if (
      data
      && !loading
      && filter !== "all"
      && q.trim().length === 0
      && items.length === 0
      && activeFilterCount === 0
    ) {
      setFilter("all");
      setOffset(0);
    }
  }, [activeFilterCount, data, filter, items.length, loading, q]);

  const filterOptions = [
    { value: "", label: PROPERTY_GOV_SHARED_COPY.ALL, group: PROPERTY_GOV_SHARED_COPY.SCOPE_GROUP, count: getCount("all") ?? undefined },
    ...LEGACY_FILTERS.filter((key) => key !== "all").map((key) => ({ value: key, label: FILTER_LABELS[key], group: MANIFEST_LIST_COPY.FILTER_GROUP_STATUS, count: getCount(key) ?? undefined })),
    ...COVERAGE_FILTERS.map((key) => ({ value: key, label: FILTER_LABELS[key], group: MANIFEST_LIST_COPY.FILTER_GROUP_COVERAGE, count: getCount(key) ?? undefined })),
  ];
  const totalItems = s != null && isCoverageSummary(s) ? s.totalSourcesRaw : (s?.totalSources ?? 0);
  const hasFilters = filter !== "all" || q.length > 0;
  const clearFilters = () => {
    setFilter("all");
    setQ("");
    setOffset(0);
  };

  const statusMeta = (status: string): { tone: StatusDotTone; label: string; extra?: string } => {
    if (status === "fresh") return { tone: "fact", label: FILTER_LABELS.fresh };
    if (status === "stale") return { tone: "warn", label: FILTER_LABELS.stale };
    if (status === "unknown") return { tone: "error", label: FILTER_LABELS.unknown };
    return { tone: "fact", label: FILTER_LABELS.missing };
  };

  const columns: Array<Column<ManifestItem>> = [
    {
      key: "title",
      title: <TableSortHeader label={MANIFEST_LIST_COPY.COL_TITLE} active={sortField === "title"} direction={sortDirection} ascendingLabel={MANIFEST_LIST_COPY.COL_TITLE_ASC} descendingLabel={MANIFEST_LIST_COPY.COL_TITLE_DESC} onChange={(direction) => { setSortField("title"); setSortDirection(direction); }} />,
      render: (item) => (
        <div>
          <div data-testid="manifest-row-title" className="truncate font-mono text-xs font-medium text-text-main">{item.title}</div>
          <div className="mt-0.5 truncate font-mono text-kg-xs text-text-hint">{item.sourcePath}</div>
        </div>
      ),
      width: "48%",
    },
    {
      key: "mode",
      title: <TableSortHeader label={MANIFEST_LIST_COPY.COL_KIND} active={sortField === "mode"} direction={sortDirection} ascendingLabel={MANIFEST_LIST_COPY.COL_KIND_ASC} descendingLabel={MANIFEST_LIST_COPY.COL_KIND_DESC} onChange={(direction) => { setSortField("mode"); setSortDirection(direction); }} />,
      render: (item) => renderKindBadge(item),
      align: "right",
      width: 112,
    },
    {
      key: "directRelationCount",
      title: <TableSortHeader label={MANIFEST_LIST_COPY.COL_RELATION_COUNT} active={sortField === "directRelationCount"} direction={sortDirection} ascendingLabel={MANIFEST_LIST_COPY.COL_RELATION_COUNT_ASC} descendingLabel={MANIFEST_LIST_COPY.COL_RELATION_COUNT_DESC} onChange={(direction) => { setSortField("directRelationCount"); setSortDirection(direction); }} />,
      dataIndex: "directRelationCount",
      align: "right",
      width: 96,
      className: "font-mono tabular-nums text-text-hint",
    },
    {
      key: "status",
      title: <TableSortHeader label={MANIFEST_LIST_COPY.COL_STATUS} active={sortField === "status"} direction={sortDirection} ascendingLabel={MANIFEST_LIST_COPY.COL_STATUS_ASC} descendingLabel={MANIFEST_LIST_COPY.COL_STATUS_DESC} onChange={(direction) => { setSortField("status"); setSortDirection(direction); }} />,
      render: (item) => {
        const meta = statusMeta(item.manifest.status);
        return (
          <div className="flex flex-col items-end">
            <div className="flex items-center justify-end gap-1.5">
              <StatusDot tone={meta.tone} label={meta.label} className={item.manifest.status === "missing" ? "bg-text-placeholder" : undefined} />
              <span className="font-mono text-kg-xs">{meta.label}</span>
            </div>
            <div className="mt-0.5 text-right">{renderStatusExtra(item)}</div>
          </div>
        );
      },
      align: "right",
      width: 192,
    },
  ];

  // WP-037 P5：整页无数据（全量 0）——统计堆与搜索/筛选工具条都降级，不渲染空转控件
  const noData = !loading && !error && totalItems === 0; // 红队修：error 态不降级（失败≠无数据）

  return (
    <div className="flex flex-col gap-3">
      {renderSummary()}

      {/* ── Error ── */}
      {error && (
        <div className="rounded ring-1 ring-status-error-6 bg-status-error-2 px-3 py-2 font-mono text-xs text-status-error">
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && !data && <LoadingHint />}

      {!noData && (
        <TableToolbar testId="manifest-toolbar">
          <TableToolbarSearch ariaLabel={MANIFEST_LIST_COPY.SEARCH_ARIA} placeholder={MANIFEST_LIST_COPY.SEARCH_PLACEHOLDER} value={q} onChange={(event) => { setQ(event.target.value); setOffset(0); }} onEnter={() => doSearch()} />
          <FilterSelect
            ariaLabel={MANIFEST_LIST_COPY.FILTER_ARIA}
            title={MANIFEST_LIST_COPY.FILTER_TITLE}
            searchPlaceholder={MANIFEST_LIST_COPY.FILTER_SEARCH}
            variant="filter"
            value={filter === "all" ? "" : filter}
            onValueChange={(value) => { setFilter((value as string) || "all"); setOffset(0); }}
            emptyTriggerLabel={MANIFEST_LIST_COPY.FILTER_TRIGGER}
            placeholder={MANIFEST_LIST_COPY.FILTER_TRIGGER}
            options={filterOptions}
          />
          <ClearFilterButton label={MANIFEST_LIST_COPY.CLEAR_FILTERS} disabled={!hasFilters} onClick={clearFilters} />
        </TableToolbar>
      )}

      <DataTable
        ariaLabel={MANIFEST_LIST_COPY.TABLE_ARIA}
        columns={columns}
        rows={isEmpty ? [] : sortedItems}
        rowKey={(item) => item.normalizedSourcePath}
        loading={loading && Boolean(data)}
        empty={noData ? {
          // WP-037 P4：no-data 变体——说明来源＋引导（不再是「筛选无结果」错话术）
          icon: FileSearch,
          title: <span className="text-sm font-medium text-text-sub">{MANIFEST_LIST_COPY.EMPTY_NO_DATA_TITLE}</span>,
        } : {
          icon: FileSearch,
          title: <span className="text-sm font-medium text-text-sub">{MANIFEST_LIST_COPY.EMPTY_NO_MATCH_TITLE}</span>,
          description: (
            <span className="mx-auto block max-w-[340px] text-xs leading-relaxed">
              {q.trim()
                ? manifestNoMatchQuery(q)
                : PROPERTY_GOV_SHARED_COPY.NO_FILTER_RESULT}
            </span>
          ),
        }}
        minWidth={720}
        pagination={<TablePagination ariaLabel={MANIFEST_LIST_COPY.PAGINATION_ARIA} page={Math.floor(offset / LIMIT)} pageSize={LIMIT} total={totalItems} loading={loading} onPageChange={(nextPage) => setOffset(nextPage * LIMIT)} />}
      />
    </div>
  );
}

// ── Sub-components ──

function LoadingHint() {
  return (
    <div className="flex h-32 items-center justify-center">
      <p className="text-sm text-text-hint">{TERM.LOADING}</p>
    </div>
  );
}
