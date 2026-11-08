// ADR-008 D1：子域词条双形态（裸标量 legacy｜{id,label?,description?} 对象）前端单源 helper。
// server 响应侧（/api/schema/enums、discovery）已归一为对象数组；此处防御归一兜底未归一通道，
// 口径与 server/shared/enums-loader.cjs normalizeSubdomainEntries/subdomainEntryId 对齐。

export interface SubdomainEntry {
  id: string;
  label?: string;
  description?: string;
}

export type SubdomainEntryInput = string | SubdomainEntry;

/** 双形态词条取 id（server 侧 subdomainEntryId 同口径）。 */
export function subdomainEntryId(item: SubdomainEntryInput | null | undefined): string | null {
  if (typeof item === "string") return item.trim() || null;
  if (item && typeof item === "object" && typeof item.id === "string") return item.id.trim() || null;
  return null;
}

/** 词条数组 → id 数组（消费方按字符串集比较的公共口）。 */
export function subdomainIdsOf(items: ReadonlyArray<SubdomainEntryInput> | null | undefined): string[] {
  return (items ?? []).map(subdomainEntryId).filter((id): id is string => Boolean(id));
}

/** 防御归一：双形态混排 → 对象数组（server 已归一时为幂等直通）。 */
export function normalizeSubdomainEntries(
  subdomains: Record<string, ReadonlyArray<SubdomainEntryInput> | null> | null | undefined,
): Record<string, SubdomainEntry[]> {
  const normalized: Record<string, SubdomainEntry[]> = {};
  for (const [domainId, raw] of Object.entries(subdomains ?? {})) {
    if (raw === null || raw === undefined) continue;
    if (!Array.isArray(raw)) { normalized[domainId] = []; continue; }
    normalized[domainId] = raw
      .map((item): SubdomainEntry | null => {
        if (typeof item === "string") return item.trim() ? { id: item.trim() } : null;
        if (item && typeof item === "object" && typeof item.id === "string" && item.id.trim()) {
          return { id: item.id.trim(), ...(item.label !== undefined ? { label: item.label } : {}), ...(item.description !== undefined ? { description: item.description } : {}) };
        }
        return null;
      })
      .filter((entry): entry is SubdomainEntry => entry !== null);
  }
  return normalized;
}
