// @responsible: seq205 展示即事实——store 打开抽屉自动重验接线 + 值语义分槽 + 计数单源
// @inputs: vi.mock entity-compliance-api + zustand store 直驱（既有先例形态）
// @outputs: vitest 断言（规则 28：行为测试覆盖正常路径与失败路径）
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchEntityCheckOne = vi.fn();
vi.mock("@/features/entity-compliance/entity-compliance-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/entity-compliance/entity-compliance-api")>();
  return { ...original, fetchEntityCheckOne: (...args: unknown[]) => fetchEntityCheckOne(...args) };
});

import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";
import { repairableFieldIssues } from "@/features/entity-compliance/repairable-fields";
import type { EntityComplianceResult } from "@/features/entity-compliance/entity-compliance-types";
import { EntityComplianceCard } from "@/features/entity-compliance/EntityComplianceCard";
import { EntityRepairDrawer } from "@/features/entity-compliance/EntityRepairDrawer";
import { PropertyCheckRow } from "@/features/entity-compliance/PropertyCheckRow";
import { MemoryRouter } from "react-router-dom";

type Check = { ruleId: string; field: string; label: string; severity: string; passed: boolean; editable: boolean; value: unknown; message: string; reason?: string; suggestions?: { value: unknown }[] };

function makeEntity(overrides: Record<string, unknown> = {}): EntityComplianceResult {
  return {
    entityId: "live", title: "Live", fileName: "live.md", sourceKey: "知识库/wiki/entities/live.md",
    sourceExists: true, sourceType: "entity", architectureIntent: "active", score: 60,
    blockerCount: 0, warningCount: 2, infoCount: 0,
    groups: [{ id: "fields", label: "受管属性", checks: [
      { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写", reason: "missing" },
      { ruleId: "F06", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "", message: "arch_layer 取值非法" },
      { ruleId: "F07", field: "module", label: "module", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写", reason: "missing", suggestions: [{ value: "Fixture模块" }] },
    ] as Check[] }],
    ...overrides,
  } as unknown as EntityComplianceResult;
}

function freshEntity() {
  return makeEntity({
    score: 95, blockerCount: 0, warningCount: 0,
    groups: [{ id: "fields", label: "受管属性", checks: [
      { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "service", message: "尚未填写" },
      { ruleId: "F07", field: "module", label: "module", severity: "warn", passed: false, editable: true, value: "Fixture模块", message: "尚未填写" },
    ] as Check[] }],
  });
}

beforeEach(() => {
  fetchEntityCheckOne.mockReset();
  useEntityComplianceStore.setState({
    data: null, selectedEntity: null, repairOpen: false, creatingEntity: false,
    repairChanges: {}, relationPatch: null, preview: null, applyResult: null, repairStatus: "idle",
    repairError: null, repairBlockers: [], refreshingSourceKey: null,
  } as unknown as Parameters<typeof useEntityComplianceStore.setState>[0]);
});

describe("seq205 展示即事实", () => {
  it("openRepair 自动触发单实体现读并用最新结果替换选中实体（值随之变新）", async () => {
    const stale = makeEntity();
    fetchEntityCheckOne.mockResolvedValue(freshEntity());
    useEntityComplianceStore.getState().openRepair(stale);
    await vi.waitFor(() => expect(fetchEntityCheckOne).toHaveBeenCalledWith("知识库/wiki/entities/live.md"));
    await vi.waitFor(() => {
      const selected = useEntityComplianceStore.getState().selectedEntity;
      expect(selected?.score).toBe(95);
      const layer = selected?.groups?.[0]?.checks?.find((c) => c.field === "arch_layer");
      expect(layer?.value).toBe("service");
    });
    expect(useEntityComplianceStore.getState().refreshingSourceKey).toBeNull();
  });

  it("创建流（sourceExists=false）不触发重验；重验失败保留基座并给出非致命提示", async () => {
    fetchEntityCheckOne.mockRejectedValue(new Error("network down"));
    const ghost = makeEntity({ sourceExists: false, sourceKey: "知识库/wiki/entities/ghost.md" });
    useEntityComplianceStore.getState().openRepair(ghost);
    expect(fetchEntityCheckOne).not.toHaveBeenCalled();

    useEntityComplianceStore.getState().openRepair(makeEntity());
    await vi.waitFor(() => expect(useEntityComplianceStore.getState().refreshingSourceKey).toBeNull());
    expect(useEntityComplianceStore.getState().repairError).toContain("实时刷新失败");
    expect(useEntityComplianceStore.getState().selectedEntity).not.toBeNull();
  });

  it("计数单源：同字段双检查按字段去重；卡片徽标与抽屉渲染同出 selector", () => {
    const report = repairableFieldIssues(makeEntity());
    expect(report.count).toBe(2);
    // seq206 双口径：failedCount 只数未通过字段（arch_layer 未过；module 未过 → 2），count 为全部可编辑编辑面
    expect(report.failedCount).toBe(2);
    expect(report.issues.map((issue) => issue.field)).toEqual(["arch_layer", "module"]);
    expect(report.issues[0].checks).toHaveLength(2);

    render(<MemoryRouter><EntityComplianceCard entity={makeEntity()} /></MemoryRouter>);
    const button = screen.getByRole("button", { name: /修复 2 字段/ });
    expect(button).toBeTruthy();
  });

  it("复核 CONCERN-2：同字段一锁一改两条检查时，徽章与抽屉同按合并能力位（不分叉）", () => {
    // WP-113 M2 随迁：示例字段从 architecture-node-id 改为 title——身份号已入托管家族（任何合并口径下
    // 都不出写入口，见 EntityRepairDrawer 托管短路），「合并可改→出控件」这条不变式改由 title 承担样本。
    const mixed = makeEntity({
      sourceValues: { title: "Live 混检" },
      groups: [{ id: "fields", label: "受管属性", checks: [
        { ruleId: "F01", field: "title", label: "实体名称", severity: "error", passed: true, editable: false, value: null, message: "通过" },
        { ruleId: "F01x", field: "title", label: "实体名称", severity: "warn", passed: false, editable: true, value: null, message: "另一条检查未过" },
      ] as Check[] }],
    });
    const report = repairableFieldIssues(mixed);
    expect(report.issues[0].locked).toBe(false); // 合并值：任一检查可改即可改
    expect(report.failedCount).toBe(1);

    useEntityComplianceStore.setState({ selectedEntity: mixed, repairOpen: true } as unknown as Parameters<typeof useEntityComplianceStore.setState>[0]);
    render(<EntityRepairDrawer />);
    const row = screen.getByRole("button", { name: /实体名称，当前值 Live 混检/ });
    expect(row).not.toHaveAccessibleName(/创建后不可修改|系统托管/);
    fireEvent.click(row);
    expect(screen.getByRole("textbox", { name: /实体名称/ })).toBeInTheDocument(); // 与徽章同口径：改得动
  });

  it("复核回件 C2/C3（WP-110 随批）：锁死行须有现值通道才成行；锁死行不参与徽标", () => {
    const entity = makeEntity({
      sourceValues: { "architecture-node-id": "dup-id" },
      groups: [{ id: "fields", label: "受管属性", checks: [
        { ruleId: "F02b", field: "architecture-node-id", label: "架构组件身份", severity: "error", passed: false, editable: false, value: null, message: "该身份已被他人占用" },
        { ruleId: "F17", field: "aliases", label: "别名", severity: "warn", passed: false, editable: false, value: null, message: "别名冲突" },
      ] as Check[] }],
    });
    const report = repairableFieldIssues(entity);
    // 诊断侧 EDITABLE_FIELDS 不含 aliases → 现值通道没这个键；判据分离后若无通道也成行，
    // 用户面对的是「当前值未填写」的真实旧别名表，填一个即整体覆盖（复核实测）。
    expect(report.issues.map((issue) => issue.field)).toEqual(["architecture-node-id"]);
    expect(report.failedCount).toBe(0); // 未通过但改不动（改名出口 PR-229④ 未批）→ 不计徽标，防死胡同徽章

    render(<MemoryRouter><EntityComplianceCard entity={entity} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /修复 \d+ 字段/ })).toBeNull();

    useEntityComplianceStore.setState({ selectedEntity: entity, repairOpen: true } as unknown as Parameters<typeof useEntityComplianceStore.setState>[0]);
    render(<EntityRepairDrawer />);
    // WP-113 M2 随迁：身份号已入托管家族——锁死文案短路为「系统托管，只读」（写入口由铸造口供给）
    expect(screen.getByRole("button", { name: /架构组件身份，当前值 dup-id（系统托管，只读）/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /别名，当前值/ })).toBeNull();
  });

  it("seq206 徽标口径：全通过但有可编辑编辑面 → 卡片按钮隐藏；徽标 N = 未通过字段数", () => {
    const healthyEditable = makeEntity({
      groups: [{ id: "g", label: "g", checks: [
        { ruleId: "F11", field: "module", label: "产品模块", severity: "info", passed: true, editable: true, value: ["Ceph", "MySQL"], message: "通过" },
      ] as Check[] }],
    });
    const report = repairableFieldIssues(healthyEditable);
    expect(report.count).toBe(1);
    expect(report.failedCount).toBe(0);

    render(<MemoryRouter><EntityComplianceCard entity={healthyEditable} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /修复 \d+ 字段/ })).toBeNull();
  });

  it("seq206 抽屉排序：未通过的字段排前，已通过可编辑字段跟后（编辑面不缩水）", () => {
    const mixed = makeEntity({
      groups: [{ id: "g", label: "g", checks: [
        { ruleId: "F11", field: "module", label: "产品模块", severity: "info", passed: true, editable: true, value: ["Ceph"], message: "通过" },
        { ruleId: "F05", field: "arch_layer", label: "架构分层", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写", reason: "missing" },
      ] as Check[] }],
    });
    useEntityComplianceStore.setState({ selectedEntity: mixed, repairOpen: true, repairChanges: {} } as unknown as Parameters<typeof useEntityComplianceStore.setState>[0]);
    render(<EntityRepairDrawer />);
    // PR-026 池行式：排序断言落在行级（未通过字段行在 DOM 序上先于已通过字段行）——
    // 至多一行展开的池交互下，控件序不再承载排序语义，行序才是用户看到的顺序。
    const layerRow = screen.getByRole("button", { name: /架构分层.*当前值/ });
    const moduleRow = screen.getByRole("button", { name: /产品模块.*当前值/ });
    expect(layerRow.compareDocumentPosition(moduleRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 展开未通过字段行，控件挂载可编辑（编辑面不缩水的运行时证据）
    fireEvent.click(layerRow);
    expect(screen.getByRole("textbox", { name: /架构分层/ })).toBeInTheDocument();
  });

  it("seq207 诊断不拥有值：finding.value=None 时编辑框渲染 sourceValues 文件真值", () => {
    const staleDiagnostic = makeEntity({
      sourceValues: { arch_layer: "service", title: "Live" },
      groups: [{ id: "g", label: "g", checks: [
        { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: null, message: "arch_layer 取值非法" },
      ] as Check[] }],
    }) as EntityComplianceResult;
    useEntityComplianceStore.setState({ selectedEntity: staleDiagnostic, repairOpen: true, repairChanges: {} } as unknown as Parameters<typeof useEntityComplianceStore.setState>[0]);
    render(<EntityRepairDrawer />);
    fireEvent.click(screen.getByRole("button", { name: /架构分层.*当前值/ }));
    const layerInput = screen.getByRole("textbox", { name: /架构分层/ }) as HTMLInputElement;
    expect(layerInput.value).toBe("service");
  });

  it("seq208 检查行现值列读 sourceValues：文件有值显示真值，无值显示 —", () => {
    render(
      <PropertyCheckRow finding={{ ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: true, editable: true, value: null, message: "" }} sourceValues={{ arch_layer: "intelligence" }} />
    );
    expect(screen.getByText("intelligence")).toBeTruthy();
    render(
      <PropertyCheckRow finding={{ ruleId: "F06", field: "arch_category", label: "arch_category", severity: "warn", passed: true, editable: true, value: null, message: "" }} sourceValues={{}} />
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("seq208 fail-closed：sourceValues 缺失时编辑框为空，不回退诊断 value（值所有权执法）", () => {
    const legacyEntity = makeEntity({
      groups: [{ id: "g", label: "g", checks: [
        { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "stale-diagnostic", message: "arch_layer 取值非法" },
      ] as Check[] }],
    }) as EntityComplianceResult;
    delete (legacyEntity as { sourceValues?: unknown }).sourceValues;
    useEntityComplianceStore.setState({ selectedEntity: legacyEntity, repairOpen: true, repairChanges: {} } as unknown as Parameters<typeof useEntityComplianceStore.setState>[0]);
    render(<EntityRepairDrawer />);
    fireEvent.click(screen.getByRole("button", { name: /架构分层.*当前值/ }));
    const layerInput = screen.getByRole("textbox", { name: /架构分层/ }) as HTMLInputElement;
    expect(layerInput.value).toBe("");
  });

  it("渲染门槛：server editable 但不在前端 EDITABLE 的检查不进 selector（与抽屉渲染同门槛）", () => {
    const entity = makeEntity({
      groups: [{ id: "g", label: "g", checks: [
        { ruleId: "R1", field: "arch_layer", label: "", severity: "warn", passed: false, editable: true, value: "", message: "m" },
        { ruleId: "R2", field: "unknown-field-x", label: "", severity: "warn", passed: false, editable: true, value: "", message: "m" },
        { ruleId: "R3", field: "module", label: "", severity: "info", passed: true, editable: true, value: "x", message: "通过" },
      ] as Check[] }],
    });
    // 口径与旧抽屉渲染超集一致：已通过但可编辑的检查（module 多值编辑面）同样计入（#1409 锚定），只过滤 EDITABLE 外字段
    const report = repairableFieldIssues(entity);
    expect(report.count).toBe(2);
    expect(report.failedCount).toBe(1);
    expect(report.issues.map((issue) => issue.failed)).toEqual([true, false]);
  });
});
