// Gap types — governance gap definitions, labels, and guidance for the gap engine.
// Severity model v2: "blocker" (breaks pipeline) | "warning" (observation-level debt)
// seq211：业务叫法取术语常量表，杜绝就地写自造词（原「实体源文档」在术语规范里 0 处，见 PR-021）
// WP-151：缺口标签/引导/快捷补充/分组标题文案迁入页级文案单源 gap-engine-copy.ts（ADR-019 §二），
// 本文件保留类型、样式与分组逻辑，标签表原名再导出（既有消费点零改动）。
import { GAP_GROUP_COPY, GAP_GUIDANCE, gapLowConfidenceGuidance } from "./gap-engine-copy";

export { GAP_TYPE_LABEL, GAP_QUICK_ACTION } from "./gap-engine-copy";

export const GAP_TYPE = {
  DANGLING_DEPENDENCY: "dangling_dependency",
  ISOLATED_ENTITY: "isolated_entity",
  LOW_CONFIDENCE: "low_confidence",
  MISSING_DOCUMENT_REF: "missing_document_ref",
  CROSS_DOMAIN_REF: "cross_domain_ref",
} as const;
export type GapType = (typeof GAP_TYPE)[keyof typeof GAP_TYPE];

/** blocker = pipeline breaks (dangling_dependency). warning = topology quality issue. */
export const GAP_SEVERITY = { BLOCKER: "blocker", WARNING: "warning" } as const;
export type GapSeverity = (typeof GAP_SEVERITY)[keyof typeof GAP_SEVERITY];

/** seq193 单源：dashboard 治理胶囊 severity = gap 两级 + clean（无缺口），本地三值 union 重声明退役。 */
export const GOVERNANCE_FLAG_SEVERITY = { ...GAP_SEVERITY, CLEAN: "clean" } as const;
export type GovernanceFlagSeverity = (typeof GOVERNANCE_FLAG_SEVERITY)[keyof typeof GOVERNANCE_FLAG_SEVERITY];

export type GapResolveAction = "resolved" | "ignored" | "exempted";

export interface GapItem {
  id: string;
  type: GapType;
  severity: GapSeverity;
  targetId: string;
  targetLabel: string;
  detail: string;
  /** low_confidence 缺口的置信度阈值（后端 gap-engine 单源下发）；仅 low_confidence 携带。 */
  threshold?: number;
  edgeInfo?: { from: string; to: string; type?: string };
  /** Vault-relative source path (e.g. 知识库/wiki/entities/mvp-gateway.md). */
  filePath?: string;
}

export type WarningType = "suspicious_edge";

export interface WarningItem {
  id: string;
  type: WarningType;
  targetId: string;
  detail: string;
  edgeInfo?: { from: string; to: string; type: string };
}

export const GAP_SEVERITY_STYLE: Record<GapSeverity, { border: string; bg: string; icon: string; badge: string }> = {
  blocker: { border: "border-status-error-6",   bg: "bg-status-error-2",   icon: "text-status-error",   badge: "bg-status-error-3 text-status-error" },
  warning: { border: "border-status-warn-6",  bg: "bg-status-warn-2", icon: "text-status-warn", badge: "bg-status-warn-3 text-status-warn" },
};

/** gap 引导文案的单源出口：low_confidence 的置信度阈值取自后端下发的 gap.threshold（此处不得硬编码阈值）；
    阈值缺失时回落 GAP_GUIDANCE 的无数字表述，其余类型直接取静态文案表。 */
export function gapGuidance(gap: GapItem): string {
  if (gap.type === GAP_TYPE.LOW_CONFIDENCE && typeof gap.threshold === "number") {
    return gapLowConfidenceGuidance(gap.threshold);
  }
  return GAP_GUIDANCE[gap.type];
}

/** Group gaps by severity: blocker first, then warnings */
export function groupGapsBySeverity(gaps: GapItem[]): {
  blockers: GapItem[];
  warnings: GapItem[];
} {
  // seq193：分桶查表键引用 GAP_SEVERITY 单源常量（穷尽性由 Record<GapSeverity, …> 保证），无裸字面量比较
  const buckets: Record<GapSeverity, GapItem[]> = {
    [GAP_SEVERITY.BLOCKER]: [],
    [GAP_SEVERITY.WARNING]: [],
  };
  for (const g of gaps) {
    buckets[g.severity].push(g);
  }
  return { blockers: buckets[GAP_SEVERITY.BLOCKER], warnings: buckets[GAP_SEVERITY.WARNING] };
}

/** Human-readable labels for severity groups */
export const GROUP_LABEL = {
  blocker: { ...GAP_GROUP_COPY.blocker, color: "text-status-error" },
  warning: { ...GAP_GROUP_COPY.warning, color: "text-status-warn" },
} as const;
