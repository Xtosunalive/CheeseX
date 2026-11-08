import { isNoCurrentReleaseText } from "@/lib/api";
import { useMemo } from "react";
import { ImpactHopGroup } from "./ImpactHopGroup";
import { useImpactAnalysisStore } from "@/features/impact-analysis/impact-analysis-store";
import { useAdmittedNodes } from "@/lib/topology-store";
import { useNodeHighlight } from "@/lib/dashboard-ui-store";
import { ObsidianLink } from "@/components/obsidian";
import { FilterSelect } from "@/components/filter-select";

import { relationTypeLabel } from "@/lib/ontology";
import { nodeNameLabel } from "@/lib/domain";
import { TERM } from "@/constants/term-const";
// WP-006 第2项风险分类人读名、排除原因/推断规则/置信档人读名随文案迁入页级文案单源（WP-151）
import {
  IMPACT_CONFIDENCE_BAND_LABELS,
  IMPACT_FILTER_REASON_LABELS,
  IMPACT_INFERENCE_RULE_LABELS,
  IMPACT_PANEL_COPY,
  IMPACT_RISK_KIND_LABELS,
  impactFilteredEdgesSummary,
  impactInferredEdgesSummary,
  impactScopeErrorFallback,
} from "../impact-analysis-copy";
import { ImpactAnalysisLineage } from "./ImpactLineage";
import { ReasoningSummary } from "@/components/reasoning";

const SLIDER_CSS = `
  input[type=range].range-dark {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
  }
  input[type=range].range-dark::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 9999px;
    background: var(--color-border-thin);
  }
  input[type=range].range-dark::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 9999px;
    background: var(--color-accent-base);
    margin-top: -4px;
  }
  input[type=range].range-dark::-moz-range-track {
    height: 6px;
    border-radius: 9999px;
    background: var(--color-border-thin);
    border: none;
  }
  input[type=range].range-dark::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 9999px;
    background: var(--color-accent-base);
    border: none;
  }
`;

