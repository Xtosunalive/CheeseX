import { ArticleStatusBadge } from "./ArticleStatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalWorkbench } from "@/features/approval-workbench/ApprovalWorkbench";
import { TERM } from "@/constants/term-const";
import { ARTICLE_APPROVAL_DIALOG_COPY } from "../article-workflow-copy";

/**
 * 审批与发布收敛（2026-10-15 Master 裁）：独立 #/publish 页退役，状态机动作
 * （标准化→审批→发布）并入文章工作台行内——本对话框复用既有 ApprovalWorkbench 组件。
 */
export function ArticleApprovalDialog({ open, articleId, title, onClose }: { open: boolean; articleId: string | null; title: string; onClose: () => void }) {
  if (!articleId) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <ArticleStatusBadge articleId={articleId} />
        <DialogHeader>
          <DialogTitle>{TERM.GRAPH_PUBLISH}</DialogTitle>
          <DialogDescription>{ARTICLE_APPROVAL_DIALOG_COPY.DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <ApprovalWorkbench articleId={articleId} title={title} />
      </DialogContent>
    </Dialog>
  );
}
