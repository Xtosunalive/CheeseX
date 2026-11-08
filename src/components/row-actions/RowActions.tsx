// ── RowActions（P3 · B2：行操作列统一件，三种手写形态收一）──
// 口径（决策卡 §十一）：右对齐、间距 8（gap-2）、文字钮与图标钮两型、动作配置化。
// danger 动作提供破坏性视觉；二次确认（ui/alert-dialog）由迁移波按 B3 逐表接入——
// 本件只承载形态，不内置弹窗（确认对话是业务语义，属调用方）。
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { SHARED_UI_COPY } from "../components-copy";

export type RowAction<T> = {
  key: string;
  label: string;
  onRun: (row: T) => void;
  /** 图标钮（提供即图标型） */
  icon?: React.FC<{ className?: string }>;
  danger?: boolean;
  disabled?: boolean | ((row: T) => boolean);
};

export type RowActionsProps<T> = {
  row: T;
  actions: Array<RowAction<T>>;
  ariaLabel?: string;
};

export function RowActions<T>({ row, actions, ariaLabel = SHARED_UI_COPY.ROW_ACTIONS }: RowActionsProps<T>) {
  if (actions.length === 0) return null;
  return (
    <div role="group" aria-label={ariaLabel} data-testid="row-actions" className="flex items-center justify-end gap-2">
      {actions.map(({ key, label, onRun, icon: Icon, danger, disabled }) => {
        const isDisabled = typeof disabled === "function" ? disabled(row) : disabled;
        if (Icon) {
          return (
            <Button
              key={key}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={label}
              title={label}
              disabled={isDisabled}
              onClick={() => onRun(row)}
              className={`h-7 w-7 ${danger ? "text-status-error hover:bg-status-error-3" : "text-text-hint"} hover:text-text-main`}
            >
              <Icon className="h-4 w-4" />
            </Button>
          );
        }
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="sm"
            disabled={isDisabled}
            onClick={() => onRun(row)}
            className={`h-7 px-2 text-xs ${danger ? "text-status-error hover:bg-status-error-3" : "text-text-sub"} hover:text-text-main`}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
