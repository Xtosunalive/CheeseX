import type { ComponentType, KeyboardEvent, ReactNode } from "react";

type TabIcon = ComponentType<{ className?: string }>;

export interface InternalTabItem<T extends string> {
  id: T;
  label: string;
  icon?: TabIcon;
  badge?: ReactNode;
}

interface InternalTabsProps<T extends string> {
  ariaLabel: string;
  items: readonly InternalTabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
}

const GRID_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function InternalTabs<T extends string>({ ariaLabel, items, value, onValueChange }: InternalTabsProps<T>) {
  const columns = GRID_COLUMNS[Math.min(items.length, 4)] ?? "grid-cols-2";

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex == null) return;

    event.preventDefault();
    const nextItem = items[nextIndex];
    onValueChange(nextItem.id);
    const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabButtons?.[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`grid w-full ${columns} gap-1 rounded-lg bg-surface-root p-0.5 ring-1 ring-border-thin sm:inline-flex sm:w-fit sm:self-start`}
    >
      {items.map((item, index) => {
        const active = value === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus sm:px-3.5 sm:text-sm ${
              active
                ? "bg-accent-base text-accent-contrast"
                : "text-text-hint hover:text-text-sub"
            }`}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            <span className="truncate">{item.label}</span>
            {item.badge != null && <span className="shrink-0 text-xs tabular-nums text-text-hint">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
