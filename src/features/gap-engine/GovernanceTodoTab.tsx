// GovernanceTodoTab — Tab 3: 真实数据质量问题 (gap-engine powered)
// v3: two-step exempt flow with Obsidian guidance + frontmatter snippet

import { useState } from "react";
import { ShieldCheck, Lightbulb, ExternalLink, X } from "lucide-react";
import { useGapItems, useTopologyStore } from "@/lib/topology-store";
import { resolveGap } from "./gap-api";
import { TERM } from "@/constants/term-const";
import {
  GOVERNANCE_TODO_COPY,
  governanceTodoEmptyDescription,
  governanceTodoExemptedNotice,
  governanceTodoExemptedShort,
} from "./gap-engine-copy";
import { EmptyState } from "@/components/empty-state";
import { ObsidianLink } from "@/components/obsidian";
import {
  GAP_TYPE_LABEL,
  GAP_SEVERITY_STYLE,
  gapGuidance,
  GAP_QUICK_ACTION,
  groupGapsBySeverity,
  GROUP_LABEL,
  type GapItem,
  type GapType,
} from "./gap-types";

/** Frontmatter snippet for each gap type exemption */
const EXEMPT_FRONTMATTER: Record<GapType, string> = {
  dangling_dependency: "exempt_rules: [dangling_dependency]",
  isolated_entity: "exempt_rules: [isolated_entity]",
  low_confidence: "exempt_rules: [low_confidence]",
  missing_document_ref: "exempt_rules: [missing_document_ref]",
  cross_domain_ref: "exempt_rules: [cross_domain_ref]",
};

export function GovernanceTodoTab() {
  const gaps = useGapItems();
  const removeGap = useTopologyStore((s) => s.removeGap);
  // WP-031：按文档豁免规则豁免的缺口计数——可追溯不静默（与单条豁免同源可见）
  const exemptedCount = useTopologyStore((s) => s.stats?.gapsExempted ?? 0);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  /** gapId → action that triggered the confirmation panel */
  const [pendingExempt, setPendingExempt] = useState<string | null>(null);

  const handleIgnore = async (gap: GapItem) => {
    setResolvingIds((prev) => new Set(prev).add(gap.id));
    try {
      await resolveGap(gap.id, "ignored");
      removeGap(gap.id);
    } catch { /* gap stays on reload */ }
    finally { setResolvingIds((prev) => { const n = new Set(prev); n.delete(gap.id); return n; }); }
  };

  const confirmExempt = async (gap: GapItem) => {
    setResolvingIds((prev) => new Set(prev).add(gap.id));
    setPendingExempt(null);
    try {
      await resolveGap(gap.id, "exempted");
      removeGap(gap.id);
    } catch { /* gap stays on reload */ }
    finally { setResolvingIds((prev) => { const n = new Set(prev); n.delete(gap.id); return n; }); }
  };

  if (gaps.length === 0) {
    return (
      // WP-145 N1：整块 tab 空态改走 EmptyState 介质（默认弱底容器居中形态）；渲染条件不变
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6 text-status-fact-11" />}
        title={GOVERNANCE_TODO_COPY.EMPTY_TITLE}
        description={
          <>
            {governanceTodoEmptyDescription()}
            {exemptedCount > 0 && (
              <span className="mt-1 block">{governanceTodoExemptedShort(exemptedCount)}</span>
            )}
          </>
        }
      />
    );
  }

  const { blockers, warnings } = groupGapsBySeverity(gaps);

  return (
    <div className="space-y-6">
      {exemptedCount > 0 && (
        <p className="text-xs text-text-hint">{governanceTodoExemptedNotice(exemptedCount)}</p>
      )}
      {blockers.length > 0 && (
        <GapGroup
          label={GROUP_LABEL.blocker}
          gaps={blockers}
          resolvingIds={resolvingIds}
          pendingExempt={pendingExempt}
          onIgnore={handleIgnore}
          onRequestExempt={(id) => setPendingExempt(id)}
          onConfirmExempt={confirmExempt}
          onCancelExempt={() => setPendingExempt(null)}
        />
      )}
      {warnings.length > 0 && (
        <GapGroup
          label={GROUP_LABEL.warning}
          gaps={warnings}
          resolvingIds={resolvingIds}
          pendingExempt={pendingExempt}
          onIgnore={handleIgnore}
          onRequestExempt={(id) => setPendingExempt(id)}
          onConfirmExempt={confirmExempt}
          onCancelExempt={() => setPendingExempt(null)}
        />
      )}
    </div>
  );
}

