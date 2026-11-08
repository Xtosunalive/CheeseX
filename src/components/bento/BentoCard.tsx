// ── BentoCard：Bento 主次网格单元（WP-036 Shakuro 布局件）──
// 表面复用 Panel（同表面/描边/标题槽），不另写一套卡片样式；
// 跨列/跨行经 colSpan/rowSpan 声明（相对 BentoGrid 默认 md 2 列 / lg 3 列）。
import { cn } from "@/lib/utils";
import { Panel, type PanelProps } from "@/components/panel";

type BentoCardProps = PanelProps & {
  /** 跨列：2＝宽单元（md 起跨满两列），3＝整行（lg 三列全宽） */
  colSpan?: 1 | 2 | 3;
  /** 跨行（默认 1 不跨） */
  rowSpan?: 1 | 2 | 3;
};

const COL_SPAN_CLASS: Record<number, string> = {
  1: "",
  2: "md:col-span-2",
  3: "md:col-span-2 lg:col-span-3",
};

const ROW_SPAN_CLASS: Record<number, string> = {
  1: "",
  2: "row-span-2",
  3: "row-span-3",
};

export function BentoCard({ colSpan = 1, rowSpan = 1, className, ...panel }: BentoCardProps) {
  return (
    <Panel
      {...panel}
      className={cn(COL_SPAN_CLASS[colSpan], ROW_SPAN_CLASS[rowSpan], className)}
    />
  );
}
