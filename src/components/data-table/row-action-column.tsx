// rowActionColumn — 行操作列工厂（批8 结构性收敛：DataTable+RowActions 的固定接法
// 收编为一处——新表格不再各写一遍删行列定义。零业务语义，table-base 辖区内自然生长）。
import { RowActions } from "@/components/row-actions/RowActions";
import type { Column } from "./types";
import { SHARED_UI_COPY } from "../components-copy";

export type RowActionColumnOptions<T> = {
  /** 动作标签（静态或按行；aria-label 恒用「行操作」基座口径） */
  label: string | ((row: T) => string);
  onRun: (row: T, index: number) => void;
  width?: number;
  disabled?: boolean;
  /** 破坏性动作视觉（RowActions danger 透传） */
  danger?: boolean;
};

export function rowActionColumn<T>({ label, onRun, width = 56, disabled, danger }: RowActionColumnOptions<T>): Column<T> {
  return {
    key: "row-actions",
    title: "",
    width,
    render: (row, index) => (
      <RowActions
        row={index}
        ariaLabel={SHARED_UI_COPY.ROW_ACTIONS}
        actions={[
          {
            key: "run",
            label: typeof label === "function" ? label(row) : label,
            onRun: () => onRun(row, index),
            danger,
            disabled,
          },
        ]}
      />
    ),
  };
}
