// ── ui/alert（P1 · F1/F3：错误态/行内警告统一件）──
// 尺寸口径＝antd 实测（components/alert/style/index.ts prepareComponentToken）：
//   默认 padding 8/12（paddingContentVerticalSM×12）；带描述 20/24（paddingMD×paddingContentHorizontalLG）；
//   圆角 8（--radius-sm，W2 Shakuro 对齐后）。颜色全部走项目语义 token（status-*），零字面值——门禁执法对象。
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";

const alertVariants = cva("flex w-full gap-3 rounded-sm text-left", {
  variants: {
    variant: {
      info: "bg-status-inferred/10 text-status-inferred ring-status-inferred/20",
      success: "bg-status-fact-2 text-status-fact ring-status-fact-6",
      warn: "bg-status-warn-2 text-status-warn ring-status-warn-6",
      error: "bg-status-error-2 text-status-error ring-status-error-6",
    },
    hasDescription: {
      false: "items-start px-3 py-2",
      true: "items-start px-6 py-5",
    },
  },
  defaultVariants: { variant: "info", hasDescription: false },
});

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
} as const;

export type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants> & {
  /** 副文案：出现即切换到带描述版 padding（20/24，antd 口径） */
  description?: React.ReactNode;
  /** 图标列（默认按变体取）；false 关闭 */
  icon?: React.ReactNode | false;
};

export function Alert({ variant = "info", description, icon, className, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      data-testid="ui-alert"
      className={`${alertVariants({ variant, hasDescription: Boolean(description) })} ring-1 ${className ?? ""}`}
      {...props}
    >
      {icon !== false && (
        <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium leading-5">{children}</div>
        {description ? <div className="text-xs leading-5 opacity-80">{description}</div> : null}
      </div>
    </div>
  );
}
