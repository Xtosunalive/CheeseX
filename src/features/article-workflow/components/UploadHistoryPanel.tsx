// UploadHistoryPanel — 收官批迁移（Master 裁定 A，2026-10-15）：W3 豁免解除——同页单表断言
// 已按裁定改为按表名定位（article-workflow-view.test.tsx「工作草稿表」），本面板 div 行→DataTable
// 语义表（D12）：四列＋结果反馈卡 expandable 常显行（F2 role=status 保留）；移动端单列堆叠走
// 基座 card（表头隐藏）；时间 formatDateTime（D9，W3 已换）。面板壳（折叠/汇总/终态历史开关）原样。
// WP-146 件2（清单#17）：原「备注」列整列每行同一句「动作在草稿行内」——列删除，语义上移到
// 「状态」表头 title（TERM.STANDARDIZE_ACTION_IN_DRAFT_HINT）。
import { useState } from "react";
import { TERM } from "@/constants/term-const";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { DataTable } from "@/components/data-table/DataTable";
import { Panel } from "@/components/panel";
import type { Column } from "@/components/data-table/types";
import { formatDateTime } from "@/lib/format";
import { type ArticleUploadList, type ArticleWorkflowTask, type DraftSkillOutcome } from "@/features/article-workflow/article-workflow-types";
import { articleTaskStatusDisplay } from "@/lib/domain/StatusDisplay";
import {
  ARTICLE_SKILL_OUTCOME_COPY,
  UPLOAD_HISTORY_COPY,
  articleSkillKnownIssuesText,
  uploadHistoryCandidateSuffix,
  uploadHistoryCountText,
  uploadHistorySummaryCounts,
  uploadHistoryTerminalToggleText,
} from "../article-workflow-copy";

type Props = {
  items: ArticleWorkflowTask[];
  total: number;
  statusCounts: ArticleUploadList["statusCounts"];
  skillOutcomes: Record<string, DraftSkillOutcome>;
  /** 标准化动作已迁工作草稿行内（2026-10-15 Master 裁）——面板纯审计视图；保留 prop 供存量测试 */
};

// 状态列统一走 ui/tag 语义 tone（表间观感一致性批 2026-10-16）
function statusTone(status: ArticleWorkflowTask["status"]): "fact" | "loading" | "neutral" | "warn" {
  if (status === "standardized" || status === "published") return "fact";
  if (status === "source_deleted") return "neutral";
  return "warn";
}


function displaySize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