// ── Gap Group ──

function GapGroup({
  label, gaps, resolvingIds, pendingExempt,
  onIgnore, onRequestExempt, onConfirmExempt, onCancelExempt,
}: {
  label: { title: string; subtitle: string; color: string };
  gaps: GapItem[];
  resolvingIds: Set<string>;
  pendingExempt: string | null;
  onIgnore: (gap: GapItem) => void;
  onRequestExempt: (id: string) => void;
  onConfirmExempt: (gap: GapItem) => void;
  onCancelExempt: () => void;
}) {
  return (
    <div>
      <div className="mb-3">
        <h3 className={`text-sm font-semibold ${label.color}`}>{label.title}</h3>
        <p className="mt-0.5 text-xs text-text-hint">{label.subtitle}</p>
      </div>
      <div className="space-y-2">
        {gaps.map((g) => (
          <GapCard
            key={g.id}
            gap={g}
            resolving={resolvingIds.has(g.id)}
            showExemptPanel={pendingExempt === g.id}
            onIgnore={() => onIgnore(g)}
            onRequestExempt={() => onRequestExempt(g.id)}
            onConfirmExempt={() => onConfirmExempt(g)}
            onCancelExempt={onCancelExempt}
          />
        ))}
      </div>
    </div>
  );
}

// ── Gap Card (v3: two-step exempt with Obsidian guidance) ──

