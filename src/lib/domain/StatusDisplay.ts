// StatusDisplay — 状态机显示投影单源（复用域 status-display；PR-130/STATUS-DISPLAY-001）
//
// 承 REVIEW-STATUS-001 机制（ReviewStatus.ts 显示单源先例）扩面：把散在三处 feature 的
// 状态显示映射（ApprovalWorkbench STATUS_LABELS/STATUS_STYLE、article-workflow-types 两套
// LABELS、admission-types ADMISSION_STATUS_LABEL + EntityRegistryTable 行内 tone 三元式）
// 收编为单源投影。五台状态机各自独立、不合并状态机（与 review-status 域「三状态机独立」
// 纪律同源）；每机一个编译期钉子 Record（契约枚举机：契约加值即 tsc 红；无枚举机：
// 本域 as const 即值域单源）。
//
// 纪律：纯函数（同输入两次调用 deepEqual）；零 feature 依赖（类型全部从
// generated/api-types 派生或本域 as const）；显示词走 TERM；tone 语义与
// ReviewStatusTone 同源（fact=生效/完成、warn=待处理、error=拒绝/阻断）加
// neutral 档（中性进行态：草稿/管道处理中/已删除等）；只做呈现面投影，
// 状态机转移执法仍在服务端与各 feature 动作层。

import type { components, paths } from "@/lib/generated/api-types";
import { TERM } from "@/constants/term-const";

// ── 公共形状 ──

/** 状态显示投影条目：label（走 TERM）+ tone（四档，语义见头注释） */
export interface StatusDisplayEntry {
  label: string;
  tone: StatusDisplayTone;
}

/** tone 词汇：fact=生效/完成、warn=待处理、error=拒绝/阻断、neutral=中性进行态 */
export type StatusDisplayTone = "fact" | "warn" | "error" | "neutral";

// ── 审批机（ApprovalStatusEnum——契约枚举钉子）──

export type ApprovalStatusValue = components["schemas"]["ApprovalStatusEnum"];

/** 键集 ≡ 契约 ApprovalStatusEnum 的编译期钉子（api-types 单源；契约加值即 tsc 红） */
const _APPROVAL_NAIL: Record<ApprovalStatusValue, StatusDisplayEntry> = {
  draft: { label: TERM.APPROVAL_DRAFT, tone: "neutral" },
  pending: { label: TERM.APPROVAL_PENDING, tone: "warn" },
  approved: { label: TERM.APPROVAL_APPROVED, tone: "fact" },
  rejected: { label: TERM.APPROVAL_REJECTED, tone: "error" },
  snapshot: { label: TERM.APPROVAL_SNAPSHOT, tone: "fact" },
};

export const APPROVAL_STATUS_DISPLAY: Readonly<Record<ApprovalStatusValue, StatusDisplayEntry>> = _APPROVAL_NAIL;

/** 显示取数口（非法/缺省按 pending 待审——与 reviewStatusDisplay fail-safe 同思路） */
export function approvalStatusDisplay(raw: string | undefined | null): StatusDisplayEntry {
  return APPROVAL_STATUS_DISPLAY[(raw as ApprovalStatusValue) ?? "pending"] ?? APPROVAL_STATUS_DISPLAY.pending;
}

// ── 文章标准化机（standardizationStatus——契约派生类型钉子）──

