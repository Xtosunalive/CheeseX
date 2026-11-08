// Property data store — shared summary for cross-feature consumption.
// Migrated from features/property-gov/property-store.ts (Phase 1 store decoupling).
// Dashboard consumes summary.blockerCount / summary.warningCount.

import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchCheckResults } from "@/features/property-gov/property-api";
import type { CheckSummary } from "@/features/property-gov/property-types";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";

// 消费端统一从本 store 取检查摘要类型（类型随数据源；DashboardView 不再直穿 property-gov feature）

interface PropertyDataStore {
  summary: CheckSummary | null;
  status: RequestStatus;
  error: string | null;
  load: () => Promise<void>;
}

export const usePropertyDataStore = create<PropertyDataStore>((set) => ({
  summary: null,
  status: "idle",
  error: null,

  load: async () => {
    set(requestLoading());
    try {
      const data = await fetchCheckResults({ filter: "all", q: "" });
      set({ summary: data.summary, ...requestSettled() });
    } catch (e) {
      set(requestFailed(e, TERM.LOAD_FAILED));
    }
  },
}));

export function useCheckSummary() {
  return usePropertyDataStore((s) => s.summary);
}
