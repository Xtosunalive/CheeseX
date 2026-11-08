import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface MentalPageTipProps {
  children: React.ReactNode;
  className?: string;
}

export function MentalPageTip({ children, className }: MentalPageTipProps) {
  return (
    <p
      className={cn("flex items-start gap-1.5 text-xs leading-5 text-text-hint", className)}
      data-testid="mental-page-tip"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
