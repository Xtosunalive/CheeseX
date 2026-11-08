// ── PageContainer：页面内部纵向节奏（WP-036 Shakuro 布局件）──
// 宽度与外边距由 App.tsx 主内容区统一（p-4 sm:p-6 + max-w-[1400px]），此处不重复，
// 只统一页面内各区块之间的纵向间距。
// WP-037 P1：响应式节奏 gap-4 md:gap-6（窄 16 / 宽 24，shadcn Blocks 同款对齐）。
import * as React from "react";
import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageContainer({ children, className }: PageContainerProps) {
  return <div className={cn("flex flex-col gap-4 md:gap-6", className)}>{children}</div>;
}
