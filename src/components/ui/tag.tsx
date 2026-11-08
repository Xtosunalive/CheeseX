// ── ui/tag（P3 · D6：语义徽章，替代 15 处手写 span 与不匹配的 ui/badge 用法）──
// 规格口径＝antd Tag 实测（components/tag/style/index.ts）：内距 inline 7（tagPaddingHorizontal 8
// 减线宽 1）、block 方向 0（行高≈20 撑高）、圆角 4px 字面（--radius-xs 单消费者随收官存量清零批退役）、字号 12（fontSizeSM）。
// 颜色：status 五语义＋neutral 走 token 派生（/10 底 /20 环）；cat 分类色由调用方拼
// className（cat 家族 ~50 词不做枚举变体——动态类名不过 Tailwind JIT）。
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const tagVariants = cva(
  "inline-flex items-center gap-1 rounded-[4px] px-[7px] py-0 text-xs leading-5 ring-1",
  {
    variants: {
      tone: {
        neutral: "bg-surface-hover/60 text-text-sub ring-border-thin",
        fact: "bg-status-fact-2 text-status-fact ring-status-fact-6",
        inferred: "bg-status-inferred/10 text-status-inferred ring-status-inferred/20",
        warn: "bg-status-warn-2 text-status-warn ring-status-warn-6",
        error: "bg-status-error-2 text-status-error ring-status-error-6",
        loading: "bg-status-loading-2 text-status-loading ring-status-loading-6",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type TagProps = React.ComponentProps<"span"> & VariantProps<typeof tagVariants>;

export function Tag({ tone, className, ...props }: TagProps) {
  return <span data-testid="ui-tag" className={`${tagVariants({ tone })} ${className ?? ""}`} {...props} />;
}
