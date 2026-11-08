import { X } from "lucide-react";
import type { ProjectionModel } from "./architecture-projection-types";
import { TERM } from "@/constants/term-const";
import { ARCH_PROJECTION_COPY, archProjDiagnosticBranches } from "../components-copy";

interface Props { model: ProjectionModel; selectedEvidence: string | null; onEvidence: (key: string | null) => void; onHighlight: (ids: Set<string> | null) => void; onClear: () => void; }

export default function ArchProjMobile({ model, selectedEvidence, onEvidence, onHighlight, onClear }: Props) {
  const { evidenceIndex, meta, nodes } = model;
  const mainPath = nodes.filter(n => n.data.nodeType === "entity" || n.data.nodeType === "start" || n.data.nodeType === "empty");
  const branches = nodes.filter(n => ["implicit", "ambiguous", "unresolved", "missing"].includes(n.data.nodeType)
    || (n.data.nodeType === "decision" && n.data.evidenceKey?.startsWith("implicit_path:")));
  const ev = selectedEvidence && evidenceIndex.has(selectedEvidence) ? evidenceIndex.get(selectedEvidence)! : null;

  return (
    <div className="space-y-3 p-3">
      <div className="text-xs text-text-hint">{TERM.ARCH_COMPONENT}: {meta.seedCount} · {TERM.GAP_INDIRECT}: {meta.implicitCount} · {TERM.GAP_UNRELATED}: {meta.unresolvedCount} · {TERM.GAP_MISSING_COMPONENT}: {meta.missingCount}</div>
      <div className="space-y-2">
        {mainPath.map(n => (
          <div key={n.id} onClick={() => { if (n.data.evidenceKey) onEvidence(n.data.evidenceKey); }} className="cursor-pointer rounded-lg bg-surface-card p-3 ring-1 ring-border-thin hover:bg-surface-hover">
            {/* WP-146 裁决2：空 label 不上屏（节点本体照常渲染） */}
            {n.data.label ? <div className="text-sm font-medium text-text-main">{n.data.label}</div> : null}
            <div className="mt-0.5 text-xs text-text-hint">{n.data.nodeType}</div>
          </div>
        ))}
      </div>
      {branches.length > 0 && (
        <details className="rounded-lg bg-surface-card p-2 ring-1 ring-border-thin">
          <summary className="cursor-pointer text-sm font-medium text-text-sub">{archProjDiagnosticBranches(branches.length)}</summary>
          <div className="space-y-2 mt-2">
            {branches.map(n => (
              <button type="button" key={n.id} onClick={() => { if (n.data.pathNodeIds?.length) onHighlight(new Set(n.data.pathNodeIds)); if (n.data.evidenceKey) onEvidence(n.data.evidenceKey); }} className={`block w-full rounded p-2 text-left text-sm ring-1 ${n.data.nodeType === "missing" || n.data.nodeType === "unresolved" ? "bg-status-error-2 text-status-error ring-status-error-6" : "bg-status-warn-2 text-status-warn ring-status-warn-6"}`}>
                <div className="font-medium">{n.data.label}</div><div className="text-xs opacity-60">{n.data.nodeType}</div>
              </button>
            ))}
          </div>
        </details>
      )}
      {meta.isComplete && <div className="rounded-lg bg-status-fact-2 p-3 text-sm text-status-fact ring-1 ring-status-fact-6">{ARCH_PROJECTION_COPY.COMPLETE_MARK}</div>}
      {ev && (
        <div className="fixed bottom-0 left-0 right-0 z-sticky max-h-60 overflow-auto border-t border-border-thin bg-surface-card p-4 shadow-popover">
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-text-main">{ev.label}</span><button type="button" onClick={onClear} aria-label={ARCH_PROJECTION_COPY.CLOSE_EVIDENCE}><X className="h-4 w-4 text-text-hint" /></button></div>
          <div className="space-y-1 text-xs text-text-sub">
            {ev.type === "implicit_path" && <div>{ARCH_PROJECTION_COPY.PATH_PREFIX}{(ev.pathNodeIds || []).join(" → ")}</div>}
            {ev.type === "unresolved_pair" && <div>{TERM.GAP_UNRELATED}: {ev.pairNodes?.nodeA} ⨯ {ev.pairNodes?.nodeB}</div>}
            {ev.type === "missing_seed" && <div>{TERM.GAP_MISSING_COMPONENT}: {ev.sourceNodeId}</div>}
            {ev.type === "success" && <div className="text-status-fact">{ARCH_PROJECTION_COPY.ALL_REACHABLE}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
