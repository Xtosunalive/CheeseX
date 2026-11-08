import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutocompleteField } from "@/components/entity-repair";

function ControlledAutocomplete({ suggestions }: { suggestions: string[] }) {
  const [value, setValue] = useState("");
  return <AutocompleteField field="version" label="产品版本" value={value} suggestions={suggestions} onChange={setValue} />;
}

describe("AutocompleteField", () => {
  it("shows suggestions on focus and selects one", () => {
    const onChange = vi.fn();
    render(<AutocompleteField field="version" label="产品版本" value="" suggestions={["7.0.0.0", "8.0.0.0"]} onChange={onChange} />);
    fireEvent.focus(screen.getByRole("textbox", { name: "产品版本" }));
    expect(screen.getByRole("listbox", { name: "产品版本 建议" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "7.0.0.0" }));
    expect(onChange).toHaveBeenCalledWith("7.0.0.0");
  });

  it("filters suggestions by the typed value and supports selection", () => {
    render(<ControlledAutocomplete suggestions={["7.0.0.0", "8.0.0.0"]} />);
    const input = screen.getByRole("textbox", { name: "产品版本" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "8" } });
    expect(screen.getByRole("option", { name: "8.0.0.0" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "7.0.0.0" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "8.0.0.0" }));
    expect(input).toHaveValue("8.0.0.0");
  });

  it("hides the suggestion list when there is no match", () => {
    render(<ControlledAutocomplete suggestions={["7.0.0.0"]} />);
    const input = screen.getByRole("textbox", { name: "产品版本" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
