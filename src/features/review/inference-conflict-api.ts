import { apiFetchEnvelope } from "@/lib/api";
import { REVIEW_REQUEST_COPY } from "./review-copy";
import type { InferenceConflict } from "./review-types";

export async function fetchConflicts(status: "unresolved" | "resolved" | "all" = "all"): Promise<{ conflicts: InferenceConflict[]; total: number }> {
  const params = new URLSearchParams({ status });
  const envelope = await apiFetchEnvelope<{ conflicts: InferenceConflict[]; total: number }>(`/api/kg/inference-conflicts?${params}`);
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || REVIEW_REQUEST_COPY.CONFLICTS_FETCH_FAILED);
  return envelope.data;
}