function GapCard({
  gap, resolving, showExemptPanel,
  onIgnore, onRequestExempt, onConfirmExempt, onCancelExempt,
}: {
  gap: GapItem;
  resolving: boolean;
  showExemptPanel: boolean;
  onIgnore: () => void;
  onRequestExempt: () => void;
  onConfirmExempt: () => void;
  onCancelExempt: () => void;
}) {
  const style = GAP_SEVERITY_STYLE[gap.severity];
  const label = GAP_TYPE_LABEL[gap.type] || GOVERNANCE_TODO_COPY.UNREGISTERED_GAP_TYPE;
  const guidance = gapGuidance(gap);
  const quickAction = GAP_QUICK_ACTION[gap.type];
  const frontmatterSnippet = EXEMPT_FRONTMATTER[gap.type] || `exempt_rules: [${gap.type}]`;

  return (
    <div className={`rounded-lg border px-4 py-3 ${style.border} ${style.bg}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`rounded px-1.5 py-0.5 text-kg-xs font-medium ${style.badge}`}>{label}</span>
        {gap.edgeInfo && (
          <span className="font-mono text-kg-xs text-text-hint">{gap.edgeInfo.from} → {gap.edgeInfo.to}</span>
        )}
      </div>

      <p className="text-xs text-text-sub">{gap.detail}</p>

      {/* Guidance */}
      {(guidance || quickAction) && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-surface-hover/50 px-2.5 py-1.5 text-kg-xs text-text-hint">
          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-status-warn-11" />
          <div className="flex-1">
            <span>{guidance}</span>
            {quickAction && (
              <p className="mt-1 text-kg-xs text-blue-11 font-mono">{GOVERNANCE_TODO_COPY.QUICK_ACTION_PREFIX}{quickAction.injectSyntax}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Two-step exempt confirmation panel ── */}
      {showExemptPanel && (
        <div className="mt-3 rounded-md ring-1 ring-status-warn-6 bg-status-warn-2 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-status-warn">{GOVERNANCE_TODO_COPY.EXEMPT_PANEL_TITLE}</p>
            <button onClick={onCancelExempt} className="text-text-hint hover:text-text-sub"><X className="h-3 w-3" /></button>
          </div>

          <div className="space-y-2 text-kg-xs text-text-hint">
            <p>
              {GOVERNANCE_TODO_COPY.EXEMPT_INTRO_LEAD}<strong className="text-text-sub">{GOVERNANCE_TODO_COPY.EXEMPT_INTRO_NOT_DEFECT}</strong>{GOVERNANCE_TODO_COPY.EXEMPT_INTRO_MIDDLE}<strong className="text-status-warn">{GOVERNANCE_TODO_COPY.EXEMPT_INTRO_TRACEABLE}</strong>{GOVERNANCE_TODO_COPY.EXEMPT_INTRO_TAIL}
            </p>

            <div className="rounded bg-surface-hover/70 px-2.5 py-2 space-y-1.5">
              <p className="text-text-sub font-medium">{GOVERNANCE_TODO_COPY.EXEMPT_STEP_OPEN}</p>
              {gap.filePath ? (
                <ObsidianLink sourcePath={gap.filePath} className="inline-flex items-center gap-1 text-purple-11 hover:text-purple-3 underline">
                  <ExternalLink className="h-3 w-3" />
                  {gap.filePath}
                </ObsidianLink>
              ) : (
                <span className="text-text-hint">{GOVERNANCE_TODO_COPY.EXEMPT_NO_SOURCE_FILE}</span>
              )}

              <p className="text-text-sub font-medium mt-1.5">{GOVERNANCE_TODO_COPY.EXEMPT_STEP_DECLARE}</p>
              <code className="block rounded bg-surface-card px-2 py-1 font-mono text-xs text-status-fact-11 select-all">
                {frontmatterSnippet}
              </code>
              <p className="text-text-hint leading-relaxed">
                {GOVERNANCE_TODO_COPY.EXEMPT_YAML_LEAD}<code>---</code>{GOVERNANCE_TODO_COPY.EXEMPT_YAML_BETWEEN}<br />
                {GOVERNANCE_TODO_COPY.EXEMPT_EXISTING_LEAD}<code>exempt_rules:</code>{GOVERNANCE_TODO_COPY.EXEMPT_EXISTING_APPEND}<code>exempt_rules: [old_rule, {gap.type}]</code>
              </p>

              <p className="text-text-sub font-medium mt-1.5">{GOVERNANCE_TODO_COPY.EXEMPT_STEP_SAVE}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCancelExempt} className="rounded px-2.5 py-1 text-kg-xs text-text-hint hover:text-text-sub">{TERM.CANCEL_ACTION}</button>
            <button
              onClick={onConfirmExempt}
              disabled={resolving}
              className="rounded px-3 py-1 text-kg-xs font-medium bg-status-warn-3 text-status-warn ring-1 ring-status-warn-6 hover:bg-amber-5 transition disabled:opacity-50"
            >
              {resolving ? GOVERNANCE_TODO_COPY.PROCESSING : GOVERNANCE_TODO_COPY.EXEMPT_CONFIRM_ACTION}
            </button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="mt-3 flex items-center justify-end gap-2">
        {gap.filePath && (
          <ObsidianLink
            sourcePath={gap.filePath}
            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-kg-xs font-medium bg-purple-3 text-purple-11 ring-1 ring-purple-7 hover:bg-purple-4 transition"
          >
            <ExternalLink className="h-3 w-3" />
            {GOVERNANCE_TODO_COPY.FIX_IN_OBSIDIAN}
          </ObsidianLink>
        )}

        <button
          onClick={onRequestExempt}
          disabled={resolving || showExemptPanel}
          className="rounded px-2.5 py-1 text-kg-xs text-status-warn-11 hover:bg-amber-3 hover:text-amber-11 transition disabled:opacity-50"
        >
          {GOVERNANCE_TODO_COPY.EXEMPT_ACTION}
        </button>

        <button
          onClick={onIgnore}
          disabled={resolving}
          className="rounded px-2.5 py-1 text-kg-xs text-text-hint hover:bg-surface-hover/50 hover:text-text-sub transition disabled:opacity-50"
        >
          {resolving ? GOVERNANCE_TODO_COPY.PROCESSING : GOVERNANCE_TODO_COPY.IGNORE_ACTION}
        </button>
      </div>
    </div>
  );
}

