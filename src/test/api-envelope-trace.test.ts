import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetchEnvelope, formatApiErrorMessage, unwrapEnvelope } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("API investigation id", () => {
  it("formats a server failure with one user-facing investigation id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error_code: "CONFLICT",
        message: "当前版本已变化",
        trace_id: "tr_frontend-12345678",
      }),
    }));

    const result = await apiFetchEnvelope("/api/example");
    expect(result.error).toBe("当前版本已变化\n排查编号：tr_frontend-12345678");
    expect(result.traceId).toBe("tr_frontend-12345678");
  });

  it("does not invent an investigation id for network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    const result = await apiFetchEnvelope("/api/example");
    expect(result.error).toBe("connection refused");
    expect(result.traceId).toBeNull();
  });

  it("unwrapEnvelope keeps typed trace metadata and avoids duplicate labels", async () => {
    const envelope = Promise.resolve({
      ok: false,
      data: null,
      error: "失败\n排查编号：tr_existing-12345678",
      errorCode: "FAILED",
      details: undefined,
      traceId: "tr_existing-12345678",
      status: 500,
    });
    await expect(unwrapEnvelope(envelope, "fallback")).rejects.toThrow("失败\n排查编号：tr_existing-12345678");
    expect(formatApiErrorMessage("失败", "not valid")).toBe("失败");
  });
});
