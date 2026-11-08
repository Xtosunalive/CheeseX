import { GitCompareArrows, Loader2 } from "lucide-react";
import type { ProductVersion } from "@/features/architecture-version/architecture-version-types";
import { AV_COMPARE_COPY } from "@/features/architecture-version/architecture-version-copy";

const SOURCE_LABEL = { snapshot: AV_COMPARE_COPY.SOURCE_SNAPSHOT, live: AV_COMPARE_COPY.SOURCE_LIVE } as const;

function VersionSource({ version }: { version: ProductVersion | undefined }) {
  if (!version) return null;
  return (
    <span className="inline-flex rounded-sm bg-surface-hover px-2 py-0.5 text-xs text-text-hint ring-1 ring-border-thin">
      {SOURCE_LABEL[version.sourceMode]}
    </span>
  );
}

export function VersionComparePanel({
  products, versions, product, sourceVersion, targetVersion, comparing,
  onProductChange, onSourceChange, onTargetChange, onCompare,
}: {
  products: string[];
  versions: ProductVersion[];
  product: string;
  sourceVersion: string;
  targetVersion: string;
  comparing: boolean;
  onProductChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onCompare: () => void;
}) {
  const source = versions.find((item) => item.version === sourceVersion);
  const target = versions.find((item) => item.version === targetVersion);
  const selectClass = "h-9 w-full rounded-md bg-surface-root px-3 text-sm text-text-main outline-none ring-1 ring-border-thin focus:ring-border-focus";

  return (
    <section className="grid gap-3 border-y border-border-thin py-4 lg:grid-cols-[minmax(150px,0.7fr)_minmax(190px,1fr)_auto_minmax(190px,1fr)_auto] lg:items-end">
      <label className="text-xs text-text-hint">
        {AV_COMPARE_COPY.PRODUCT}
        <select aria-label={AV_COMPARE_COPY.PRODUCT_PICK_ARIA} value={product} onChange={(event) => onProductChange(event.target.value)} className={`mt-1.5 ${selectClass}`}>
          {products.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label className="text-xs text-text-hint">
        {AV_COMPARE_COPY.SOURCE_VERSION}
        <select aria-label={AV_COMPARE_COPY.SOURCE_VERSION_PICK_ARIA} value={sourceVersion} onChange={(event) => onSourceChange(event.target.value)} className={`mt-1.5 ${selectClass}`}>
          {!sourceVersion && <option value="" disabled>{AV_COMPARE_COPY.VERSION_PLACEHOLDER}</option>}
          {versions.map((item) => <option key={item.version} value={item.version} disabled={item.version === targetVersion}>{item.label}</option>)}
        </select>
      </label>
      <div className="pb-1"><VersionSource version={source} /></div>
      <label className="text-xs text-text-hint">
        {AV_COMPARE_COPY.TARGET_VERSION}
        <select aria-label={AV_COMPARE_COPY.TARGET_VERSION_PICK_ARIA} value={targetVersion} onChange={(event) => onTargetChange(event.target.value)} className={`mt-1.5 ${selectClass}`}>
          {!targetVersion && <option value="" disabled>{AV_COMPARE_COPY.NO_TARGET}</option>}
          {versions.map((item) => <option key={item.version} value={item.version} disabled={item.version === sourceVersion}>{item.label}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-3 pb-0.5">
        <VersionSource version={target} />
        <button
          type="button"
          onClick={onCompare}
          disabled={comparing || !sourceVersion || !targetVersion || sourceVersion === targetVersion}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-accent-bg px-4 text-sm font-medium text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)] transition-colors hover:bg-[var(--color-accent-bg)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {comparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
          {AV_COMPARE_COPY.START_COMPARE}
        </button>
      </div>
    </section>
  );
}
