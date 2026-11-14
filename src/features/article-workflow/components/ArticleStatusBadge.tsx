// ArticleStatusBadge — WP-173（SPEC-095 §3.6 收窄版）：计算状态徽章＋下一步动作按钮
// OpenBKN 模式：stage 从后端计算状态取（读时现算），next_actions 直接消费。
// 自包含数据获取（useEffect + fetch——不依赖 React Query Provider，挂哪都不炸）。

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getArticleStatus, type ArticleStatusResponse } from "../article-workflow-api";

import { ARTICLE_STAGE_LABEL as STAGE_LABEL, ARTICLE_ACTION_LABEL as ACTION_LABEL, ARTICLE_STATUS_COPY } from "../article-workflow-copy";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-surface-hover text-text-hint",
  warn: "bg-status-warn/10 text-status-warn",
  fact: "bg-status-fact/10 text-status-fact",
  error: "bg-status-error/10 text-status-error",
};



export function ArticleStatusBadge({ articleId }: { articleId: string }) {
  const [status, setStatus] = useState<ArticleStatusResponse["data"] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getArticleStatus(articleId)
      .then((r) => { if (!cancelled && r?.data) setStatus(r.data); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [articleId]);

  if (error) return null; // 状态获取失败静默——不阻断宿主组件
  if (!status) return <Badge variant="outline" className="text-xs">…</Badge>;

  const display = STAGE_LABEL[status.stage] ?? { label: status.stage, tone: "neutral" as const };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`article-status-${articleId}`}>
      <Badge className={`text-xs ${TONE_CLASS[display.tone]}`}>{display.label}</Badge>
      {status.stale?.length > 0 && (
        <Badge variant="outline" className="text-xs text-status-warn" data-testid="status-stale">
          {ARTICLE_STATUS_COPY.STALE_BADGE}
        </Badge>
      )}
      {status.blockers?.length > 0 && (
        <span className="text-xs text-status-error" data-testid="status-blockers">{ARTICLE_STATUS_COPY.BLOCKER_COUNT(status.blockers.length)}</span>
      )}
      {(status.next_actions ?? []).filter((a) => a.allowed && a.action !== "wait").map((a) => (
        <Button key={a.action} size="sm" variant="outline" className="h-6 px-2 text-xs"
          title={a.reason || undefined} disabled={!a.allowed} data-action-id={`status-${a.action}`}>
          {ACTION_LABEL[a.action] ?? a.action}
        </Button>
      ))}
    </div>
  );
}
