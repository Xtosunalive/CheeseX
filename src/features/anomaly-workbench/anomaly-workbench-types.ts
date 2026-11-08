import type { components } from "@/lib/generated/api-types";
import type { RequestStatus } from "@/lib/request-status";

export type AnomalyIssue = components["schemas"]["AnomalyIssue"];
export type AnomalyListData = components["schemas"]["AnomalyListData"];
export type AnomalyStatus = AnomalyIssue["status"];
export type RelationCandidate = components["schemas"]["RelationCandidateDTO"];
export type RelationCandidateRejection = components["schemas"]["RelationCandidateRejectionDTO"];
export type RelationCandidateRejectionInput = Pick<RelationCandidateRejection, "reason">;
export type AnomalyOperation = "preview" | "confirm" | "reject" | "close" | "reopen";

/** 别名：定义单源在 @/lib/request-status（interaction-state 域） */
export type AnomalyViewStatus = RequestStatus;

/**
 * 终态/非待处理状态集（唯一事实源，规则 8 配置单源化）。
 * 语义：verified（已复核）/ blocked（处理已阻断）不计入"待处理"计数与分组。
 * 引用：docs/design/anomaly-state-machine.md §一；docs/ui-mental-model-contract.md A7。
 * 消费：anomaly-article-groups.ts（pendingCount）、AnomalySourceTable.tsx（分组过滤）。
 */
export const ANOMALY_TERMINAL_STATUSES: ReadonlySet<AnomalyStatus> = new Set(["verified", "blocked"]);

export function isAnomalyPending(status: AnomalyStatus): boolean {
  return !ANOMALY_TERMINAL_STATUSES.has(status);
}
