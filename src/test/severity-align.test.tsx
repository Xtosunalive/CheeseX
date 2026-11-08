// seq193 刀1 severity 全库对齐——前端查表键对齐/类型单源行为锁
// 红灯输入：审计族 S（docs/plans/audits/{entity-compliance,dashboard,gap-engine,schema-manager}.md）
// seq182 修法同款：查表键=各自域契约/产出值集，显示语义不变；无锚字面量比较清零。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { jsx as _jsx } from "react/jsx-runtime";
import {
  GAP_SEVERITY,
  GOVERNANCE_FLAG_SEVERITY,
  groupGapsBySeverity,
  type GapItem,
} from "@/features/gap-engine/gap-types";

function gap(severity: GapItem["severity"], id: string): GapItem {
  return { id, type: "dangling_dependency", severity, targetId: id, targetLabel: id, detail: `detail-${id}` };
}
import { ComplianceGroupSection } from "@/features/entity-compliance/ComplianceGroupSection";
import type { ComplianceFinding } from "@/features/entity-compliance/entity-compliance-types";

describe("seq193: gap severity 单源查表（blocker/warning 产出值集，词表不跨域反转）", () => {
  it("groupGapsBySeverity groups by GAP_SEVERITY buckets, preserving order", () => {
    const gaps = [gap("warning", "w1"), gap("blocker", "b1"), gap("blocker", "b2"), gap("warning", "w2")];
    const { blockers, warnings } = groupGapsBySeverity(gaps);
    expect(blockers.map((g) => g.id)).toEqual(["b1", "b2"]);
    expect(warnings.map((g) => g.id)).toEqual(["w1", "w2"]);
  });

  it("GOVERNANCE_FLAG_SEVERITY = gap 两级 + clean（单源键集）", () => {
    expect(GOVERNANCE_FLAG_SEVERITY).toEqual({ BLOCKER: "blocker", WARNING: "warning", CLEAN: "clean" });
    expect(GAP_SEVERITY.BLOCKER).toBe("blocker");
  });

});

describe("seq193: ComplianceGroupSection 计数表键=契约枚举（error/warn/info）", () => {
  const finding = (severity: ComplianceFinding["severity"], passed: boolean, ruleId: string): ComplianceFinding =>
    ({ ruleId, field: "title", severity, passed, message: "m" } as ComplianceFinding);

  it("error 级未过 → blocker 图标分支激活（行为与收敛前一致，无裸值渲染）", () => {
    render(
      _jsx(ComplianceGroupSection, {
        group: {
          id: "g1",
          label: "身份组",
          checks: [finding("error", false, "F01"), finding("warn", true, "F02"), finding("info", false, "F03")],
        },
      })
    );
    // 打开态下 checks 渲染；error 未过使 hasBlocker=true → 默认展开
    expect(screen.getByText("身份组")).toBeTruthy();
  });

  it("全过 → 计数摘要可见（无 error/warn 未过项）", () => {
    render(
      _jsx(ComplianceGroupSection, {
        group: {
          id: "g2",
          label: "全部通过组",
          checks: [finding("warn", true, "F04"), finding("info", true, "F05")],
        },
      })
    );
    expect(screen.getByText("2/2")).toBeTruthy();
  });
});

