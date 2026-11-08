import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { TokenInput } from "@/components/entity-repair";
import { FilterSelect } from "@/components/filter-select";
import type { AssertionPolicyDef, AssertionPolicySelectorOptions } from "../schema-manager-types";
import { POLICY_COPY } from "../schema-manager-copy";

type Props = {
  relationId: string;
  policies: AssertionPolicyDef[] | undefined;
  selectorOptions: AssertionPolicySelectorOptions;
  disabled: boolean;
  onChange: (policies: AssertionPolicyDef[]) => void;
};

function assertionPolicyIsIncomplete(policy: AssertionPolicyDef) {
  const neverPublished = policy.decision_mode === "derived_only" || policy.decision_mode === "forbidden";
  return !policy.source_kind
    || !policy.producer
    || !policy.decision_mode
    || !policy.working_projection
    || (!neverPublished && policy.required_evidence.length === 0)
    || (policy.working_projection === "approved_only" && policy.formal_consumers.length === 0)
    || (policy.working_projection === "never" && policy.formal_consumers.length > 0);
}

function optionList(values: string[], group: string) {
  return values.map((value) => ({ value, label: value, group }));
}

export function AssertionPolicyEditor({ relationId, policies = [], selectorOptions, disabled, onChange }: Props) {
  const incompleteCount = policies.filter(assertionPolicyIsIncomplete).length;
  const update = (index: number, patch: Partial<AssertionPolicyDef>) => {
    onChange(policies.map((policy, policyIndex) => policyIndex === index ? { ...policy, ...patch } : policy));
  };
  const addPolicy = () => {
    const decisionMode = selectorOptions.decisionModes.includes("reviewed") ? "reviewed" : selectorOptions.decisionModes[0];
    const workingProjection = selectorOptions.workingProjections.includes("approved_only") ? "approved_only" : selectorOptions.workingProjections[0];
    onChange([...policies, {
      source_kind: selectorOptions.sourceKinds[0] || "",
      producer: selectorOptions.producers[0] || "",
      decision_mode: (decisionMode || "reviewed") as AssertionPolicyDef["decision_mode"],
      required_evidence: [],
      working_projection: (workingProjection || "approved_only") as AssertionPolicyDef["working_projection"],
      formal_consumers: [],
    }]);
  };

  return (
    <section aria-label={`${relationId}${POLICY_COPY.SECTION_ARIA_SUFFIX}`} className="space-y-2 rounded-md bg-surface-root/50 p-3 ring-1 ring-border-thin/60">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-text-main">{POLICY_COPY.HEADER} · {policies.length}</h4>
          {policies.length === 0 && <p role="alert" className="mt-1 flex items-center gap-1 text-xs text-status-error"><AlertTriangle className="h-3 w-3" />{POLICY_COPY.EMPTY_ALERT}</p>}
          {policies.length > 0 && incompleteCount > 0 && <p role="alert" className="mt-1 flex items-center gap-1 text-xs text-status-error"><AlertTriangle className="h-3 w-3" />{POLICY_COPY.INCOMPLETE_ALERT_PREFIX}{incompleteCount}{POLICY_COPY.INCOMPLETE_ALERT_SUFFIX}</p>}
        </div>
        <button type="button" onClick={addPolicy} disabled={disabled} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-sub ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40">
          <Plus className="h-3 w-3" />{POLICY_COPY.ADD_ACTION}
        </button>
      </div>

      {policies.map((policy, index) => (
        <div key={`${policy.source_kind}:${policy.producer}:${index}`} className="space-y-3 rounded-md bg-surface-card p-3 ring-1 ring-border-thin">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-sub">{POLICY_COPY.ITEM_PREFIX}{index + 1}</span>
            <button type="button" aria-label={`${POLICY_COPY.DELETE_ARIA_PREFIX}${index + 1}`} onClick={() => onChange(policies.filter((_, policyIndex) => policyIndex !== index))} disabled={disabled} className="rounded p-1 text-text-hint hover:bg-red-3 hover:text-red-11 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-text-hint">{POLICY_COPY.LABEL_SOURCE_KIND}
              <FilterSelect ariaLabel={POLICY_COPY.ITEM_ARIA(index + 1, POLICY_COPY.LABEL_SOURCE_KIND)} title={POLICY_COPY.SOURCE_PICK_TITLE} searchPlaceholder={POLICY_COPY.SOURCE_FILTER_PLACEHOLDER} value={policy.source_kind} onValueChange={(value) => update(index, { source_kind: value as string })} disabled={disabled} className="w-full" options={optionList(selectorOptions.sourceKinds, POLICY_COPY.GROUP_SERVER_VALUES)} />
            </label>
            <label className="space-y-1 text-xs text-text-hint">{POLICY_COPY.LABEL_PRODUCER}
              <FilterSelect ariaLabel={POLICY_COPY.ITEM_ARIA(index + 1, POLICY_COPY.LABEL_PRODUCER)} title={POLICY_COPY.PRODUCER_PICK_TITLE} searchPlaceholder={POLICY_COPY.PRODUCER_FILTER_PLACEHOLDER} value={policy.producer} onValueChange={(value) => update(index, { producer: value as string })} disabled={disabled} className="w-full" options={optionList(selectorOptions.producers, POLICY_COPY.GROUP_SERVER_VALUES)} />
            </label>
            <label className="space-y-1 text-xs text-text-hint">{POLICY_COPY.LABEL_DECISION_MODE}
              <FilterSelect ariaLabel={POLICY_COPY.ITEM_ARIA(index + 1, POLICY_COPY.LABEL_DECISION_MODE)} title={POLICY_COPY.DECISION_PICK_TITLE} value={policy.decision_mode} onValueChange={(value) => update(index, { decision_mode: value as AssertionPolicyDef["decision_mode"] })} disabled={disabled} className="w-full" options={optionList(selectorOptions.decisionModes, POLICY_COPY.GROUP_SERVER_VALUES)} />
            </label>
            <label className="space-y-1 text-xs text-text-hint">{POLICY_COPY.LABEL_WORKING_PROJECTION}
              <FilterSelect ariaLabel={POLICY_COPY.ITEM_ARIA(index + 1, POLICY_COPY.LABEL_WORKING_PROJECTION)} title={POLICY_COPY.PROJECTION_PICK_TITLE} value={policy.working_projection} onValueChange={(value) => update(index, { working_projection: value as AssertionPolicyDef["working_projection"] })} disabled={disabled} className="w-full" options={optionList(selectorOptions.workingProjections, POLICY_COPY.GROUP_SERVER_VALUES)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-xs text-text-hint">{POLICY_COPY.LABEL_REQUIRED_EVIDENCE}</span><TokenInput ariaLabel={POLICY_COPY.ITEM_ARIA(index + 1, POLICY_COPY.LABEL_REQUIRED_EVIDENCE)} values={policy.required_evidence} onChange={(required_evidence) => update(index, { required_evidence })} placeholder={POLICY_COPY.EVIDENCE_PLACEHOLDER} disabled={disabled} /></div>
            <div><span className="text-xs text-text-hint">{POLICY_COPY.LABEL_FORMAL_CONSUMERS}</span><TokenInput ariaLabel={POLICY_COPY.ITEM_ARIA(index + 1, POLICY_COPY.LABEL_FORMAL_CONSUMERS)} values={policy.formal_consumers} onChange={(formal_consumers) => update(index, { formal_consumers })} placeholder={POLICY_COPY.CONSUMERS_PLACEHOLDER} disabled={disabled} /></div>
          </div>
        </div>
      ))}
    </section>
  );
}
