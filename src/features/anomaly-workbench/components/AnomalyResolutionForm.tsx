import { useEffect, useMemo, useState } from "react";
import { EFFECT_LABELS } from "@/lib/domain";
import { ExternalLink, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ObsidianLink } from "@/components/obsidian";
import { ANOMALY_RELATION_REMOVE_PREVIEW_ACTION } from "@/features/anomaly-workbench/anomaly-workbench-api";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { navigate } from "@/lib/navigation";
import { TERM } from "@/constants/term-const";
import { ANOMALY_RESOLUTION_COPY, resolutionEmptyTypeTitle, resolutionComponentCountText, resolutionUnmanagedCandidateText, resolutionMovePageHint, UNMANAGED_ARTICLE_CANDIDATE_PATTERN } from "@/features/anomaly-workbench/anomaly-workbench-copy";

type Props = { issue: AnomalyIssue; onPreview: (payload: Record<string, unknown>) => void };
type Option = { id: string; label: string; version?: string; product?: string; group?: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function options(value: unknown): Option[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const current = record(item);
    return typeof current.id === "string" && typeof current.label === "string"
      ? [{ id: current.id, label: current.label, version: typeof current.version === "string" ? current.version : undefined, product: typeof current.product === "string" ? current.product : undefined }]
      : [];
  });
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function AssociationResolution({ issue, onPreview }: Props) {
  const action = record(issue.proposedAction);
  const isReload = action.type === "article-association-reload";
  const componentOptions = useMemo(() => options(action.componentOptions), [action.componentOptions]);
  const versionOptions = useMemo(() => options(action.versionOptions), [action.versionOptions]);
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [versionIds, setVersionIds] = useState<string[]>([]);
  // 整改3：组件候选按身份分组折叠（group 缺省归「未分组」）+搜索过滤+选中高亮
  const [componentQuery, setComponentQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => { setComponentIds([]); setVersionIds([]); setComponentQuery(""); }, [issue.issueId]);
  if (isReload) return <Button size="sm" variant="outline" onClick={() => onPreview({})}><SearchCheck className="mr-1.5 h-4 w-4" />{ANOMALY_RESOLUTION_COPY.RELOAD_PREVIEW_ACTION}</Button>;
  const filteredComponents = componentQuery.trim()
    ? componentOptions.filter((item) => `${item.id} ${item.label}`.toLowerCase().includes(componentQuery.trim().toLowerCase()))
    : componentOptions;
  const grouped = new Map<string, Option[]>();
  for (const item of filteredComponents) {
    const key = item.group?.trim() || ANOMALY_RESOLUTION_COPY.UNGROUPED_LABEL;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  const toggleComponent = (id: string) => setComponentIds((values) => toggle(values, id));
  return <div className="space-y-3">
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-hint">{resolutionComponentCountText(componentIds.length, componentOptions.length)}</span>
      </div>
      {componentOptions.length > 8 && (
        <input
          aria-label={ANOMALY_RESOLUTION_COPY.COMPONENT_SEARCH_ARIA}
          value={componentQuery}
          onChange={(event) => setComponentQuery(event.target.value)}
          placeholder={ANOMALY_RESOLUTION_COPY.COMPONENT_SEARCH_PLACEHOLDER}
          className="h-8 w-full rounded-md bg-surface-card px-2.5 text-xs text-text-main ring-1 ring-border-thin placeholder:text-text-placeholder focus:outline-none focus:ring-border-focus"
        />
      )}
      <fieldset className="max-h-56 overflow-auto rounded-md bg-surface-card p-3 ring-1 ring-border-thin">
        <legend className="px-1 text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.COMPONENT_GROUP_LEGEND}</legend>
        {[...grouped.entries()].map(([group, items]) => {
          const collapsed = collapsedGroups.has(group);
          return (
            <div key={group} className="mb-1.5 last:mb-0">
              <button
                type="button"
                aria-expanded={!collapsed}
                onClick={() => setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(group)) { next.delete(group); } else { next.add(group); } return next; })}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-kg-xs font-medium text-text-main hover:bg-surface-hover"
              >
                <span aria-hidden className="text-text-hint">{collapsed ? "▸" : "▾"}</span>
                {group}
                <span className="ml-auto tabular-nums text-text-hint">{items.length}</span>
              </button>
              {!collapsed && items.map((item) => (
                <label key={item.id} className={`ml-4 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors ${componentIds.includes(item.id) ? "bg-accent-bg text-text-main ring-1 ring-border-focus" : "text-text-sub hover:bg-surface-hover"}`}>
                  <input type="checkbox" checked={componentIds.includes(item.id)} onChange={() => toggleComponent(item.id)} className="h-3 w-3 accent-[var(--color-accent-base)]" />
                  <span className="min-w-0 flex-1 truncate" title={item.id}>{item.label}</span>
                </label>
              ))}
            </div>
          );
        })}
        {filteredComponents.length === 0 && <p className="px-1 py-2 text-xs text-text-hint">{componentQuery.trim() ? TERM.NO_MATCH_COMPONENT : TERM.EMPTY_COMPONENT_OPTION}</p>}
      </fieldset>
    </div>
    <fieldset className="max-h-40 overflow-auto rounded-md bg-surface-card p-3 ring-1 ring-border-thin"><legend className="px-1 text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.VERSION_FIELDSET_LEGEND}</legend>{versionOptions.length ? versionOptions.map((item) => <label key={item.id} className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors ${versionIds.includes(item.id) ? "bg-accent-bg text-text-main ring-1 ring-border-focus" : "text-text-sub hover:bg-surface-hover"}`}><input type="checkbox" checked={versionIds.includes(item.id)} onChange={() => setVersionIds((values) => toggle(values, item.id))} className="h-3 w-3 accent-[var(--color-accent-base)]" />{item.product} {item.version || item.label}</label>) : <p className="text-xs text-text-hint">{TERM.EMPTY_VERSION_OPTION}</p>}</fieldset>
    <Button size="sm" variant="outline" disabled={componentIds.length === 0 && versionIds.length === 0} onClick={() => onPreview({ action: "add", componentIds, versionIds })}><SearchCheck className="mr-1.5 h-4 w-4" />{ANOMALY_RESOLUTION_COPY.ADD_PREVIEW_ACTION}</Button>
  </div>;
}

