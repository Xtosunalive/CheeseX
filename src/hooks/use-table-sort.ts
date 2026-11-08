// ── useTableSort（P2 · I2：排序三元组统一件）──
// 每表一对 sortField/sortDirection + 一段 localeCompare 的重复由此收口。
// compareZh：中文 locale 比较（全仓排序口径唯一来源）。
import { useCallback, useState } from "react";

export type SortDirection = "asc" | "desc";

export function compareZh(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN");
}

/** 排序方向翻转应用：desc 结果取反（与既有各表 `-comparison` 同口径） */
export function withDirection(comparison: number, direction: SortDirection): number {
  return direction === "asc" ? comparison : -comparison;
}

export function useTableSort<F extends string>(initial: { field: F; direction: SortDirection }) {
  const [sortField, setSortField] = useState<F>(initial.field);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initial.direction);
  const setSort = useCallback((field: F, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  }, []);
  return { sortField, sortDirection, setSort } as const;
}
