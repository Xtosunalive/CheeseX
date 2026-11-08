// ── DataTable 类型（P1 · 决策卡 §九）──
import type * as React from "react";

export type ColumnAlign = "left" | "center" | "right";

export type Column<T> = {
  key: string;
  title: React.ReactNode;
  /** 取行数据的字段（render 缺省时的默认取值） */
  dataIndex?: keyof T & string;
  width?: number | string;
  align?: ColumnAlign;
  /** P2 useTableSort 接入位：当前由调用方在 title 里直接放 TableSortHeader */
  sortable?: boolean;
  sortField?: string;
  fixed?: "left" | "right";
  ellipsis?: boolean;
  className?: string;
  /** W2 起（T04 先例）：行分组——同组连续行的该列单元格以 rowSpan 纵向合并，后续行跳过该 td。
   *  分组边界按「当页可见行」的连续同值段计算（跨页拆段各起一格，与迁移前口径一致）。 */
  groupOf?: (row: T) => string;
  /** render 第三参＝本组合并宽度（组内行数），供「N 项」类组级文案使用（配 groupOf） */
  render?: (row: T, index: number, span?: number) => React.ReactNode;
};

export type Density = "lg" | "md" | "sm";

export type TableEmptyProps = {
  /** W1 起 ReactNode：空态归因等富文案可直接进基座（T01 三分支先例） */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 空态归因（T01 先例：区分「无数据」与「被筛选清空」）由调用方决定文案 */
  icon?: React.FC<{ className?: string }>;
};

export type Expandable<T> = {
  rowExpanded: (row: T) => boolean;
  onToggle: (row: T) => void;
  render: (row: T) => React.ReactNode;
  /** false＝不渲染内置展开钮列（调用方在自定义列里放自己的按钮——保富 aria 先例，T10） */
  toggleColumn?: boolean;
};

export type RowSelection<T> = {
  selectedKeys: Set<string>;
  onToggle: (row: T) => void;
  onToggleAll?: () => void;
  /** 选择列为表头可访问名（默认「全选」）；不传 onToggleAll 时不渲染全选钮（T03 先例：仅手选） */
  headerLabel?: string;
  /** 行复选框可访问名（默认「选择第 N 行」）——业务可携带对象名（T03：选择文章：X.md） */
  rowLabel?: (row: T, index: number) => string;
};

/** W2 起（T05 先例，O4）：卡片降级——窄屏行渲染为卡片、表头隐藏，md+ 恢复表格。
 *  rowClassName＝窄屏卡片行几何（grid 列轨等，基座自动附 md:table-row 复位）；
 *  各列在窄屏的显隐/换位由调用方列 className 与 render 内 md: 前缀类承载。 */
export type CardPreset = {
  rowClassName: string;
};
