import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SheetTitle } from "@/components/ui/sheet";
import { sidePanelOpenTitle } from "../components-copy";

// PR-026：SIDE_PANEL_WIDTH_CLASS / SIDE_PANEL_SHEET_CLASS（480px 通顶白条形态）随四个面板任务池化退役——
// 唯二消费者（EntityHubDrawer/ArticleDrawer 经 Sheet、RepairDrawerShell 经宽度常量）已全部迁至 pool-panel。
// Header/Action/Section 为内容区构件，保留。

type SidePanelHeaderProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  dialogTitle?: boolean;
};

export function SidePanelHeader({ title, description, actions, className, dialogTitle = false }: SidePanelHeaderProps) {
  return (
    <header className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {dialogTitle
          ? <SheetTitle className="truncate text-lg text-text-main">{title}</SheetTitle>
          : <h2 className="font-display truncate text-lg font-semibold text-text-main">{title}</h2>}
        {description && <p className="mt-0.5 truncate text-xs text-text-hint" title={description}>{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

type SidePanelActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function SidePanelAction({ variant = "secondary", className, type = "button", ...props }: SidePanelActionProps) {
  return <button type={type} className={cn(
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    variant === "primary"
      ? "bg-accent-bg text-accent-base ring-1 ring-accent-base/30 hover:bg-surface-hover"
      : "bg-surface-root text-text-sub ring-1 ring-border-thin hover:bg-surface-hover hover:text-text-main",
    className,
  )} {...props} />;
}

type SidePanelSectionProps = {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export function SidePanelSection({ title, icon: Icon, href, children, className, ariaLabel }: SidePanelSectionProps) {
  const heading = (
    <div className="mb-3 flex items-center gap-2">
      {Icon && <Icon className="h-4 w-4 shrink-0 text-text-sub" />}
      <h3 className="text-sm font-medium text-text-main">{title}</h3>
    </div>
  );

  return (
    <section aria-label={ariaLabel} className={cn("rounded-lg bg-surface-root p-4 ring-1 ring-border-thin", className)}>
      {href ? <a href={href} className="block transition-opacity hover:opacity-90" title={sidePanelOpenTitle(title)}>{heading}</a> : heading}
      {children}
    </section>
  );
}
