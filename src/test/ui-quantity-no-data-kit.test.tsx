// WP-134 波0 类型闸口钉：未知必须与真零可分辨，且六处「length - 写死常数」的减法有单一出口。
// 差分性质＝本文件向 Statistic/TablePagination/SidebarHeader 传 null——
// 一旦 kit props 的 `| null` 被撤，本文件 `npx tsc --noEmit` 必红（不是行为断言，是编译期钉子）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Statistic } from "@/components/statistic/Statistic";
import { TablePagination } from "@/components/table-pagination/TablePagination";
import { SidebarHeader } from "@/components/app-shell/sidebar-primitives";
import { sliceWithRest } from "@/lib/format";

describe("未知≠真零：三处共享件的类型闸口", () => {
  it("Statistic：value=null 渲染「—」，value=0 仍照实渲染 0（正对照）", () => {
    const { rerender } = render(<Statistic label="待审核关系" value={null} testId="stat-unknown" />);
    expect(screen.getByTestId("stat-unknown").textContent).toContain("—");
    rerender(<Statistic label="待审核关系" value={0} testId="stat-zero" />);
    expect(screen.getByTestId("stat-zero").textContent).toContain("0");
    expect(screen.getByTestId("stat-zero").textContent).not.toContain("—");
  });

  it("TablePagination：total=null 与 total=0 同形隐藏（WP-037 P5 已签收），但类型可分辨；总数标签不再冠名「全量」", () => {
    const { rerender } = render(
      <TablePagination page={0} pageSize={50} total={null} onPageChange={() => {}} />,
    );
    expect(screen.queryByTestId("table-pagination")).toBeNull();
    rerender(<TablePagination page={0} pageSize={50} total={0} onPageChange={() => {}} />);
    expect(screen.queryByTestId("table-pagination")).toBeNull();
    rerender(<TablePagination page={0} pageSize={50} total={120} onPageChange={() => {}} />);
    const bar = screen.getByTestId("table-pagination");
    expect(bar.textContent).toContain("/ 共 120");
    expect(bar.textContent).not.toContain("全量");
    expect(bar.textContent).toContain("1–50");
    expect(bar.textContent).toContain("3 页");
  });

  it("SidebarHeader：count=null 不渲染徽章数字（宁缺勿假），count=0 照实显示 0（正对照）", () => {
    const { rerender } = render(<SidebarHeader title="架构组件" count={null} accent="blue" />);
    expect(screen.queryByText("架构组件")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    rerender(<SidebarHeader title="架构组件" count={0} accent="blue" />);
    expect(screen.getByText("0")).toBeTruthy();
  });
});

describe("sliceWithRest：折叠剩余数单源（收口六处 .length - 常数）", () => {
  const items = Array.from({ length: 13 }, (_, i) => i);

  it("超出上限：rest＝被折叠条数", () => {
    const { visible, rest } = sliceWithRest(items, 12);
    expect(visible.length).toBe(12);
    expect(rest).toBe(1);
  });

  it("未超上限：rest 归零，不出现负数（旧写法 `validModules.length - 12` 的真缺陷面）", () => {
    const { visible, rest } = sliceWithRest([1, 2, 3], 12);
    expect(visible.length).toBe(3);
    expect(rest).toBe(0);
  });

  it("limit 大于集合时不抛错、不截多（total 语义）", () => {
    expect(sliceWithRest([], 5)).toEqual({ visible: [], rest: 0 });
  });
});
