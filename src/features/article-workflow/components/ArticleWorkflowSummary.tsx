import type { PrecleanedArticleItem } from "@/features/article-workflow/article-workflow-types";
import { TERM } from "@/constants/term-const";
import { standardizationStatusDisplay } from "@/lib/domain/StatusDisplay";
import { articlePendingStandardizationText } from "../article-workflow-copy";

type Props = {
  items: PrecleanedArticleItem[];
};

/**
 * 工作草稿统计条。
 * 勾选体系退役记录（2026-10-15，无消费者实证）：「审批与发布（N）」按钮与 selectedItems 已删——
 * 该按钮原为跳独立 #/publish 页入口（页面退役后成自我跳转），勾选链的唯一消费者即其计数，
 * 行内 🚀 单篇动作不需要多选。防「顺手」复活：批量动作需求出现时须先证明消费路径。
 */
export function ArticleWorkflowSummary({ items }: Props) {
  if (items.length === 0) return null; // Master 2026-10-29：零值状态条不渲染
  const pendingCount = items.filter((item) => item.standardizationStatus === "pending_standardization").length;
  const blockedCount = items.filter((item) => item.standardizationStatus === "blocked").length;
  const standardizedCount = items.filter((item) => item.standardizationStatus === "standardized").length;

  return (
    <div className="border-b border-border-thin px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h2 id="standard-articles-heading" data-module-title="standard-articles" className="text-sm font-semibold text-text-main">{TERM.WORKING_DRAFT}</h2>
        <div className="flex items-center gap-4" data-testid="admission-stats">
          <span className="flex items-baseline gap-1.5 text-xs text-text-hint"><b className="text-lg font-semibold tabular-nums text-status-warn">{pendingCount}</b>{standardizationStatusDisplay("pending_standardization").label}</span>
          <span className="flex items-baseline gap-1.5 text-xs text-text-hint"><b className="text-lg font-semibold tabular-nums text-status-error">{blockedCount}</b>{standardizationStatusDisplay("blocked").label}</span>
          <span className="flex items-baseline gap-1.5 text-xs text-text-hint"><b className="text-lg font-semibold tabular-nums text-text-main">{standardizedCount}</b>{standardizationStatusDisplay("standardized").label}</span>
          <span className="flex items-baseline gap-1.5 text-xs text-text-hint"><b className="text-lg font-semibold tabular-nums text-text-main">{items.length}</b>{TERM.WORKING_DRAFT}</span>
        </div>
      </div>
      {pendingCount > 0 && <p className="mt-2 text-xs text-text-hint">{articlePendingStandardizationText(pendingCount)}</p>}
    </div>
  );
}
