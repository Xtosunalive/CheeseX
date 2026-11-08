import type { EntityRepairPreviewData } from "./entity-compliance-types";

export function FrontmatterDiff({ preview }: { preview: EntityRepairPreviewData }) {
  return <div className="grid gap-2 md:grid-cols-2">
    <pre className="max-h-64 overflow-auto rounded bg-surface-root p-3 text-xs text-status-error">{preview.beforeFrontmatter}</pre>
    <pre className="max-h-64 overflow-auto rounded bg-surface-root p-3 text-xs text-status-fact">{preview.afterFrontmatter}</pre>
  </div>;
}
