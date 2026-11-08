import type { paths } from "@/lib/generated/api-types";

type ListOperation = paths["/api/article-associations"]["get"];
type PreviewOperation = paths["/api/article-associations/preview"]["post"];
type SaveOperation = paths["/api/article-associations/save"]["post"];
export type ArticleAssociationData = ListOperation["responses"][200]["content"]["application/json"]["data"];
export type ArticleAssociationDecision = ArticleAssociationData["decisions"][number];
export type ArticleAssociationWriteRequest = PreviewOperation["requestBody"]["content"]["application/json"];
export type ArticleAssociationPreviewData = PreviewOperation["responses"][200]["content"]["application/json"]["data"];
export type ArticleAssociationProposalData = SaveOperation["responses"][200]["content"]["application/json"]["data"];
export type AssociationAction = ArticleAssociationWriteRequest["action"];
