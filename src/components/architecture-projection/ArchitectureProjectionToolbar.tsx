import { Focus, Layers, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { ProjectionFilter } from "./architecture-projection-types";
import { TERM } from "@/constants/term-const";
import { ARCH_PROJECTION_COPY } from "../components-copy";

interface Props {
  filter: ProjectionFilter; onFilterChange: (f: ProjectionFilter) => void;
  counts: { implicit: number; unresolved: number; missing: number };
  onZoomIn: () => void; onZoomOut: () => void; onFitView: () => void;
  onToggleFullscreen: () => void; isFullscreen: boolean; fullscreenAvailable: boolean;
  onClearHighlight: () => void; hasHighlight: boolean;
  /** seq212 缺口叠加开关（有缺口数据时由 Flow 提供；默认关——诊断层不喧宾夺主） */
  overlayEnabled?: boolean; onToggleOverlay?: () => void;
}

export default function ArchProjToolbar({ filter, onFilterChange, counts, onZoomIn, onZoomOut, onFitView, onToggleFullscreen, isFullscreen, fullscreenAvailable, onClearHighlight, hasHighlight, overlayEnabled, onToggleOverlay }: Props) {
  const btn = (f: ProjectionFilter, label: string, count: number) => (
    <button type="button" onClick={() => onFilterChange(f)} className={`h-8 rounded px-2.5 text-xs font-medium transition-colors ${filter === f ? "bg-accent-bg text-accent-base ring-1 ring-accent-base/30" : "text-text-hint hover:bg-surface-hover hover:text-text-main"}`}>{label}{count > 0 && <span className="ml-1 tabular-nums opacity-70">{count}</span>}</button>
  );
  return (
    <div data-testid="architecture-projection-toolbar" className="flex flex-wrap items-center gap-1 border-b border-border-thin bg-surface-root px-2 py-2">
      {onToggleOverlay && (
        <button type="button" onClick={onToggleOverlay} aria-pressed={overlayEnabled} title={ARCH_PROJECTION_COPY.OVERLAY_TITLE} className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors ${overlayEnabled ? "bg-status-warn-2 text-status-warn ring-1 ring-status-warn-6" : "text-text-hint hover:bg-surface-hover hover:text-text-main"}`}>
          <Layers className="h-4 w-4" />{ARCH_PROJECTION_COPY.GAP_OVERLAY}
        </button>
      )}
      {(overlayEnabled || !onToggleOverlay) && <div className="flex gap-1">{btn("all", ARCH_PROJECTION_COPY.FILTER_ALL, 0)}{btn("implicit", TERM.GAP_INDIRECT, counts.implicit)}{btn("unresolved", TERM.GAP_UNRELATED, counts.unresolved)}{btn("missing", TERM.GAP_MISSING_COMPONENT, counts.missing)}</div>}
      <div className="mx-1 h-5 w-px bg-border-thin" />
      <button type="button" onClick={onZoomOut} className="flex h-8 w-8 items-center justify-center rounded text-text-hint hover:bg-surface-hover hover:text-text-main" title={ARCH_PROJECTION_COPY.ZOOM_OUT} aria-label={ARCH_PROJECTION_COPY.ZOOM_OUT}><ZoomOut className="h-4 w-4" /></button>
      <button type="button" onClick={onZoomIn} className="flex h-8 w-8 items-center justify-center rounded text-text-hint hover:bg-surface-hover hover:text-text-main" title={ARCH_PROJECTION_COPY.ZOOM_IN} aria-label={ARCH_PROJECTION_COPY.ZOOM_IN}><ZoomIn className="h-4 w-4" /></button>
      <button type="button" onClick={onFitView} className="flex h-8 w-8 items-center justify-center rounded text-text-hint hover:bg-surface-hover hover:text-text-main" title={ARCH_PROJECTION_COPY.FIT_CANVAS} aria-label={ARCH_PROJECTION_COPY.FIT_CANVAS}><Focus className="h-4 w-4" /></button>
      <button type="button" onClick={onToggleFullscreen} disabled={!fullscreenAvailable} className="flex h-8 w-8 items-center justify-center rounded text-text-hint hover:bg-surface-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40" title={isFullscreen ? ARCH_PROJECTION_COPY.EXIT_FULLSCREEN : ARCH_PROJECTION_COPY.FULLSCREEN} aria-label={isFullscreen ? ARCH_PROJECTION_COPY.EXIT_FULLSCREEN : ARCH_PROJECTION_COPY.FULLSCREEN}>{isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
      <span data-testid="architecture-projection-readonly-hint" className="ml-2 inline-flex h-8 items-center rounded-full border border-border-thin px-2.5 text-xs text-text-hint" title={ARCH_PROJECTION_COPY.READONLY_TITLE}>{ARCH_PROJECTION_COPY.READONLY_HINT}</span>
      {hasHighlight && <button type="button" onClick={onClearHighlight} className="ml-auto flex h-8 items-center gap-1.5 rounded bg-status-warn-2 px-2.5 text-xs text-status-warn hover:bg-amber-4"><RotateCcw className="h-4 w-4" />{ARCH_PROJECTION_COPY.CLEAR_HIGHLIGHT}</button>}
    </div>
  );
}
