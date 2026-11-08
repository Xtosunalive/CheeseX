// ── PageSection：可选操作行＋分区容器 ──
// 页内主副标题已按 Master 裁决删除（ce337ad4「页内主标题删除」04:52；WP-037 后按
// 2026-10-29 Master 再次指认回退）：页面位置由侧栏导航表达（导航＝页题 TERM 单源），
// 信息用结构表达。本组件仅保留右上操作位（先例 4f19e5b2「只留重检动作」）与分区
// 纵向节奏——title/description 槽已删，重新引入即编译红。
import * as React from "react";
import { cn } from "@/lib/utils";

export type PageSectionProps = {
  /** 右上操作位（状态胶囊/动作钮）——无标题行，独立一行右对齐 */
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function PageSection({ action, children, className }: PageSectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {action && (
        <div className="flex items-center justify-end gap-2">
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
