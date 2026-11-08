import { fireEvent, render, screen } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/document-inventory", () => ({ DocumentSearchBar: () => null }));
vi.mock("@/features/impact-analysis/ImpactAnalysisView", () => ({ ImpactAnalysisView: () => <div>影响面分析页</div> }));
vi.mock("@/features/architecture-version/ArchitectureVersionView", () => ({ ArchitectureVersionView: () => <div>版本对比页</div> }));
vi.mock("@/features/document-inventory/DocumentInventoryView", () => ({ DocumentInventoryView: () => null }));
vi.mock("@/features/dashboard/DashboardView", () => ({ DashboardView: () => <div>dashboard</div> }));
vi.mock("@/features/admission/AdmissionView", () => ({ AdmissionView: () => null })); vi.mock("@/features/review/ReviewView", () => ({ ReviewView: () => null })); vi.mock("@/features/gap-engine/GapEngineView", () => ({ GapEngineView: () => null })); vi.mock("@/features/property-gov/PropertyGovView", () => ({ PropertyGovView: () => null })); vi.mock("@/features/entity-compliance/EntityComplianceView", () => ({ EntityComplianceView: () => null })); vi.mock("@/features/schema-manager/SchemaManagerView", () => ({ SchemaManagerView: () => null }));

describe("impact analysis navigation", () => {
  beforeEach(() => { window.location.hash = "#/dashboard"; });
  it("opens the feature page from the always-on sidebar", async () => { render(<App />); fireEvent.click(screen.getByRole("button", { name: TERM.TASK_IMPACT_ANALYSIS })); expect(await screen.findByText("影响面分析页")).toBeInTheDocument(); });
  it("opens architecture version comparison from the always-on sidebar", async () => { render(<App />); fireEvent.click(screen.getByRole("button", { name: TERM.VERSION_ANALYSIS })); expect(await screen.findByText("版本对比页")).toBeInTheDocument(); });
});
