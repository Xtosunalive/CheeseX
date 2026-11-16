import { apiFetchEnvelope } from "@/lib/api";
import { REVIEW_REQUEST_COPY } from "./review-copy";
import type { InferenceConflict } from "./review-types";

export async function fetchConflicts(status: "unresolved" | "resolved" | "all" = "all"): Promise<{ conflicts: InferenceConflict[]; total: number }> {
  const params = new URLSearchParams({ status });
  const envelope = await apiFetchEnvelope<{ conflicts: InferenceConflict[]; total: number }>(`/api/kg/inference-conflicts?${params}`);
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || REVIEW_REQUEST_COPY.CONFLICTS_FETCH_FAILED);
  return envelope.data;
}

// Wave3 阶段三（Master 2026-11-17 裁）：裁决/重开端点接线——store.review 单源委托。
export interface ConflictReviewRequest {
  action: "resolve" | "reopen";
  reviewer: string;
  reason: string;
  resolution?: string;
  decision?: { decision: "select_effect" | "select_rules" | "defer" | "reopen"; selectedEffect?: string; selectedRuleIds?: string[]; sourceRevision?: string; note?: string };
}

export async function reviewConflict(conflictId: string, request: ConflictReviewRequest): Promise<InferenceConflict> {
  const envelope = await apiFetchEnvelope<InferenceConflict>(`/api/kg/inference-conflicts/${encodeURIComponent(conflictId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || REVIEW_REQUEST_COPY.REVIEW_FAILED);
  return envelope.data;
}