export function ImpactAnalysisPanel() {
  const store = useImpactAnalysisStore();
  const setHighlightNodeIds = useNodeHighlight((state) => state.setHighlightNodeIds);
  const admittedNodes = useAdmittedNodes();

  const groups = [
    { direction: "downstream", items: store.result?.downstream.byHop || [] },
    { direction: "upstream", items: store.result?.upstream.byHop || [] },
  ];
  const versionOptions = store.versions.map((item) => ({ value: JSON.stringify([item.product, item.version]), label: `${item.product} ${item.label}`, group: item.status === "released" ? IMPACT_PANEL_COPY.VERSION_GROUP_RELEASED : item.status === "draft" ? IMPACT_PANEL_COPY.VERSION_GROUP_DRAFT : IMPACT_PANEL_COPY.VERSION_GROUP_HISTORY }));
  const versionValue = store.product && store.version ? JSON.stringify([store.product, store.version]) : "";
  const nodeOptions = useMemo(() => admittedNodes.map((node) => ({ value: node.id, label: nodeNameLabel(node), group: node.category || TERM.ARCH_COMPONENT })).sort((left, right) => left.label.localeCompare(right.label, "zh-CN")), [admittedNodes]);
  const nodeLabels = useMemo(() => new Map(admittedNodes.map((node) => [node.id, nodeNameLabel(node)])), [admittedNodes]);
  const nodeLabel = (nodeId: string) => nodeNameLabel(nodeLabels.get(nodeId));

  return (
    <div className="space-y-5">
      <style>{SLIDER_CSS}</style>
      {/* ── 标题组（唯一主标题，侧边栏已有导航入口） ── */}
      <div>
        <h2 className="font-display text-lg font-semibold text-text-main sm:text-xl">{IMPACT_PANEL_COPY.TITLE}</h2>
        <p className="text-sm text-text-hint leading-tight mt-0.5">{IMPACT_PANEL_COPY.SUBTITLE}</p>
      </div>

      {/* ── 一行表单控件：输入框 + 下拉 + 两个滑块 ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <FilterSelect ariaLabel={IMPACT_PANEL_COPY.SEED_ARIA} title={IMPACT_PANEL_COPY.SEED_TITLE} searchPlaceholder={IMPACT_PANEL_COPY.SEED_SEARCH} multiple value={store.seedNodeIds} onValueChange={(value) => store.setSeedNodeIds(value as string[])} emptyLabel={IMPACT_PANEL_COPY.SEED_EMPTY} placeholder={TERM.ARCH_COMPONENT} options={nodeOptions} className="w-72" />

        <FilterSelect ariaLabel={IMPACT_PANEL_COPY.DIRECTION_ARIA} title={IMPACT_PANEL_COPY.DIRECTION_TITLE} searchPlaceholder={IMPACT_PANEL_COPY.DIRECTION_SEARCH} variant="filter" value={store.direction} onValueChange={(value) => store.setDirection(value as "downstream" | "upstream" | "both")} options={[{ value: "downstream", label: IMPACT_PANEL_COPY.DIRECTION_DOWNSTREAM, group: IMPACT_PANEL_COPY.DIRECTION_GROUP }, { value: "upstream", label: IMPACT_PANEL_COPY.DIRECTION_UPSTREAM, group: IMPACT_PANEL_COPY.DIRECTION_GROUP }, { value: "both", label: IMPACT_PANEL_COPY.DIRECTION_BOTH, group: IMPACT_PANEL_COPY.DIRECTION_GROUP }]} />

        {versionOptions.length > 0 && <FilterSelect ariaLabel={IMPACT_PANEL_COPY.VERSION_ARIA} title={IMPACT_PANEL_COPY.VERSION_TITLE} searchPlaceholder={IMPACT_PANEL_COPY.VERSION_SEARCH} variant="filter" value={versionValue} onValueChange={(value) => { if (typeof value !== "string") return; const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((item) => typeof item === "string")) store.setVersionScope(parsed[0], parsed[1]); }} options={versionOptions} />}

        <label className="flex items-center gap-3 w-64">
          <span className="text-sm text-text-sub whitespace-nowrap">
            {IMPACT_PANEL_COPY.MAX_HOPS_LABEL} {store.maxHops}
          </span>
          <input aria-label={IMPACT_PANEL_COPY.MAX_HOPS_LABEL} type="range" min="1" max="5"
            value={store.maxHops} onChange={(event) => store.setMaxHops(Number(event.target.value))}
            className="flex-1 range-dark" />
        </label>

        <label className="flex items-center gap-3 w-64">
          <span className="text-sm text-text-sub whitespace-nowrap">
            {IMPACT_PANEL_COPY.CONFIDENCE_PREFIX}{store.minConfidence.toFixed(2)}
          </span>
          <input aria-label={IMPACT_PANEL_COPY.CONFIDENCE_ARIA} type="range" min="0" max="1" step="0.05"
            value={store.minConfidence} onChange={(event) => store.setMinConfidence(Number(event.target.value))}
            className="flex-1 range-dark" />
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={store.enableInference}
            onChange={(event) => store.setEnableInference(event.target.checked)}
            className="h-4 w-4 rounded accent-[var(--color-accent-base)]"
          />
          <span className="text-sm text-text-sub whitespace-nowrap">{IMPACT_PANEL_COPY.ENABLE_INFERENCE}</span>
        </label>

        {store.enableInference && (
          <label className="flex items-center gap-3 w-48">
            <span className="text-sm text-text-sub whitespace-nowrap">
              {IMPACT_PANEL_COPY.INFERENCE_DEPTH_LABEL} {store.maxInferenceDepth}
            </span>
            <input aria-label={IMPACT_PANEL_COPY.INFERENCE_DEPTH_LABEL} type="range" min="1" max="3"
              value={store.maxInferenceDepth} onChange={(event) => store.setMaxInferenceDepth(Number(event.target.value))}
              className="flex-1 range-dark" />
          </label>
        )}
      </div>
      {store.scope.error && <p className="text-xs text-status-warn">{isNoCurrentReleaseText(store.scope.error) ? IMPACT_PANEL_COPY.NO_RELEASE_FALLBACK : impactScopeErrorFallback(store.scope.error)}</p>}

      {/* ── 分析按钮 ── */}
      <button
        disabled={!store.seedNodeIds.length || store.status === "loading"}
        onClick={() => void store.analyze()}
        className="mt-3 px-5 py-2.5 rounded-lg bg-accent-bg text-[var(--color-accent-fg)] font-medium
          transition-all duration-[var(--duration-base)] hover:bg-accent-bg-strong active:scale-[0.97]
          ring-1 ring-[var(--color-border-focus)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {store.status === "loading" ? IMPACT_PANEL_COPY.ANALYZING : IMPACT_PANEL_COPY.ANALYZE_ACTION}
      </button>

      {/* ── 错误 ── */}
      {store.error && (
        <div className="rounded-lg ring-1 ring-status-error-6 bg-status-error-2 p-4 text-sm text-status-error flex items-center gap-3">
          <span>{store.error}</span>
          <button
            onClick={() => void store.analyze()}
            className="text-xs text-status-error hover:text-red-3 underline underline-offset-2"
          >
            {TERM.RETRY_ACTION}
          </button>
        </div>
      )}

      {store.result && <ImpactAnalysisLineage result={store.result} />}
      {store.result?.reasoning && <ReasoningSummary data={store.result.reasoning} />}

      {/* ── 空结果 ── */}
      {store.status !== "loading" && store.result && store.result.meta.totalNodesAffected === 0 && (
        <p className="py-10 text-center text-sm text-text-hint">
          {IMPACT_PANEL_COPY.EMPTY_RESULT}
        </p>
      )}

      {/* ── 结果分组 ── */}
      {groups.flatMap(({ direction, items }) =>
        items.map((group) => {
          const key = `${direction}-${group.hop}`;
          return (
            <ImpactHopGroup
              key={key}
              direction={direction}
              group={group}
              expanded={Boolean(store.expandedHops[key])}
              onToggle={() => store.toggleHop(key)}
              onNodeClick={(ids) => setHighlightNodeIds(new Set(ids))}
            />
          );
        }),
      )}

      {/* ── 已过滤边 ── */}
      {store.result && store.result.filteredEdges.length > 0 && (
        <details className="text-sm text-text-hint">
          <summary className="cursor-pointer">
            {impactFilteredEdgesSummary(store.result.filteredEdges.length)}
          </summary>
          {store.result.filteredEdges.map((item, i) => (
            <div key={`${item.edge.source}-${item.edge.target}-${i}`} className="ml-4 mt-1">
              {IMPACT_FILTER_REASON_LABELS[item.reason] || IMPACT_PANEL_COPY.FILTER_REASON_FALLBACK}：{nodeLabel(item.edge.source)} → {nodeLabel(item.edge.target)}
            </div>
          ))}
        </details>
      )}

      {/* ── 推理边 ── */}
      {store.result && store.result.inferredEdges && store.result.inferredEdges.length > 0 && (
        <details className="text-sm text-text-hint" open>
          <summary className="cursor-pointer">
            {impactInferredEdgesSummary(store.result.inferredEdges.length)}
          </summary>
          {store.result.inferredEdges.map((edge, i) => (
            <div key={`inf-${i}`} className="ml-4 mt-1.5 p-2 rounded bg-surface-root ring-1 ring-border-thin">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text-sub">{nodeLabel(edge.source)} → {nodeLabel(edge.target)}</span>
                <span className="text-xs text-text-sub">[{relationTypeLabel(edge.type)}]</span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${edge.confidenceBand === "HIGH" ? "bg-grass-3 text-grass-11" : edge.confidenceBand === "MEDIUM" ? "bg-status-warn-3 text-status-warn" : "bg-status-error-3 text-status-error"}`}>
                  {edge.confidenceBand && (IMPACT_CONFIDENCE_BAND_LABELS[edge.confidenceBand] || edge.confidenceBand)}
                </span>
                <span className="text-xs text-text-hint italic">{IMPACT_PANEL_COPY.INFERENCE_BASIS_PREFIX}{IMPACT_INFERENCE_RULE_LABELS[edge.inferenceRule || ""] || IMPACT_PANEL_COPY.INFERENCE_RULE_FALLBACK}</span>
              </div>
              {edge.inferenceChain && (
                <div className="text-xs text-text-hint mt-0.5">
                  {IMPACT_PANEL_COPY.INFERENCE_CHAIN_PREFIX}{edge.inferenceChain.map(nodeLabel).join(" → ")}
                </div>
              )}
            </div>
          ))}
        </details>
      )}

      {/* ── 推理元信息 ── */}
      {store.result && store.result.inferredEdges && store.result.inferredEdges.length > 0 && store.result.meta && (
        <div className="text-xs text-text-hint flex gap-4">
          <span>{IMPACT_PANEL_COPY.INFERRED_EDGES_LABEL}：{store.result.meta.inferredEdgeCount ?? store.result.inferredEdges.length}</span>
          <span>{IMPACT_PANEL_COPY.INFERENCE_DEPTH_LABEL}：{store.result.meta.maxInferenceDepth}</span>
        </div>
      )}

      {/* ── 风险分类汇总（WP-006 第2项：影响面按风险类别分组） ── */}
      {store.result && store.result.riskBreakdown && Object.keys(store.result.riskBreakdown).length > 0 && (
        <div className="flex flex-wrap gap-2 items-center text-xs">
          <span className="text-text-hint">{IMPACT_PANEL_COPY.RISK_BREAKDOWN_PREFIX}</span>
          {Object.entries(store.result.riskBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => (
              <span key={kind} className="px-2 py-0.5 rounded-sm bg-surface-card ring-1 ring-border-thin text-text-sub">
                {IMPACT_RISK_KIND_LABELS[kind] ?? kind} × {count}
              </span>
            ))}
        </div>
      )}

      {/* ── 关联文档 ── */}
      {store.result
        && [...store.result.downstream.documentRefs, ...store.result.upstream.documentRefs].length
          > 0 && (
        <details className="text-sm text-text-hint">
          <summary className="cursor-pointer">
            {IMPACT_PANEL_COPY.RELATED_DOCS}
          </summary>
          {[...store.result.downstream.documentRefs, ...store.result.upstream.documentRefs].map(
            (doc) => (
              <ObsidianLink
                key={doc.relativePath}
                className="block ml-4 mt-1 hover:underline text-text-sub"
                sourcePath={doc.relativePath}
              >
                {doc.title}
              </ObsidianLink>
            ),
          )}
        </details>
      )}
    </div>
  );
}
