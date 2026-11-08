import { apiFetchEnvelope, unwrapEnvelope } from "@/lib/api";
import type { components, paths } from "@/lib/generated/api-types";
import { APPROVAL_REQUEST_COPY } from "./approval-workbench-copy";

// 审批类型单源（规则 9 全链 + G2/D6）：契约 $ref 修复后生成类型已具体化，此前被迫手写的
// ApprovalStatusView/ApprovalTransitionResult 第二事实源已删除，全部别名指向契约生成物。
export type ApprovalStatus = components["schemas"]["ApprovalStatusEnum"];
export type ApprovalOperation = components["schemas"]["ApprovalTransitionRequest"]["operation"];
export type ApprovalStatusView = components["schemas"]["ApprovalStatus"];
export type ApprovalTransitionResult = components["schemas"]["ApprovalTransitionResult"];

// 真实候选文章（复用 /api/articles/precleaned 端点，ADR043 变更端收件箱语义）
export interface ApprovalCandidate {
  id: string;
  title: string;
  fileName: string;
  standardizationStatus: "pending_standardization" | "blocked" | "standardized";
  /** 最近一次标准化内容哈希（决策证据绑定，confirm/reject 必传） */
  formalContentHash: string | null;
  /** 候选源文件路径（服务端缺失哈希时的兜底定位） */
  sourcePath: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return unwrapEnvelope(apiFetchEnvelope<T>(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  }), APPROVAL_REQUEST_COPY.REQUEST_FAILED);
}

export function getApprovalStatus(articleId: string): Promise<ApprovalStatusView> {
  return request(`/api/approval/status/${encodeURIComponent(articleId)}`);
}

export function transitionApproval(articleId: string, operation: ApprovalOperation, input: Record<string, unknown> = {}): Promise<ApprovalTransitionResult> {
  return request(`/api/approval/${encodeURIComponent(articleId)}/transition`, {
    method: "POST",
    body: JSON.stringify({ operation, input }),
  });
}

// 真实候选文章列表（复用 article-workflow 的 precleaned 端点；契约类型 PrecleanedListEnvelope 已生成）
export async function fetchApprovalCandidates(): Promise<ApprovalCandidate[]> {
  type PrecleanedData = paths["/api/articles/precleaned"]["get"]["responses"][200]["content"]["application/json"]["data"];
  const data = await request<PrecleanedData>("/api/articles/precleaned");
  return data.items.map((item) => ({
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    standardizationStatus: item.standardizationStatus,
    formalContentHash: item.formalContentHash ?? null,
    sourcePath: item.sourcePath,
  }));
}
