// ── TableToolbar：列表工具条唯一实现（ui-kit·WP 批 2026-10-29 Master「归一化管理」）──
// 药丸容器＋搜索框统一在此定义；筛选钮/清除/刷新等作为 children 装入。
// 全站列表工具条一律用本组件——手写药丸 div 与手写搜索框 label 块退役
// （守卫：table-toolbar-guard 测试禁手写药丸类/搜索 label 回流）。
import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export function TableToolbar({
  children,
  className,
  testId,
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn("flex w-full flex-wrap items-center gap-1 rounded-lg bg-surface-root px-2 py-2 ring-1 ring-border-thin", className)}
    >
      {children}
    </div>
  );
}

export function TableToolbarSearch({
  ariaLabel,
  placeholder,
  value,
  onChange,
  onEnter,
}: {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onEnter?: () => void;
}) {
  return (
    <label className="relative min-w-56 flex-1">
      <span className="sr-only">{ariaLabel}</span>
      <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-text-hint" aria-hidden />
      <Input
        aria-label={ariaLabel}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={(event) => event.key === "Enter" && onEnter?.()}
        className="h-8 w-full bg-transparent pl-8 pr-3 text-xs text-text-main outline-none placeholder:text-text-hint"
      />
    </label>
  );
}
