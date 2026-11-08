import { useEffect, useState } from "react";
import { TERM } from "@/constants/term-const";
import { ARTICLE_RETIRE_COPY, articleRetireDescription, articleRetireFormalSnapshotsText } from "../article-workflow-copy";
import { FileArchive, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewArticleRetirement, retireArticle, type ArticleRetirePlan } from "@/features/article-workflow/article-workflow-api";

type Props = {
  open: boolean;
  basename: string | null;
  title: string;
  onClose: () => void;
  onRetired: () => void;
};

/**
 * SPEC-013 文章退役确认对话框——先 dryRun 预演（零落盘）展示清理计划，
 * 用户确认后才执行（服务端事务性：失败回滚不留半态）。
 */
export function ArticleRetireDialog({ open, basename, title, onClose, onRetired }: Props) {
  const [plan, setPlan] = useState<ArticleRetirePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (!open || !basename) return;
    setPlan(null);
    setError(null);
    let cancelled = false;
    previewArticleRetirement(basename)
      .then((result) => { if (!cancelled) setPlan(result); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [open, basename]);

  async function execute() {
    if (!basename) return;
    setExecuting(true);
    setError(null);
    try {
      await retireArticle(basename);
      onRetired();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : ARTICLE_RETIRE_COPY.RETIRE_FAILED);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !executing) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ARTICLE_RETIRE_COPY.TITLE}</DialogTitle>
          <DialogDescription>
            {articleRetireDescription(title)}
          </DialogDescription>
        </DialogHeader>
        {!plan && !error && <div className="flex items-center gap-2 py-6 text-sm text-text-hint"><Loader2 className="h-4 w-4 animate-spin" />{ARTICLE_RETIRE_COPY.PLAN_LOADING}</div>}
        {error && <div className="rounded-md bg-status-error-2 px-3 py-2 text-xs text-status-error ring-1 ring-status-error-6">{error}</div>}
        {plan && (
          <div className="space-y-2 text-xs">
            <p className="font-medium text-text-main">{ARTICLE_RETIRE_COPY.PLAN_HEADING}</p>
            <ul className="space-y-1 text-text-sub">
              {plan.plan.workingPath && <li>{ARTICLE_RETIRE_COPY.PLAN_WORKING_COPY}</li>}
              {plan.plan.formalPaths.length > 0 && <li>{articleRetireFormalSnapshotsText(plan.plan.formalPaths.length)}</li>}
              {plan.plan.archivePath && <li>{ARTICLE_RETIRE_COPY.PLAN_ARCHIVE}</li>}
              <li>{ARTICLE_RETIRE_COPY.PLAN_MANIFEST_ROW}</li>
            </ul>
            {plan.plan.warnings.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-md bg-status-warn-2 px-2.5 py-2 text-status-warn ring-1 ring-status-warn-6">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{plan.plan.warnings.join("；")}</div>
              </div>
            )}
            <p className="flex items-center gap-1 text-text-hint"><FileArchive className="h-4 w-4" />{ARTICLE_RETIRE_COPY.DRY_RUN_NOTE}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={executing}>{TERM.CANCEL_ACTION}</Button>
          <Button variant="destructive" onClick={() => void execute()} disabled={!plan || executing}>
            {executing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {ARTICLE_RETIRE_COPY.CONFIRM_ACTION}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
