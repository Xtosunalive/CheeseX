import { useEffect, useMemo } from "react";
import { AlertTriangle, CircleHelp, RefreshCw, ShieldCheck } from "lucide-react";
import { VersionComparePanel, VersionComponentDiff, VersionDiffSummary } from "./components";
import { useArchitectureVersionStore } from "./architecture-version-store";
import { navigate } from "@/lib/navigation";
import { Statistic } from "@/components/statistic";
import { isNoCurrentReleaseText } from "@/lib/api";
import { PageContainer, PageSection } from "@/components/page-container";
import { Panel } from "@/components/panel";
import { AV_VIEW_COPY } from "./architecture-version-copy";

export function ArchitectureVersionView() {
  const store = useArchitectureVersionStore();
  useEffect(() => { void store.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => [...new Set((store.versions?.items || []).map((item) => item.product))], [store.versions]);
  const versions = useMemo(() => (store.versions?.items || []).filter((item) => item.product === store.product), [store.product, store.versions]);

  const error = store.error ?? store.operationError;

  return (
    <PageContainer>
      <PageSection
        action={
          <button type="button" onClick={() => void store.load()} title={AV_VIEW_COPY.REFRESH} aria-label={AV_VIEW_COPY.REFRESH} className="flex h-8 w-8 items-center justify-center rounded-md text-text-hint hover:bg-surface-hover hover:text-text-main">
            <RefreshCw className={`h-4 w-4 ${store.status === "loading" ? "animate-spin" : ""}`} />
          </button>
        }
      />

      {/* WP-037 P7 锚点：产品版本数主视觉 */}
      <Statistic size="xl" label={AV_VIEW_COPY.STAT_LABEL} value={store.versions ? store.versions.items.length : null} hint={AV_VIEW_COPY.STAT_HINT} />

      <Panel>
        <div className="flex flex-col gap-4">
        {/* Master 2026-10-29：空态即结构——发布前常态无卡（版本数 0＋对比面板结构照常） */}

        {error && !isNoCurrentReleaseText(error) && (
          <div className="flex items-center gap-2 rounded-lg bg-status-error-2 px-4 py-3 text-sm text-status-error ring-1 ring-status-error-6">
            <AlertTriangle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {store.status === "loading" && !store.versions && (
          <p className="py-16 text-center text-sm text-text-hint">{AV_VIEW_COPY.LOADING}</p>
        )}

        {products.length > 0 && (
          <VersionComparePanel
            products={products}
            versions={versions}
            product={store.product}
            sourceVersion={store.sourceVersion}
            targetVersion={store.targetVersion}
            comparing={store.comparing}
            onProductChange={store.setProduct}
            onSourceChange={store.setSourceVersion}
            onTargetChange={store.setTargetVersion}
            onCompare={() => void store.compare()}
          />
        )}

        {store.status !== "loading" && store.versions && versions.length < 2 && (
          <div className="py-16 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-status-warn" />
            <h2 className="mt-3 text-sm font-medium text-text-main">{AV_VIEW_COPY.NEED_TWO_VERSIONS}</h2>
            <button type="button" onClick={() => { navigate("schema", { query: { tab: "versions" } }); }} className="mt-4 inline-flex h-9 items-center rounded-md bg-accent-bg px-4 text-sm font-medium text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)] hover:bg-[var(--color-accent-bg)]">{AV_VIEW_COPY.OPEN_VERSION_CHECK}</button>
          </div>
        )}

        {store.comparison && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-hint">
              <span className="font-medium text-text-main">{store.comparison.source.label}</span>
              <span>{AV_VIEW_COPY.TO}</span>
              <span className="font-medium text-text-main">{store.comparison.target.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border-thin py-3 text-xs text-text-hint">
              {store.comparison.lineage?.freshness.status === "fresh" ? <><ShieldCheck className="h-4 w-4 text-status-fact" /><span className="font-medium text-status-fact">{AV_VIEW_COPY.LINEAGE_VERIFIED}</span></> : <><CircleHelp className="h-4 w-4 text-status-warn" /><span className="font-medium text-status-warn">{AV_VIEW_COPY.LINEAGE_UNVERIFIED}</span></>}
              <span>{store.comparison.lineage?.source.kind === "version-snapshot-comparison" ? AV_VIEW_COPY.SNAPSHOT_COMPARISON : AV_VIEW_COPY.STATE_COMPARISON}</span>
              <span>{store.comparison.lineage?.decision.kind === "manual" ? AV_VIEW_COPY.MANUAL_DECISION : AV_VIEW_COPY.SYSTEM_DECISION}</span>
            </div>
            <VersionDiffSummary summary={store.comparison.summary} />
            <VersionComponentDiff comparison={store.comparison} />
          </div>
        )}
        </div>
      </Panel>
    </PageContainer>
  );
}
