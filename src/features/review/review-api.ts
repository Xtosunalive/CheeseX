import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import { REVIEW_REQUEST_COPY } from "./review-copy";
import type { PendingReviewResponse, ReviewHistoryResponse } from "./review-types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return unwrapEnvelope(apiFetchEnvelope<T>(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  }), REVIEW_REQUEST_COPY.REQUEST_FAILED);
}

export function fetchPendingReview(): Promise<PendingReviewResponse> {
  return request("/api/kg/pending-review");
}

export function fetchReviewHistory(): Promise<ReviewHistoryResponse> {
  return request("/api/kg/review-history");
}

// R2：关系直接审批（替代 graph-fact Proposal）——写 review_actions 账本，读侧合并生效（F3/ADR054 D2：账本唯一事实源）
export async function reviewEdge(payload: { edgeId: string; action: "approved" | "rejected"; reason?: string; confidenceBandAudit?: { source: string; target: string; type: string; relationsPath: string; revision: string } }): Promise<{ success: boolean; edgeId: string; action: string; reviewStatus: string; decidedAt: string }> {
  return request("/api/kg/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
