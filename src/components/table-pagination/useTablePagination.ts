import { useEffect, useMemo, useState } from "react";

export const TABLE_PAGE_SIZE = 20;

export function useTablePagination<T>(items: readonly T[], pageSize = TABLE_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(0);
  }, [items]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const pageItems = useMemo(() => items.slice(page * pageSize, (page + 1) * pageSize), [items, page, pageSize]);

  return { page, pageItems, pageSize, setPage };
}
