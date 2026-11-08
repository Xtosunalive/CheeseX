// ── ui/select（W4 · 卡 §十二 I5「ui/select 补齐」）──
// 样式化原生 <select>：键盘/读屏语义天然达标，零新依赖（@radix-ui/react-select 未安装，
// 引入新包须另行授权；当前消费面〔T14 产品切换〕为短列表，原生形态足够）。
// 与 EditableCell.Select 的分工：本件＝表单/工具栏级选择器；EditableCell.Select＝表内单元格形态。
import type * as React from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.ComponentProps<"select">;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      data-testid="ui-select"
      className={cn(
        "h-8 rounded-md bg-surface-root px-2 text-sm text-text-main ring-1 ring-border-thin outline-none focus-visible:ring-border-focus disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
