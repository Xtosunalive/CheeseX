import { useMemo, useRef, useState } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FILTER_SELECT_COPY, SHARED_UI_COPY, filterSelectSearchFallback } from "../components-copy";

export type FilterSelectOption = {
  value: string;
  label: string;
  group?: string;
  count?: number;
  disabled?: boolean;
};

type Props = {
  ariaLabel: string;
  title: string;
  searchPlaceholder?: string;
  options: FilterSelectOption[];
  value: string | string[];
  onValueChange: (value: string | string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  emptyTriggerLabel?: string;
  disabled?: boolean;
  className?: string;
  variant?: "field" | "filter";
};

function valuesOf(value: string | string[]) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function ChoiceRow({ option, checked, multiple, onChoose }: { option: FilterSelectOption; checked: boolean; multiple: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      role={multiple ? "menuitemcheckbox" : "option"}
      aria-checked={multiple ? checked : undefined}
      aria-selected={!multiple ? checked : undefined}
      disabled={option.disabled}
      onClick={onChoose}
      className={cn(
        "mx-2 my-0.5 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-sub transition-colors hover:bg-surface-hover hover:text-text-main disabled:opacity-40",
        checked && "bg-surface-hover text-text-main",
      )}
    >
      <span className={cn(
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border-thin bg-surface-root",
        checked && "border-accent-base bg-accent-base text-accent-contrast",
      )}>
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {option.count !== undefined && <span className="text-kg-xs tabular-nums text-text-hint">{option.count}</span>}
    </button>
  );
}

export function FilterSelect({ ariaLabel, title, searchPlaceholder, options, value, onValueChange, multiple = false, placeholder = SHARED_UI_COPY.SELECT_PLACEHOLDER, emptyLabel, emptyTriggerLabel, disabled, className, variant = "field" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentValues, setRecentValues] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const selected = valuesOf(value);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((option) => !normalizedQuery || `${option.label} ${option.group || ""}`.toLowerCase().includes(normalizedQuery)), [normalizedQuery, options]);
  const groups = useMemo(() => {
    const result = new Map<string, FilterSelectOption[]>();
    filtered.forEach((option) => {
      const group = option.group || FILTER_SELECT_COPY.OPTION_GROUP_DEFAULT;
      result.set(group, [...(result.get(group) || []), option]);
    });
    return [...result.entries()];
  }, [filtered]);
  const selectedOptions = selected.map((item) => options.find((option) => option.value === item)).filter((option): option is FilterSelectOption => Boolean(option));
  const recentOptions = recentValues.map((item) => options.find((option) => option.value === item)).filter((option): option is FilterSelectOption => option !== undefined && (!normalizedQuery || option.label.toLowerCase().includes(normalizedQuery)));
  const triggerText = selectedOptions.length === 0 ? (emptyTriggerLabel || emptyLabel || placeholder) : multiple && selectedOptions.length > 1 ? `${placeholder} (${selectedOptions.length})` : selectedOptions[0].label;

  useClickOutside(open, () => setOpen(false), [triggerRef, contentRef]);

  function choose(option: FilterSelectOption) {
    if (option.disabled) return;
    setRecentValues((current) => [option.value, ...current.filter((item) => item !== option.value)].slice(0, 3));
    if (!multiple) {
      onValueChange(option.value);
      setOpen(false);
      setQuery("");
      return;
    }
    onValueChange(selected.includes(option.value) ? selected.filter((item) => item !== option.value) : [...selected, option.value]);
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button ref={triggerRef} type="button" aria-label={ariaLabel} aria-expanded={open} disabled={disabled} data-select-variant={variant} className={cn("flex min-w-0 items-center justify-between gap-2 rounded outline-none transition-colors focus-visible:ring-1 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-40", variant === "filter" ? `h-8 rounded-md bg-transparent px-2 text-xs font-medium text-text-sub ring-1 ring-border-thin hover:bg-surface-hover hover:text-text-main ${open ? "bg-surface-hover text-text-main" : ""}` : "h-8 rounded bg-surface-root px-2 text-xs text-text-sub ring-1 ring-border-thin hover:ring-text-placeholder", className)}>
          <span className="truncate">{triggerText}</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent ref={contentRef} align="start" sideOffset={8} collisionPadding={16} className="w-[min(288px,calc(100vw-32px))] overflow-hidden rounded-md border-0 bg-popover p-0 text-popover-foreground shadow-popover ring-1 ring-border-thin">
        <div className="px-3 pb-2.5 pt-3">
          <h3 className="text-sm font-medium text-text-main">{title}</h3>
          <label className="mt-2 flex h-8 items-center gap-2 rounded bg-surface-root px-2 ring-1 ring-border-thin focus-within:ring-border-focus">
            <Search className="h-4 w-4 shrink-0 text-text-hint" />
            <span className="sr-only">{searchPlaceholder || filterSelectSearchFallback(title)}</span>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder || filterSelectSearchFallback(title)} className="min-w-0 flex-1 bg-transparent text-xs text-text-main outline-none placeholder:text-text-placeholder" />
          </label>
        </div>
        <div role={multiple ? "menu" : "listbox"} aria-multiselectable={multiple || undefined} className="max-h-64 overflow-y-auto border-t border-border-thin py-1">
          {multiple && emptyLabel && !normalizedQuery && <><div className="px-3 py-1.5 text-kg-xs font-medium text-text-hint">{SHARED_UI_COPY.OPTION_GROUP_SCOPE}</div><button type="button" role="menuitemcheckbox" aria-checked={selected.length === 0} onClick={() => onValueChange([])} className="mx-2 my-0.5 flex w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-sub transition-colors hover:bg-surface-hover hover:text-text-main"><span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded border border-border-thin bg-surface-root", selected.length === 0 && "border-accent-base bg-accent-base text-accent-contrast")}>{selected.length === 0 && <Check className="h-3 w-3" />}</span><span>{emptyLabel}</span></button></>}
          {recentOptions.length > 0 && <div><div className="px-3 py-1.5 text-kg-xs font-medium text-text-hint">{FILTER_SELECT_COPY.RECENT}</div>{recentOptions.map((option) => <ChoiceRow key={`recent-${option.value}`} option={option} checked={selected.includes(option.value)} multiple={multiple} onChoose={() => choose(option)} />)}</div>}
          {groups.map(([group, groupOptions]) => <div key={group}><div className="px-3 py-1.5 text-kg-xs font-medium text-text-hint">{group}</div>{groupOptions.map((option) => <ChoiceRow key={option.value} option={option} checked={selected.includes(option.value)} multiple={multiple} onChoose={() => choose(option)} />)}</div>)}
          {filtered.length === 0 && <p className="px-3 py-8 text-center text-xs text-text-hint">{FILTER_SELECT_COPY.NO_MATCH}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
