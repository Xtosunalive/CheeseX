// OntologyEditor — editable node_types + relation_types, read-only inference_rules + constraints
import { TERM } from "@/constants/term-const";
import { ONTOLOGY_COPY, smCountedLabel } from "./schema-manager-copy";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Plus } from "lucide-react";
import type { AssertionPolicySelectorOptions, NodeTypeDef, RelationTypeDef, SaveStatus, OntologyConstraint } from "./schema-manager-types";
import { LAYER_COLOR_MAP } from "./schema-manager-types";

// seq193：约束 severity 查表（键=OntologyConstraint["severity"] 单源 union），消除无锚字面量比较（seq182 修法同款）。
const CONSTRAINT_SEV_STYLE: Record<OntologyConstraint["severity"], { cls: string; label: string }> = {
  error: { cls: "bg-status-error-3 text-status-error", label: ONTOLOGY_COPY.SEV_ERROR },
  warning: { cls: "bg-status-warn-2 text-status-warn", label: ONTOLOGY_COPY.SEV_WARNING },
};
import { DEFAULT_COLOR } from "@/lib/topology-types";
import { FilterSelect } from "@/components/filter-select";
import { DataTable } from "@/components/data-table/DataTable";
import { rowActionColumn } from "@/components/data-table/row-action-column";
import type { Column } from "@/components/data-table/types";
import { RelationConstraintMatrix } from "./components";
import { AssertionPolicyEditor } from "./components/AssertionPolicyEditor";

interface OntologyEditorProps {
  nodeTypes: Record<string, NodeTypeDef>;
  relationTypes: Record<string, RelationTypeDef>;
  inferenceRules: Array<{ name: string; description: string; pattern: string; output: string }>;
  constraints: Array<OntologyConstraint>;
  onNodeTypesChange: (nodeTypes: Record<string, NodeTypeDef>) => void;
  onRelationTypesChange: (relationTypes: Record<string, RelationTypeDef>) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  disabled: boolean;
  selectorOptions: AssertionPolicySelectorOptions;
}

