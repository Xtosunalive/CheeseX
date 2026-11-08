// property-gov 共享 UI 原子（唯一定义，收敛 CheckResultsPanel/ManifestListPanel 重复）
import { RotateCcw } from "lucide-react";
import { TERM } from "@/constants/term-const";

export function ClearFilterButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" title={TERM.CLEAR_FILTER_ACTION} aria-label={label} disabled={disabled} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main disabled:opacity-30">
      <RotateCcw className="h-4 w-4" />
    </button>
  );
}

export function ErrorBlock({ error }: { error: string }) {
  return (
    <div className="rounded ring-1 ring-status-error-6 bg-status-error-2 px-3 py-2 font-mono text-xs text-status-error">
      {error}
    </div>
  );
}
