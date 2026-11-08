// ── BentoGrid：Bento 主次网格容器（WP-036 Shakuro 布局件）──
// 默认窄屏单列、宽屏 3 列；需要不同列数时用 className 覆盖 grid-cols。
// WP-037：透传 div 原生属性（data-testid 等——统计网格既有断言锚在网格本体）。
import * as React from "react";
import { cn } from "@/lib/utils";

export type BentoGridProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  className?: string;
};

export function BentoGrid({ children, className, ...rest }: BentoGridProps) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3", className)} {...rest}>
      {children}
    </div>
  );
}
