import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { jsx as _jsx } from "react/jsx-runtime";
import { applyPropertyRepair } from "@/features/property-gov/property-api";
import { ComponentCheckDetail } from "@/features/property-gov/ComponentCheckDetail";
import type { CheckResultItem } from "@/features/property-gov/property-types";

const repairApi = vi.hoisted(() => ({
  previewEntityRepair: vi.fn(),
  applyEntityRepair: vi.fn(),
}));

vi.mock(import("@/lib/domain/entity-repair-api"), async (importOriginal) => ({
  ...(await importOriginal()),
  ...repairApi,
}));

const item = {
  componentId: "mysql",
  label: "MySQL",
  module: null,
  archLayer: "data",
  sourcePath: "知识库/wiki/entities/MySQL.md",
  sourcePathExists: true,
  sourceRevision: { mtimeMs: 1, size: 2, contentHash: `sha256:${"a".repeat(64)}` },
  checks: {},
} as CheckResultItem;

describe("seq210: invalid module card value ownership", () => {
  it("现值显示源数据 item.module，不借道诊断对象 value（值所有权法则·property-gov 域）", () => {
    const dirty = {
      ...item,
      module: "file-truth-value",
      checks: {
        invalid_module: { passed: false, value: "diagnostic-echo", validModules: ["MySQL", "Kubernetes"] },
      },
    } as CheckResultItem;
    render(<ComponentCheckDetail item={dirty} />);
    expect(screen.getByText(/file-truth-value/)).toBeTruthy();
    expect(screen.queryByText(/diagnostic-echo/)).toBeNull();
  });
});

describe("property repair Proposal boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repairApi.previewEntityRepair.mockResolvedValue({ previewId: "preview-1" });
    repairApi.applyEntityRepair.mockResolvedValue({ entityId: "mysql", writtenFields: ["module"], backupPath: "", sourceRevision: { mtimeMs: 1, size: 2, contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, postCheck: { blockerCount: 0, warningCount: 0 } });
  });

  it("turns a module repair into an entity repair preview and direct formal-Vault apply", async () => {
    await expect(applyPropertyRepair(item, "set_module", { module: "Database" })).resolves.toMatchObject({ writtenFields: ["module"] });
    expect(repairApi.previewEntityRepair).toHaveBeenCalledWith({
      sourceKey: item.sourcePath,
      sourceRevision: item.sourceRevision,
      createIfMissing: false,
      changes: { module: ["Database"] },
    });
    expect(repairApi.applyEntityRepair).toHaveBeenCalledWith("preview-1");
  });

  it("fails closed before preview when the working source revision is missing", async () => {
    await expect(applyPropertyRepair({ ...item, sourceRevision: undefined }, "set_module", { module: "Database" }))
      .rejects.toThrow("source path or source revision is missing");
    expect(repairApi.previewEntityRepair).not.toHaveBeenCalled();
  });
});

// seq182 红灯：severity 契约值（error/warn/info，http-api.openapi.json ComplianceFinding
// 枚举+entity-compliance-severity.cjs 单源）前端查表漂移——SEV_ICON/SEV_LABEL/SEV_COLOR
// 表键为 legacy 词（blocker/warning/info），服务器产出 error/warn 时查表 miss：
// 标签显示英文裸值 "error"（SEV_LABEL["error"]=undefined → || finding.severity）。
// 目标态：表键对齐契约值，error 级显示「阻断」标签（TERM 单源），legacy 值不再出现。
describe("seq182: severity enum alignment to contract values", () => {
  it("renders Chinese label for contract severity 'error', not the raw value", async () => {
    vi.resetModules();
    const { PropertyCheckRow } = await import("@/features/entity-compliance/PropertyCheckRow");
    render(_jsx(PropertyCheckRow, { finding: { ruleId: "F02", field: "title", severity: "error", passed: false, message: "标题缺失" } as never }));
    expect(screen.getByText("阻断")).toBeInTheDocument();
    expect(screen.queryByText("error")).not.toBeInTheDocument();
  });
  it("renders Chinese label for contract severity 'warn'", async () => {
    vi.resetModules();
    const { PropertyCheckRow } = await import("@/features/entity-compliance/PropertyCheckRow");
    render(_jsx(PropertyCheckRow, { finding: { ruleId: "F16", field: "tags", severity: "warn", passed: false, message: "建议补充" } as never }));
    expect(screen.getByText("警告")).toBeInTheDocument();
    expect(screen.queryByText("warn")).not.toBeInTheDocument();
  });
});
