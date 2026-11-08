// 权威声明（#1755）：本文件为唯一活层（消费者 1:0，#1755 实测）；原 ui/separator.tsx 已于 #1756 归档（归档/components-ui-stock-2026-09-09/，ADR053），改样式只改本文件。
// aria/separator — 官方 aria 版 separator（复用 radix 原语，data-slot 对齐）
import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";

import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    data-slot="separator"
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
      className
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
