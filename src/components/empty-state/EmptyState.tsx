// ── EmptyState：统一空态（WP-037 P4 配方 empty-state）──
// 两变体：no-data（无数据：说明来源＋引导）／no-match（筛选无结果：提示调整条件＋复位筛选，文案引用 TERM）。
// 形态语言对齐 shadcn muted 体系（弱底/弱色/rounded-xl）；表格场景用 bare（表头由 DataTable 保留，
// 本组件渲染行区），非表格独立场景默认弱底容器居中。空态文案单源收编「暂无X」族散写。
import * as React from "react";
import { Inbox, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateVariant = "no-data" | "no-match";

export type EmptyStateProps = {
  /** no-data＝无数据（引导）；no-match＝筛选无结果（调整条件）。默认 no-data */
  variant?: EmptyStateVariant;
  /** 覆盖默认图标（默认：no-data=Inbox／no-match=SearchX） */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 主操作按钮（文案引用 TERM 常量，如筛选复位） */
  action?: React.ReactNode;
  /** 表格行区渲染（无外框）；false＝独立弱底容器 */
  bare?: boolean;
  className?: string;
};

const DEFAULT_ICON: Record<EmptyStateVariant, typeof Inbox> = {
  "no-data": Inbox,
  "no-match": SearchX,
};

export function EmptyState({
  variant = "no-data",
  icon,
  title,
  description,
  action,
  bare = false,
  className,
}: EmptyStateProps) {
  const Icon = DEFAULT_ICON[variant];
  return (
    <div
      data-testid="empty-state"
      data-variant={variant}
      className={cn(
        !bare && "rounded-xl bg-surface-root px-4 py-10 ring-1 ring-border-thin",
        className,
      )}
    >
      <div className="flex flex-col items-center justify-center gap-1 text-center">
        {icon ?? <Icon className="h-6 w-6 text-text-placeholder" aria-hidden />}
        <span className="text-sm text-text-main">{title}</span>
        {description ? (
          <span className="max-w-[340px] text-xs leading-relaxed text-text-hint">{description}</span>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
