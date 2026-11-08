// interaction-state 域 store 层单源：五态枚举＋切片构造器的不变量（error 非空 ⇔ status === "error"）。
// 层级：纯单元。并以两个已落地 store 做行为校验（真实 store，失败路径由 API 层 mock 触发）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestIdle, requestLoading, requestSettled, requestFailed, errorMessageOf, isRequestBusy } from "@/lib/request-status";

describe("RequestSlice 构造器——矛盾组合不可构造", () => {
  it("idle/loading/success/empty 的 error 恒为 null", () => {
    for (const slice of [requestIdle(), requestLoading(), requestSettled(false), requestSettled(true)]) {
      expect(slice.error).toBeNull();
      expect(slice.status).not.toBe("error");
    }
    expect(requestSettled(true).status).toBe("empty");
    expect(requestSettled().status).toBe("success");
  });

  it("failed 的 status 恒为 error 且 error 非空；非 Error 原因取 fallback", () => {
    expect(requestFailed(new Error("boom"), "备用")).toEqual({ status: "error", error: "boom" });
    expect(requestFailed("raw", "备用")).toEqual({ status: "error", error: "备用" });
    expect(requestFailed(new Error(""), "备用").error).toBe("备用");
    expect(errorMessageOf(null, "x")).toBe("x");
  });

  it("isRequestBusy 只认 loading", () => {
    expect(isRequestBusy("loading")).toBe(true);
    expect(["idle", "success", "empty", "error"].some((s) => isRequestBusy(s as never))).toBe(false);
  });
});

vi.mock("@/features/review/inference-conflict-api", () => ({ fetchConflicts: vi.fn() }));
vi.mock("@/features/property-gov/property-api", () => ({ fetchCheckResults: vi.fn(), applyPropertyRepair: vi.fn(), refreshProperty: vi.fn() }));

describe("迁移后 store 行为（PR-071 子项二验收：loading 与 error 不可同时成立）", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("inference-conflict：失败→status=error 且 error 文案；再次加载时 error 立即清空", async () => {
    const api = await import("@/features/review/inference-conflict-api");
    const { useInferenceConflictStore } = await import("@/features/review/inference-conflict-store");
    vi.mocked(api.fetchConflicts).mockRejectedValueOnce(new Error("网络断了"));
    await useInferenceConflictStore.getState().load();
    expect(useInferenceConflictStore.getState()).toMatchObject({ status: "error", error: "网络断了" });

    let resolveNext: (v: { conflicts: never[]; total: number }) => void = () => {};
    vi.mocked(api.fetchConflicts).mockReturnValueOnce(new Promise((r) => { resolveNext = r; }) as never);
    const pending = useInferenceConflictStore.getState().load();
    expect(useInferenceConflictStore.getState()).toMatchObject({ status: "loading", error: null });
    resolveNext({ conflicts: [], total: 0 });
    await pending;
    expect(useInferenceConflictStore.getState()).toMatchObject({ status: "empty", error: null });
  });

  it("property：写操作失败落 operationError，不改主请求 status/error", async () => {
    const api = await import("@/features/property-gov/property-api");
    const { usePropertyStore } = await import("@/features/property-gov/property-store");
    vi.mocked(api.fetchCheckResults).mockResolvedValueOnce({ items: [{ componentId: "c1" }], summary: null, workingRevisions: {} } as never);
    await usePropertyStore.getState().load();
    expect(usePropertyStore.getState()).toMatchObject({ status: "success", error: null });

    vi.mocked(api.applyPropertyRepair).mockRejectedValueOnce(new Error("写门拒绝"));
    const ok = await usePropertyStore.getState().repair({ componentId: "c1" } as never, "set" as never, {} as never);
    expect(ok).toBe(false);
    expect(usePropertyStore.getState()).toMatchObject({ status: "success", error: null, operationError: "写门拒绝", repairingId: null });
  });
});
