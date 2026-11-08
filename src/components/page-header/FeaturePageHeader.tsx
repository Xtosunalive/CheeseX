import type { ReactNode } from "react";

interface FeaturePageHeaderProps {
  /** 已废弃（与顶栏 PageHeader 重复，PR③ Master 2026-10-07 04:44 拍板删页内主标题）——
   *  保留 prop 位以免四处消费方连锁改签名，但传了也不渲染 h1；清理窗口过后可移除 */
  title?: string;
  description?: string;
  /** 状态、数量、更新时间等辅助信息 */
  meta?: ReactNode;
  /** 右侧操作按钮 */
  actions?: ReactNode;
}

/**
 * 页面标题区共享组件 — 统一描述、辅助信息和操作区布局。
 * 页内主标题已删（页面名由顶栏应用栏承载，页内 h1 属第三重重复）；本组件只保留
 * description/meta/actions 三个信息位。
 */
export function FeaturePageHeader({ description, meta, actions }: FeaturePageHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {description && <p className="max-w-3xl text-sm leading-tight text-text-hint">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="mt-1 text-xs text-text-hint">{meta}</div>}
    </div>
  );
}
