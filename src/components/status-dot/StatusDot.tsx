// ── StatusDot（P3 · D7：状态圆点单一实现，替代 T06/T07/T11 三套手画）──
// 契约禁令 4：圆点只是冗余信号——必须与文字/图形并用，不单独承载语义。

export type StatusDotTone = "fact" | "inferred" | "warn" | "error" | "loading";

const TONE_CLASS: Record<StatusDotTone, string> = {
  fact: "bg-status-fact",
  inferred: "bg-status-inferred",
  warn: "bg-status-warn",
  error: "bg-status-error",
  // animate-pulse 为功能性保留（WP-145 R7 复核）：loading 态呼吸指示，配合 label 文字（禁令 4 冗余信号）
  loading: "bg-status-loading animate-pulse",
};

export function StatusDot({ tone, label, className }: { tone: StatusDotTone; label: string; className?: string }) {
  return (
    <span
      data-testid="status-dot"
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_CLASS[tone]} ${className ?? ""}`}
    />
  );
}
