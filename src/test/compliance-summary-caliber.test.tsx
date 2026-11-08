// WP-134 波2 口径切换器拆钉：「存在阻断」卡的口径是「源文档数」（卡片 hint 原文），
// 权威字段只有 *EntityCount 一族；后端 entity-compliance-service.cjs:281-287 两族恒发。
// 夹具故意让两族不等（实体面 0、问题面 3/5/7）——旧写法 `a || b || 0` 在 a===0 时静默换成问题数，本例即红。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryBar } from "@/features/entity-compliance/SummaryBar";
import type { ComplianceSummary } from "@/features/entity-compliance/entity-compliance-types";

const dualCaliber: ComplianceSummary = {
  totalEntities: 10,
  healthyCount: 10,
  blockerEntityCount: 0,
  blockerCount: 3,
  warningEntityCount: 0,
  warningCount: 5,
  infoEntityCount: 0,
  infoCount: 7,
  averageScore: 9.2,
};

// 后端未携带 *EntityCount 一族（契约侧 ComplianceSummary 无 required 表＝全部 optional，
// 实测读自 contracts/http-api.openapi.json）。旧写法 ?? 0 把「没给数」显示成 0，与「真零」同形。
const entityCaliberAbsent: ComplianceSummary = {
  totalEntities: 10,
  healthyCount: 8,
  blockerCount: 3,
  warningCount: 5,
  infoCount: 7,
  averageScore: 9.2,
};

describe("SummaryBar 双口径不再互相顶替", () => {
  it("零阻断文档但仍有阻断级问题时，三张卡显实体面 0，不显问题面 3/5/7", () => {
    render(<SummaryBar summary={dualCaliber} />);
    expect(screen.getByText("存在阻断")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3);
    for (const wrong of ["3", "5", "7"]) {
      expect(screen.queryByText(wrong)).toBeNull();
    }
  });

  it("实体面字段缺席＝未知，渲染三处「—」，既不降级成 0 也不拿问题面数顶替", () => {
    render(<SummaryBar summary={entityCaliberAbsent} />);
    expect(screen.getAllByText("—")).toHaveLength(3);
    for (const wrong of ["0", "3", "5", "7"]) {
      expect(screen.queryByText(wrong)).toBeNull();
    }
  });
});
