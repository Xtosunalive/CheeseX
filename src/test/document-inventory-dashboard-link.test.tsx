import { render, screen } from "@testing-library/react";
import { TERM } from "@/constants/term-const";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

vi.mock("@/features/document-inventory/DocumentInventoryView", () => ({ DocumentInventoryView: () => <div>文档溯源检索页</div> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/features/dashboard/DashboardView", () => ({ DashboardView: () => <div>dashboard</div> }));
vi.mock("@/features/data-dashboard/DataDashboardView", () => ({ DataDashboardView: () => <div data-testid="hub-host">图谱检索枢纽</div> }));
vi.mock("@/features/admission/AdmissionView", () => ({ AdmissionView: () => null }));
vi.mock("@/features/review/ReviewView", () => ({ ReviewView: () => null }));
vi.mock("@/features/gap-engine/GapEngineView", () => ({ GapEngineView: () => null }));
vi.mock("@/features/property-gov/PropertyGovView", () => ({ PropertyGovView: () => null }));
vi.mock("@/features/entity-compliance/EntityComplianceView", () => ({ EntityComplianceView: () => null }));
vi.mock("@/features/schema-manager/SchemaManagerView", () => ({ SchemaManagerView: () => null }));

describe("document inventory navigation", () => {
  beforeEach(() => { window.location.hash = "#/dashboard"; });

  it("检索入口随第 3 批并入对象浏览器——导航项退役，hash 兼容回落枢纽页签", async () => {
    render(<App />);
    // 导航项已撤（DTO_LOOKUP 归图谱检索枢纽 search 页签）；旧 hash 兼容回落仍可达
    expect(screen.queryByRole("button", { name: TERM.DOC_LOOKUP })).not.toBeInTheDocument();
    window.location.hash = "#/document-inventory";
    // 归一后渲染枢纽宿主（DocumentInventoryView 已被 mock，无其文案）——断言落到 data-dashboard 页签宿主
    await screen.findByTestId("hub-host");
    expect(window.location.hash.startsWith("#/document-inventory")).toBe(true); // hash 透传（页签初值读 sub）
  });
});
