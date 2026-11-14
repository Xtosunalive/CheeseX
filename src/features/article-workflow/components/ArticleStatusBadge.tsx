// ArticleStatusBadge — WP-174：计算状态徽章＋下一步动作（props 模式，不 fetch）
import { Badge } from "@/components/ui/badge";
import { ARTICLE_STAGE_LABEL, ARTICLE_STATUS_COPY } from "../article-workflow-copy";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-surface-hover text-text-hint",
  warn: "bg-status-warn/10 text-status-warn",
  fact: "bg-status-fact/10 text-status-fact",
  error: "bg-status-error/10 text-status-error",
};

export interface ArticleStatusBadgeProps {
  stage?: string;
  stale?: string[];
  blockers?: Array<{ code: string; waiting_for: string; count?: number }>;
}

export function ArticleStatusBadge({ stage, stale = [], blockers = [] }: ArticleStatusBadgeProps) {
  if (!stage) return null;
  const display = ARTICLE_STAGE_LABEL[stage] ?? { label: stage, tone: "neutral" as const };
  return (
    <div className="flex items-center gap-1" data-testid={`article-status-${stage}`}>
      <Badge className={`text-xs ${TONE_CLASS[display.tone]}`}>{display.label}</Badge>
      {stale.length > 0 && (
        <Badge variant="outline" className="text-xs text-status-warn">{ARTICLE_STATUS_COPY.STALE_BADGE}</Badge>
      )}
      {blockers.length > 0 && (
        <span className="text-xs text-status-error">{blockers.length}{ARTICLE_STATUS_COPY.BLOCKER_COUNT_TEXT}</span>
      )}
    </div>
  );
}
