import { ArrowRight } from "lucide-react";
import { REL_MATRIX_COPY } from ".././schema-manager-copy";
import type { NodeTypeDef, RelationTypeDef } from "@/features/schema-manager/schema-manager-types";

export function RelationConstraintMatrix({ relationTypes, nodeTypes = {}, onSelectRelation }: { relationTypes: Record<string, RelationTypeDef>; nodeTypes?: Record<string, NodeTypeDef>; onSelectRelation: (relationId: string) => void }) {
  const rows = Object.entries(relationTypes).filter(([, value]) => value.source_types.length || value.target_types.length);
  const nodeLabel = (id: string) => nodeTypes[id]?.description || REL_MATRIX_COPY.UNNAMED_NODE_TYPE;
  return <section aria-label={REL_MATRIX_COPY.SECTION_ARIA} className="space-y-3"><div><h3 className="text-xs font-semibold uppercase text-text-hint">{REL_MATRIX_COPY.HEADER} · {rows.length}</h3><p className="mt-1 text-xs text-text-placeholder">{REL_MATRIX_COPY.INTRO}</p></div>
    {rows.length === 0 ? <p className="py-6 text-center text-xs text-text-placeholder">{REL_MATRIX_COPY.EMPTY}</p> : <div className="overflow-x-auto rounded-lg ring-1 ring-border-thin"><div className="min-w-[720px] divide-y divide-border-thin">{rows.map(([id, value]) => <button key={id} type="button" onClick={() => onSelectRelation(id)} className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 bg-surface-root px-3 py-2.5 text-left hover:bg-surface-hover"><div className="flex flex-wrap justify-end gap-1">{value.source_types.map((item) => <span key={item} className="rounded bg-surface-hover px-2 py-1 text-xs text-text-sub">{nodeLabel(item)}</span>)}</div><div className="flex min-w-36 items-center justify-center gap-2 text-xs text-[var(--color-accent-fg)]"><ArrowRight className="h-4 w-4" /><span>{value.label_cn || REL_MATRIX_COPY.UNNAMED_RELATION}</span><ArrowRight className="h-4 w-4" /></div><div className="flex flex-wrap gap-1">{value.target_types.map((item) => <span key={item} className="rounded bg-surface-hover px-2 py-1 text-xs text-text-sub">{nodeLabel(item)}</span>)}</div></button>)}</div></div>}
  </section>;
}
