// SPEC-029 类级回归：发布前常态（NO_CURRENT_RELEASE）不进错误横幅——三页分支断言
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/document-inventory/document-inventory-store", () => ({
  useDocumentInventoryStore: () => ({ status: "error", error: "No current Release\n排查编号：tr_x", result: null, candidateResult: null, filters: {}, expandedCards: {}, query: () => {}, clearAllFilters: () => {}, clearFilter: () => {}, toggleCard: () => {}, loadNode: () => {}, initialLoad: () => {} }),
}));
vi.mock("@/features/document-inventory/components/DocumentSearchBar", () => ({ DocumentSearchBar: () => null }));

import { DocumentInventoryView } from "@/features/document-inventory/DocumentInventoryView";

describe("发布前常态（SPEC-029）类级守卫", () => {
  it("document-inventory：无 Release → 空态引导，不渲染错误横幅与排查编号", () => {
    render(<DocumentInventoryView />);
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument(); // Master 2026-10-29：空态即结构——引导卡退役
    expect(screen.queryByText(/No current Release/)).not.toBeInTheDocument();
    expect(screen.queryByText(/排查编号/)).not.toBeInTheDocument();
  });
});
