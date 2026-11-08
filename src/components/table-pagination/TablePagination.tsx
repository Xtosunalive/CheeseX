import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TABLE_PAGINATION_COPY, tablePaginationJumpAria, tablePaginationNextAria, tablePaginationPageCount, tablePaginationPrevAria } from "../components-copy";

type Props = {
  page: number;
  pageSize: number;
  /**
   * 当前筛选集合的总数——不是库内全量：server 模式＝后端 `total`，client 模式＝过滤后行数
   * （事实源 src/hooks/use-table-list.ts:119-120）。null＝未知（未加载），整块不渲染。
   */
  total: number | null;
  onPageChange: (page: number) => void;
  ariaLabel?: string;
  loading?: boolean;
};

function pageCountOf(total: number | null, pageSize: number) {
  return Math.max(1, Math.ceil((total ?? 0) / pageSize));
}

export function TablePagination({ page, pageSize, total, onPageChange, ariaLabel = TABLE_PAGINATION_COPY.ARIA_DEFAULT, loading = false }: Props) {
  const pageCount = pageCountOf(total, pageSize);
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const [pageInput, setPageInput] = useState(String(safePage + 1));
  const totalKnown = total ?? 0;
  const start = totalKnown === 0 ? 0 : safePage * pageSize + 1;
  const end = Math.min((safePage + 1) * pageSize, totalKnown);

  useEffect(() => {
    setPageInput(String(safePage + 1));
  }, [safePage]);

  // WP-037 P5 零数据降级：总数为 0 时整块隐藏——「0–0 / 共 0 第 / 1 页」是假信息，不渲染。
  // WP-134 波0：未知（total 为 null，即未加载）与真零同形隐藏，但两者在类型上已可分辨。
  // 守卫须在全部 Hooks 之后（早退不得改变钩子序——Rules of Hooks）。
  if (totalKnown === 0) return null;

  function commitPage() {
    const requested = Number.parseInt(pageInput, 10);
    const nextPage = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pageCount) - 1 : safePage;
    setPageInput(String(nextPage + 1));
    onPageChange(nextPage);
  }

  return (
    <div data-testid="table-pagination" className="flex flex-wrap items-center justify-end gap-2 px-1" aria-label={ariaLabel}>
      <span className="font-mono text-kg-xs text-text-hint">
        <b className="font-semibold text-text-sub">{start}–{end}</b>
        {TABLE_PAGINATION_COPY.TOTAL_PREFIX}
        <b className="font-semibold text-text-sub">{total}</b>
      </span>
      <label className="flex items-center gap-1 font-mono text-kg-xs text-text-hint">
        <span>{TABLE_PAGINATION_COPY.PAGE_PREFIX}</span>
        <Input
          aria-label={tablePaginationJumpAria(ariaLabel)}
          value={pageInput}
          inputMode="numeric"
          onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitPage(); } }}
          onBlur={commitPage}
          disabled={total === 0 || loading}
          className="h-7 w-9 rounded bg-surface-root px-1 text-center font-mono text-kg-xs text-text-main shadow-none ring-1 ring-border-thin focus:ring-border-focus disabled:opacity-40"
        />
        <span>{tablePaginationPageCount(pageCount)}</span>
      </label>
      <div className="flex gap-1">
        <button type="button" aria-label={tablePaginationPrevAria(ariaLabel)} disabled={safePage === 0 || loading} onClick={() => onPageChange(safePage - 1)} className="flex h-7 w-7 items-center justify-center rounded-md text-text-hint ring-1 ring-border-thin transition-colors hover:bg-surface-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" aria-label={tablePaginationNextAria(ariaLabel)} disabled={safePage >= pageCount - 1 || loading} onClick={() => onPageChange(safePage + 1)} className="flex h-7 w-7 items-center justify-center rounded-md text-text-hint ring-1 ring-border-thin transition-colors hover:bg-surface-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
