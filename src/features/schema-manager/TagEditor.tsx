// TagEditor — reusable chip list editor for categories and products
import { useState } from "react";
import { TAG_EDITOR_COPY } from "./schema-manager-copy";
import { X, Plus } from "lucide-react";
import { TERM } from "@/constants/term-const";

interface TagEditorProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function TagEditor({ tags, onTagsChange, placeholder, disabled }: TagEditorProps) {
  const [newValue, setNewValue] = useState("");

  const addTag = () => {
    const trimmed = newValue.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onTagsChange([...tags, trimmed]);
    setNewValue("");
  };

  const removeTag = (index: number) => {
    onTagsChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        {tags.map((tag, i) => (
          <div
            key={`${tag}-${i}`}
            className="group flex items-center justify-between rounded-lg ring-1 ring-border-thin px-3 py-2 text-sm text-text-main hover:bg-surface-hover transition-colors"
          >
            <span className="truncate">{tag}</span>
            <button
              onClick={() => removeTag(i)}
              disabled={disabled}
              className="text-text-hint hover:text-red-11 disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {tags.length === 0 && (
          <p className="text-sm text-text-placeholder py-2">{TERM.EMPTY_TAG}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
          placeholder={placeholder ?? TAG_EDITOR_COPY.NAME_PLACEHOLDER_FALLBACK}
          disabled={disabled}
          className="rounded-lg ring-1 ring-border-thin bg-surface-card px-3 py-2 text-sm text-text-main placeholder:text-text-placeholder focus:ring-1 focus:ring-accent-base focus:outline-none w-48"
        />
        <button
          onClick={addTag}
          disabled={disabled || !newValue.trim()}
          className="flex items-center gap-1.5 rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-main/80 hover:bg-surface-root disabled:opacity-40 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {TAG_EDITOR_COPY.ADD_ACTION}
        </button>
      </div>
    </div>
  );
}
