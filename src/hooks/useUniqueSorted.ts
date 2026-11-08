import { useMemo } from "react";

/**
 * 数组去重排序（唯一定义，收敛 AuditLogPanel/EdgeReviewPanel 等 useMemo 重复）
 * @param items 源数组
 * @param pick 提取可排序值的函数（默认取自身）
 * @param filter 可选过滤（如 filter(Boolean)）
 */
export function useUniqueSorted<T, K>(
  items: T[],
  pick: (item: T) => K,
  filter?: (value: K) => boolean,
): K[] {
  return useMemo(() => {
    const values = items.map(pick);
    const filtered = filter ? values.filter(filter) : values;
    return [...new Set(filtered)].sort();
  }, [items, pick, filter]);
}
