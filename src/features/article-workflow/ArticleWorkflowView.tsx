import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { ArticleAdmissionWorkspace, ArticlePreviewDialog, ArticleUploadDock, UploadHistoryPanel } from "./components";
import { useArticleWorkflowStore } from "./article-workflow-store";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { PageContainer } from "@/components/page-container";
import { BentoGrid } from "@/components/bento";
import { Statistic } from "@/components/statistic";
import { Panel } from "@/components/panel";
import { ARTICLE_WORKFLOW_VIEW_COPY } from "./article-workflow-copy";

export function ArticleWorkflowView() {
  const items = useArticleWorkflowStore((state) => state.items);
  const uploads = useArticleWorkflowStore((state) => state.uploads);
  const uploadTotal = useArticleWorkflowStore((state) => state.uploadTotal);
  const uploadStatusCounts = useArticleWorkflowStore((state) => state.uploadStatusCounts);
  const selected = useArticleWorkflowStore((state) => state.selected);
  const loading = useArticleWorkflowStore((state) => state.status === "loading");
  const submitting = useArticleWorkflowStore((state) => state.submitting);
  const updatingIds = useArticleWorkflowStore((state) => state.updatingIds);
  const skillOutcomes = useArticleWorkflowStore((state) => state.skillOutcomes);
  const fieldOptions = useArticleWorkflowStore((state) => state.fieldOptions);
  const fieldOptionsLoading = useArticleWorkflowStore((state) => state.fieldOptionsLoading);
  const savingFields = useArticleWorkflowStore((state) => state.savingFields);
  const error = useArticleWorkflowStore((state) => state.error ?? state.operationError);
  const initialize = useArticleWorkflowStore((state) => state.initialize);
  const reload = useArticleWorkflowStore((state) => state.reload);
  const submitUpload = useArticleWorkflowStore((state) => state.submitUpload);
  const openArticle = useArticleWorkflowStore((state) => state.openArticle);
  const closeArticle = useArticleWorkflowStore((state) => state.closeArticle);
  const standardize = useArticleWorkflowStore((state) => state.standardize);
  const loadFieldOptions = useArticleWorkflowStore((state) => state.loadFieldOptions);
  const saveCandidateFields = useArticleWorkflowStore((state) => state.saveCandidateFields);

  useEffect(() => { void initialize(); }, [initialize]);
  // WP-145：聚焦/回前台即时重拉收编共享 hook（reload(true) 语义留调用侧闭包）
  useRefetchOnFocus(() => { void reload(true); });
  // 可见期 5 秒轮询起停（节流语义，不并入 hook）：可见→起表，隐藏→停表；卸载随 effect 清理
  useEffect(() => {
    let timer: number | undefined;
    const start = () => {
      if (document.visibilityState !== "visible" || timer !== undefined) return;
      timer = window.setInterval(() => void reload(true), 5000);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", handleVisibility); };
  }, [reload]);

  return (
    <PageContainer>
      {/* Master 2026-10-29「横幅都不要了」：DIKW 徽标行＋转换横幅全撤——信息由结构与空态引导承担 */}


      {/* WP-037 P7 锚点：投稿工作流规模（待处理 xl＋总任务 lg） */}
      {uploads.length > 0 && (
      <BentoGrid>
        <Statistic size="xl" className="lg:col-span-2" label={ARTICLE_WORKFLOW_VIEW_COPY.AWAITING_ARCHITECT_LABEL} value={uploadStatusCounts.awaiting_architect_processing ?? 0} tone={(uploadStatusCounts.awaiting_architect_processing ?? 0) > 0 ? "text-status-warn" : "text-status-fact"} hint={ARTICLE_WORKFLOW_VIEW_COPY.AWAITING_ARCHITECT_HINT} />
        <Statistic size="lg" label={ARTICLE_WORKFLOW_VIEW_COPY.UPLOAD_TOTAL_LABEL} value={uploadTotal} hint={ARTICLE_WORKFLOW_VIEW_COPY.UPLOAD_TOTAL_HINT} />
      </BentoGrid>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-status-error-2 px-4 py-3 text-xs text-status-error ring-1 ring-status-error-6">
          <AlertTriangle className="h-4 w-4" />{error}
        </div>
      )}

      <div className="space-y-4 pb-32">
        <UploadHistoryPanel
          items={uploads}
          total={uploadTotal}
          statusCounts={uploadStatusCounts}
          skillOutcomes={skillOutcomes}
        />
        <Panel padding="none" className="overflow-hidden" labelledBy="standard-articles-heading">
          <ArticleAdmissionWorkspace
            items={items}
            uploads={uploads}
            loading={loading}
            onOpen={(id) => { void openArticle(id); void loadFieldOptions(); }}
          />
        </Panel>
      </div>

      <ArticleUploadDock submitting={submitting} onSubmit={submitUpload} />
      <ArticlePreviewDialog
        article={selected}
        standardizing={Boolean(selected && updatingIds.includes(selected.id))}
        fieldOptions={fieldOptions}
        fieldOptionsLoading={fieldOptionsLoading}
        savingFields={savingFields}
        onStandardize={(id) => standardize(id)}
        onSaveFields={(id, fields) => { void saveCandidateFields(id, fields).then((ok) => { if (ok) void reload(true); }); }}
        onClose={closeArticle}
      />
    </PageContainer>
  );
}
