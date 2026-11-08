import { FileText, GitBranch, Layers3, X } from "lucide-react";
import { DEP_IMPACT_COPY } from ".././schema-manager-copy";
import { ReasoningSummary } from "@/components/reasoning";
import { versionStatusDisplay } from "@/lib/domain/StatusDisplay";
import type { DependencyImpactPreviewData } from "@/features/schema-manager/schema-manager-types";

export function DependencyImpactPreview({ data, onClose }: { data: DependencyImpactPreviewData; onClose: () => void }) {
  const metrics = [
    [DEP_IMPACT_COPY.SUMMARY_VERSIONS, data.summary.versions], [DEP_IMPACT_COPY.SUMMARY_RELATIONS_ADDED, data.summary.relationsAdded], [DEP_IMPACT_COPY.SUMMARY_RELATIONS_REMOVED, data.summary.relationsRemoved],
    [DEP_IMPACT_COPY.SUMMARY_COMPONENTS, data.summary.components], [DEP_IMPACT_COPY.SUMMARY_PATHS, data.summary.paths], [DEP_IMPACT_COPY.SUMMARY_DOCUMENTS, data.summary.documents],
  ] as const;
  return (
    <section aria-label={DEP_IMPACT_COPY.SECTION_ARIA} className="space-y-4 border-y border-border-thin py-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-text-main">{DEP_IMPACT_COPY.HEADER}</h3><p className="mt-0.5 text-xs text-text-hint">{DEP_IMPACT_COPY.INTRO}</p></div><button type="button" aria-label={DEP_IMPACT_COPY.CLOSE_ARIA} onClick={onClose} className="rounded-md p-1.5 text-text-hint hover:bg-surface-hover hover:text-text-main"><X className="h-4 w-4" /></button></div>
      <ReasoningSummary data={data.reasoning} />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border-thin ring-1 ring-border-thin sm:grid-cols-3 xl:grid-cols-6">{metrics.map(([label, value]) => <div key={label} className="bg-surface-root px-3 py-2.5"><div className="text-xs text-text-hint">{label}</div><div className="mt-1 font-mono text-base text-text-main">{value}</div></div>)}</div>
      {data.affectedVersions.length === 0 ? <p className="py-4 text-center text-sm text-text-hint">{DEP_IMPACT_COPY.EMPTY_NO_EFFECT}</p> : <div className="space-y-2">{data.affectedVersions.map((item) => <div key={`${item.product}:${item.version}`} className="rounded-lg bg-surface-root px-3 py-3 ring-1 ring-border-thin"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-text-main">{item.product} {item.version}</span><span className="text-xs text-text-hint">{versionStatusDisplay(item.status).label}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-hint"><span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{`${DEP_IMPACT_COPY.RELATION_DELTA_PREFIX}${item.added.length}${DEP_IMPACT_COPY.RELATION_DELTA_MIDDLE}${item.removed.length}`}</span><span className="inline-flex items-center gap-1"><Layers3 className="h-3 w-3" />{`${DEP_IMPACT_COPY.COMPONENTS_PREFIX}${item.componentIds.length}`}</span><span>{`${DEP_IMPACT_COPY.PATHS_PREFIX}${item.paths.length}`}</span><span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{`${DEP_IMPACT_COPY.DOCUMENTS_PREFIX}${item.documents.length}`}</span></div></div>)}</div>}
    </section>
  );
}
