import { useRef, useState } from "react";
import { X } from "lucide-react";
import { repairRemoveTokenAria } from "../components-copy";

type TokenInputProps = {
  ariaLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  disabled?: boolean;
};

/**
 * 可输入的 token/chip 控件。
 * 支持回车生成一项、删除已输入项、自动补全建议。
 */
export function TokenInput({ ariaLabel, values, onChange, placeholder, suggestions = [], disabled = false }: TokenInputProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `token-suggestions-${ariaLabel.replace(/\s+/g, "-")}`;

  const addToken = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft("");
  };

  const removeToken = (token: string) => onChange(values.filter((v) => v !== token));

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addToken(draft);
    }
    if (event.key === "Backspace" && !draft && values.length > 0) {
      removeToken(values[values.length - 1]);
    }
  };

  return (
    <div className="mt-1">
      <div
        className="flex min-h-[36px] flex-wrap items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1.5 ring-1 ring-border-thin focus-within:ring-border-focus"
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((token) => (
          <span key={token} className="inline-flex items-center gap-1 rounded bg-accent-bg px-2 py-0.5 text-xs text-text-main ring-1 ring-border-thin">
            {token}
            <button type="button" aria-label={repairRemoveTokenAria(token)} disabled={disabled} onClick={(e) => { e.stopPropagation(); removeToken(token); }} className="rounded p-0.5 text-text-hint hover:text-text-main disabled:opacity-40">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (draft.trim()) addToken(draft); }}
          disabled={disabled}
          placeholder={values.length === 0 ? placeholder : ""}
          list={suggestions.length > 0 ? listId : undefined}
          className="min-w-[80px] flex-1 bg-transparent text-xs text-text-main outline-none placeholder:text-text-placeholder"
        />
      </div>
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.filter((s) => !values.includes(s)).map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}
