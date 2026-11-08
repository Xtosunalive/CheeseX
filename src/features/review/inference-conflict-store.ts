import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchConflicts } from "./inference-conflict-api";
import type { InferenceConflict } from "./review-types";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";

type State = {
  conflicts: InferenceConflict[];
  total: number;
  statusFilter: "unresolved" | "resolved" | "all";
  status: RequestStatus;
  error: string | null;
  expandedIds: Set<string>;
  setStatusFilter: (filter: "unresolved" | "resolved" | "all") => void;
  toggleExpand: (id: string) => void;
  load: () => Promise<void>;
};

export const useInferenceConflictStore = create<State>((set, get) => ({
  conflicts: [],
  total: 0,
  statusFilter: "all",
  status: "idle",
  error: null,
  expandedIds: new Set<string>(),
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
}));
