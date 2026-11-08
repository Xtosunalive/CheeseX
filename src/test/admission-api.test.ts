import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCanvasAdmission, fetchClassificationList } from "@/features/admission/admission-api";

afterEach(() => vi.restoreAllMocks());

const releaseId = `release-${"a".repeat(64)}`;
const sourceCommit = "b".repeat(40);

describe("formal admission API", () => {
  it("preserves Release identity for canvas admission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { releaseId, sourceCommit, total: 0, admitted: 0, blocked: 0, components: [] } }) }));
    const response = await fetchCanvasAdmission();
    expect(response.data).toMatchObject({ releaseId, sourceCommit });
  });

  it("preserves Release identity for classification data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { releaseId, sourceCommit, items: [] } }) }));
    const response = await fetchClassificationList();
    expect(response.data).toEqual({ releaseId, sourceCommit, items: [] });
  });

  it("fails closed when classification data has no Release identity container", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    await expect(fetchClassificationList()).rejects.toThrow("请求未完成");
  });

  it("echoes backend envelope error copy for classification failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ success: false, message: "分类服务不可用" }) }));
    await expect(fetchClassificationList()).rejects.toThrow("分类服务不可用");
  });
});
