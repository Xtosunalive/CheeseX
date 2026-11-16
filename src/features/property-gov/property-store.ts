// property-store.ts — 属性检查 + 修复状态管理
import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchCheckResults, applyPropertyRepair, refreshProperty } from "./property-api";
import type { CheckResultItem, CheckSummary, CheckFilter, RepairAction, RepairPayload, WorkingRevisions } from "./property-types";
import { errorMessageOf, requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { PROPERTY_REQUEST_COPY } from "./property-gov-copy";

interface PropertyStore {
  checkResults: CheckResultItem[];
  /** 2026-11-17 第 1 批接线：阻断/警告聚合恢复持有（工作台量值带前置依赖；概览卡消费自 MAIC 批停用） */
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
  /** PR-314/WP-178：重新生成属性入队成功后的持久回显（组件级瞬时 busy 之外的结果去向指引） */
  lastRefreshQueued: { componentId: string; at: string } | null;
  load: () => Promise<void>;
  setFilter: (f: CheckFilter) => void;
  setQuery: (q: string) => void;
  repair: (item: CheckResultItem, action: RepairAction, payload: RepairPayload) => Promise<boolean>;
  refresh: (componentId: string) => Promise<boolean>;
}

export const usePropertyStore = create<PropertyStore>((set, get) => ({
  checkResults: [], summary: null, workingRevisions: {}, status: "idle", error: null,
  filter: "all", query: "", repairingId: null, operationError: null, lastApplySummary: null, lastRefreshQueued: null,

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
    try {
      await refreshProperty(componentId);
      // PR-314：入队成功落持久回显——结果去向（重新检查/等管线）由展示层渲染，不再只靠按钮瞬时变字
      set({ repairingId: null, lastRefreshQueued: { componentId, at: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) } });
      return true;
    }
    catch { set({ repairingId: null }); return false; }
  },
}));

export function useCheckResults() { return usePropertyStore((s) => s.checkResults); }
export function usePropertyLoading() { return usePropertyStore((s) => s.status === "loading"); }
/** 主请求错误与写操作错误合流给横幅（两者语义分离在 store，展示层合并） */
export function usePropertyError() { return usePropertyStore((s) => s.error ?? s.operationError); }
