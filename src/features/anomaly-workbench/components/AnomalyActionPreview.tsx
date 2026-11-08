import { ArrowRight, FilePenLine, ShieldCheck } from "lucide-react";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { actionLabel, anomalyActionTarget, expectedRevisionCount, fieldLabel, record, valueLabel, anomalyEffectLabel, ANOMALY_ACTION_PREVIEW_COPY, ANOMALY_VALUE_PLACEHOLDER_COPY, actionPreviewEvidenceText, actionPreviewWillUpdateText, actionPreviewRelationSourceText, actionPreviewArticleMappingText, actionPreviewDecisionReasonText, actionPreviewPrePostCheckText } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { safeNavigateHash } from "@/lib/navigation";
import { Panel } from "@/components/panel";

// 关系结论效果正名收编 copy 闭集（WP-150，anomalyEffectLabel）；本文件旧别名删除
const bodyPatchRemovedState = (value: string) => value === ANOMALY_VALUE_PLACEHOLDER_COPY.EMPTY || value === ANOMALY_VALUE_PLACEHOLDER_COPY.EMPTY_LIST;

export function AnomalyActionPreview({ issue }: { issue: AnomalyIssue }) {
  const target = anomalyActionTarget(issue);
  const preview = issue.actionPreview;
  const summary = preview?.summary;
  const beforeValues = record(summary?.beforeValues);
  const afterValues = record(summary?.afterValues);
  const changedFields = summary?.changedFields || [];
  const bodyPatch = summary?.bodyPatch;
  const preCheck = summary?.preCheck;
  const postCheck = summary?.postCheck;
  const hasPreview = preview?.accepted === true;
  const previewFields = changedFields.map(fieldLabel);
  const derivedRepair = record(issue.proposedAction).type === "derived-graph-repair";
  const relationGroups = Array.isArray(summary?.relationGroups) ? summary.relationGroups : [];

  return (
    <Panel className="space-y-4" ariaLabel={ANOMALY_ACTION_PREVIEW_COPY.PANEL_ARIA}>
      <div>
        <p className="text-xs font-medium text-text-hint">{ANOMALY_ACTION_PREVIEW_COPY.TITLE}</p>
        <p className="mt-1 text-sm font-semibold text-text-main">{actionLabel(issue)}</p>
        <p className="mt-1 text-xs leading-5 text-text-sub">{derivedRepair ? ANOMALY_ACTION_PREVIEW_COPY.DERIVED_HISTORY_NOTE : ANOMALY_ACTION_PREVIEW_COPY.DEFAULT_NOTE}</p>
      </div>

      {hasPreview ? <>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-surface-hover p-3">
            <div className="flex items-center gap-2 text-text-hint"><FilePenLine className="h-4 w-4" /><p className="text-kg-xs">{ANOMALY_ACTION_PREVIEW_COPY.EVIDENCE_CARD_TITLE}</p></div>
            <p className="mt-1 text-xs text-text-main">{actionPreviewEvidenceText(expectedRevisionCount(issue))}</p>
          </div>
          <div className="rounded-md bg-surface-hover p-3">
            <div className="flex items-center gap-2 text-text-hint"><ShieldCheck className="h-4 w-4" /><p className="text-kg-xs">{ANOMALY_ACTION_PREVIEW_COPY.SAFETY_CARD_TITLE}</p></div>
            <p className="mt-1 text-xs text-text-main">{ANOMALY_ACTION_PREVIEW_COPY.SAFETY_CARD_NOTE}</p>
          </div>
        </div>

        <div className="rounded-md bg-status-fact-2 p-3 ring-1 ring-status-fact-6">
          <p className="text-xs font-medium text-status-fact">{ANOMALY_ACTION_PREVIEW_COPY.PREVIEW_READY_TITLE}</p>
          <p className="mt-1 text-xs text-text-sub">{actionPreviewWillUpdateText(previewFields, actionLabel(issue))}</p>
        </div>

        {derivedRepair && <div className="space-y-3 rounded-md bg-surface-card p-3 ring-1 ring-border-thin">
          <div className="grid gap-2 sm:grid-cols-4">
            <div><p className="text-kg-xs text-text-hint">{ANOMALY_ACTION_PREVIEW_COPY.STAT_UNAPPROVED_ARTICLES}</p><p className="mt-1 text-lg font-semibold text-status-error">{summary?.unapprovedNodeCount ?? "—"}</p></div>
            <div><p className="text-kg-xs text-text-hint">{ANOMALY_ACTION_PREVIEW_COPY.STAT_RELATIONS}</p><p className="mt-1 text-lg font-semibold text-text-main">{summary?.incidentRelationCount ?? "—"}</p></div>
            <div><p className="text-kg-xs text-text-hint">{ANOMALY_ACTION_PREVIEW_COPY.STAT_MISSING_LINEAGE}</p><p className="mt-1 text-lg font-semibold text-status-warn">{summary?.missingLineageCount ?? "—"}</p></div>
            <div><p className="text-kg-xs text-text-hint">{ANOMALY_ACTION_PREVIEW_COPY.STAT_APPROVED_ARTICLES}</p><p className="mt-1 text-lg font-semibold text-text-main">{summary?.approvedArticleCount ?? "—"}</p></div>
          </div>
          {relationGroups.length > 0 && <div className="border-t border-border-thin pt-2"><p className="text-kg-xs text-text-hint">{ANOMALY_ACTION_PREVIEW_COPY.REBUILD_SOURCES_TITLE}</p><div className="mt-2 flex flex-wrap gap-2">{relationGroups.map((item, index) => { const group = record(item); return <span key={`${String(group.source)}-${index}`} className="rounded bg-surface-root px-2 py-1 text-xs text-text-sub">{actionPreviewRelationSourceText(group.source, group.count)}</span>; })}</div></div>}
        </div>}

        {changedFields.length > 0 && Object.keys(afterValues).length > 0 && <div className="space-y-2 rounded-md bg-status-fact-2 p-3 ring-1 ring-status-fact-6">
          <p className="text-xs font-medium text-status-fact">{ANOMALY_ACTION_PREVIEW_COPY.CHANGES_TITLE}</p>
          {changedFields.map((field) => <div key={field} className="grid items-center gap-2 text-xs sm:grid-cols-[100px_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <span className="text-text-hint">{fieldLabel(field)}</span>
            <span className="break-words rounded bg-surface-root px-2 py-1.5 text-text-sub">{valueLabel(beforeValues[field])}</span>
            <ArrowRight className="h-4 w-4 text-text-hint" />
            <span className="break-words rounded bg-status-fact-2 px-2 py-1.5 text-status-fact">{valueLabel(afterValues[field])}</span>
          </div>)}
        </div>}

        {bodyPatch && <div className={`space-y-2 rounded-md p-3 ring-1 ${bodyPatchRemovedState(valueLabel(bodyPatch.after)) ? "bg-status-error-2 ring-status-error-6" : "bg-status-fact-2 ring-status-fact-6"}`}>
          <p className={`text-xs font-medium ${bodyPatchRemovedState(valueLabel(bodyPatch.after)) ? "text-status-error" : "text-status-fact"}`}>{bodyPatchRemovedState(valueLabel(bodyPatch.after)) ? ANOMALY_ACTION_PREVIEW_COPY.BODY_PATCH_REMOVED : ANOMALY_ACTION_PREVIEW_COPY.BODY_PATCH_FIXED}</p>
          <div className="grid gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <span className="break-words rounded bg-surface-root px-2 py-1.5 text-text-sub">{valueLabel(bodyPatch.before)}</span>
            <ArrowRight className="self-center h-4 w-4 text-text-hint" />
            <span className={`break-words rounded px-2 py-1.5 ${bodyPatchRemovedState(valueLabel(bodyPatch.after)) ? "bg-status-error-2 text-ruby-3" : "bg-status-fact-2 text-status-fact"}`}>{bodyPatchRemovedState(valueLabel(bodyPatch.after)) ? ANOMALY_ACTION_PREVIEW_COPY.BODY_PATCH_WILL_REMOVE : valueLabel(bodyPatch.after)}</span>
          </div>
        </div>}

        {summary?.articleTitle && <div className="rounded-md bg-status-fact-2 p-3 text-xs text-status-fact ring-1 ring-status-fact-6">{actionPreviewArticleMappingText(summary.articleTitle, valueLabel(summary.added), valueLabel(summary.removed))}</div>}
        {summary?.selectedEffect && <div className="rounded-md bg-status-fact-2 p-3 text-xs text-status-fact ring-1 ring-status-fact-6"><p>{anomalyEffectLabel(summary.selectedEffect)}</p>{summary.decisionReason && <p className="mt-1 text-status-fact-11">{actionPreviewDecisionReasonText(summary.decisionReason)}</p>}</div>}

        {postCheck && <div className={`rounded-md p-3 text-xs ring-1 ${postCheck.blockerCount > 0 ? "bg-status-error-2 text-status-error ring-status-error-6" : "bg-surface-hover text-text-main ring-border-thin"}`}>
          <p className="font-medium">{ANOMALY_ACTION_PREVIEW_COPY.PRE_CHECK_TITLE}</p>
          <p className="mt-1 text-text-sub">{actionPreviewPrePostCheckText(preCheck ? preCheck.blockerCount : null, postCheck.blockerCount, preCheck ? preCheck.warningCount : null, postCheck.warningCount)}</p>
        </div>}
      </> : <div className="rounded-md bg-surface-hover p-3 text-xs text-text-sub">{ANOMALY_ACTION_PREVIEW_COPY.EMPTY_HINT}</div>}

      {target && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-thin pt-3"><p className="text-xs leading-5 text-text-hint">{target.description}</p><button type="button" onClick={() => { safeNavigateHash(target.hash); }} className="inline-flex items-center gap-1.5 rounded-md bg-accent-bg px-3 py-1.5 text-xs text-text-main ring-1 ring-border-focus"><span>{target.label}</span><ArrowRight className="h-4 w-4" /></button></div>}
    </Panel>
  );
}
