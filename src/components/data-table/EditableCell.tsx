// ── EditableCell（W4 · I5：可编辑单元格统一件，卡 §十二「DataTable.EditableCell」落点）──
// 收编 T13~T16 四编辑器各自手写的行内 input/select 样式（I5 缺口：行内控件无规范）。
// 形态：h-8（对齐工具栏控件高度）＋surface-root 底＋ring 边；invalid＝错误环（诊断字段）。
// 富控件（FilterSelect 搜索选择、datalist 建议输入、诊断接线）仍由调用方在单元格内自管
// ——本件只收编「样式无规范」这一层，不吞业务语义（与 RowActions 不内置弹窗同理）。
import type * as React from "react";
import { cn } from "@/lib/utils";

const BASE = "h-8 w-full min-w-0 rounded-md bg-surface-root px-2 text-sm text-text-main ring-1 ring-border-thin outline-none placeholder:text-text-placeholder focus-visible:ring-border-focus disabled:opacity-60";

function classes(invalid: boolean | undefined, className: string | undefined) {
  // cn（twMerge）：调用方 className 可确定性地覆盖基础形态（如 warn 环覆盖默认环，T15 先例）
  return cn(BASE, invalid && "ring-status-error", className);
}

export type EditableCellTextProps = React.ComponentProps<"input"> & {
  /** 诊断字段错误态：错误环（配合 aria-invalid 使用，T14 先例） */
  invalid?: boolean;
};

export function EditableCellText({ invalid, className, ...props }: EditableCellTextProps) {
  return <input data-testid="editable-cell-text" className={classes(invalid, className)} {...props} />;
}

export type EditableCellSelectProps = React.ComponentProps<"select"> & {
  invalid?: boolean;
};

export function EditableCellSelect({ invalid, className, ...props }: EditableCellSelectProps) {
  return <select data-testid="editable-cell-select" className={classes(invalid, className)} {...props} />;
}

