// Review data store — shared Zustand state for cross-feature data consistency.
// Migrated from features/review/review-store.ts (Phase 1 store decoupling).
// Dashboard consumes pendingCount; review panels call load() after submit.

import { create } from "zustand";
import { TERM } from "@/constants/term-const";
import { fetchPendingReview } from "@/features/review/review-api";
import { requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";

interface ReviewStore {
  pendingCount: number | null;
  status: RequestStatus;
  error: string | null;
  load: () => Promise<void>;
}

export const useReviewStore = create<ReviewStore>((set) => ({
  pendingCount: null,
  status: "idle",
  error: null,

  load: async () => {
    set(requestLoading());
    try {
      const data = await fetchPendingReview();
      set({ pendingCount: data.pending, ...requestSettled() });
    } catch (e) {
      set(requestFailed(e, TERM.LOAD_FAILED));
    }
  },
}));

export function useReviewPendingCount() {
  return useReviewStore((s) => s.pendingCount);
}
export function useReviewLoading() {
  return useReviewStore((s) => s.status === "loading");
}
