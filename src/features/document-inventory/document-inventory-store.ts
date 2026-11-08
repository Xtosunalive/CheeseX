import { create } from "zustand";
import { searchArticleCandidates, searchDocuments } from "./document-inventory-api";
import type {
  CandidateSearchResponse,
  DocumentSearchParams,
  ExpandedCards,
  QueryStatus,
  SearchDocumentsResponse,
} from "./document-inventory-types";
import { DOCUMENT_REQUEST_COPY } from "./document-inventory-copy";

type DocumentInventoryState = {
  filters: DocumentSearchParams;
  result: SearchDocumentsResponse | null;
  candidateResult: CandidateSearchResponse | null;
  expandedCards: ExpandedCards;
  status: QueryStatus;
  error: string | null;
  requestVersion: number;
  setFilter: <K extends keyof DocumentSearchParams>(key: K, value: DocumentSearchParams[K]) => void;
  clearFilter: (key: keyof DocumentSearchParams) => void;
  clearAllFilters: () => void;
  toggleCard: (documentId: string) => void;
  query: () => Promise<void>;
  initialLoad: () => Promise<void>;
  loadNode: (nodeId: string) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : DOCUMENT_REQUEST_COPY.SEARCH_FAILED;
}

export const useDocumentInventoryStore = create<DocumentInventoryState>((set, get) => ({
  filters: {}, result: null, candidateResult: null, expandedCards: {}, status: "idle", error: null, requestVersion: 0,
  setFilter: (key, value) => set((state) => {
    const filters = { ...state.filters, [key]: value };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete filters[key];
    delete filters.offset;
    return { filters, status: "loading" };
  }),
  clearFilter: (key) => set((state) => {
    const filters = { ...state.filters };
    delete filters[key];
    delete filters.offset;
    return { filters, status: "loading" };
  }),
  clearAllFilters: () => set({ filters: {}, status: "loading" }),
  toggleCard: (documentId) => set((state) => ({ expandedCards: { ...state.expandedCards, [documentId]: !state.expandedCards[documentId] } })),
  query: async () => {
    const version = get().requestVersion + 1;
    const filters = get().filters;
    set({ requestVersion: version, status: "loading", error: null });
    try {
      const [result, candidateResult] = await Promise.all([
        searchDocuments(filters),
        searchArticleCandidates(filters.keyword || ""),
      ]);
      if (get().requestVersion !== version) return;
      set({ result, candidateResult, status: result.documents.length || candidateResult.items.length ? "success" : Object.keys(filters).length ? "empty" : "idle" });
    } catch (error) {
      if (get().requestVersion === version) set({ status: "error", error: errorMessage(error) });
    }
  },
  initialLoad: async () => {
    // Preserve existing filters (e.g. keyword carried from Dashboard overlay via Enter-navigate)
    const existing = get().filters;
    if (!existing || Object.keys(existing).length === 0) {
      set({ filters: {} });
    }
    await get().query();
  },
  loadNode: async (nodeId) => {
    set({ status: "loading", error: null });
    try {
      const result = await searchDocuments({ nodeId, limit: 200, offset: 0 });
      set({ filters: { nodeId }, result, candidateResult: null, status: result.documents.length ? "success" : "empty" });
    } catch (error) { set({ status: "error", error: errorMessage(error) }); }
  },
}));