type PrecleanedListData = paths["/api/articles/precleaned"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type StandardizationStatusValue = PrecleanedListData["items"][number]["standardizationStatus"];

/** 键集 ≡ 契约 standardizationStatus 值域的编译期钉子 */
const _STANDARDIZATION_NAIL: Record<StandardizationStatusValue, StatusDisplayEntry> = {
  pending_standardization: { label: TERM.STANDARDIZATION_PENDING, tone: "warn" },
  blocked: { label: TERM.STANDARDIZATION_BLOCKED, tone: "error" },
  standardized: { label: TERM.STANDARDIZATION_DONE, tone: "fact" },
};

export const STANDARDIZATION_STATUS_DISPLAY: Readonly<Record<StandardizationStatusValue, StatusDisplayEntry>> = _STANDARDIZATION_NAIL;

/** 显示取数口（非法/缺省按 pending_standardization） */
export function standardizationStatusDisplay(raw: string | undefined | null): StatusDisplayEntry {
  return STANDARDIZATION_STATUS_DISPLAY[(raw as StandardizationStatusValue) ?? "pending_standardization"]
    ?? STANDARDIZATION_STATUS_DISPLAY.pending_standardization;
}

// ── 投稿任务机（upload task status——契约派生类型钉子）──

type UploadTaskData = paths["/api/articles/upload"]["post"]["responses"][201]["content"]["application/json"]["data"];
export type ArticleTaskStatusValue = UploadTaskData["status"];

/** 键集 ≡ 契约 task status 值域的编译期钉子 */
const _TASK_NAIL: Record<ArticleTaskStatusValue, StatusDisplayEntry> = {
  awaiting_architect_processing: { label: TERM.TASK_AWAITING_ARCHITECT, tone: "warn" },
  awaiting_approval: { label: TERM.TASK_AWAITING_APPROVAL, tone: "warn" },
  standardized: { label: TERM.TASK_STANDARDIZED, tone: "fact" },
  published: { label: TERM.TASK_PUBLISHED, tone: "fact" },
  source_deleted: { label: TERM.TASK_SOURCE_DELETED, tone: "neutral" },
  digested: { label: TERM.TASK_DIGESTED, tone: "neutral" },
};

export const ARTICLE_TASK_STATUS_DISPLAY: Readonly<Record<ArticleTaskStatusValue, StatusDisplayEntry>> = _TASK_NAIL;

/** 显示取数口（非法/缺省按 awaiting_architect_processing） */
export function articleTaskStatusDisplay(raw: string | undefined | null): StatusDisplayEntry {
  return ARTICLE_TASK_STATUS_DISPLAY[(raw as ArticleTaskStatusValue) ?? "awaiting_architect_processing"]
    ?? ARTICLE_TASK_STATUS_DISPLAY.awaiting_architect_processing;
}

// ── 版本生命周期机（version status——契约六个 schema 共用同一三态枚举：VersionRegistryEntry/
// ProductVersion/DependencyImpactVersion/ArchitectureVersionState/ArchitectureVersionRef/
// ArticleAssociationVersionOption）──

export type VersionStatusValue = components["schemas"]["VersionRegistryEntry"]["status"];

/** 键集 ≡ 契约 version status 枚举的编译期钉子（VersionRegistryEntry 派生；契约加值即 tsc 红） */
const _VERSION_NAIL: Record<VersionStatusValue, StatusDisplayEntry> = {
  draft: { label: TERM.VERSION_DRAFT, tone: "neutral" },
  released: { label: TERM.VERSION_RELEASED, tone: "fact" },
  deprecated: { label: TERM.VERSION_DEPRECATED, tone: "warn" },
};

export const VERSION_STATUS_DISPLAY: Readonly<Record<VersionStatusValue, StatusDisplayEntry>> = _VERSION_NAIL;

/** 显示取数口（非法/缺省按 draft） */
export function versionStatusDisplay(raw: string | undefined | null): StatusDisplayEntry {
  return VERSION_STATUS_DISPLAY[(raw as VersionStatusValue) ?? "draft"] ?? VERSION_STATUS_DISPLAY.draft;
}

// ── 准入机（admissionStatus——契约 CanvasAdmissionData 无枚举，值域单源=本域 as const）──
// PD-5 死枚举归位（WP-026）：REJECTED 全仓零生产方退役；PENDING 由 selectors 真实派生
//（有源文章=APPROVED/无源=PENDING）——准入列从恒「已准入」假象改为真实两态。

export const ADMISSION_STATUS_VALUES = ["APPROVED", "PENDING"] as const;
export type AdmissionStatusValue = (typeof ADMISSION_STATUS_VALUES)[number];

/** 键集 ≡ 本域值域单源的编译期钉子（契约升枚举后此钉子改挂契约类型） */
const _ADMISSION_NAIL: Record<AdmissionStatusValue, StatusDisplayEntry> = {
  APPROVED: { label: TERM.ADMISSION_APPROVED, tone: "fact" },
  PENDING: { label: TERM.ADMISSION_PENDING, tone: "warn" },
};

export const ADMISSION_STATUS_DISPLAY: Readonly<Record<AdmissionStatusValue, StatusDisplayEntry>> = _ADMISSION_NAIL;

/** 值域守卫（EntityRegistryItem.admissionStatus 的收口判别） */
export function isAdmissionStatusValue(raw: string): raw is AdmissionStatusValue {
  return (ADMISSION_STATUS_VALUES as readonly string[]).includes(raw);
}

/** 显示取数口（非法/缺省按 PENDING 待审） */
export function admissionStatusDisplay(raw: string | undefined | null): StatusDisplayEntry {
  const value = raw && isAdmissionStatusValue(raw) ? raw : "PENDING";
  return ADMISSION_STATUS_DISPLAY[value];
}
