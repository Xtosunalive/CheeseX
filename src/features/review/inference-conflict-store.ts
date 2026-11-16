import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchConflicts, reviewConflict } from "./inference-conflict-api";
import type { InferenceConflict } from "./review-types";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";

type State = {
  conflicts: InferenceConflict[];
  total: number;
  statusFilter: "unresolved" | "resolved" | "all";
  status: RequestStatus;
  error: string | null;
  expandedIds: Set<string>;
  /** Wave3 阶段三：裁决/重开进行中的行（busy 位） */
  reviewingIds: Set<string>;
  setStatusFilter: (filter: "unresolved" | "resolved" | "all") => void;
  toggleExpand: (id: string) => void;
  load: () => Promise<void>;
  /** 裁决/重开（store.review 单源委托）：成功后原位更新该行 */
  review: (conflictId: string, request: Parameters<typeof reviewConflict>[1]) => Promise<void>;
};

export const useInferenceConflictStore = create<State>((set, get) => ({
  conflicts: [],
  total: 0,
  statusFilter: "all",
  status: "idle",
  error: null,
  expandedIds: new Set<string>(),
  reviewingIds: new Set<string>(),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  toggleExpand: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { expandedIds: next };
    }),
  load: async () => {
    set(requestLoading());
    try {
      const result = await fetchConflicts(get().statusFilter);
      set({ conflicts: result.conflicts, total: result.total, ...requestSettled(result.conflicts.length === 0) });
    } catch (error) {
      set(requestFailed(error, TERM.LOAD_FAILED));
    }
  },
  review: async (conflictId, request) => {
    const reviewing = new Set(get().reviewingIds).add(conflictId);
    set({ reviewingIds: reviewing });
    try {
      const updated = await reviewConflict(conflictId, request);
      set((state) => ({
        conflicts: state.conflicts.map((c) => (c.conflictId === conflictId ? updated : c)),
      }));
    } finally {
      const next = new Set(get().reviewingIds);
      next.delete(conflictId);
      set({ reviewingIds: next });
    }
  },
}));
