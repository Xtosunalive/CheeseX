import { fireEvent, render, screen } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { describe, expect, it } from "vitest";
import { CardNav } from "@/features/document-inventory/components/CardNav";

describe("CardNav overlay layering", () => {
  it("keeps the search bar and portalled menu below global drawers", () => {
    const { container } = render(
      <CardNav
        searchSlot={<input aria-label={TERM.DOCUMENT_SEARCH_INPUT} />}
        items={[{ label: "筛选", bgColor: "#111", textColor: "#fff", content: <span>筛选内容</span> }]}
      />,
    );

    const nav = container.querySelector<HTMLElement>(".card-nav-container");
    expect(nav).not.toBeNull();
    expect(nav).toHaveStyle({ zIndex: "10" });

    fireEvent.click(screen.getByRole("button", { name: "筛选菜单" }));
    expect(screen.getByRole("menu")).toHaveStyle({ zIndex: "40" });
  });
});
