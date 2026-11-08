import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import type { paths } from "@/lib/generated/api-types";
import { ANOMALY_REQUEST_COPY } from "./anomaly-workbench-copy";
import type { AnomalyIssue, AnomalyListData, AnomalyOperation } from "./anomaly-workbench-types";

export const ANOMALY_RELATION_REMOVE_PREVIEW_ACTION = {
  id: "anomaly-relation-remove-preview",
  risk: "high",
  dataChannel: "POST /api/anomalies/:issueId/preview",
} as const;

export const ANOMALY_RELATION_CONFIRM_ACTION = {
  id: "anomaly-relation-confirm",
  risk: "high",
  dataChannel: "POST /api/anomalies/:issueId/confirm -> Vault entity source",
} as const;

export const ANOMALY_RELATION_REJECT_ACTION = {
  id: "anomaly-relation-candidate-reject",
  risk: "high",
  dataChannel: "POST /api/anomalies/:issueId/reject -> graph-fact Proposal metadata",
} as const;

export async function fetchAnomalies(): Promise<AnomalyListData> {
  return unwrapEnvelope(apiFetchEnvelope<AnomalyListData>("/api/anomalies"), ANOMALY_REQUEST_COPY.LIST_FETCH_FAILED);
}

export async function runAnomalyReconcile(): Promise<Record<string, unknown>> {
  // N3/#853：显式触发 reconcile（实时不再检出 → 自动销账），随后前端重新拉取列表。
  return unwrapEnvelope(
    apiFetchEnvelope<Record<string, unknown>>(`/api/anomalies/reconcile`, { method: "POST" }),
    ANOMALY_REQUEST_COPY.RECONCILE_FAILED,
  );
}

export async function performAnomalyOperation(issueId: string, operation: AnomalyOperation, payload: Record<string, unknown> = {}): Promise<AnomalyIssue> {
  return unwrapEnvelope(
    apiFetchEnvelope<AnomalyIssue>(`/api/anomalies/${encodeURIComponent(issueId)}/${operation}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
    ANOMALY_REQUEST_COPY.OPERATION_FAILED,
  );
}

type ArticleRepairOptions = paths["/api/articles/field-completion-options"]["get"]["responses"][200]["content"]["application/json"]["data"];

// 切片3：文章修复表单字段清单+枚举选项（服务端单源 GET field-completion-options）
export async function fetchArticleRepairOptions(): Promise<ArticleRepairOptions> {
  const response = await apiFetchEnvelope<ArticleRepairOptions>("/api/articles/field-completion-options");
  if (!response.ok || !response.data) throw new Error(response.error ?? ANOMALY_REQUEST_COPY.ARTICLE_OPTIONS_FETCH_FAILED);
  return response.data;
}
