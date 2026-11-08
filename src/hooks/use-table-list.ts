// ── useTableList（P2 · I1/I2/I3/I6：搜索/筛选/排序/分页/计数统一件）──
// client 模式：传全量 rows＋匹配器，hook 内完成过滤/排序/分页切片；
// server 模式：传 server 页数据与分页句柄，状态形状与 client 完全一致（消除两套）。
// 口径：默认 pageSize=20（决策卡 §十裁定，对齐 useTablePagination 现状默认）；
//      query/filters/sort 变更自动回第一页（防「过滤后停留在空页」）。
// draftQuery/applyQuery：onSubmit/onApply 型搜索的暂存-应用两段式（immediate 型直接用 query/setQuery）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTableSort, type SortDirection } from "./use-table-sort";

export type TableFilterMatcher<T> = (row: T, value: string) => boolean;

export type TableFilters<T> = Record<string, { values: string[]; match: TableFilterMatcher<T> }>;

export type TableComparator<T> = (a: T, b: T) => number;

export type UseTableListOptions<T, F extends string = string> = {
  /** client 模式：全量数据 */
  rows?: T[];
  /** 搜索匹配（小写化由调用方负责或在此统一 toLowerCase） */
  search?: (row: T, query: string) => boolean;
  /** 多值筛选（values 空数组＝该维度不过滤） */
  filters?: TableFilters<T>;
  /** 排序：字段到比较器的映射 */
  comparators?: Partial<Record<F, TableComparator<T>>>;
  initialSort?: { field: F; direction: SortDirection };
  pageSize?: number;
  /** server 模式：分页句柄与当页数据 */
  server?: {
    rows: T[];
    total: number;
    page: number;
    pageSize: number;
    onPageChange: (page: number) => void;
  };
};

export type UseTableListResult<T, F extends string = string> = {
  /** 当页数据（client＝过滤排序切片；server＝透传当页） */
  items: T[];
  /** 全量条数（client＝rows.length；server＝远端 total） */
  total: number;
  /** 可见条数（client＝过滤后；server＝远端 total 或当页口径由调用方注释） */
  visibleCount: number;
  query: string;
  setQuery: (value: string) => void;
  draftQuery: string;
  setDraftQuery: (value: string) => void;
  applyQuery: () => void;
  /** 各维度当前选中值（只读视图） */
  filterValues: Record<string, string[]>;
  setFilter: (key: string, values: string[]) => void;
  clearFilters: () => void;
  sortField: F;
  sortDirection: SortDirection;
  setSort: (field: F, direction: SortDirection) => void;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
};

export function useTableList<T, F extends string = string>(options: UseTableListOptions<T, F>): UseTableListResult<T, F> {
  const { rows, search, filters, comparators, initialSort, pageSize: pageSizeOption = 20, server } = options;

  const [query, setQueryState] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [filterState, setFilterState] = useState<Record<string, string[]>>({});
  const [page, setPageState] = useState(0);
  const sort = useTableSort<F>(initialSort ?? ({ field: "" as F, direction: "desc" }));

  // 条件变更回第一页（query/filters/sort）
  useEffect(() => { setPageState(0); }, [query, filterState, sort.sortField, sort.sortDirection]);

  const applyQuery = useCallback(() => setQueryState(draftQuery), [draftQuery]);
  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setDraftQuery(value);
  }, []);

  const setFilter = useCallback((key: string, values: string[]) => {
    setFilterState((prev) => ({ ...prev, [key]: values }));
  }, []);
  const clearFilters = useCallback(() => setFilterState({}), []);

  const filtered = useMemo(() => {
    if (server || !rows) return rows ?? [];
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      for (const [key, values] of Object.entries(filterState)) {
        if (values.length === 0) continue;
        const def = filters?.[key];
        if (!def) continue;
        if (!values.some((value) => def.match(row, value))) return false;
      }
      if (keyword && search && !search(row, keyword)) return false;
      return true;
    });
  }, [server, rows, query, filterState, filters, search]);

  const sorted = useMemo(() => {
    const base = server ? server.rows : filtered;
    const comparator = comparators?.[sort.sortField];
    if (!comparator) return base;
    const copy = [...base];
    copy.sort((a, b) => (sort.sortDirection === "asc" ? comparator(a, b) : -comparator(a, b)));
    return copy;
  }, [server, filtered, comparators, sort.sortField, sort.sortDirection]);

  const clientPageSize = pageSizeOption;
  const pageCount = Math.max(1, Math.ceil(filtered.length / clientPageSize));
  const safePage = Math.min(page, pageCount - 1);

  const items = useMemo(() => {
    if (server) return server.rows;
    return sorted.slice(safePage * clientPageSize, (safePage + 1) * clientPageSize);
  }, [server, sorted, safePage, clientPageSize]);

  return {
    items,
    total: server ? server.total : (rows?.length ?? 0),
    visibleCount: server ? server.total : filtered.length,
    query,
    setQuery,
    draftQuery,
    setDraftQuery,
    applyQuery,
    filterValues: filterState,
    setFilter,
    clearFilters,
    sortField: sort.sortField,
    sortDirection: sort.sortDirection,
    setSort: sort.setSort,
    page: server ? server.page : safePage,
    pageSize: server ? server.pageSize : clientPageSize,
    setPage: (next: number) => (server ? server.onPageChange(next) : setPageState(next)),
  };
}
