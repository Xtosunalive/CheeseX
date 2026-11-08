import type { components } from '@/lib/generated/api-types';
import { TERM } from '@/constants/term-const';

// 从 OpenAPI 契约派生的类型（单源）
type ReviewStatusValue = components['schemas']['ReviewStatus'];

// 业务动作保留（不在契约中，因为是前端状态机专用）
export const REVIEW_STATUS_ACTIONS = [
  "approve",
  "reject",
  "reopen",
  "manual_override",
  "ignore_forever",
] as const;
export type ReviewStatusAction = (typeof REVIEW_STATUS_ACTIONS)[number];

// ── 显示投影单源（REVIEW-STATUS-001 开域 review-status）──
// 契约五态 → 显示层（label 词走 TERM；tone 语义：fact=生效态[人裁批准/规则生效/继承已审]、
// warn=待人裁、error=已拒绝）。三呈现副本（RelationLibraryTab/EntityDetailPanel/DashboardView）
// 一律经此消费，禁止私有状态映射——PR-095 扩枚举时无供给点致三副本漂移即本域开域病因。
export type ReviewStatusTone = "fact" | "warn" | "error";

export const REVIEW_STATUS_VALUES = ["approved", "pending", "rejected", "deterministic", "inherited_approved"] as const;

/** 键集 ≡ 契约枚举的编译期钉子（api-types 单源；破坏即 tsc 红） */
const _CONTRACT_NAIL: Record<components["schemas"]["ReviewStatus"], { label: string; tone: ReviewStatusTone }> = {
  approved: { label: TERM.APPROVED, tone: "fact" },
  pending: { label: TERM.PENDING_REVIEW, tone: "warn" },
  rejected: { label: TERM.REJECTED, tone: "error" },
  deterministic: { label: TERM.RULE_EFFECTIVE, tone: "fact" },
  inherited_approved: { label: TERM.INHERITED_APPROVED, tone: "fact" },
};

export const REVIEW_STATUS_DISPLAY: Readonly<Record<(typeof REVIEW_STATUS_VALUES)[number], { label: string; tone: ReviewStatusTone }>> = _CONTRACT_NAIL;

/** 显示取数口（非法/缺省值按 pending——与 ReviewStatus.from 同口径 fail-safe） */
export function reviewStatusDisplay(raw: string | undefined | null): { label: string; tone: ReviewStatusTone } {
  return REVIEW_STATUS_DISPLAY[ReviewStatus.from(raw).value];
}

// ── 生效集单点谓词（WP-138 R5c / O2：前端手写分桶收口，PR-250 同族同治法）──
// 两口径不同、住在同一声明处，防「哪个状态算生效」再散抄：
// ① 生效集（formal 消费口径）＝人裁批准＋产线派生章均算生效——与后端 formal-relation-selector
//    生效集同口径（ALLOWED_STATUSES 三 decisionMode 并集）。DashboardView 生效计数桶消费。
// ② 人裁放行（图可见性口径）＝仅人裁批准算——Master 2026-10-29 裁定：机器推导断言仅人裁
//    approved 上图，派生章（deterministic/inherited_approved）不入图。isEdgeVisible 与
//    LocalGraph 徽章 tone 消费。两口径不得混用（混用即语义变更，非本单源授权范围）。
export const EFFECTIVE_REVIEW_STATUSES = ["approved", "deterministic", "inherited_approved"] as const;

// 生效集三态串只此一份（上方常量），谓词派生自它——单源内不再第二份手写。
export function isEffectiveReviewStatus(raw: string | undefined | null): boolean {
  return (EFFECTIVE_REVIEW_STATUSES as readonly string[]).includes(raw ?? "");
}

export function isHumanApprovedReviewStatus(raw: string | undefined | null): boolean {
  return raw === "approved";
}

// 类型守卫（PR-095：纳入产线派生章 deterministic/inherited_approved——来自契约枚举）
function isReviewStatusValue(raw: string): raw is ReviewStatusValue {
  return raw === "approved" || raw === "pending" || raw === "rejected"
    || raw === "deterministic" || raw === "inherited_approved";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ReviewStatus action: ${String(value)}`);
}

export class ReviewStatus {
  readonly value: ReviewStatusValue;

  private constructor(value: ReviewStatusValue) {
    this.value = value;
    Object.freeze(this);
  }

  static from(raw: string | undefined | null): ReviewStatus {
    if (raw && isReviewStatusValue(raw)) {
      return new ReviewStatus(raw);
    }
    return new ReviewStatus("pending");
  }

  static pending(): ReviewStatus {
    return new ReviewStatus("pending");
  }

  static approved(): ReviewStatus {
    return new ReviewStatus("approved");
  }

  static rejected(): ReviewStatus {
    return new ReviewStatus("rejected");
  }

  transition(action: ReviewStatusAction): ReviewStatus {
    switch (action) {
      case "approve":
      case "manual_override":
        return ReviewStatus.approved();
      case "reject":
      case "ignore_forever":
        return ReviewStatus.rejected();
      case "reopen":
        return ReviewStatus.pending();
      default:
        return assertNever(action);
    }
  }

  equals(other: ReviewStatus): boolean {
    return this.value === other.value;
  }

  toString(): ReviewStatusValue {
    return this.value;
  }

  toJSON(): ReviewStatusValue {
    return this.value;
  }
}

// 导出类型别名供外部使用
export type { ReviewStatusValue };