// 本地标准化 Skill 行内结果卡：完成（字段问题随候选上报待处理问题补齐）/ 结构性失败两分支。
function SkillOutcomeCard({ outcome }: { outcome: DraftSkillOutcome }) {
  if (outcome.errorMessage) {
  return (
      <div role="status" className="rounded-lg bg-status-error-2 px-3 py-2 text-xs text-status-error ring-1 ring-status-error-6">
        <p className="font-medium">{ARTICLE_SKILL_OUTCOME_COPY.FAILED}</p>
        <p className="mt-1">{outcome.errorMessage}</p>
      </div>
    );
  }
  const validate = outcome.validate;
  if (!validate || outcome.stage !== "done" || !outcome.promote) return null;
  const issues = [...validate.errors, ...validate.warnings];
  return (
    <div role="status" className="rounded-lg bg-status-fact-2 px-3 py-2 text-xs ring-1 ring-border-thin">
      <p className="font-medium text-status-fact">{ARTICLE_SKILL_OUTCOME_COPY.DONE}</p>
      <p className="mt-0.5 truncate text-text-hint" title={outcome.promote.precleanedPath}>{outcome.promote.precleanedPath}</p>
      {issues.length > 0 && (
        <div className="mt-1 text-status-warn">
          <p>{articleSkillKnownIssuesText(issues.length)}</p>
          <ul className="list-disc pl-4">
            {issues.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}
      {validate.autoFilled.length > 0 && <p className="mt-0.5 text-text-hint">{ARTICLE_SKILL_OUTCOME_COPY.AUTO_FILLED_PREFIX}{validate.autoFilled.join("、")}</p>}
    </div>
  );
}

export function UploadHistoryPanel({ items, total, statusCounts, skillOutcomes }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // 显示收敛（2026-10-15 Master 裁「2」）：终态任务（已完成/源已删/已消化）默认不投——操作页
  // 只看「当前要处理什么」；完整审计走 vault git 提交史。历史可展开查看（不删数据）。
  const TERMINAL_STATUSES = new Set(["standardized", "published", "source_deleted", "digested"]);
  const activeItems = items.filter((item) => !TERMINAL_STATUSES.has(item.status));
  const historyItems = items.filter((item) => TERMINAL_STATUSES.has(item.status));
  const visibleItems = showHistory ? items : activeItems;
  const completedCount = statusCounts.standardized + statusCounts.published;
  const deletedCount = statusCounts.source_deleted + statusCounts.digested;
  const pendingCount = total - completedCount - deletedCount;
  const summary = total === 0 ? TERM.EMPTY_PENDING_SUBMISSION : pendingCount === 0 ? (statusCounts.standardized > 0 ? UPLOAD_HISTORY_COPY.SUMMARY_DONE_WITH_STANDARDIZED : UPLOAD_HISTORY_COPY.SUMMARY_DONE) : uploadHistorySummaryCounts(pendingCount, completedCount + deletedCount);
  const summaryDot = total > 0 && pendingCount === 0 ? "bg-status-fact" : "bg-status-loading";

  const columns: Array<Column<ArticleWorkflowTask>> = [
    {
      key: "file",
      title: UPLOAD_HISTORY_COPY.COL_FILE,
      render: (item) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-main" title={item.originalFileName}>{item.originalFileName}</p>
          <p className="truncate text-xs text-text-hint" title={item.draftPath}>{item.draftPath}</p>
        </div>
      ),
    },
    {
      key: "size",
      title: UPLOAD_HISTORY_COPY.COL_SIZE,
      width: 90,
      render: (item) => <span className="text-xs text-text-sub">{displaySize(item.sizeBytes)}</span>,
    },
    {
      key: "createdAt",
      title: UPLOAD_HISTORY_COPY.COL_CREATED_AT,
      width: 130,
      render: (item) => <span className="text-xs text-text-hint">{formatDateTime(item.createdAt)}</span>,
    },
    {
      // WP-146 件2：标准化动作入口指引从原「备注」列整列重复句收敛到本表头 title（列删除，
      // 宽度让给文件列；窄屏卡片态表头隐藏，指引随表格语义仅在表格形态呈现）
      key: "status",
      title: <span title={TERM.STANDARDIZE_ACTION_IN_DRAFT_HINT}>{UPLOAD_HISTORY_COPY.COL_STATUS}</span>,
      width: 150,
      render: (item) => (
        <Tag tone={statusTone(item.status)}>
          {articleTaskStatusDisplay(item.status).label}{item.candidateCount > 1 ? uploadHistoryCandidateSuffix(item.candidateCount) : ""}
        </Tag>
      ),
    },
  ];

  if (total === 0) return null; // Master 2026-10-29：零值摘要/提示不渲染——结构即空态（Hooks 后）
  return (
    <Panel padding="none" ariaLabel={UPLOAD_HISTORY_COPY.TITLE}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={expanded ? UPLOAD_HISTORY_COPY.COLLAPSE_ARIA : UPLOAD_HISTORY_COPY.EXPAND_ARIA} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <div data-module-title="upload-history" className="flex min-w-0 flex-1 items-baseline gap-2"><h2 className="text-sm font-semibold text-text-main">{UPLOAD_HISTORY_COPY.TITLE}</h2><p className="truncate text-xs text-text-hint">{uploadHistoryCountText(total, activeItems.length)}</p></div>
        {/* animate-pulse 为功能性保留（WP-145 R7 复核）：仅 pendingCount>0 时呼吸，实时指示有进行中的投稿任务 */}
        <span className="hidden items-center gap-1.5 text-xs text-text-hint sm:flex"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${pendingCount > 0 ? "animate-pulse" : ""} ${summaryDot}`} />{summary}</span>
      </div>
      {expanded && (
        <div className="border-t border-border-thin">
          <DataTable
            ariaLabel={UPLOAD_HISTORY_COPY.TABLE_ARIA}
            columns={columns}
            rows={visibleItems}
            rowKey={(item) => item.taskId}
            density="md"
            empty={items.length === 0 ? { title: UPLOAD_HISTORY_COPY.EMPTY_NONE } : { title: UPLOAD_HISTORY_COPY.EMPTY_NO_PENDING, description: UPLOAD_HISTORY_COPY.EMPTY_NO_PENDING_DESCRIPTION }}
            card={{ rowClassName: "grid grid-cols-1 gap-1" }}
            expandable={{
              rowExpanded: (item) => Boolean(skillOutcomes[item.taskId]),
              onToggle: () => undefined,
              render: (item) => <SkillOutcomeCard outcome={skillOutcomes[item.taskId]} />,
              toggleColumn: false,
            }}
          />
        </div>
      )}
      {expanded && historyItems.length > 0 && (
        <button type="button" onClick={() => setShowHistory((v) => !v)} className="w-full border-t border-border-thin px-4 py-2 text-left text-xs text-text-hint hover:bg-surface-hover hover:text-text-sub">
          {showHistory ? TERM.COLLAPSE_ACTION : TERM.EXPAND_ACTION}{uploadHistoryTerminalToggleText(historyItems.length)}
        </button>
      )}
    </Panel>
  );
}
