import { useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// seq208：date 形状单源引用（shared/date-contract 唯一载体；形状判定与后端/checker 同源，零行为变化）
import { DATE_PATTERN } from "../../../shared/date-contract.mjs";
import { ENTITY_REPAIR_COPY } from "../components-copy";

type DateFieldProps = {
  ariaLabel: string;
  value: unknown;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
};

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

function formatDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0"))
    .join("-");
}

export function DateField({ ariaLabel, value, onChange, disabled = false, required = false }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDate(value), [value]);
  const text = typeof value === "string" && value ? value : ENTITY_REPAIR_COPY.DATE_PLACEHOLDER;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} aria-required={required || undefined} aria-expanded={open} disabled={disabled} className="mt-1 flex h-8 w-full items-center justify-between rounded-md bg-surface-hover px-2.5 text-left text-sm text-text-main ring-1 ring-border-thin hover:ring-text-placeholder focus-visible:outline-none focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50">
          <span className={selected ? "text-text-main" : "text-text-placeholder"}>{text}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-text-hint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-auto p-0">
        <Calendar mode="single" selected={selected} onSelect={(date) => { if (date) { onChange(formatDate(date)); setOpen(false); } }} initialFocus />
        <div className="border-t border-border-thin p-2">
          <button type="button" onClick={() => { onChange(""); setOpen(false); }} disabled={!selected} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-hint hover:bg-surface-hover disabled:opacity-40">
            <X className="h-3 w-3" />{ENTITY_REPAIR_COPY.CLEAR_DATE}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
