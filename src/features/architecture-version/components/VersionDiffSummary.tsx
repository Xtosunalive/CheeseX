import type { ArchitectureVersionComparison } from "@/features/architecture-version/architecture-version-types";
import { AV_SUMMARY_COPY } from "@/features/architecture-version/architecture-version-copy";

export function VersionDiffSummary({ summary }: { summary: ArchitectureVersionComparison["summary"] }) {
  const metrics = [
    [AV_SUMMARY_COPY.COMPONENTS_ADDED, summary.componentsAdded, "text-status-fact"],
    [AV_SUMMARY_COPY.COMPONENTS_REMOVED, summary.componentsRemoved, "text-status-error"],
    [AV_SUMMARY_COPY.COMPONENTS_CHANGED, summary.componentsChanged, "text-status-warn"],
    [AV_SUMMARY_COPY.RELATIONS_ADDED, summary.relationsAdded, "text-status-fact"],
    [AV_SUMMARY_COPY.RELATIONS_REMOVED, summary.relationsRemoved, "text-status-error"],
    [AV_SUMMARY_COPY.DOCUMENTS_ADDED, summary.documentsAdded, "text-status-fact"],
    [AV_SUMMARY_COPY.DOCUMENTS_REMOVED, summary.documentsRemoved, "text-status-error"],
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border-thin ring-1 ring-border-thin sm:grid-cols-4 xl:grid-cols-7">
      {metrics.map(([label, value, tone]) => (
        <div key={label} className="bg-surface-root px-3 py-3">
          <div className="text-xs text-text-hint">{label}</div>
          <div className={`mt-1 font-mono text-lg tabular-nums ${tone}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}
