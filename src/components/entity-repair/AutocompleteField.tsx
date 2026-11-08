import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { repairSuggestionsAria } from "../components-copy";

type AutocompleteFieldProps = {
  field: string;
  label: string;
  value: unknown;
  suggestions: string[];
  placeholder?: string;
  pattern?: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function AutocompleteField({ field, label, value, suggestions, placeholder, pattern, required, disabled = false, onChange }: AutocompleteFieldProps) {
  const [open, setOpen] = useState(false);
  const text = typeof value === "string" ? value : String(value ?? "");
  const filtered = useMemo(() => {
    const query = text.trim().toLowerCase();
    return suggestions.filter((item) => !query || item.toLowerCase().includes(query)).slice(0, 20);
  }, [suggestions, text]);

  return (
    <Popover open={open && filtered.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <input type="text" aria-label={label} aria-required={required || undefined} aria-controls={open && filtered.length > 0 ? `autocomplete-${field}` : undefined} pattern={pattern} placeholder={placeholder} disabled={disabled} value={text} onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }} className="mt-1 h-8 w-full rounded-md bg-surface-hover px-2.5 text-sm text-text-main ring-1 ring-border-thin focus:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50" />
      </PopoverTrigger>
      <PopoverContent id={`autocomplete-${field}`} align="start" sideOffset={6} className="w-[min(288px,calc(100vw-32px))] p-1">
        <div role="listbox" aria-label={repairSuggestionsAria(label)} className="max-h-56 overflow-y-auto">
          {filtered.map((option) => (
            <button key={option} type="button" role="option" aria-selected={option === text} onClick={() => { onChange(option); setOpen(false); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-text-sub hover:bg-surface-hover hover:text-text-main">
              <Check className={`h-4 w-4 ${option === text ? "opacity-100" : "opacity-0"}`} />
              <span className="truncate">{option}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
