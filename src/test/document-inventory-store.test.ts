import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentInventoryStore } from "@/features/document-inventory/document-inventory-store";
import * as api from "@/features/document-inventory/document-inventory-api";

const empty = { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), filters: {}, summary: { totalResults: 0, totalDocuments: 0, indexedDocuments: 0, pendingExtraction: 0 }, availableFilters: { arch_status: [], status: [], arch_category: [], arch_layer: [], arch_subdomain: [], module: [], tags: [], wikilinkTarget: [], relationType: [], documentKind: [], graphStatus: [], product: [], version: [], articleType: [], docType: [] }, documents: [], limit: 50, offset: 0, generatedAt: "now" };
const emptyCandidates = { items: [], total: 0, limit: 50, offset: 0, generatedAt: "now" };

describe("document inventory store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "searchArticleCandidates").mockResolvedValue(emptyCandidates);
    useDocumentInventoryStore.setState({ filters: {}, result: null, candidateResult: null, expandedCards: {}, status: "idle", error: null, requestVersion: 0 });
  });

  it("loads the overview and resets pagination on filter changes", async () => {
    vi.spyOn(api, "searchDocuments").mockResolvedValue(empty);
    await useDocumentInventoryStore.getState().initialLoad();
    expect(useDocumentInventoryStore.getState().status).toBe("idle");
    expect(useDocumentInventoryStore.getState().result).toMatchObject({ releaseId: empty.releaseId, sourceCommit: empty.sourceCommit });
    useDocumentInventoryStore.setState({ filters: { offset: 20 } });
    useDocumentInventoryStore.getState().setFilter("keyword", "mysql");
    expect(useDocumentInventoryStore.getState().filters.offset).toBeUndefined();
  });

  it("does not let an older request overwrite a newer one", async () => {
    let resolveFirst!: (value: typeof empty) => void;
    vi.spyOn(api, "searchDocuments")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ...empty, summary: { ...empty.summary, totalResults: 2 } });
    const first = useDocumentInventoryStore.getState().query();
    const second = useDocumentInventoryStore.getState().query();
    await second;
    resolveFirst({ ...empty, summary: { ...empty.summary, totalResults: 1 } });
    await first;
    expect(useDocumentInventoryStore.getState().result?.summary.totalResults).toBe(2);
  });

  it("exposes empty and error states", async () => {
    vi.spyOn(api, "searchDocuments").mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error("broken"));
    useDocumentInventoryStore.setState({ filters: { keyword: "none" } });
    await useDocumentInventoryStore.getState().query();
    expect(useDocumentInventoryStore.getState().status).toBe("empty");
    await useDocumentInventoryStore.getState().query();
    expect(useDocumentInventoryStore.getState().error).toBe("broken");
  });
});
