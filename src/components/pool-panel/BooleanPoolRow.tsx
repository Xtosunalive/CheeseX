// BooleanPoolRow — 布尔字段的池行式开关（PR-026 定稿：label 居左、右侧「是/否」文字 + switch 开关）
// 自绘 peer 滑块（不新增 npm 依赖）；颜色全部走 accent/status L1 词表，零字面值。
import { SMALL_UI_COPY } from "../components-copy";

export function BooleanPoolRow({ label, value, disabled = false, onChange }: { label: string; value: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex w-full cursor-pointer items-center justify-between gap-2 py-0.5">
      <span className="min-w-0 truncate text-xs font-medium text-text-main">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        {/* 禁令4 双通道：文字「是/否」+颜色状态点，颜色只是第三重冗余 */}
        <span className={`text-xs ${value ? "text-status-fact" : "text-text-hint"}`} aria-hidden>{value ? SMALL_UI_COPY.BOOLEAN_YES : SMALL_UI_COPY.BOOLEAN_NO}</span>
        <span className="relative inline-flex h-4.5 w-8 items-center">
          <input
            type="checkbox"
            role="switch"
            aria-label={label}
            checked={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className="peer sr-only"
          />
          <span className="h-4.5 w-8 rounded-full bg-surface-hover ring-1 ring-border-thin transition-colors peer-checked:bg-accent-base peer-focus-visible:ring-border-focus peer-disabled:cursor-not-allowed peer-disabled:opacity-50" />
          <span className="absolute left-0.5 h-3.5 w-3.5 rounded-full bg-surface-card ring-1 ring-border-thin transition-transform peer-checked:translate-x-3.5" />
        </span>
      </span>
    </label>
  );
}
