// ── Symmetric sidebar primitives ──
// Shared physical base for the left (分类树) and right (架构分层) sidebars.
// Both sidebars consume these so they render with pixel-mirrored headers,
// identical card-like tree nodes, and a unified indentation/hover grammar.
//
// Design contract (see "全对称融合优化"):
//  - Fixed-width container (292px), dark micro-light bg, 12px radius (rounded-md, WP-145 波3 归档), ultra-thin border.
//  - No hard left/right dividing lines — breathing room comes from bg depth + padding.
//  - Header: leading status dot (accent-colored) + mono title + right-aligned count badge.
//  - Parent rows: lightweight horizontal bar cards with collapse chevron, identical hover.
//  - Leaf rows: same indentation (pl-[30px]) on both sides.
//  - Pills + PulseDot: right-aligned, minimalist, transparent — replaces heavy saturated blocks.

import type { ReactNode } from "react";
import { TERM } from "@/constants/term-const";
import { APP_SHELL_COPY, SHARED_UI_COPY } from "../components-copy";

/** Shared accent palette — left sidebar uses `blue` (主题蓝), right uses `green` (主题绿). */
export type SidebarAccent = "blue" | "green";

const ACCENT: Record<SidebarAccent, { dot: string; text: string; badgeBg: string; focusBg: string; focusRing: string }> = {
  blue: {
    dot: "bg-status-loading",
    text: "text-status-loading",
    badgeBg: "bg-cyan-2 text-status-loading",
    focusBg: "bg-cyan-2",
    focusRing: "ring-1 ring-cyan-9",
  },
  green: {
    dot: "bg-status-fact",
    text: "text-status-fact",
    badgeBg: "bg-status-fact-2 text-status-fact",
    focusBg: "bg-status-fact-2",
    focusRing: "ring-1 ring-jade-9",
  },
};

// ── Physical container (identical base for both sidebars; width follows the parent grid) ──
export function SidebarShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-md bg-surface-root ring-1 ring-border-thin">
      {children}
    </div>
  );
}

// ── Mirrored header ──
// Both sidebars render the SAME structure: accent dot · mono title · (right) count badge · clear.
export function SidebarHeader({
  title,
  count,
  accent,
  onClear,
}: {
  title: string;
  /** null＝未知（未加载/后端未携带）——徽章不渲染，不得喂 0 冒充（WP-134 波0 类型闸口） */
  count: number | null;
  accent: SidebarAccent;
  onClear?: () => void;
}) {
  const a = ACCENT[accent];
  return (
    <div className="px-3 py-2 flex items-center gap-2 border-b border-border-thin">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${a.dot}`} />
      <span className="text-xs font-mono tracking-wider text-text-sub">{title}</span>
      {count === null ? (
        <span className="ml-auto" />
      ) : (
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-xs font-mono tabular-nums ${a.badgeBg}`}>
          {count}
        </span>
      )}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className={`text-xs font-mono ${a.text} hover:underline shrink-0`}
        >
          {SHARED_UI_COPY.CLEAR}
        </button>
      )}
    </div>
  );
}

// ── Card-like parent tree node (domain / band) ──
// Horizontal bar card. Two distinct click targets:
//   - chevron (▾) → onToggle (collapse/expand)
//   - row body   → onFocus (focus this axis; toggles off if already focused)
// This keeps collapse and focus independent, mirroring the original band behavior.
export function ParentNodeCard({
  open,
  onToggle,
  onFocus,
  label,
  badge,
  onPath,
  dimmed,
  focused,
  accent,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** Click on the row body (not the chevron). When omitted, body click falls back to onToggle. */
  onFocus?: () => void;
  label: ReactNode;
  badge?: ReactNode;
  onPath?: boolean;
  dimmed?: boolean;
  focused?: boolean;
  accent: SidebarAccent;
  children?: ReactNode;
}) {
  const a = ACCENT[accent];
  const handleBodyClick = onFocus ?? onToggle;
  return (
    <div className="px-1.5">
      <div
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors ${
          focused ? a.focusBg : onPath ? "bg-surface-hover" : "hover:bg-surface-hover"
        } ${dimmed ? "opacity-40" : ""}`}
      >
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 text-xs text-text-hint transition-transform hover:text-text-main"
          aria-label={open ? APP_SHELL_COPY.COLLAPSE : TERM.EXPAND_ACTION}
        >
          <span className={`inline-block transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
        </button>
        <button
          type="button"
          onClick={handleBodyClick}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <span className="text-xs font-mono truncate flex-1 text-text-main">{label}</span>
          {badge}
        </button>
      </div>
      {open && children}
    </div>
  );
}

// ── Leaf tree node (subdomain metric / band entity) ──
// Indentation is identical on both sides (pl-[30px]).
export function LeafNodeRow({
  active,
  dimmed,
  onPath,
  accent,
  onClick,
  onMouseEnter,
  onMouseLeave,
  dotColor,
  label,
  trailing,
  warn,
}: {
  active?: boolean;
  dimmed?: boolean;
  onPath?: boolean;
  accent: SidebarAccent;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Override the leading dot color (e.g. band color). Defaults to accent. */
  dotColor?: string;
  label: ReactNode;
  /** Right-aligned pills/badges. */
  trailing?: ReactNode;
  /** Show a pulsing warning dot (governance alert). */
  warn?: boolean;
}) {
  const a = ACCENT[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`w-full flex items-center gap-1.5 pl-[30px] pr-3 py-1 text-left transition-colors ${
        active ? `${a.focusBg} ${a.focusRing}` : onPath ? "bg-surface-hover" : "hover:bg-surface-hover"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      {/* Single leading indicator: a pulsing warning dot when warn, else the
          band/category color dot. Never both — one light, one meaning. */}
      {warn ? (
        <PulseDot />
      ) : dotColor ? (
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />
      ) : null}
      <span className="text-xs font-mono truncate flex-1 text-text-sub">{label}</span>
      {trailing}
    </button>
  );
}

// ── Right-aligned minimalist transparent pill ──
export function Pill({
  children,
  tone = "muted",
  title,
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "warn";
  title?: string;
}) {
  const toneCls =
    tone === "accent"
      ? "bg-cyan-2 text-status-loading"
      : tone === "warn"
        ? "bg-status-warn-2 text-status-warn"
        : "bg-surface-hover text-text-sub";
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-mono tabular-nums leading-none ${toneCls}`}
    >
      {children}
    </span>
  );
}

// ── Pulsing warning dot (governance alert) ──
// Breathes gently instead of a flat yellow icon — keeps the row's clean alignment.
// animate-ping 为功能性保留（WP-145 R7 复核）：治理数据质量警告的实时告警指示，非纯装饰。
// 2026-10-06 vocab 批：默认色改 status-warn（原 var(--color-kg-warn) 为退役词，vocab 门禁执法对象）。
export function PulseDot({ color = "var(--color-status-warn)" }: { color?: string }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0" title={`${TERM.DATA_QUALITY}${TERM.WARNING}`}>
      <span
        className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

// ── Empty-layer leaf (right sidebar: 暂无实体) ──
export function EmptyLeaf({ label = `— ${TERM.EMPTY_ENTITY} —` }: { label?: string }) {
  return (
    <div className="pl-[30px] pr-3 py-1 text-xs font-mono text-text-placeholder">{label}</div>
  );
}
