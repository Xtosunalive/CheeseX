import { ExternalLink, FileText, Wrench } from "lucide-react";
import { freshnessView } from "./freshness";
import { ObsidianLink } from "@/components/obsidian";
import { buildAnomalyHandoffHash } from "@/lib/domain/anomaly-handoff";
import type { RelationOverviewData } from "./index";
import { safeNavigateHash } from "@/lib/navigation";
import {
  IMPACT_SHARED_COPY,
  RELATION_OVERVIEW_COPY,
  RELATION_REASON_LABELS,
  relationSourceLineSuffix,
  relationVersionRangeBoth,
  relationVersionRangeSince,
  relationVersionRangeUntil,
} from "../../impact-analysis-copy";

function hashLabel(value: string | null | undefined) {
  if (!value) return IMPACT_SHARED_COPY.UNRECORDED;
  return value.length > 24 ? `${value.slice(0, 20)}...` : value;
}

function versionRange(relation: RelationOverviewData) {
  if (relation.since && relation.until) return relationVersionRangeBoth(relation.since, relation.until);
  if (relation.since) return relationVersionRangeSince(relation.since);
  if (relation.until) return relationVersionRangeUntil(relation.until);
  return RELATION_OVERVIEW_COPY.VERSION_UNBOUNDED;
}

function reasonLabel(reason: string | undefined) {
  return reason ? RELATION_REASON_LABELS[reason] || reason : RELATION_OVERVIEW_COPY.REASON_FALLBACK;
}

export function RelationOverview({ relation, defaultOpen = false }: { relation: RelationOverviewData; defaultOpen?: boolean }) {
  const view = freshnessView(relation.freshness);
  const Icon = view.Icon;
  const canOpenSource = relation.sourcePath && relation.sourcePath !== ".ledger/master_graph.json";
  const handoff = buildAnomalyHandoffHash({
    objectKind: "relation",
    objectId: relation.edgeId,
    sourcePath: relation.sourcePath,
    sourceLine: relation.sourceLine || undefined,
    relationSource: relation.source,
    relationTarget: relation.target,
    relationType: relation.relationType,
    releaseId: relation.releaseId,
    sourceCommit: relation.sourceCommit,
  });
  return <details open={defaultOpen} className="border-t border-border-thin px-4 py-2 text-xs text-text-sub">
    <summary className="cursor-pointer select-none text-text-hint hover:text-text-main">{RELATION_OVERVIEW_COPY.SUMMARY}</summary>
    <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <div><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_SOURCE}</dt><dd className="mt-1 flex items-start gap-1.5 break-all text-text-main"><FileText className="mt-0.5 h-4 w-4 shrink-0" />{canOpenSource ? <ObsidianLink className="hover:underline" sourcePath={relation.sourcePath!}>{relation.sourcePath}<ExternalLink className="ml-1 inline h-3 w-3" /></ObsidianLink> : relation.sourcePath || IMPACT_SHARED_COPY.UNRECORDED}{relation.sourceLine ? relationSourceLineSuffix(relation.sourceLine) : ""}</dd></div>
      <div><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_VERSION_RANGE}</dt><dd className="mt-1 text-text-main">{versionRange(relation)}</dd></div>
      <div><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_REASON}</dt><dd className="mt-1 text-text-main">{reasonLabel(relation.reason)}</dd></div>
      <div><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_DECISION}</dt><dd className="mt-1 text-text-main">{relation.decision || IMPACT_SHARED_COPY.UNRECORDED}</dd></div>
      <div><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_EVIDENCE_HASH}</dt><dd className="mt-1 font-mono text-text-main" title={relation.evidenceHash || ""}>{hashLabel(relation.evidenceHash)}</dd></div>
      <div><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_SOURCE_HASH}</dt><dd className="mt-1 font-mono text-text-main" title={relation.sourceHash || ""}>{hashLabel(relation.sourceHash)}</dd></div>
      <div className="sm:col-span-2"><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_FRESHNESS}</dt><dd className={`mt-1 inline-flex items-center gap-1.5 ${view.tone}`}><Icon className="h-4 w-4" />{view.label}，{view.detail}</dd></div>
      {(relation.releaseId || relation.sourceCommit) && <div className="sm:col-span-2"><dt className="text-text-hint">{RELATION_OVERVIEW_COPY.DT_RELEASE}</dt><dd className="mt-1 break-all font-mono text-text-main">{relation.releaseId || IMPACT_SHARED_COPY.UNRECORDED}<br />{relation.sourceCommit || IMPACT_SHARED_COPY.UNRECORDED}</dd></div>}
    </dl>
    <button type="button" className="mt-3 inline-flex items-center gap-1 text-xs text-text-sub hover:text-text-main" onClick={() => { safeNavigateHash(handoff); }}><Wrench className="h-4 w-4" />{RELATION_OVERVIEW_COPY.ANOMALY_HANDOFF_ACTION}</button>
  </details>;
}
