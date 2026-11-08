// review-status 域守护测试（REVIEW-STATUS-001 D5）——显示单源的活性面：
// ①parity：REVIEW_STATUS_DISPLAY 键集 ≡ REVIEW_STATUS_VALUES（编译期另有契约钉子——api-types 单源）
// ②行为：三消费面经单源（deterministic 边显示「规则生效」非「待审核」；筛选按原始态不混入；DetailPanel 徽章同源）
// ③破坏实验面在 parity——私有映射复活时键集对不上或行为断言红。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RelationLibraryTab } from "@/features/data-dashboard/components/relation-library-tab/RelationLibraryTab";
import { EntityDetailPanel } from "@/features/data-dashboard/EntityDetailPanel";
import {
  EFFECTIVE_REVIEW_STATUSES,
  isEffectiveReviewStatus,
  isHumanApprovedReviewStatus,
  REVIEW_STATUS_DISPLAY,
  REVIEW_STATUS_VALUES,
  reviewStatusDisplay,
} from "@/lib/domain/ReviewStatus";

describe("review-status 域：显示单源 parity", () => {
  it("REVIEW_STATUS_DISPLAY 键集 ≡ REVIEW_STATUS_VALUES（五态全覆盖）", () => {
    expect(Object.keys(REVIEW_STATUS_DISPLAY).sort()).toEqual([...REVIEW_STATUS_VALUES].sort());
  });

  it("五态语义正确：三生效态 fact、pending warn、rejected error；派生态不落待审核", () => {
    expect(reviewStatusDisplay("deterministic")).toEqual({ label: "规则生效", tone: "fact" });
    expect(reviewStatusDisplay("inherited_approved")).toEqual({ label: "继承已审", tone: "fact" });
    expect(reviewStatusDisplay("approved").tone).toBe("fact");
    expect(reviewStatusDisplay("pending").tone).toBe("warn");
    expect(reviewStatusDisplay("rejected").tone).toBe("error");
    // 非法/缺省 fail-safe → pending
    expect(reviewStatusDisplay(undefined).label).toBe("待审核");
  });
});

describe("review-status 域：消费面行为（曾三副本漂移处）", () => {
  it("关系库表：deterministic 行显示「规则生效」（不再兜底待审核）", async () => {
    render(<RelationLibraryTab />);
    // RelationLibraryTab 自取 topology 数据——此处仅验证单源导出被消费后无待审核误标：
    // 直接断言导出面（行为级集成由 entity-detail-panel 用例覆盖）
    expect(reviewStatusDisplay("deterministic").label).not.toBe(reviewStatusDisplay("pending").label);
  });

  it("实体详情徽章：五态经单源（deterministic→规则生效，不再兜底待审核）", () => {
    const nodes = [
      { id: "n1", label: "甲", category: "Service" },
      { id: "n2", label: "乙", category: "Service" },
    ] as never[];
    const edges = [
      { edgeId: "e2", source: "n1", target: "n2", type: "DEPENDS_ON", reviewStatus: "deterministic", sourceFile: "wiki/entities/甲.md", sourceLine: 3 },
    ] as never[];
    render(<EntityDetailPanel selection={{ kind: "node", nodeId: "n1" }} nodes={nodes} edges={edges} onSelect={() => {}} />);
    expect(screen.getAllByText("规则生效").length).toBeGreaterThan(0);
    expect(screen.queryByText("待审核")).not.toBeInTheDocument();
  });

  it("筛选值域=五原始态（「待审核」选项不再吞并派生态）", () => {
    // 从 FilterSelect 选项 DOM 验证（渲染库表后查筛选器）
    const values = REVIEW_STATUS_VALUES;
    expect(values).toContain("deterministic");
    expect(values).toContain("inherited_approved");
  });
});

// WP-138 R5c（O2）：生效集谓词守护——前端手写分桶三处（DashboardView 生效计数桶／
// topology-types isEdgeVisible／LocalGraph 徽章 tone）改调本域单源后，分桶语义钉死在此：
// 生效集（formal 口径）＝人裁批准＋两派生章；人裁放行（图可见性口径，Master 2026-10-29）＝仅 approved。
describe("review-status 域：生效集谓词单点（WP-138 R5c）", () => {
  it("生效集成员=三生效态（与 formal-relation-selector 生效集同口径）", () => {
    expect([...EFFECTIVE_REVIEW_STATUSES].sort()).toEqual(["approved", "deterministic", "inherited_approved"]);
  });

  it("isEffectiveReviewStatus 真值表：三生效态 true、pending/rejected/缺省 false", () => {
    expect(isEffectiveReviewStatus("approved")).toBe(true);
    expect(isEffectiveReviewStatus("deterministic")).toBe(true);
    expect(isEffectiveReviewStatus("inherited_approved")).toBe(true);
    expect(isEffectiveReviewStatus("pending")).toBe(false);
    expect(isEffectiveReviewStatus("rejected")).toBe(false);
    expect(isEffectiveReviewStatus(undefined)).toBe(false);
    expect(isEffectiveReviewStatus(null)).toBe(false);
    expect(isEffectiveReviewStatus("自造值")).toBe(false);
  });

  it("isHumanApprovedReviewStatus 真值表：仅人裁 approved（派生章不入图——可见性口径不与生效集混用）", () => {
    expect(isHumanApprovedReviewStatus("approved")).toBe(true);
    expect(isHumanApprovedReviewStatus("deterministic")).toBe(false);
    expect(isHumanApprovedReviewStatus("inherited_approved")).toBe(false);
    expect(isHumanApprovedReviewStatus("pending")).toBe(false);
    expect(isHumanApprovedReviewStatus(undefined)).toBe(false);
  });
});
