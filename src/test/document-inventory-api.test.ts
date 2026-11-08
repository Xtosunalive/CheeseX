import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDocumentSearchQuery, searchArticleCandidates, searchDocuments } from "@/features/document-inventory/document-inventory-api";

afterEach(() => vi.restoreAllMocks());

describe("document inventory API", () => {
  it("encodes arrays, booleans and pagination", () => {
    const query = buildDocumentSearchQuery({ arch_layer: ["service", "gateway"], arch_component: true, limit: 20, offset: 2 });
    expect(query).toContain("arch_layer=service%2Cgateway");
    expect(query).toContain("arch_component=true");
    expect(query).toContain("limit=20");
  });

  it("unwraps a successful API envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, trace_id: "t", data: { releaseId: `release-${"a".repeat(64)}`, sourceCommit: "b".repeat(40), filters: {}, summary: {}, availableFilters: {}, documents: [], limit: 50, offset: 0, generatedAt: "now" } }),
    }));
    const result = await searchDocuments({});
    expect(result.documents).toEqual([]);
    expect(result.releaseId).toBe(`release-${"a".repeat(64)}`);
    expect(result.sourceCommit).toBe("b".repeat(40));
  });

  it("surfaces network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(searchDocuments({})).rejects.toThrow("offline");
  });

  it("uses the name-only candidate search contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, trace_id: "t", data: { items: [{ title: "半成品" }], total: 1, limit: 50, offset: 0, generatedAt: "now" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchArticleCandidates("半成品");
    expect(result.items).toEqual([{ title: "半成品" }]);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/articles/candidates/search?keyword=%E5%8D%8A%E6%88%90%E5%93%81");
  });
});
