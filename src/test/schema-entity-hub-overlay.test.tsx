import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";
import { useTopologyStore } from "@/lib/topology-store";
import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/document-inventory", () => ({ DocumentSearchBar: () => <div>浮动搜索卡片</div> }));
vi.mock("@/features/dashboard/DashboardView", () => ({ DashboardView: () => <div>dashboard</div> }));
vi.mock("@/features/data-dashboard/DataDashboardView", () => ({ DataDashboardView: () => <div>图谱检索页面</div> }));
vi.mock("@/features/admission/AdmissionView", () => ({ AdmissionView: () => null }));
vi.mock("@/features/review/ReviewView", () => ({ ReviewView: () => null }));
vi.mock("@/features/gap-engine/GapEngineView", () => ({ GapEngineView: () => null }));
vi.mock("@/features/property-gov/PropertyGovView", () => ({ PropertyGovView: () => null }));
vi.mock("@/features/entity-compliance/EntityComplianceView", () => ({ EntityComplianceView: () => null }));
vi.mock("@/features/document-inventory/DocumentInventoryView", () => ({ DocumentInventoryView: () => null }));
vi.mock("@/features/impact-analysis/ImpactAnalysisView", () => ({ ImpactAnalysisView: () => null }));
vi.mock("@/features/schema-manager/SchemaManagerView", () => ({ SchemaManagerView: () => null }));

describe("实体全景 overlay", () => {
  beforeEach(() => {
    window.location.hash = "#/dashboard";
    useHubDrawerState.getState().setOpen(false);
    useTopologyStore.setState({ activeEntityId: null });
    useEntityComplianceStore.getState().closeRepair();
  });

  it("keeps the application bar intact and background interactive while the pool is open", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "搜索文档" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开实体全景" }));

    // 应用栏结构保持存在且直接可交互（PR-026 任务池为非模态悬浮——无遮罩、背景不锁）
    expect(screen.getByRole("button", { name: "搜索文档" })).toBeInTheDocument();
    expect(screen.queryByText("浮动搜索卡片")).not.toBeInTheDocument();
    // 池壳形态：300px 悬浮毛玻璃面板（480px 通顶白条 dialog 形态已退役）
    const pool = screen.getByRole("complementary", { name: "实体全景" });
    expect(pool).toHaveClass("w-[300px]", "bg-glass", "rounded-[var(--radius-panel)]", "shadow-card", "backdrop-blur-md");
  });

  it("renders the entity hub drawer trigger", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "打开实体全景" })).toHaveAttribute("title", "实体全景");
  });

  it("navigates the empty hub to graph overview", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开实体全景" }));
    fireEvent.click(screen.getByRole("button", { name: "前往图谱检索" }));

    expect(window.location.hash).toBe("#/data-dashboard");
    expect(useHubDrawerState.getState().open).toBe(false);
    await waitFor(() => expect(screen.getByText("图谱检索页面")).toBeInTheDocument());
  });

  it("resumes a minimized entity completion task from the global launcher", () => {
    useEntityComplianceStore.setState({
      selectedEntity: { entityId: "", title: "MySQL", fileName: "MySQL.md", sourceKey: "知识库/wiki/entities/MySQL.md", sourceExists: false, blockerCount: 1, warningCount: 0, infoCount: 0, score: 0, groups: [] },
      creatingEntity: true,
      repairOpen: false,
      repairChanges: { title: "MySQL" },
    });
    render(<App />);

    const launcher = screen.getByRole("button", { name: "打开补齐任务" });
    expect(launcher).toHaveAttribute("title", "继续补齐 MySQL");
    fireEvent.click(launcher);
    expect(screen.getByText("创建并补齐 MySQL")).toBeInTheDocument();
    expect(useEntityComplianceStore.getState().repairChanges).toEqual({ title: "MySQL" });
  });
});
