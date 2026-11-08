import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { apiFetchJson } from "./api";
import type { GraphDataSet } from "./graph-data-types";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { LIB_REQUEST_COPY } from "./lib-copy";

// ---- Store ----
interface GraphStore {
  data: GraphDataSet | null;
  status: RequestStatus;
  error: string | null;
  selectedNodeId: string | null;
  load: () => Promise<void>;
  selectNode: (id: string | null) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  data: null,
  status: "idle",
  error: null,
  selectedNodeId: null,

  load: async () => {
    set(requestLoading());
    try {
      const res = await apiFetchJson<{
        success: boolean;
        data: GraphDataSet;
      }>("/api/kg/query?type=all");
      if (res.success && res.data) {
        set({ data: res.data, ...requestSettled(res.data.components.length === 0) });
      } else {
        set(requestFailed(null, LIB_REQUEST_COPY.GRAPH_DATA_LOAD_FAILED));
      }
    } catch (e) {
      set(requestFailed(e, TERM.API_UNREACHABLE));
    }
  },

  selectNode: (id) => set({ selectedNodeId: id }),
}));
