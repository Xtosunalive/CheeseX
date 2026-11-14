import type { components } from "@/lib/generated/api-types";

export type PendingEdge = components["schemas"]["PendingReviewEdge"];
export type PendingReviewResponse = components["schemas"]["PendingReviewData"];
export type ReviewRecord = components["schemas"]["ReviewHistoryRecord"];
export type ReviewHistoryResponse = components["schemas"]["ReviewHistoryData"];
export type InferenceConflict = components["schemas"]["InferenceConflict"];

export type ReviewTab = "edges" | "audit" | "conflicts";

// WP-175：后端 pending-review 边数据运行时附加 article_stage（resolveArticleStatus 计算）
// OpenAPI 未声明（增量兼容）——前端类型扩展消费
export type PendingEdgeWithStage = PendingEdge & { article_stage?: string };
