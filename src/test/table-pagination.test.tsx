import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TablePagination } from "@/components/table-pagination";

function Fixture() {
  const [page, setPage] = useState(0);
  return <TablePagination ariaLabel="测试列表分页" page={page} pageSize={20} total={75} onPageChange={setPage} />;
}

describe("TablePagination", () => {
  it("shows the shared range and jumps to a typed page", () => {
    render(<Fixture />);
    expect(screen.getByTestId("table-pagination")).toHaveTextContent("1–20 / 共 75");
    const jumpInput = screen.getByRole("textbox", { name: "测试列表分页 跳转页码" });
    fireEvent.change(jumpInput, { target: { value: "3" } });
    fireEvent.keyDown(jumpInput, { key: "Enter" });
    expect(screen.getByTestId("table-pagination")).toHaveTextContent("41–60 / 共 75");

    fireEvent.change(jumpInput, { target: { value: "99" } });
    fireEvent.blur(jumpInput);
    expect(screen.getByTestId("table-pagination")).toHaveTextContent("61–75 / 共 75");
    expect(jumpInput).toHaveValue("4");
  });

  it("WP-037 P5：总数 0 时整块隐藏（禁「0–0 / 共 0 第 / 1 页」假分页），总数>0 恢复", () => {
    function ZeroFixture() {
      const [page, setPage] = useState(0);
      return <TablePagination ariaLabel="零数据分页" page={page} pageSize={20} total={0} onPageChange={setPage} />;
    }
    const { container, unmount } = render(<ZeroFixture />);
    expect(container.querySelector('[data-testid="table-pagination"]')).toBeNull();
    unmount();

    render(<Fixture />);
    expect(screen.getByTestId("table-pagination")).toBeInTheDocument();
  });
});
