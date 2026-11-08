// navigation 读侧契约（要点 ④）：解析纯函数、读出口、订阅钩子；子路由登记漂移回归。
// 层级：纯单元（parseNavHash）＋ jsdom 行为（readNavLocation/useNavLocation/navigate 写入）。
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { parseNavHash, readNavLocation, getNavQueryParam, navigate } from "@/lib/navigation";
import { useNavLocation } from "@/hooks/use-nav-location";

afterEach(() => {
  window.location.hash = "";
  vi.restoreAllMocks();
});

describe("parseNavHash — 任意 hash 字符串 → route/sub/query 三段", () => {
  it("完整形态：路由＋子路由＋查询", () => {
    const l = parseNavHash("#/review/edges?q=a&page=2");
    expect(l.route).toBe("review");
    expect(l.sub).toBe("edges");
    expect(l.query.get("q")).toBe("a");
    expect(l.query.get("page")).toBe("2");
    expect(l.hash).toBe("#/review/edges?q=a&page=2");
  });

  it("无子路由 sub=null；只有查询时 route 仍正确", () => {
    expect(parseNavHash("#/schema?tab=fields").sub).toBeNull();
    expect(parseNavHash("#/schema?tab=fields").route).toBe("schema");
    expect(parseNavHash("#/schema?tab=fields").query.get("tab")).toBe("fields");
  });

  it("多段子路由保留剩余路径；尾斜杠不产生空 sub", () => {
    expect(parseNavHash("#/admission/a/b").sub).toBe("a/b");
    expect(parseNavHash("#/review/").sub).toBeNull();
  });

  it("空 hash / 裸 # / 无前导斜杠 都得到可用形态", () => {
    expect(parseNavHash("")).toMatchObject({ route: "", sub: null });
    expect(parseNavHash("#")).toMatchObject({ route: "", sub: null });
    expect(parseNavHash("#dashboard").route).toBe("dashboard");
    expect([...parseNavHash("").query.keys()]).toEqual([]);
  });
});

describe("readNavLocation / getNavQueryParam — 读当前地址", () => {
  it("随 window.location.hash 读出三段", () => {
    window.location.hash = "#/property/checks?entityId=E1";
    expect(readNavLocation()).toMatchObject({ route: "property", sub: "checks" });
    expect(getNavQueryParam("entityId")).toBe("E1");
    expect(getNavQueryParam("missing")).toBeNull();
  });
});

describe("useNavLocation — 唯一 hashchange 订阅点", () => {
  it("初值取当前地址，hashchange 后重渲染为新地址", () => {
    window.location.hash = "#/review";
    const { result } = renderHook(() => useNavLocation());
    expect(result.current.route).toBe("review");
    act(() => {
      window.location.hash = "#/review/audit?x=1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current.sub).toBe("audit");
    expect(result.current.query.get("x")).toBe("1");
  });

  it("同一 hash 重复事件不产生新对象（避免无谓渲染）", () => {
    window.location.hash = "#/gaps";
    const { result } = renderHook(() => useNavLocation());
    const first = result.current;
    act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(result.current).toBe(first);
  });
});

describe("子路由登记漂移回归（review/audit、property/mapping）", () => {
  it("两处页签子路由可经 navigate 写入地址栏，不再被判非法", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    navigate("review", { sub: "audit" });
    expect(window.location.hash).toBe("#/review/audit");
    navigate("property", { sub: "mapping" });
    expect(window.location.hash).toBe("#/property/mapping");
    expect(err).not.toHaveBeenCalled();
  });

  it("未登记子路由仍被拒（契约守卫未松动）", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    window.location.hash = "#/review";
    navigate("review", { sub: "nope" });
    expect(window.location.hash).toBe("#/review");
    expect(err).toHaveBeenCalledOnce();
  });
});
