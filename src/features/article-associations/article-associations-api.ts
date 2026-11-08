import { apiFetchEnvelope } from "@/lib/api";
import type { ArticleAssociationData, ArticleAssociationPreviewData, ArticleAssociationProposalData, ArticleAssociationWriteRequest } from "./article-associations-types";
import { AA_REQUEST_COPY } from "./article-associations-copy";

function unwrap<T>(result: Awaited<ReturnType<typeof apiFetchEnvelope<T>>>, fallback: string): T {
  if (!result.ok || !result.data) throw new Error(result.error || fallback);
  return result.data;
}
export async function fetchArticleAssociations() {
  const env = await apiFetchEnvelope<ArticleAssociationData>("/api/article-associations");
  // SPEC-029：发布前消费面 NO_CURRENT_RELEASE 是业务前置态（库尚未发布正式版本）——
  // 打标记走空态引导，不进错误横幅（英文原文＋排查编号不裸奔给用户）
  if (!env.ok && env.errorCode === "NO_CURRENT_RELEASE") {
    const err = new Error("NO_CURRENT_RELEASE") as Error & { code: string };
    err.code = "NO_CURRENT_RELEASE";
    throw err;
  }
  return unwrap(env, AA_REQUEST_COPY.LOAD_FAILED);
}
export async function previewArticleAssociation(payload: ArticleAssociationWriteRequest) { return unwrap(await apiFetchEnvelope<ArticleAssociationPreviewData>("/api/article-associations/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), AA_REQUEST_COPY.PREVIEW_FAILED); }
// AA1：直接写回（替代 Proposal 审批层，复用 service.save 原子写+审计）
export async function saveArticleAssociation(payload: ArticleAssociationWriteRequest) { return unwrap(await apiFetchEnvelope<ArticleAssociationProposalData>("/api/article-associations/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), AA_REQUEST_COPY.SAVE_FAILED); }
// 引用随源流转（2026-10-15）：stale 决策行移除出口——源已删，行成幽灵