function RelationResolution({ issue, onPreview }: Props) {
  const action = record(issue.proposedAction);
  const targetOptions = useMemo(() => options(action.relationTargetOptions), [action.relationTargetOptions]);
  const unresolvedTargets = Array.isArray(action.unresolvedTargets) ? action.unresolvedTargets.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  const unmanagedCandidates = Array.isArray(action.unmanagedCandidates) ? action.unmanagedCandidates.flatMap((item) => {
    const candidate = record(item);
    return typeof candidate.target === "string" && typeof candidate.sourcePath === "string" ? [{ target: candidate.target, sourcePath: candidate.sourcePath }] : [];
  }) : [];
  const articleCandidates = unmanagedCandidates.filter((candidate) => UNMANAGED_ARTICLE_CANDIDATE_PATTERN.test(candidate.sourcePath));
  const otherCandidates = unmanagedCandidates.filter((candidate) => !articleCandidates.includes(candidate));
  const [originalTarget, setOriginalTarget] = useState("");
  const [targetId, setTargetId] = useState("");
  useEffect(() => { setOriginalTarget(""); setTargetId(""); }, [issue.issueId]);
  if (unresolvedTargets.length === 0) return <div className="space-y-3 sm:col-span-2">
    <div className="rounded-md bg-status-warn-2 p-3 text-xs leading-5 text-status-warn ring-1 ring-status-warn-6">
      <p className="font-medium">{resolutionEmptyTypeTitle(action.currentValue)}</p>
      <p className="mt-1 text-status-warn-11">{typeof action.hint === "string" ? action.hint : ANOMALY_RESOLUTION_COPY.EMPTY_TYPE_HINT}</p>
    </div>
    <ObsidianLink sourcePath={typeof action.sourceKey === "string" ? action.sourceKey : ""} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-bg px-3 text-xs text-text-main ring-1 ring-border-focus hover:bg-surface-hover"><ExternalLink className="h-4 w-4" />{ANOMALY_RESOLUTION_COPY.DECLARE_RELATION_ACTION}</ObsidianLink>
  </div>;
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="space-y-1.5"><span className="text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.ORIGINAL_TARGET_LABEL}</span><select aria-label={ANOMALY_RESOLUTION_COPY.ORIGINAL_TARGET_LABEL} value={originalTarget} onChange={(event) => setOriginalTarget(event.target.value)} className="h-9 w-full rounded-md bg-surface-card px-3 text-sm text-text-main ring-1 ring-border-thin"><option value="">{ANOMALY_RESOLUTION_COPY.ORIGINAL_TARGET_PLACEHOLDER}</option>{unresolvedTargets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    <label className="space-y-1.5"><span className="text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.REPLACEMENT_LABEL}</span><select aria-label={ANOMALY_RESOLUTION_COPY.REPLACEMENT_LABEL} value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={targetOptions.length === 0} className="h-9 w-full rounded-md bg-surface-card px-3 text-sm text-text-main ring-1 ring-border-thin disabled:opacity-50"><option value="">{targetOptions.length ? ANOMALY_RESOLUTION_COPY.REPLACEMENT_PLACEHOLDER : ANOMALY_RESOLUTION_COPY.REPLACEMENT_EMPTY}</option>{targetOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    {articleCandidates.length > 0 && <div className="rounded-md bg-status-warn-2 p-3 text-xs leading-5 text-status-warn ring-1 ring-status-warn-6 sm:col-span-2"><p className="font-medium">{ANOMALY_RESOLUTION_COPY.ARTICLE_CANDIDATE_TITLE}</p>{articleCandidates.map((candidate) => <p key={`${candidate.target}-${candidate.sourcePath}`} className="mt-1">{resolutionUnmanagedCandidateText(candidate.target, candidate.sourcePath)}</p>)}<p className="mt-1 text-status-warn-11">{ANOMALY_RESOLUTION_COPY.ARTICLE_CANDIDATE_NOTE}</p></div>}
    {otherCandidates.length > 0 && <div className="rounded-md bg-status-warn-2 p-3 text-xs leading-5 text-status-warn ring-1 ring-status-warn-6 sm:col-span-2"><p className="font-medium">{ANOMALY_RESOLUTION_COPY.OTHER_CANDIDATE_TITLE}</p>{otherCandidates.map((candidate) => <p key={`${candidate.target}-${candidate.sourcePath}`} className="mt-1">{resolutionUnmanagedCandidateText(candidate.target, candidate.sourcePath)}</p>)}<p className="mt-1 text-status-warn-11">{resolutionMovePageHint(String(action.governedEntityDirectory || ANOMALY_RESOLUTION_COPY.GOVERNED_DIRECTORY_FALLBACK))}</p></div>}
    <p className="text-xs leading-5 text-text-hint sm:col-span-2">{ANOMALY_RESOLUTION_COPY.RETARGET_NOTE}</p>
    <div className="flex flex-wrap gap-2 sm:col-span-2">
      <Button size="sm" variant="outline" disabled={!originalTarget || !targetId} onClick={() => onPreview({ relationPatch: { operation: "retarget", originalTarget, targetId } })}><SearchCheck className="mr-1.5 h-4 w-4" />{ANOMALY_RESOLUTION_COPY.RETARGET_ACTION}</Button>
      <Button size="sm" variant="outline" data-action-id={ANOMALY_RELATION_REMOVE_PREVIEW_ACTION.id} data-risk={ANOMALY_RELATION_REMOVE_PREVIEW_ACTION.risk} data-channel={ANOMALY_RELATION_REMOVE_PREVIEW_ACTION.dataChannel} disabled={!originalTarget} onClick={() => onPreview({ relationPatch: { operation: "remove-target", originalTarget } })}><SearchCheck className="mr-1.5 h-4 w-4" />{ANOMALY_RESOLUTION_COPY.REMOVE_OLD_ACTION}</Button>
      <ObsidianLink sourcePath={typeof action.sourceKey === "string" ? action.sourceKey : ""} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent-bg px-3 text-xs text-text-main ring-1 ring-border-focus hover:bg-surface-hover"><ExternalLink className="h-4 w-4" />{ANOMALY_RESOLUTION_COPY.CREATE_OR_FIX_ACTION}</ObsidianLink>
    </div>
  </div>;
}

