import { FileText, GitBranch, Layers3 } from "lucide-react";
import { TERM } from "@/constants/term-const";
import type { ArchitectureVersionComparison } from "@/features/architecture-version/architecture-version-types";
import { relationTypeLabel } from "@/lib/ontology";
import { VERSION_DIFF_FIELD_LABELS } from "./version-diff-field-labels";
import { AV_DIFF_COPY } from "@/features/architecture-version/architecture-version-copy";

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-text-hint">{title} ({count})</h3>
      <div className="divide-y divide-border-thin overflow-hidden rounded-lg ring-1 ring-border-thin">{children}</div>
    </div>
  );
}

function EmptyDiff() {
  return <p className="py-10 text-center text-sm text-text-hint">{AV_DIFF_COPY.NO_DIFF}</p>;
}



function changeValue(field: string, value: string) {
  if (field === "articleId" || field === "sourcePath") return value ? AV_DIFF_COPY.VALUE_SET : AV_DIFF_COPY.VALUE_UNSET;
  return value || AV_DIFF_COPY.VALUE_EMPTY;
}

export function VersionComponentDiff({ comparison }: { comparison: ArchitectureVersionComparison }) {
  const total = Object.values(comparison.summary).reduce((sum, value) => sum + value, 0);
  if (total === 0) return <EmptyDiff />;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <section className="min-w-0 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-main"><Layers3 className="h-4 w-4 text-[var(--color-accent-base)]" />{TERM.ARCH_COMPONENT}</div>
        <Group title={TERM.ADD_ACTION} count={comparison.components.added.length}>{comparison.components.added.map((item) => <div key={item.id} className="bg-surface-root px-3 py-2.5"><div className="text-sm text-text-main">{item.label}</div><div className="mt-0.5 text-xs text-text-hint">{item.layer || AV_DIFF_COPY.UNLAYERED} · {item.category || AV_DIFF_COPY.UNCATEGORIZED}{item.role ? ` · ${item.role}` : ""}</div></div>)}</Group>
        <Group title={AV_DIFF_COPY.GROUP_REMOVED} count={comparison.components.removed.length}>{comparison.components.removed.map((item) => <div key={item.id} className="bg-surface-root px-3 py-2.5 text-sm text-text-main">{item.label}</div>)}</Group>
        <Group title={AV_DIFF_COPY.GROUP_CHANGED} count={comparison.components.changed.length}>{comparison.components.changed.map((item) => <div key={item.id} className="bg-surface-root px-3 py-2.5"><div className="text-sm text-text-main">{item.target.label}</div><div className="mt-1 space-y-1 text-xs text-text-hint">{item.changes.map((change) => <div key={change.field}><span className="text-text-sub" title={change.field}>{VERSION_DIFF_FIELD_LABELS[change.field] ?? AV_DIFF_COPY.OTHER_ATTRIBUTE}</span>：{changeValue(change.field, change.before)} → {changeValue(change.field, change.after)}</div>)}</div></div>)}</Group>
      </section>

      <section className="min-w-0 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-main"><GitBranch className="h-4 w-4 text-[var(--color-accent-base)]" />{TERM.RELATION}</div>
        <Group title={TERM.ADD_ACTION} count={comparison.relations.added.length}>{comparison.relations.added.map((item) => <div key={item.key} className="bg-surface-root px-3 py-2.5 text-xs text-text-sub"><span className="text-text-main">{item.sourceLabel}</span> → {relationTypeLabel(item.type)} → <span className="text-text-main">{item.targetLabel}</span></div>)}</Group>
        <Group title={AV_DIFF_COPY.GROUP_REMOVED} count={comparison.relations.removed.length}>{comparison.relations.removed.map((item) => <div key={item.key} className="bg-surface-root px-3 py-2.5 text-xs text-text-sub"><span className="text-text-main">{item.sourceLabel}</span> → {relationTypeLabel(item.type)} → <span className="text-text-main">{item.targetLabel}</span></div>)}</Group>
      </section>

      <section className="min-w-0 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-main"><FileText className="h-4 w-4 text-[var(--color-accent-base)]" />{AV_DIFF_COPY.DOCUMENTS_SECTION}</div>
        <Group title={TERM.ADD_ACTION} count={comparison.documents.added.length}>{comparison.documents.added.map((item) => <div key={item.documentId} className="bg-surface-root px-3 py-2.5 text-sm text-text-main">{item.title}</div>)}</Group>
        <Group title={AV_DIFF_COPY.GROUP_REMOVED} count={comparison.documents.removed.length}>{comparison.documents.removed.map((item) => <div key={item.documentId} className="bg-surface-root px-3 py-2.5 text-sm text-text-main">{item.title}</div>)}</Group>
        <Group title={AV_DIFF_COPY.GROUP_CHANGED} count={comparison.documents.changed.length}>{comparison.documents.changed.map((item) => <div key={item.id} className="bg-surface-root px-3 py-2.5"><div className="text-sm text-text-main">{item.target.title}</div><div className="mt-1 space-y-1 text-xs text-text-hint">{item.changes.map((change) => <div key={change.field}><span className="text-text-sub">{VERSION_DIFF_FIELD_LABELS[change.field] || AV_DIFF_COPY.ARTICLE_INFO}</span>：{changeValue(change.field, change.before)} → {changeValue(change.field, change.after)}</div>)}</div></div>)}</Group>
      </section>
    </div>
  );
}
