import type { paths } from "@/lib/generated/api-types";

type TaskEnvelope = paths["/api/articles/upload"]["post"]["responses"][201]["content"]["application/json"];
type UploadListEnvelope = paths["/api/articles/uploads"]["get"]["responses"][200]["content"]["application/json"];
type ListEnvelope = paths["/api/articles/precleaned"]["get"]["responses"][200]["content"]["application/json"];
type DetailEnvelope = paths["/api/articles/precleaned/{id}"]["get"]["responses"][200]["content"]["application/json"];
type StandardizationEnvelope = paths["/api/articles/precleaned/{id}/standardization"]["post"]["responses"][200]["content"]["application/json"];
type DraftValidateEnvelope = paths["/api/articles/drafts/validate"]["post"]["responses"][200]["content"]["application/json"];
type DraftPromoteEnvelope = paths["/api/articles/drafts/promote"]["post"]["responses"][200]["content"]["application/json"];

export type ArticleUploadRequest = paths["/api/articles/upload"]["post"]["requestBody"]["content"]["application/json"];
export type ArticleWorkflowTask = TaskEnvelope["data"];
export type ArticleUploadList = UploadListEnvelope["data"];
export type PrecleanedArticleList = ListEnvelope["data"];
export type PrecleanedArticleItem = PrecleanedArticleList["items"][number];
export type PrecleanedArticleDetail = DetailEnvelope["data"];
export type ArticleStandardization = StandardizationEnvelope["data"];
export type DraftValidationResult = DraftValidateEnvelope["data"];
export type DraftPromotionResult = DraftPromoteEnvelope["data"];
export type ArticleFieldCompletionRequest = paths["/api/articles/precleaned/{id}/fields"]["patch"]["requestBody"]["content"]["application/json"];
export type CandidateFieldCompletion = ArticleFieldCompletionRequest["fields"];

// 表单数据源形状（契约生成类型，仅供 api 层装配选项）。
export type CandidateFieldOptions = paths["/api/articles/field-completion-options"]["get"]["responses"][200]["content"]["application/json"]["data"];

// 本地标准化 Skill 一次执行的行内结果：done=校验打标+晋升完成（字段问题随候选上报）；
// promote=结构性失败（文件/解析/source_file），草稿保持原状。
export type DraftSkillOutcome = {
  stage: "promote" | "done";
  validate: DraftValidationResult | null;
  promote: DraftPromotionResult | null;
  errorMessage: string | null;
  /** 选项空态状态（WP-062 功能可用性）：逐选项源 empty＋hint——空态时表单渲染指引替代死下拉 */
  availability?: Partial<Record<string, { empty: boolean; hint: string }>>;
};
// 状态显示映射已收编至 status-display 域单源（PR-130/STATUS-DISPLAY-001）：
// standardizationStatusDisplay / articleTaskStatusDisplay（@/lib/domain/StatusDisplay）。