function ConflictResolution({ issue, onPreview }: Props) {
  const action = record(issue.proposedAction);
  const effects = useMemo(() => [...new Set((Array.isArray(action.conclusions) ? action.conclusions : []).map((item) => record(item).effect).filter((item): item is string => typeof item === "string"))], [action.conclusions]);
  const [selectedEffect, setSelectedEffect] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => { setSelectedEffect(""); setReason(""); }, [issue.issueId]);
  // WP-035：EFFECT 四词单源 lib/domain（seq204「靠约定」的手抄形态退役）
  const labels = EFFECT_LABELS;
  return <div className="space-y-3">
    <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-1 text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.CONCLUSION_LEGEND}</legend>{effects.map((effect) => <label key={effect} className={`flex items-center gap-2 rounded-md p-3 text-xs ring-1 ${selectedEffect === effect ? "bg-accent-bg text-text-main ring-border-focus" : "bg-surface-card text-text-sub ring-border-thin"}`}><input type="radio" name={`effect-${issue.issueId}`} checked={selectedEffect === effect} onChange={() => setSelectedEffect(effect)} />{labels[effect] || ANOMALY_RESOLUTION_COPY.CONCLUSION_FALLBACK}</label>)}</fieldset>
    <label className="block space-y-1.5"><span className="text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.REASON_LABEL}</span><input aria-label={ANOMALY_RESOLUTION_COPY.REASON_LABEL} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={ANOMALY_RESOLUTION_COPY.REASON_PLACEHOLDER} className="h-9 w-full rounded-md bg-surface-card px-3 text-sm text-text-main outline-none ring-1 ring-border-thin placeholder:text-text-placeholder focus:ring-border-focus" /></label>
    <Button size="sm" variant="outline" disabled={!selectedEffect || !reason.trim()} onClick={() => onPreview({ selectedEffect, reason: reason.trim() })}><SearchCheck className="mr-1.5 h-4 w-4" />{ANOMALY_RESOLUTION_COPY.ADJUDICATE_PREVIEW_ACTION}</Button>
  </div>;
}

