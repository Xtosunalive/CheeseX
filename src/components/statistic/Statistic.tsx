// ── Statistic（P3 · D8：汇总统计卡单一实现，合并 SummaryStat〔T06〕≈ SummaryMetric〔T07〕）──
// WP-036 升级：表面走 surface-card，补 size 大数字档（消费展示字阶 2xl/3xl/4xl），
// 支持 className（Bento 跨格）与 icon（label 前小图标）。
import * as React from "react";
import { cn } from "@/lib/utils";

type StatisticSize = "sm" | "md" | "lg" | "xl";

type StatisticProps = {
  label: string;
  /** null＝未知（未加载/后端未携带）——渲染「—」，不得由调用方喂 0 冒充（WP-134 波0 类型闸口） */
  value: number | string | null;
  /** 值下方副行（如「较昨日 +2」） */
  sub?: React.ReactNode;
  /** 值的颜色类（语义工具类，如 text-status-warn） */
  tone?: string;
  /** 悬停提示 */
  hint?: string;
  testId?: string;
  /** label 前小图标 */
  icon?: React.ReactNode;
  /** 数字档位：sm 紧凑 / md 标准卡 / lg 强调 / xl 主视觉大数字 */
  size?: StatisticSize;
  /** 网格跨格等布局类（如 lg:col-span-2） */
  className?: string;
  /** 提供则整卡可点击（渲染为 button，带 hover 反馈） */
  onClick?: () => void;
};

const VALUE_CLASS: Record<StatisticSize, string> = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-3xl",
  xl: "text-5xl",
};

export function Statistic({
  label,
  value,
  sub,
  tone,
  hint,
  testId,
  icon,
  size = "md",
  className,
  onClick,
}: StatisticProps) {
  const isHero = size === "xl";
  const Root = onClick ? "button" : "div";
  return (
    <Root
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId ?? "statistic"}
      className={cn(
        "flex flex-col rounded-xl bg-surface-card ring-1 ring-border-thin",
        isHero ? "items-start p-5 text-left" : "items-center justify-center px-4 py-4 text-center",
        onClick && "cursor-pointer transition hover:ring-border-focus",
        className,
      )}
      title={hint}
    >
      <div
        className={cn(
          "font-display font-bold tabular-nums",
          VALUE_CLASS[size],
          tone ?? "text-text-main",
        )}
      >
        {value === null ? "—" : value}
      </div>
      {sub ? <div className="mt-0.5 text-kg-xs tabular-nums text-text-placeholder">{sub}</div> : null}
      <div className={cn("mt-1 flex items-center gap-1 text-kg-xs text-text-hint", isHero && "text-sm")}>
        {icon}
        <span>{label}</span>
      </div>
    </Root>
  );
}
