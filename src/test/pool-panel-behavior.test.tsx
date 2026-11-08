// PR-026 任务池容器行为测试：三档视口（宽/窄切换+唤回）、底部 2×2 操作条、清除全部、布尔开关行。
// @inputs: zustand store 直驱 + jsdom resize 回退路径（use-narrow-viewport 无 matchMedia 时走 window resize）
// @outputs: vitest 断言（容器几何类、窄屏隐藏、唤回恢复、footer 网格、store 清空语义）
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityRepairDrawer } from "@/features/entity-compliance/EntityRepairDrawer";
import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";

const WIDE_ENTITY = {
  entityId: "svc", title: "MySQL", fileName: "MySQL.md", sourceKey: "知识库/wiki/entities/MySQL.md",
  sourceExists: true, sourceRevision: { mtimeMs: 1, size: 1, contentHash: "sha256:x" },
  blockerCount: 2, warningCount: 0, infoCount: 0, score: 50,
  sourceValues: { arch_layer: "service" },
  groups: [{ id: "g", label: "g", checks: [
    { ruleId: "F03", field: "arch_layer", label: "架构分层", severity: "error", passed: false, value: null, message: "缺少层级", editable: true, allowedValues: ["service"] },
    { ruleId: "F04", field: "arch_component", label: "架构组件标记", severity: "error", passed: false, value: null, message: "必须为 true", editable: true },
  ] }],
} as never;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

describe("PR-026 任务池容器行为", () => {
  afterEach(() => {
    setViewportWidth(1280);
    vi.restoreAllMocks();
  });

  it("宽视口渲染 300px 停靠池卡片（毛玻璃+圆角+投影），480px 通顶形态退役", () => {
    setViewportWidth(1280);
    useEntityComplianceStore.setState({ selectedEntity: WIDE_ENTITY, repairOpen: true, repairChanges: {} } as never);
    render(<EntityRepairDrawer />);
    const pool = screen.getByRole("complementary", { name: "修复 MySQL" });
    // 目检④改版：停靠卡片（App 池槽 portal，与主内容并排）——不再是 fixed 悬浮
    expect(pool).toHaveClass("w-[300px]", "shrink-0", "bg-glass", "rounded-[var(--radius-panel)]", "shadow-card", "backdrop-blur-md", "ring-1", "ring-border-thin");
    expect(pool).not.toHaveClass("fixed");
    expect(pool).not.toHaveClass("sm:w-[480px]");
  });

  it("窄视口（≤800px）整块隐藏，无唤回钮时不可见；宽视口恢复渲染", () => {
    setViewportWidth(1280);
    useEntityComplianceStore.setState({ selectedEntity: WIDE_ENTITY, repairOpen: true, repairChanges: {} } as never);
    render(<EntityRepairDrawer />);
    expect(screen.getByRole("complementary", { name: "修复 MySQL" })).toBeInTheDocument();

    act(() => setViewportWidth(760));
    expect(screen.queryByRole("complementary", { name: "修复 MySQL" })).not.toBeInTheDocument();

    act(() => setViewportWidth(900));
    expect(screen.getByRole("complementary", { name: "修复 MySQL" })).toBeInTheDocument();
  });

  it("底部操作条 2×2 等宽网格：清除全部/生成空字段/查看修复结果/直接写回（唯一主钮）", () => {
    setViewportWidth(1280);
    useEntityComplianceStore.setState({ selectedEntity: WIDE_ENTITY, repairOpen: true, repairChanges: {} } as never);
    render(<EntityRepairDrawer />);
    const footer = screen.getByRole("complementary", { name: "修复 MySQL" }).querySelector("footer");
    expect(footer).not.toBeNull();
    expect(footer).toHaveClass("border-t", "border-border-thin");
    expect(footer?.querySelector(".grid")).toHaveClass("grid-cols-2");
    expect(screen.getByRole("button", { name: "清除全部" })).toHaveClass("h-8");
    expect(screen.getByRole("button", { name: "生成空字段" })).toHaveClass("bg-accent-bg");
    expect(screen.getByRole("button", { name: "查看修复结果" })).toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "直接写回" });
    expect(primary).toHaveClass("bg-accent-base", "text-accent-contrast");
  });

  it("清除全部只清编辑态，任务本体保留", () => {
    setViewportWidth(1280);
    useEntityComplianceStore.setState({
      selectedEntity: WIDE_ENTITY, repairOpen: true,
      repairChanges: { arch_layer: "service" }, repairStatus: "preview_ready" as never,
    } as never);
    render(<EntityRepairDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "清除全部" }));
    const state = useEntityComplianceStore.getState();
    expect(state.repairChanges).toEqual({});
    expect(state.repairStatus).toBe("idle");
    expect(state.selectedEntity).not.toBeNull();
    expect(state.repairOpen).toBe(true);
  });

  it("布尔字段渲染开关行：label 居左 + 是/否文字 + switch", () => {
    setViewportWidth(1280);
    useEntityComplianceStore.setState({ selectedEntity: WIDE_ENTITY, repairOpen: true, repairChanges: {} } as never);
    render(<EntityRepairDrawer />);
    // 未通过字段排前：arch_component 行在（点行展开开关行；行 label=TERM.ARCH_COMPONENT「激活为架构组件」）
    fireEvent.click(screen.getByRole("button", { name: /激活为架构组件.*当前值/ }));
    const switchEl = screen.getByRole("switch");
    expect(switchEl).toHaveAttribute("aria-label", expect.stringContaining("架构组件"));
    expect(screen.getByText("否")).toBeInTheDocument();
    fireEvent.click(switchEl);
    expect(useEntityComplianceStore.getState().repairChanges).toMatchObject({ arch_component: true });
    expect(screen.getByText("是")).toBeInTheDocument();
  });
});
