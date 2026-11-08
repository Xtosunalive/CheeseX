import * as React from "react";

import { cn } from "@/lib/utils";

/** ui-kit 域输入基础件（2026-10-21 建件——check:ui-kit 的 <input> 棘轮自此有了合法落点）
 *  尺寸与 ui/button 同族（默认 h-9＝表单标准；紧凑场景经 className 覆写，twMerge 保证后者胜出）。
 *  语义化尺寸变体不另立 prop——沿用 tailwind-merge 覆写先例，避免再造一份尺寸清单。 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
