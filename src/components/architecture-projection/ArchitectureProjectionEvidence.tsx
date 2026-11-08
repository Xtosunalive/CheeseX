import { X } from "lucide-react";
import type { ProjectionEvidence } from "./architecture-projection-types";
import { TERM } from "@/constants/term-const";
import { ARCH_PROJECTION_COPY, SHARED_UI_COPY, archProjCandidatePaths, archProjStaleAge } from "../components-copy";

interface Props { evidence: ProjectionEvidence; onClose: () => void; onHighlight: (ids: string[]) => void; onClearHighlight: () => void; }

export default function ArchProjEvidence({ evidence, onClose, onHighlight, onClearHighlight }: Props) {
  const ids = evidence.pathNodeIds || [];
  return (
    <div className="absolute bottom-0 right-0 top-0 z-sticky flex w-80 flex-col overflow-hidden bg-surface-card shadow-popover ring-1 ring-border-thin">
      <div className="flex items-center justify-between border-b border-border-thin bg-surface-root p-3">
        <h3 className="truncate text-sm font-semibold text-text-main">{evidence.label}</h3>
        <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-text-hint hover:bg-surface-hover hover:text-text-main" aria-label={ARCH_PROJECTION_COPY.CLOSE_EVIDENCE_PANEL}><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-3 text-sm text-text-sub">
        {evidence.type === "implicit_path" && (
          <>
            <div><span className="font-medium text-text-hint">{ARCH_PROJECTION_COPY.START_PREFIX}</span> {evidence.sourceNodeId}</div>
            <div><span className="font-medium text-text-hint">{ARCH_PROJECTION_COPY.END_PREFIX}</span> {evidence.targetNodeId}</div>
            {ids.length > 0 && <div><span className="font-medium text-text-hint">{ARCH_PROJECTION_COPY.PATH_CHAIN_PREFIX}</span> {ids.join(" → ")}</div>}
            {evidence.isImplicit && <div className="text-xs text-status-warn">{ARCH_PROJECTION_COPY.TYPE_PREFIX}{TERM.GAP_INDIRECT}</div>}
            {evidence.isAmbiguous && <div className="text-xs text-status-warn">{archProjCandidatePaths(evidence.alternateCount)}</div>}
          </>
        )}
        {evidence.type === "unresolved_pair" && (
          <>
            <div><span className="font-medium text-text-hint">Node A:</span> {evidence.pairNodes?.nodeA}</div>
            <div><span className="font-medium text-text-hint">Node B:</span> {evidence.pairNodes?.nodeB}</div>
            <div className="text-xs text-status-error">{ARCH_PROJECTION_COPY.UNRESOLVED_PAIR_NOTE}</div>
          </>
        )}
        {evidence.type === "missing_seed" && <div><span className="font-medium text-text-hint">{TERM.GAP_MISSING_COMPONENT}:</span> {evidence.sourceNodeId}</div>}
        {evidence.type === "success" && (
          <>
            <div className="text-status-fact">{ARCH_PROJECTION_COPY.ALL_REACHABLE}</div>
            {evidence.dataFreshness && <div className="text-xs text-text-hint"><div>{ARCH_PROJECTION_COPY.DATA_VERSION_PREFIX}{evidence.dataFreshness.version}</div><div>{ARCH_PROJECTION_COPY.UPDATED_AT_PREFIX}{evidence.dataFreshness.updatedAt}</div><div>{ARCH_PROJECTION_COPY.FRESHNESS_PREFIX}{evidence.dataFreshness.fresh ? ARCH_PROJECTION_COPY.FRESH : archProjStaleAge(evidence.dataFreshness.ageHours)}</div></div>}
          </>
        )}
      </div>
      <div className="flex gap-2 border-t border-border-thin p-2">
        <button type="button" onClick={() => onHighlight(ids)} disabled={ids.length === 0} className="h-8 flex-1 rounded bg-accent-base px-3 text-xs text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">{ARCH_PROJECTION_COPY.HIGHLIGHT}</button>
        <button type="button" onClick={onClearHighlight} className="h-8 rounded px-3 text-xs text-text-hint ring-1 ring-border-thin hover:bg-surface-hover hover:text-text-main">{SHARED_UI_COPY.CLEAR}</button>
      </div>
    </div>
  );
}
