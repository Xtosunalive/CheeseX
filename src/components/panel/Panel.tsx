// ── Panel：标准面板，收编散写的 bg-surface-card rounded-xl ring-1（WP-036）──
// 统一表面/描边/内距与标题槽；面板清单见 SPEC-038 附录 A。
import * as React from "react";
import { cn } from "@/lib/utils";

export type PanelProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** 标题行右侧操作区 */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 内容区内距，默认 md */
  padding?: "none" | "sm" | "md";
  /** 内容区附加类（全屏工作台需 flex-1 撑满时使用） */
  contentClassName?: string;
  /** 测试锚点 */
  testId?: string;
  /** 可访问名：传入后根节点作为 region 地标，供屏幕阅读器地标导航 */
  ariaLabel?: string;
  /** 可访问名（引用内部标题 id）：传入后根节点作为 region 地标 */
  labelledBy?: string;
};

export function Panel({
  title,
  description,
  action,
  children,
  className,
  padding = "md",
  contentClassName,
  testId,
  ariaLabel,
  labelledBy,
}: PanelProps) {
  const isRegion = Boolean(ariaLabel || labelledBy);
  return (
    <div
      data-testid={testId}
      className={cn("rounded-xl bg-surface-card ring-1 ring-border-thin", className)}
      role={isRegion ? "region" : undefined}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
    >
      {(title || description || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3">
          <div className="min-w-0">
            {title && (
              <h3 className="font-display text-sm font-bold text-text-main">{title}</h3>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-text-sub">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          padding === "md" && "p-5",
          padding === "sm" && "p-3",
          padding === "none" && "",
          contentClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
