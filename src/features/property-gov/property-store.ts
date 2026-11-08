// property-store.ts — 属性检查 + 修复状态管理
import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchCheckResults, applyPropertyRepair, refreshProperty } from "./property-api";
import type { CheckResultItem, CheckSummary, CheckFilter, RepairAction, RepairPayload, WorkingRevisions } from "./property-types";
import { errorMessageOf, requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { PROPERTY_REQUEST_COPY } from "./property-gov-copy";

interface PropertyStore {
  checkResults: CheckResultItem[];
  summary: CheckSummary | null;
  workingRevisions: WorkingRevisions;
  /** 主请求＝检查结果加载 */
  status: RequestStatus;
  error: string | null;
  filter: CheckFilter;
  query: string;
  /** 写侧＝修复/刷新：busy 以 repairingId 表示，失败落 operationError */
  repairingId: string | null;
  operationError: string | null;
  lastApplySummary: string | null;
  load: () => Promise<void>;
  setFilter: (f: CheckFilter) => void;
  setQuery: (q: string) => void;
  repair: (item: CheckResultItem, action: RepairAction, payload: RepairPayload) => Promise<boolean>;
  refresh: (componentId: string) => Promise<boolean>;
}

export const usePropertyStore = create<PropertyStore>((set, get) => ({
  checkResults: [], summary: null, workingRevisions: {}, status: "idle", error: null,
  filter: "all", query: "", repairingId: null, operationError: null, lastApplySummary: null,

  load: async () => {
    const { filter, query } = get();
    set(requestLoading());
    try {
      const data = await fetchCheckResults({ filter, q: query });
      set({ checkResults: data.items, summary: data.summary, workingRevisions: data.workingRevisions ?? {}, ...requestSettled(data.items.length === 0) });
    } catch (e) {
      set(requestFailed(e, TERM.LOAD_FAILED));
    }
  },

  setFilter: (f) => { set({ filter: f }); get().load(); },
  setQuery: (q) => { set({ query: q }); },

  repair: async (item, action, payload) => {
    set({ repairingId: item.componentId, operationError: null, lastApplySummary: null });
    try {
      const result = await applyPropertyRepair(item, action, payload);
      set({ repairingId: null, lastApplySummary: (result.writtenFields || []).join("、") || PROPERTY_REQUEST_COPY.REPAIR_WRITTEN });
      return true;
    } catch (error) {
      set({ repairingId: null, operationError: errorMessageOf(error, PROPERTY_REQUEST_COPY.REPAIR_WRITE_FAILED) });
      return false;
    }
  },

  refresh: async (componentId) => {
    set({ repairingId: componentId });
    try { await refreshProperty(componentId); set({ repairingId: null }); return true; }
    catch { set({ repairingId: null }); return false; }
  },
}));

export function useCheckSummary() { return usePropertyStore((s) => s.summary); }
export function useCheckResults() { return usePropertyStore((s) => s.checkResults); }
export function usePropertyLoading() { return usePropertyStore((s) => s.status === "loading"); }
/** 主请求错误与写操作错误合流给横幅（两者语义分离在 store，展示层合并） */
export function usePropertyError() { return usePropertyStore((s) => s.error ?? s.operationError); }
