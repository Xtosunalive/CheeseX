import { ApiError, apiFetchEnvelope } from "@/lib/api";
import { ARTICLE_ACTION_WRITES, ARTICLE_REQUEST_COPY } from "./article-workflow-copy";
import type { ArticleStandardization, ArticleUploadList, ArticleUploadRequest, ArticleWorkflowTask, CandidateFieldCompletion, CandidateFieldOptions, DraftPromotionResult, DraftValidationResult, PrecleanedArticleDetail, PrecleanedArticleList } from "./article-workflow-types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const envelope = await apiFetchEnvelope<T>(path, init);
  // WP-022 红队#3：抛结构化 ApiError（errorCode 保留）——store 层按码分支（409 冲突自动重读），message 行为不变
  if (!envelope.ok || !envelope.data) {
    throw new ApiError(envelope.error || ARTICLE_REQUEST_COPY.REQUEST_FAILED, {
      errorCode: envelope.errorCode ?? "UNKNOWN_ERROR",
      details: envelope.details,
      traceId: envelope.traceId,
    });
  }
  return envelope.data;
}

export function uploadArticle(payload: ArticleUploadRequest, expectedRevision?: number): Promise<ArticleWorkflowTask> {
  return request("/api/articles/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, expectedRevision }),
  });
}

export function fetchPrecleanedArticles(): Promise<PrecleanedArticleList> {
  return request("/api/articles/precleaned");
}

// SPEC-013 文章退役：dryRun 只读预演（返回清理计划，零落盘）——UI 确认对话框的数据源
export type ArticleRetirePlan = {
  dryRun?: boolean;
  retired?: boolean;
  plan: {
    basename: string;
    workingPath: string | null;
    formalPaths: string[];
    archivePath: string | null;
    manifestKey: string;
    warnings: string[];
  };
};

export function previewArticleRetirement(basename: string): Promise<ArticleRetirePlan> {
  return request(`/api/articles/retire?dryRun=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ basename }),
  });
}

export function retireArticle(basename: string): Promise<ArticleRetirePlan> {
  return request("/api/articles/retire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ basename }),
  });
}

export function fetchArticleUploads(limit = 50): Promise<ArticleUploadList> {
  return request(`/api/articles/uploads?limit=${limit}`);
}

export function fetchPrecleanedArticle(id: string): Promise<PrecleanedArticleDetail> {
  return request(`/api/articles/precleaned/${encodeURIComponent(id)}`);
}

// 标准化是 Plan-B 纯文件操作：校验 → 写不可变标准快照（wiki/articles/{id}/{hash}.md）→ 更新候选状态；不经 Article Proposal、不写 Release/current，发布走独立状态机 publish。
export function standardizeArticle(id: string): Promise<ArticleStandardization> {
  return request(`/api/articles/precleaned/${encodeURIComponent(id)}/standardization`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmed: true }),
  });
}

export const ARTICLE_STANDARDIZATION_ACTION = {
  id: "article-workflow.standardize",
  risk: "medium",
  dataChannel: "POST /api/articles/precleaned/:id/standardization",
  writes: ARTICLE_ACTION_WRITES.STANDARDIZATION,
} as const;

// 本地标准化 Skill（验收权威 core-business-loop.feature:20-21）：一键串 validateDraft → promoteDraft。
// validate 阶段会机械补齐 frontmatter 并打校验印记（非只读）；promote 由后端强制显式确认，前端固定携带 confirmed: true。
export function validateDraftArticle(filePath: string, expectedRevision?: number): Promise<DraftValidationResult> {
  return request("/api/articles/drafts/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, expectedRevision }),
  });
}

export function promoteDraftArticle(filePath: string, expectedRevision?: number): Promise<DraftPromotionResult> {
  return request("/api/articles/drafts/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, confirmed: true, expectedRevision }),
  });
}

export const ARTICLE_STANDARDIZATION_SKILL_ACTION = {
  id: "article-workflow.standardization-skill",
  risk: "medium",
  dataChannel: "POST /api/articles/drafts/validate → POST /api/articles/drafts/promote",
  writes: ARTICLE_ACTION_WRITES.STANDARDIZATION_SKILL,
} as const;

// 候选字段补齐（腿B）：白名单四字段，服务端复用标准化规则引擎做枚举校验。
export function patchCandidateFields(id: string, fields: CandidateFieldCompletion): Promise<PrecleanedArticleDetail> {
  return request(`/api/articles/precleaned/${encodeURIComponent(id)}/fields`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}

// 表单选项：GET /api/articles/field-completion-options——与标准化引擎同源（loadArticleRuleSet），
// 产品/版本的注册表规范化（如别名→正式名）由后端统一处理，表单 offered 值必被 PATCH 接受。
export function fetchCandidateFieldOptions(): Promise<CandidateFieldOptions> {
  return request("/api/articles/field-completion-options");
}

export const ARTICLE_FIELD_COMPLETION_ACTION = {
  id: "article-workflow.field-completion",
  risk: "medium",
  dataChannel: "PATCH /api/articles/precleaned/:id/fields",
  writes: ARTICLE_ACTION_WRITES.FIELD_COMPLETION,
} as const;