function DerivedGraphRepairResolution() {
  return <div className="space-y-3">
    <div className="rounded-md bg-surface-card p-3 text-xs leading-5 text-text-sub ring-1 ring-border-thin">
      <p className="font-medium text-text-main">{ANOMALY_RESOLUTION_COPY.DERIVED_REBUILD_TITLE}</p>
      <p className="mt-1">{ANOMALY_RESOLUTION_COPY.DERIVED_REBUILD_NOTE}</p>
    </div>
    <Button size="sm" variant="outline" onClick={() => { navigate("article-workflow"); }}><ExternalLink className="mr-1.5 h-4 w-4" />{ANOMALY_RESOLUTION_COPY.OPEN_ARTICLE_WORKBENCH_ACTION}</Button>
  </div>;
}

export function AnomalyResolutionForm(props: Props) {
  // 阻断提示自 DecisionPanel 迁入（2026-10-16 死件退役批）：阻断态说明为何确认被停
  if (props.issue.status === "blocked") {
    return (
      <div className="space-y-2">
        <p className="text-xs leading-5 text-status-warn">{ANOMALY_RESOLUTION_COPY.BLOCKED_NOTICE}</p>
        <ResolutionBody {...props} />
      </div>
    );
  }
  return <ResolutionBody {...props} />;
}

function ResolutionBody(props: Props) {
  const action = record(props.issue.proposedAction);
  if (action.type === "entity-repair") return <p className="text-xs text-text-hint">{ANOMALY_RESOLUTION_COPY.ENTITY_REPAIR_HINT}</p>;
  if (action.type === "entity-relation-repair") return <RelationResolution {...props} />;
  if (["article-association", "article-association-reload"].includes(String(action.type))) return <AssociationResolution {...props} />;
  if (action.type === "inference-review") return <ConflictResolution {...props} />;
  if (action.type === "derived-graph-repair") return <DerivedGraphRepairResolution />;
  return <p className="text-xs text-status-warn">{ANOMALY_RESOLUTION_COPY.NO_ACTION_FALLBACK}</p>;
}
