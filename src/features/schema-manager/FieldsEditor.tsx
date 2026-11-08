// FieldsEditor（ADR-008 D2 / SPEC-017 W4）——字段字典编辑面。
// 数据：GET/PUT /api/schema/fields（fields-write-service 三件套：严格校验/哈希乐观锁/快照）。
// 投影联动：保存成功即服务端重生成 entity-frontmatter-schema.md（projectionSynced 回执）。
// SCHEMA-IA-001 批6：自研 grid 行 → DataTable 语义表 + EditableCell 行内编辑（形态归一；
// 值域跳转/勾选 scope 语义原样保留；测试面零耦合已核实）。
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { TERM } from "@/constants/term-const";
import { apiFetchEnvelope } from "@/lib/api";
import { FIELDS_COPY, smFieldsSummary, smRebuildNoteError, smRebuildNoteFailed, smRebuildNoteKnownTotal, smRebuildNotePageOnly, smLabelIndexAria } from "./schema-manager-copy";
import { DataTable } from "@/components/data-table/DataTable";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { rowActionColumn } from "@/components/data-table/row-action-column";
import { useSchemaManagerStore } from "./schema-manager-store";
import type { TabId } from "./schema-manager-types";

// 值域源 → 值域页签（SPEC-018 #3 映射单源：fields.yaml 的 value_domain.source 到编辑页签）
const VALUE_DOMAIN_TAB: Record<string, TabId> = {
  layers: "layers",
  arch_categories: "categories",
  subdomains: "domains",
  domains: "domains",
  modules: "taxonomy",
  article_types: "taxonomy",
  doc_types: "taxonomy",
  tags: "tags",
};

type FieldRequired = (typeof FIELDS_COPY.REQUIRED_OPTIONS)[number];
type FieldLayer = (typeof FIELDS_COPY.LAYER_OPTIONS)[number];

interface FieldRow {
  name: string;
  label: string;
  type: "string" | "enum" | "list" | "bool" | "date" | "map";
  required: FieldRequired;
  scope: Array<"entity" | "article">;
  layer: FieldLayer;
  value_domain?: { source: string; segment?: string; note?: string };
  aliases?: string[];
  description?: string;
}

const TYPES: FieldRow["type"][] = ["string", "enum", "list", "bool", "date", "map"];
const REQUIRED = FIELDS_COPY.REQUIRED_OPTIONS;
const LAYERS = FIELDS_COPY.LAYER_OPTIONS;

