import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateField } from "@/components/entity-repair";

describe("DateField calendar popover", () => {
  it("opens the calendar popover and selects a date output as YYYY-MM-DD", () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="创建日期 日期" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "创建日期 日期" }));
    // 日历打开（react-day-picker 渲染 role=grid）
    expect(screen.getByRole("grid")).toBeInTheDocument();
    // 选择一个日期（15 号），输出统一为 YYYY-MM-DD
    fireEvent.click(screen.getAllByRole("gridcell", { name: "15" })[0]);
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-15$/));
  });

  it("clears the selected date back to an empty value", () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="创建日期 日期" value="2026-08-02" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "创建日期 日期" }));
    fireEvent.click(screen.getByRole("button", { name: "清除日期" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("echoes the current YYYY-MM-DD value on the trigger for re-opening", () => {
    render(<DateField ariaLabel="最后更新日期 日期" value="2026-08-02" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "最后更新日期 日期" })).toHaveTextContent("2026-08-02");
  });

  it("disables the trigger when the field is disabled", () => {
    render(<DateField ariaLabel="创建日期 日期" value="" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "创建日期 日期" })).toBeDisabled();
  });
});
