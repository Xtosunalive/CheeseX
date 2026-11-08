import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilterSelect } from "@/components/filter-select";

const options = [
  { value: "pending", label: "待决定", group: "准入状态" },
  { value: "approved", label: "已批准", group: "准入状态" },
  { value: "submitted", label: "已提交", group: "准入状态" },
];

function MultipleFixture() {
  const [value, setValue] = useState<string[]>([]);
  return <FilterSelect ariaLabel="筛选状态" title="按状态筛选" searchPlaceholder="筛选状态" multiple variant="filter" value={value} onValueChange={(next) => setValue(next as string[])} emptyLabel="全部状态" placeholder="状态" options={options} />;
}

function SingleFixture() {
  const [value, setValue] = useState("pending");
  return <FilterSelect ariaLabel="选择状态" title="选择状态" value={value} onValueChange={(next) => setValue(next as string)} options={options} />;
}

describe("FilterSelect", () => {
  it("searches, selects multiple values, shows a count, and clears all", () => {
    render(<MultipleFixture />);
    const trigger = screen.getByRole("button", { name: "筛选状态" });
    expect(trigger).toHaveAttribute("data-select-variant", "filter");
    expect(trigger).toHaveClass("h-8", "bg-transparent", "text-xs");
    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    expect(screen.getByRole("dialog")).toHaveClass("w-[min(288px,calc(100vw-32px))]", "rounded-md", "ring-border-thin");
    expect(screen.getByRole("heading", { name: "按状态筛选" })).toHaveClass("text-sm");
    const search = screen.getByRole("textbox", { name: "筛选状态" });
    expect(search).toHaveClass("text-xs");
    fireEvent.change(search, { target: { value: "批准" } });
    const approvedOption = screen.getByRole("menuitemcheckbox", { name: "已批准" });
    expect(approvedOption).toHaveClass("text-xs");
    fireEvent.click(approvedOption);
    fireEvent.change(screen.getByRole("textbox", { name: "筛选状态" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "已提交" }));
    expect(screen.getByRole("button", { name: "筛选状态" })).toHaveTextContent("状态 (2)");
    expect(screen.getByText("最近的")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "全部状态" }));
    expect(screen.getByRole("button", { name: "筛选状态" })).toHaveTextContent("全部状态");
  });

  it("keeps single-select semantics and closes after selection", () => {
    render(<SingleFixture />);
    expect(screen.getByRole("button", { name: "选择状态" })).toHaveClass("h-8", "bg-surface-root", "text-xs", "ring-1", "ring-border-thin");
    fireEvent.click(screen.getByRole("button", { name: "选择状态" }));
    fireEvent.click(screen.getByRole("option", { name: "已批准" }));
    expect(screen.getByRole("button", { name: "选择状态" })).toHaveTextContent("已批准");
    expect(screen.queryByRole("textbox", { name: "筛选选择状态" })).not.toBeInTheDocument();
  });

  it("closes consistently when the user clicks outside the menu", () => {
    render(<><SingleFixture /><button type="button">页面空白操作</button></>);
    fireEvent.click(screen.getByRole("button", { name: "选择状态" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "页面空白操作" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择状态" })).toHaveAttribute("aria-expanded", "false");
  });
});