export function OntologyEditor({
  nodeTypes, relationTypes, inferenceRules, constraints,
  onNodeTypesChange, onRelationTypesChange,
  saveStatus, saveError, disabled, selectorOptions,
}: OntologyEditorProps) {
  const allNodeKeys = Object.keys(nodeTypes);
  const allRelationKeys = Object.keys(relationTypes);
  const directionLabel = (direction: string) => direction === "directed" ? ONTOLOGY_COPY.DIRECTION_DIRECTED : direction === "bidirectional" ? ONTOLOGY_COPY.DIRECTION_BIDIRECTIONAL : direction || ONTOLOGY_COPY.DIRECTION_UNSET;

  return (
    <div className="space-y-6">
      {/* ── Save status bar — save via top-level header button ── */}
      <div className="flex items-center gap-3">
        {saveStatus === "dirty" && (
          <span className="flex items-center gap-1 text-xs text-status-warn">
            <AlertTriangle className="h-3 w-3" />{ONTOLOGY_COPY.UNSAVED_CHANGES}
          </span>
        )}
        {saveStatus === "saved" && (
          <span className="flex items-center gap-1 text-xs text-status-fact">
            <CheckCircle2 className="h-3 w-3" />{TERM.SAVED}
          </span>
        )}
        {saveStatus === "saving" && (
          <span className="flex items-center gap-1 text-xs text-text-sub">
            <Loader2 className="h-3 w-3 animate-spin" />{ONTOLOGY_COPY.SAVING}
          </span>
        )}
        {saveStatus === "error" && saveError && (
          <span className="text-xs text-status-error">{saveError}</span>
        )}
      </div>

      {/* ── 1. Node Types (editable) ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">
            {ONTOLOGY_COPY.NODE_TYPES_HEADER} · {allNodeKeys.length}
          </h3>
          <button
            onClick={() => {
              const next = { ...nodeTypes };
              next[""] = { description: "", category: "", color: "gray", icon: "box", allows_relations: [] };
              onNodeTypesChange(next);
            }}
            disabled={disabled}
            className="flex items-center gap-1 rounded-lg bg-surface-hover px-2 py-1 text-xs text-text-main/80 hover:bg-surface-root disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />{ONTOLOGY_COPY.ADD_ACTION}
          </button>
        </div>
        <NodeTypeTable nodeTypes={nodeTypes} relationTypes={relationTypes} onChange={onNodeTypesChange} disabled={disabled} />
      </section>

      {/* ── 2. Relation Types (editable) ── */}
      <section className="space-y-3">
        <RelationConstraintMatrix relationTypes={relationTypes} nodeTypes={nodeTypes} onSelectRelation={(relationId) => document.getElementById(`relation-type-${relationId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">
            {ONTOLOGY_COPY.RELATION_TYPES_HEADER} · {allRelationKeys.length}
          </h3>
          <button
            onClick={() => {
              const next = { ...relationTypes };
              next[""] = {
                description: "", direction: "", weight_default: 0.5, weight_range: [0.1, 1.0],
                versionable: false, source_types: [], target_types: [], label_cn: "", assertion_policies: [],
              };
              onRelationTypesChange(next);
            }}
            disabled={disabled}
            className="flex items-center gap-1 rounded-lg bg-surface-hover px-2 py-1 text-xs text-text-main/80 hover:bg-surface-root disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />{ONTOLOGY_COPY.ADD_ACTION}
          </button>
        </div>
                <RelationTypeTable relationTypes={relationTypes} nodeTypes={nodeTypes} allNodeKeys={allNodeKeys} directionLabel={directionLabel} selectorOptions={selectorOptions} onChange={onRelationTypesChange} disabled={disabled} />
      </section>

      {/* ── 3. Inference Rules (read-only) ── */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-hint">
          <Lock className="h-3 w-3" />{ONTOLOGY_COPY.INFERENCE_TITLE} · {inferenceRules.length}
        </h3>
        {inferenceRules.length === 0 ? (
          <p className="text-xs text-text-placeholder">{ONTOLOGY_COPY.INFERENCE_EMPTY}</p>
        ) : (
          inferenceRules.map((rule, idx) => (
            <div key={idx} className="rounded-lg ring-1 ring-border-thin/60 bg-surface-card/50 p-3">
              <div className="text-sm font-semibold text-text-main/80">{ONTOLOGY_COPY.INFERENCE_TITLE} {idx + 1}</div>
              <p className="mt-1 text-xs text-text-hint">{rule.description || ONTOLOGY_COPY.INFERENCE_FALLBACK_DESC}</p>
            </div>
          ))
        )}
      </section>

      {/* ── 4. Constraints (read-only) ── */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-hint">
          <Lock className="h-3 w-3" />{ONTOLOGY_COPY.CONSTRAINTS_HEADER} · {constraints.length}
        </h3>
        {constraints.length === 0 ? (
          <p className="text-xs text-text-placeholder">{ONTOLOGY_COPY.CONSTRAINTS_EMPTY}</p>
        ) : (
          constraints.map((c, idx) => (
            <div key={idx} className="rounded-lg ring-1 ring-border-thin/60 bg-surface-card/50 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${CONSTRAINT_SEV_STYLE[c.severity].cls}`}>
                  {CONSTRAINT_SEV_STYLE[c.severity].label}
                </span>
              </div>
              <p className="text-xs text-text-hint">{c.description}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

// ── Sub-components ──

function NodeTypeTable({
  nodeTypes, relationTypes, onChange, disabled,
}: {
  nodeTypes: Record<string, NodeTypeDef>; relationTypes: Record<string, RelationTypeDef>;
  onChange: (next: Record<string, NodeTypeDef>) => void; disabled: boolean;
}) {
  // 批7：卡列表 → DataTable 展开行（行=卡头语义，展开区=卡身表单原样）
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  type Row = { key: string; value: NodeTypeDef };
  const rows: Row[] = Object.entries(nodeTypes).map(([key, value]) => ({ key, value }));
  const columns: Array<Column<Row>> = [
    { key: "name", title: ONTOLOGY_COPY.COL_TYPE, render: (row) => (
      <span className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: LAYER_COLOR_MAP[row.value.color] || DEFAULT_COLOR }} aria-hidden />
        <span className="text-sm font-semibold text-text-main">{row.key === "" ? ONTOLOGY_COPY.NEW_NODE_TYPE : row.value.description || ONTOLOGY_COPY.UNNAMED_NODE_TYPE}</span>
      </span>) },
    { key: "category", title: ONTOLOGY_COPY.COL_CATEGORY, width: 150, render: (row) => (
      <span className="rounded bg-surface-hover px-1.5 py-0.5 text-xs text-text-sub">{row.value.category || ONTOLOGY_COPY.CATEGORY_UNSET}</span>) },
    { key: "relations", title: ONTOLOGY_COPY.COL_RELATIONS, width: 100, render: (row) => (
      <span className="text-xs text-text-placeholder">{smCountedLabel(row.value.allows_relations.length, ONTOLOGY_COPY.UNIT_RELATIONS)}</span>) },
    rowActionColumn<Row>({ label: TERM.DELETE_ACTION, danger: true, disabled, onRun: (row) => {
      const next = { ...nodeTypes };
      delete next[row.key];
      onChange(next);
    } }),
  ];
  return (
    <DataTable
      ariaLabel={ONTOLOGY_COPY.NODE_TABLE_ARIA}
      columns={columns}
      rows={rows}
      rowKey={(row) => `node-${row.key || "__new__"}`}
      density="sm"
      expandable={{
        rowExpanded: (row) => expandedKey === row.key,
        onToggle: (row) => setExpandedKey(expandedKey === row.key ? null : row.key),
        render: (row) => (
          <div className="p-2" onClick={(e) => e.stopPropagation()}>
            <NodeTypeCardBody
              nodeKey={row.key} value={row.value} relationTypes={relationTypes}
              onChange={(newKey, newValue) => {
                const next = { ...nodeTypes };
                if (newKey !== row.key) delete next[row.key];
                next[newKey] = newValue;
                onChange(next);
              }}
              disabled={disabled}
            />
          </div>
        ),
      }}
    />
  );
}

function NodeTypeCardBody({
  nodeKey, value, relationTypes, onChange, disabled,
}: {
  nodeKey: string; value: NodeTypeDef; relationTypes: Record<string, RelationTypeDef>;
  onChange: (key: string, value: NodeTypeDef) => void; disabled: boolean;
}) {
  const isNew = nodeKey === "";
  return (
    <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {isNew && <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_KEY}</label>
              <input value={nodeKey} onChange={(e) => onChange(e.target.value, value)}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main disabled:opacity-50"
                placeholder={ONTOLOGY_COPY.PLACEHOLDER_KEY} />
            </div>}
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_DESC}</label>
              <input value={value.description} onChange={(e) => onChange(nodeKey, { ...value, description: e.target.value })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main"
                placeholder={ONTOLOGY_COPY.PLACEHOLDER_DESC} />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_CATEGORY}</label>
              <input value={value.category} onChange={(e) => onChange(nodeKey, { ...value, category: e.target.value })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main"
                placeholder={ONTOLOGY_COPY.PLACEHOLDER_CATEGORY} />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_ICON}</label>
              <input value={value.icon} onChange={(e) => onChange(nodeKey, { ...value, icon: e.target.value })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main"
                placeholder={ONTOLOGY_COPY.PLACEHOLDER_ICON} />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_COLOR}</label>
              <FilterSelect ariaLabel={`${nodeKey}${ONTOLOGY_COPY.COLOR_ARIA_SUFFIX}`} title={ONTOLOGY_COPY.COLOR_PICK_TITLE} searchPlaceholder={ONTOLOGY_COPY.COLOR_FILTER_PLACEHOLDER} value={value.color} onValueChange={(next) => onChange(nodeKey, { ...value, color: next as string })} disabled={disabled} className="h-7 w-full rounded text-xs" options={Object.keys(LAYER_COLOR_MAP).map((color) => ({ value: color, label: color, group: ONTOLOGY_COPY.GROUP_COLOR }))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_ALLOWED_RELATIONS}</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {Object.keys(relationTypes).map((rKey) => {
                const checked = value.allows_relations.includes(rKey);
                return (
                  <button key={rKey} onClick={() => {
                    const next = checked
                      ? value.allows_relations.filter((r) => r !== rKey)
                      : [...value.allows_relations, rKey];
                    onChange(nodeKey, { ...value, allows_relations: next });
                  }}
                  disabled={disabled}
                  className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                    checked ? "ring-1 ring-accent-base bg-status-inferred/10 text-status-inferred" : "ring-1 ring-border-thin text-text-hint hover:ring-1 hover:ring-text-placeholder"
                  }`}
                  >
                    {relationTypes[rKey]?.label_cn || ONTOLOGY_COPY.UNNAMED_RELATION}
                  </button>
                );
              })}
            </div>
          </div>
    </div>
  );
}

function RelationTypeTable({
  relationTypes, nodeTypes, allNodeKeys, directionLabel, selectorOptions, onChange, disabled,
}: {
  relationTypes: Record<string, RelationTypeDef>; nodeTypes: Record<string, NodeTypeDef>; allNodeKeys: string[];
  directionLabel: (direction: string) => string; selectorOptions: AssertionPolicySelectorOptions;
  onChange: (next: Record<string, RelationTypeDef>) => void; disabled: boolean;
}) {
  // 批7：卡列表 → DataTable 展开行；矩阵跳转锚 id=relation-type-* 移到展开区 wrapper（scrollIntoView 消费点不变）
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  type Row = { key: string; value: RelationTypeDef };
  const rows: Row[] = Object.entries(relationTypes).map(([key, value]) => ({ key, value }));
  const columns: Array<Column<Row>> = [
    { key: "name", title: ONTOLOGY_COPY.RELATION_TYPES_HEADER, render: (row) => (
      <span id={`relation-type-${row.key}`} className="text-sm font-semibold text-text-main">{row.key === "" ? ONTOLOGY_COPY.NEW_RELATION_TYPE : row.value.label_cn || ONTOLOGY_COPY.UNNAMED_RELATION}</span>) },
    { key: "direction", title: ONTOLOGY_COPY.COL_DIRECTION, width: 110, render: (row) => (
      <span className="text-xs text-text-placeholder">{directionLabel(row.value.direction)}</span>) },
    { key: "policies", title: ONTOLOGY_COPY.COL_POLICIES, width: 130, render: (row) => (
      <span className={`rounded px-1.5 py-0.5 text-xs ${(row.value.assertion_policies?.length ?? 0) > 0 ? "bg-surface-hover text-text-sub" : "bg-status-error-2 text-status-error"}`}>
        {(row.value.assertion_policies?.length ?? 0) > 0 ? smCountedLabel(row.value.assertion_policies.length, ONTOLOGY_COPY.UNIT_POLICIES) : ONTOLOGY_COPY.POLICY_MISSING}
      </span>) },
    { key: "flags", title: ONTOLOGY_COPY.COL_FLAGS, width: 150, render: (row) => (
      <span className="flex gap-1">
        {row.value.is_legacy && <span className="rounded bg-status-warn-2 px-1 py-0 text-xs text-status-warn">{ONTOLOGY_COPY.FLAG_LEGACY}</span>}
        {row.value.requires_review && <span className="rounded bg-cyan-3 px-1 py-0 text-xs text-status-loading">{ONTOLOGY_COPY.FLAG_NEEDS_REVIEW}</span>}
      </span>) },
    rowActionColumn<Row>({ label: TERM.DELETE_ACTION, danger: true, disabled, onRun: (row) => {
      const next = { ...relationTypes };
      delete next[row.key];
      onChange(next);
    } }),
  ];
  return (
    <DataTable
      ariaLabel={ONTOLOGY_COPY.RELATION_TABLE_ARIA}
      columns={columns}
      rows={rows}
      rowKey={(row) => `rel-${row.key || "__new__"}`}
      density="sm"
      expandable={{
        rowExpanded: (row) => expandedKey === row.key,
        onToggle: (row) => setExpandedKey(expandedKey === row.key ? null : row.key),
        render: (row) => (
          <div className="p-2" onClick={(e) => e.stopPropagation()}>
            <RelationTypeCardBody
              relKey={row.key} value={row.value} allNodeKeys={allNodeKeys} nodeTypes={nodeTypes}
              selectorOptions={selectorOptions}
              onChange={(newKey, newValue) => {
                const next = { ...relationTypes };
                if (newKey !== row.key) delete next[row.key];
                next[newKey] = newValue;
                onChange(next);
              }}
              disabled={disabled}
            />
          </div>
        ),
      }}
    />
  );
}

function RelationTypeCardBody({
  relKey, value, allNodeKeys, nodeTypes, selectorOptions, onChange, disabled,
}: {
  relKey: string; value: RelationTypeDef; allNodeKeys: string[]; nodeTypes: Record<string, NodeTypeDef>;
  selectorOptions: AssertionPolicySelectorOptions;
  onChange: (key: string, value: RelationTypeDef) => void; disabled: boolean;
}) {
  const isNew = relKey === "";
  return (
    <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {isNew && <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_KEY}</label>
              <input value={relKey} onChange={(e) => onChange(e.target.value, value)}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main disabled:opacity-50"
                placeholder={ONTOLOGY_COPY.PLACEHOLDER_KEY} />
            </div>}
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_CN_TAG}</label>
              <input value={value.label_cn} onChange={(e) => onChange(relKey, { ...value, label_cn: e.target.value })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main"
                placeholder={ONTOLOGY_COPY.PLACEHOLDER_CN_TAG} />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_DESC}</label>
              <input value={value.description} onChange={(e) => onChange(relKey, { ...value, description: e.target.value })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main" />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_DIRECTION}</label>
              <input value={value.direction} onChange={(e) => onChange(relKey, { ...value, direction: e.target.value })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main" />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_WEIGHT_DEFAULT}</label>
              <input type="number" step="0.1" min="0" max="1" value={value.weight_default}
                onChange={(e) => onChange(relKey, { ...value, weight_default: parseFloat(e.target.value) || 0 })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main" />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_WEIGHT_MIN}</label>
              <input type="number" step="0.1" min="0" max="1" value={value.weight_range[0]}
                onChange={(e) => onChange(relKey, { ...value, weight_range: [parseFloat(e.target.value) || 0, value.weight_range[1]] })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main" />
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_WEIGHT_MAX}</label>
              <input type="number" step="0.1" min="0" max="1" value={value.weight_range[1]}
                onChange={(e) => onChange(relKey, { ...value, weight_range: [value.weight_range[0], parseFloat(e.target.value) || 1] })}
                disabled={disabled}
                className="w-full rounded ring-1 ring-border-thin bg-surface-card px-2 py-1 text-xs text-text-main" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-text-sub">
              <input type="checkbox" checked={value.versionable}
                onChange={(e) => onChange(relKey, { ...value, versionable: e.target.checked })}
                disabled={disabled} className="rounded ring-border-thin bg-surface-card" />
              {ONTOLOGY_COPY.CHECK_VERSIONABLE}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text-sub">
              <input type="checkbox" checked={value.requires_review || false}
                onChange={(e) => onChange(relKey, { ...value, requires_review: e.target.checked })}
                disabled={disabled} className="rounded ring-border-thin bg-surface-card" />
              {ONTOLOGY_COPY.CHECK_REQUIRES_REVIEW}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text-sub">
              <input type="checkbox" checked={value.is_legacy || false}
                onChange={(e) => onChange(relKey, { ...value, is_legacy: e.target.checked })}
                disabled={disabled} className="rounded ring-border-thin bg-surface-card" />
              {ONTOLOGY_COPY.CHECK_IS_LEGACY}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_SOURCE_TYPES}</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {allNodeKeys.map((nKey) => {
                  const checked = value.source_types.includes(nKey);
                  return (
                    <button key={nKey} onClick={() => {
                      const next = checked ? value.source_types.filter((s) => s !== nKey) : [...value.source_types, nKey];
                      onChange(relKey, { ...value, source_types: next });
                    }}
                    disabled={disabled}
                    className={`rounded px-1.5 py-0.5 text-xs ${checked ? "ring-1 ring-accent-base bg-status-inferred/10 text-status-inferred" : "ring-1 ring-border-thin text-text-hint hover:ring-1 hover:ring-text-placeholder"}`}
                    >{nodeTypes[nKey]?.description || ONTOLOGY_COPY.UNNAMED_NODE_TYPE}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-xs text-text-hint">{ONTOLOGY_COPY.LABEL_TARGET_TYPES}</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {allNodeKeys.map((nKey) => {
                  const checked = value.target_types.includes(nKey);
                  return (
                    <button key={nKey} onClick={() => {
                      const next = checked ? value.target_types.filter((t) => t !== nKey) : [...value.target_types, nKey];
                      onChange(relKey, { ...value, target_types: next });
                    }}
                    disabled={disabled}
                    className={`rounded px-1.5 py-0.5 text-xs ${checked ? "ring-1 ring-accent-base bg-status-inferred/10 text-status-inferred" : "ring-1 ring-border-thin text-text-hint hover:ring-1 hover:ring-text-placeholder"}`}
                    >{nodeTypes[nKey]?.description || ONTOLOGY_COPY.UNNAMED_NODE_TYPE}</button>
                  );
                })}
              </div>
            </div>
          </div>
          <AssertionPolicyEditor
            relationId={relKey || ONTOLOGY_COPY.NEW_RELATION_TYPE}
            policies={value.assertion_policies}
            selectorOptions={selectorOptions}
            disabled={disabled}
            onChange={(assertion_policies) => onChange(relKey, { ...value, assertion_policies })}
          />
    </div>
  );
}

