// aria/tooltip — 官方 aria 版 tooltip 适配层
// 权威声明（#1748）：本文件是 tooltip 组件的唯一活层。原 ui/tooltip.tsx（零消费
// 官方库存）已于 #1756 归档至 归档/components-ui-stock-2026-09-09/（ADR053）。改 tooltip 只改本文件。
// 标准 Radix 模式（sidebar 用）：
//   <Tooltip><TooltipTrigger asChild>{el}</TooltipTrigger><TooltipContent side="right">text</TooltipContent></Tooltip>
// 注：简化 content prop 模式（SimpleTooltip）已随 #1747 侧边栏 Tooltip 下线一并删除
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

// 标准 Radix 导出（sidebar 等官方组件使用）
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipProvider = TooltipPrimitive.Provider;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-modal overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-popover",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
