import type { components } from "@/lib/generated/api-types";

export type PendingEdge = components["schemas"]["PendingReviewEdge"];
export type PendingReviewResponse = components["schemas"]["PendingReviewData"];
export type ReviewRecord = components["schemas"]["ReviewHistoryRecord"];
export type ReviewHistoryResponse = components["schemas"]["ReviewHistoryData"];
export type InferenceConflict = components["schemas"]["InferenceConflict"];

export type ReviewTab = "edges" | "audit" | "conflicts";
