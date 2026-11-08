import { fireEvent, render, screen, within } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

vi.mock("@/features/document-inventory/DocumentInventoryView", () => ({ DocumentInventoryView: () => <div>文档溯源检索页</div> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/features/dashboard/DashboardView", () => ({ DashboardView: () => <div>dashboard</div> }));
vi.mock("@/features/admission/AdmissionView", () => ({ AdmissionView: () => null }));
vi.mock("@/features/review/ReviewView", () => ({ ReviewView: () => null }));
vi.mock("@/features/gap-engine/GapEngineView", () => ({ GapEngineView: () => null }));
vi.mock("@/features/property-gov/PropertyGovView", () => ({ PropertyGovView: () => null }));
vi.mock("@/features/entity-compliance/EntityComplianceView", () => ({ EntityComplianceView: () => null }));
vi.mock("@/features/schema-manager/SchemaManagerView", () => ({ SchemaManagerView: () => null }));

describe("document inventory navigation", () => {
  beforeEach(() => { window.location.hash = "#/dashboard"; });

  it("opens the page from the global navigation sheet", async () => {
    render(<App />);
    fireEvent.click(within(screen.getByRole("complementary", { name: "全局导航" })).getByRole("button", { name: TERM.DOC_LOOKUP }));
    expect(window.location.hash).toBe("#/document-inventory");
    // F3 视图懒加载：视图首挂异步解析，改 findBy 等待
    expect(await screen.findByText("文档溯源检索页")).toBeInTheDocument();
  });
});
