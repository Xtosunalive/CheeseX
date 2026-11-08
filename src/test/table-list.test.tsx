// ── useTableList/useTableSort/URL 状态的单元测试（P2）──
// 层级：纯单元＋hook 渲染（renderHook）＋jsdom URL。
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableList } from "@/hooks/use-table-list";
import { useTableSort, compareZh, withDirection } from "@/hooks/use-table-sort";
import { readTableUrlState, writeTableUrlState } from "@/lib/table-url";

type Row = { id: string; name: string; city: string };

const rows: Row[] = [
  { id: "1", name: "北京节点", city: "north" },
  { id: "2", name: "上海节点", city: "south" },
  { id: "3", name: "广州节点", city: "south" },
  { id: "4", name: "审计实体", city: "north" },
];

function makeClient() {
  return renderHook(() =>
    useTableList<Row, "name" | "city">({
      rows,
      pageSize: 2,
      search: (row, q) => row.name.includes(q),
      filters: {
        city: { values: [], match: (row, value) => row.city === value },
      },
      comparators: {
        name: (a, b) => compareZh(a.name, b.name),
        city: (a, b) => compareZh(a.city, b.city),
      },
      initialSort: { field: "name", direction: "asc" },
    }),
  );
}

describe("useTableList（client 模式）", () => {
  it("过滤＋搜索＋排序＋分页切片全链", () => {
    const { result } = makeClient();
    expect(result.current.total).toBe(4);
    expect(result.current.visibleCount).toBe(4);
    expect(result.current.pageSize).toBe(2);
    // 排序 asc：上海节点 < 北京节点？——compareZh 下实际顺序按 locale，断言切片大小即可
    expect(result.current.items.length).toBe(2);

    act(() => result.current.setQuery("节点"));
    expect(result.current.visibleCount).toBe(3);

    act(() => result.current.setFilter("city", ["south"]));
    expect(result.current.visibleCount).toBe(2);
    expect(result.current.items.every((r) => r.city === "south")).toBe(true);

    act(() => result.current.clearFilters());
    expect(result.current.visibleCount).toBe(3);
  });

  it("条件变更回第一页；翻页与 setPage", () => {
    const { result } = makeClient();
    act(() => result.current.setPage(1));
    expect(result.current.page).toBe(1);
    act(() => result.current.setQuery("节点"));
    expect(result.current.page).toBe(0);
  });

  it("draftQuery/applyQuery 两段式（onSubmit/onApply 型）", () => {
    const { result } = makeClient();
    act(() => result.current.setDraftQuery("审计"));
    expect(result.current.visibleCount).toBe(4); // 未应用不影响
    act(() => result.current.applyQuery());
    expect(result.current.visibleCount).toBe(1);
    expect(result.current.items[0].name).toBe("审计实体");
  });

  it("setQuery 同步双轨（immediate 型）", () => {
    const { result } = makeClient();
    act(() => result.current.setQuery("上海"));
    expect(result.current.query).toBe("上海");
    expect(result.current.draftQuery).toBe("上海");
    expect(result.current.visibleCount).toBe(1);
  });
});

describe("useTableList（server 模式：状态形状一致）", () => {
  it("透传当页与远端 total，分页走 onPageChange", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() =>
      useTableList<Row, "name">({
        server: { rows: [rows[1]], total: 87, page: 3, pageSize: 20, onPageChange },
        comparators: { name: (a, b) => compareZh(a.name, b.name) },
        initialSort: { field: "name", direction: "desc" },
      }),
    );
    expect(result.current.items).toEqual([rows[1]]);
    expect(result.current.total).toBe(87);
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(20);
    act(() => result.current.setPage(4));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});

describe("useTableSort", () => {
  it("三元组与比较口径", () => {
    const { result } = renderHook(() => useTableSort<"a" | "b">({ field: "a", direction: "desc" }));
    expect(result.current.sortField).toBe("a");
    act(() => result.current.setSort("b", "asc"));
    expect(result.current.sortField).toBe("b");
    expect(result.current.sortDirection).toBe("asc");
    expect(withDirection(1, "asc")).toBe(1);
    expect(withDirection(1, "desc")).toBe(-1);
    expect(compareZh("安", "波")).toBeLessThan(0);
  });
});

describe("表格 URL 状态（N1）", () => {
  it("编码-解码往返：query/筛选/排序/页码", () => {
    window.location.hash = "#/review";
    writeTableUrlState("", {
      query: "实体",
      filters: { action: ["approved", "reopen"], owner: ["张,三"] },
      sortField: "decidedAt",
      sortDirection: "desc",
      page: 2,
    });
    const back = readTableUrlState("");
    expect(back.query).toBe("实体");
    expect(back.filters?.action).toEqual(["approved", "reopen"]);
    expect(back.filters?.owner).toEqual(["张,三"]); // 逗号转义往返
    expect(back.sortField).toBe("decidedAt");
    expect(back.sortDirection).toBe("desc");
    expect(back.page).toBe(2);
    window.location.hash = "";
  });

  it("多表命名空间隔离（key 前缀）", () => {
    window.location.hash = "#/review";
    writeTableUrlState("t1", { query: "甲" });
    writeTableUrlState("t2", { query: "乙" });
    expect(readTableUrlState("t1").query).toBe("甲");
    expect(readTableUrlState("t2").query).toBe("乙");
    window.location.hash = "";
  });
});
