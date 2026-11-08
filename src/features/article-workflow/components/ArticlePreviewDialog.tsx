import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TERM } from "@/constants/term-const";
import { ARTICLE_STANDARDIZATION_ACTION } from "@/features/article-workflow/article-workflow-api";
import { type CandidateFieldCompletion, type CandidateFieldOptions, type PrecleanedArticleDetail } from "@/features/article-workflow/article-workflow-types";
import { standardizationStatusDisplay } from "@/lib/domain/StatusDisplay";
import { CandidateFieldForm } from "./CandidateFieldForm";
import { ARTICLE_PREVIEW_COPY, articlePreviewReceiptText, articlePreviewWarningText } from "../article-workflow-copy";

type Props = {
  article: PrecleanedArticleDetail | null;
  standardizing: boolean;
  fieldOptions: CandidateFieldOptions | null;
  fieldOptionsLoading: boolean;
  savingFields: boolean;
  onStandardize: (id: string) => Promise<void>;
  onSaveFields: (id: string, fields: CandidateFieldCompletion) => void;
  onClose: () => void;
};

export function ArticlePreviewDialog({ article, standardizing, fieldOptions, fieldOptionsLoading, savingFields, onStandardize, onSaveFields, onClose }: Props) {
  if (!article) return null;
  const standardized = article.standardizationStatus === "standardized";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{article.title}</DialogTitle>
          <DialogDescription>
            {article.sourcePath}
            <span className="ml-2">{TERM.STANDARDIZATION_VALIDATION}：{standardizationStatusDisplay(article.standardizationStatus).label}</span>
            {standardized && article.validatedAt && (
              <span className="ml-2" title={ARTICLE_PREVIEW_COPY.RECEIPT_TITLE}>
                {articlePreviewReceiptText(new Date(article.validatedAt).toLocaleString("zh-CN"))}
              </span>
            )}
            {standardized && article.currentStandardVersion?.releaseId && <span className="ml-2" title={article.currentStandardVersion.releaseId}>{ARTICLE_PREVIEW_COPY.RELEASE_PREFIX}{article.currentStandardVersion.releaseId.slice(-12)}</span>}
            {standardized && article.currentStandardVersion?.proposalId && <span className="ml-2" title={article.currentStandardVersion.proposalCommit ?? article.currentStandardVersion.proposalId}>{ARTICLE_PREVIEW_COPY.PROPOSAL_PREFIX}{article.currentStandardVersion.proposalId.slice(-12)}</span>}
            {!standardized && article.standardizationWarningCount > 0 && <span className="ml-2">{articlePreviewWarningText(article.standardizationWarningCount)}</span>}
          </DialogDescription>
        </DialogHeader>
        {/* PR-151：已标准化文章同样开放补齐——补齐后内容变化自动回待标准化，重走标准化即可（与 Obsidian 编辑同一语义） */}
      <CandidateFieldForm article={article} options={fieldOptions} optionsLoading={fieldOptionsLoading} saving={savingFields} onSave={onSaveFields} />
        {/* 正文来自当前工作稿；正式快照的发布状态由审批工作区单独呈现。 */}
        <ScrollArea className="h-[58vh] border border-border-thin bg-surface-root p-4"><pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-text-sub">{article.content}</pre></ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{ARTICLE_PREVIEW_COPY.CLOSE_ACTION}</Button>
          <Button disabled={standardizing} data-action-id={ARTICLE_STANDARDIZATION_ACTION.id} data-risk={ARTICLE_STANDARDIZATION_ACTION.risk} data-channel={ARTICLE_STANDARDIZATION_ACTION.dataChannel} title={ARTICLE_PREVIEW_COPY.STANDARDIZE_TITLE} onClick={() => void onStandardize(article.id)}>{standardizing ? ARTICLE_PREVIEW_COPY.STANDARDIZING : ARTICLE_PREVIEW_COPY.STANDARDIZE_ACTION}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