export function FieldsEditor({ disabled }: { disabled?: boolean }) {
  const setActiveTab = useSchemaManagerStore((s) => s.setActiveTab);
  const [rows, setRows] = useState<FieldRow[] | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // PR-163（重建入口显形化）：一键重建全部在册派生物（POST /api/schema/derived/rebuild）
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildNote, setRebuildNote] = useState<string | null>(null);
  const rebuildDerived = async () => {
    setRebuilding(true); setRebuildNote(null);
    try {
      // PR-169：200 报告在信封 data、失败为错误信封（error＋details 报告）——原读根级字段在信封下恒 undefined
      const env = await apiFetchEnvelope<{ total?: number; artifacts?: Array<{ artifact: string; changed: boolean | null }> }>("/api/schema/derived/rebuild", { method: "POST" });
      if (env.ok && env.data) {
        const list = env.data.artifacts || [];
        const changed = list.filter((a) => a.changed).length;
        // WP-134 波2 拆切换器：`data.total ?? list.length` 会让「后端没报总数」时拿本页条数
        // 冒充派生物总数（同一句里已最新数随之虚低）。总数未知就按本页口径说话，不顶替。
        const totalKnown = env.data.total;
        setRebuildNote(totalKnown !== undefined
          ? smRebuildNoteKnownTotal(totalKnown, changed)
          : smRebuildNotePageOnly(list.length, changed));
      } else {
        const details = (env.details ?? {}) as { failed?: number; artifacts?: Array<{ artifact: string; ok: boolean }> };
        const failedList = (details.artifacts || []).filter((a) => !a.ok).map((a) => a.artifact).join("、");
        setRebuildNote(smRebuildNoteFailed(details.failed ?? "?", failedList, env.error || FIELDS_COPY.REBUILD_SEE_SERVER_LOG));
      }
    } catch (e) {
      setRebuildNote(smRebuildNoteError(e instanceof Error ? e.message : String(e)));
    } finally { setRebuilding(false); }
  };
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const env = await apiFetchEnvelope<{ fields: FieldRow[]; revision: string | null }>("/api/schema/fields");
    if (!env.ok || !env.data) { setStatus({ kind: "error", text: env.error ?? FIELDS_COPY.READ_FAILED }); return; }
    setRows(env.data.fields);
    setRevision(env.data.revision);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (i: number, patch: Partial<FieldRow>) => {
    setRows((prev) => (prev ? prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)) : prev));
  };

  const save = async () => {
    if (!rows) return;
    setSaving(true); setStatus(null);
    try {
      const env = await apiFetchEnvelope<{ revision: string; projectionSynced: boolean }>("/api/schema/fields", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, fields: rows }),
      });
      if (!env.ok || !env.data) throw new Error(env.error ?? TERM.SAVE_FAILED);
      setRevision(env.data.revision);
      setStatus({ kind: "ok", text: env.data.projectionSynced ? FIELDS_COPY.SAVE_OK_SYNCED : FIELDS_COPY.SAVE_OK_UNSYNCED });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : TERM.SAVE_FAILED });
    } finally {
      setSaving(false);
    }
  };

  if (rows === null) return <p className="text-sm text-text-placeholder">{FIELDS_COPY.LOAD_HINT}</p>;

  const columns: Array<Column<FieldRow & { __index: number }>> = [
    { key: "name", title: FIELDS_COPY.COL_NAME, width: 140, render: (row) => (
      <EditableCell.Text aria-label={smLabelIndexAria(FIELDS_COPY.COL_NAME, row.__index)} value={row.name} onChange={(e) => update(row.__index, { name: e.target.value })} placeholder={FIELDS_COPY.PLACEHOLDER_NAME} disabled={disabled} />) },
    { key: "label", title: FIELDS_COPY.COL_LABEL, width: 140, render: (row) => (
      <EditableCell.Text aria-label={smLabelIndexAria(FIELDS_COPY.ARIA_LABEL_TAG, row.__index)} value={row.label} onChange={(e) => update(row.__index, { label: e.target.value })} placeholder={FIELDS_COPY.COL_LABEL} disabled={disabled} />) },
    { key: "type", title: FIELDS_COPY.COL_TYPE, width: 96, render: (row) => (
      <EditableCell.Select aria-label={smLabelIndexAria(FIELDS_COPY.COL_TYPE, row.__index)} value={row.type} onChange={(e) => update(row.__index, { type: e.target.value as FieldRow["type"] })} disabled={disabled}>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </EditableCell.Select>) },
    { key: "required", title: FIELDS_COPY.COL_REQUIRED, width: 84, render: (row) => (
      <EditableCell.Select aria-label={smLabelIndexAria(FIELDS_COPY.COL_REQUIRED, row.__index)} value={row.required} onChange={(e) => update(row.__index, { required: e.target.value as FieldRow["required"] })} disabled={disabled}>
        {REQUIRED.map((r) => <option key={r} value={r}>{r}</option>)}
      </EditableCell.Select>) },
    { key: "layer", title: FIELDS_COPY.COL_LAYER, width: 110, render: (row) => (
      <EditableCell.Select aria-label={smLabelIndexAria(FIELDS_COPY.COL_LAYER, row.__index)} value={row.layer} onChange={(e) => update(row.__index, { layer: e.target.value as FieldRow["layer"] })} disabled={disabled}>
        {LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
      </EditableCell.Select>) },
    { key: "scope", title: FIELDS_COPY.COL_SCOPE, width: 110, render: (row) => (
      <span className="flex gap-2 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={row.scope.includes("entity")} onChange={(e) => update(row.__index, { scope: e.target.checked ? Array.from(new Set([...row.scope, "entity" as const])) : row.scope.filter((s) => s !== "entity") })} disabled={disabled} />{FIELDS_COPY.SCOPE_ENTITY}</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={row.scope.includes("article")} onChange={(e) => update(row.__index, { scope: e.target.checked ? Array.from(new Set([...row.scope, "article" as const])) : row.scope.filter((s) => s !== "article") })} disabled={disabled} />{FIELDS_COPY.SCOPE_ARTICLE}</label>
      </span>) },
    { key: "value_domain", title: FIELDS_COPY.COL_VALUE_DOMAIN, width: 130, render: (row) => {
      const tab = VALUE_DOMAIN_TAB[row.value_domain?.source ?? ""];
      return (
        <EditableCell.Text
          aria-label={smLabelIndexAria(FIELDS_COPY.COL_VALUE_DOMAIN, row.__index)}
          value={row.value_domain?.source ?? ""}
          onChange={(e) => update(row.__index, { value_domain: { ...(row.value_domain ?? { source: "free" }), source: e.target.value } })}
          disabled={disabled}
          placeholder={FIELDS_COPY.PLACEHOLDER_VALUE_DOMAIN}
          className={tab ? "cursor-pointer text-accent-base underline decoration-dotted" : ""}
          title={tab ? FIELDS_COPY.VALUE_DOMAIN_JUMP_TITLE : undefined}
          onClick={() => { if (tab) setActiveTab(tab); }}
        />);
    } },
    { key: "description", title: FIELDS_COPY.COL_DESC, render: (row) => (
      <EditableCell.Text aria-label={smLabelIndexAria(FIELDS_COPY.COL_DESC, row.__index)} value={row.description ?? ""} onChange={(e) => update(row.__index, { description: e.target.value })} placeholder={FIELDS_COPY.PLACEHOLDER_DESC} disabled={disabled} />) },
    rowActionColumn<FieldRow & { __index: number }>({ label: (row) => smLabelIndexAria(FIELDS_COPY.DELETE_ROW_PREFIX, row.__index), danger: true, onRun: (row) => setRows((prev) => (prev ? prev.filter((_, idx) => idx !== row.__index) : prev)) }),
  ];

  return <section aria-label={FIELDS_COPY.SECTION_ARIA} className="space-y-3">
    <div className="flex items-center gap-3">
      <p className="text-xs text-text-hint">{smFieldsSummary(rows.length)}</p>
      <button onClick={() => void save()} disabled={disabled || saving} className="ml-auto rounded-md bg-accent-base px-3 py-1.5 text-xs text-accent-contrast hover:bg-accent-base/90 disabled:opacity-40">{saving ? FIELDS_COPY.SAVING : FIELDS_COPY.SAVE_ACTION}</button>
      <button onClick={() => void rebuildDerived()} disabled={rebuilding} title={FIELDS_COPY.REBUILD_TITLE} className="rounded-md bg-surface-card px-3 py-1.5 text-xs text-text-sub ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40">{rebuilding ? FIELDS_COPY.REBUILDING : FIELDS_COPY.REBUILD_ACTION}</button>
      {rebuildNote && <span className="text-xs text-text-hint">{rebuildNote}</span>}
      <button onClick={() => setRows([...rows, { name: "", label: "", type: "string", required: FIELDS_COPY.REQUIRED_OPTIONS[1], scope: ["entity"], layer: FIELDS_COPY.LAYER_OPTIONS[2], description: "" }])} disabled={disabled} className="flex items-center gap-1 rounded-md bg-surface-hover px-3 py-1.5 text-xs text-text-main/80 hover:bg-surface-root disabled:opacity-40"><Plus className="h-4 w-4" />{FIELDS_COPY.ADD_FIELD}</button>
    </div>
    {status && <p className={`text-xs ${status.kind === "ok" ? "text-status-fact" : "text-status-error"}`}>{status.text}</p>}
    <DataTable
      ariaLabel={FIELDS_COPY.TABLE_ARIA}
      columns={columns}
      rows={rows.map((row, __index) => ({ ...row, __index }))}
      rowKey={(row) => `field-${row.__index}`}
      density="sm"
      minWidth={1080}
      empty={{ title: FIELDS_COPY.EMPTY }}
    />
  </section>;
}
