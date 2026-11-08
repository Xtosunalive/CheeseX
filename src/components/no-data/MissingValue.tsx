// MissingValue（ui-kit · 未知呈现单源）——自 data-dashboard/EntityDetailPanel.tsx:50 的文件内私有件升为共享件。
// 用途：真实数据未携带某值时，缺口原样可见，禁止以 0 或空串冒充（判据＝契约 optional 且后端恒发 0 才允许归一）。
import { SMALL_UI_COPY } from "../components-copy";

export function MissingValue({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-surface-hover/60 px-2 py-0.5 text-xs text-text-hint ring-1 ring-border-thin"
      title={SMALL_UI_COPY.MISSING_VALUE_TITLE}
    >
      {label}{SMALL_UI_COPY.MISSING_VALUE_SUFFIX}
    </span>
  );
}
