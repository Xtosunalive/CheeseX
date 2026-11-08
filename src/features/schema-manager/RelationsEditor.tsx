// RelationsEditor — 关系实例账编辑器（配置页纯写面；SCHEMA-IA-001 批13）：
// 实例账编辑（DataTable 基座＋FilterSelect 下拉＝后端选项集单源；全量写回＋revision 乐观锁；
// 409 冲突提示刷新重载）。原阶段4/5 的出链/反链查询＋G6 局部图谱（R5 验证场脚手架）已按
// Master 2026-10-26 裁定迁图谱检索页（LocalGraph，图为主体、查询收编为控件）——配置页宪法：
// 只留能动配置的东西。
// 治理面纪律：列表走 DataTable 基座（table-base 域）、theme token 类（无裸色/裸 z）、术语走 TERM。
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { TablePagination } from "@/components/table-pagination";
import { FilterSelect } from "@/components/filter-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // ui-kit 域基础件（新代码不进 <input> 棘轮基线）
import { useTableList } from "@/hooks/use-table-list";
import { TERM } from "@/constants/term-const";
import { RELATIONS_COPY, smLabeledValueAria } from "./schema-manager-copy";
import { fetchRelationsBundle, saveRelations, type RelationInstance } from "@/lib/edge-api";

type DraftRow = RelationInstance & { key: string };

const today = () => new Date().toISOString().slice(0, 10);

function RelationLedgerEditor({ objectOptions, typeOptions, bandOptions }: { objectOptions: string[]; typeOptions: string[]; bandOptions: string[] }) {
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof fetchRelationsBundle>>["data"] | null>(null);
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { data } = await fetchRelationsBundle();
      setBundle(data);
      setRows(data.relations.map((row, index) => ({ ...row, key: `rel-${index}-${row.source}-${row.type}` })));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : TERM.LOAD_FAILED);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const list = useTableList<DraftRow>({
    rows: rows || [],
    filters: {
      type: { values: [], match: (row, value) => row.type === value },
      source: { values: [], match: (row, value) => row.source.includes(value) },
    },
  });
  const { page, pageSize, setPage } = list;

  if (!rows || !bundle) {
    return loadError
      ? <div className="space-y-2"><p className="text-sm text-status-error">{loadError}</p><Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCcw className="h-4 w-4" />{TERM.RETRY_ACTION}</Button></div>
      : <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  const dirty = JSON.stringify(rows.map(({ key, ...rest }) => { void key; return rest; })) !== JSON.stringify(bundle.relations);
  const updateRow = (key: string, patch: Partial<DraftRow>) => setRows(rows.map((row) => row.key === key ? { ...row, ...patch } : row));

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const payload = rows.map(({ key, ...rest }) => { void key; return rest; });
      await saveRelations({ relations: payload, revision: bundle.revision });
      await load();
    } catch (error) {
      const e = error as Error & { code?: string };
      setSaveError(e.code === "RELATIONS_REVISION_CONFLICT" ? RELATIONS_COPY.SAVE_CONFLICT : e.message);
    } finally {
      setSaving(false);
    }
  };

  const objectOpts = objectOptions.map((name) => ({ value: name, label: name, group: RELATIONS_COPY.GROUP_DICT_OBJECT }));
  const typeOpts = typeOptions.map((t) => ({ value: t, label: t, group: RELATIONS_COPY.GROUP_RELATION_TYPES }));
  // WP-049 L4（SPEC-044 C4）：档位选项来自 API 单源（本体声明经装载端口派生），不再手抄名集
  const BAND_LABELS: Record<string, string> = { high: RELATIONS_COPY.BAND_HIGH, medium: RELATIONS_COPY.BAND_MEDIUM, low: RELATIONS_COPY.BAND_LOW };
  const bandOpts = [
    { value: "", label: RELATIONS_COPY.BAND_EMPTY_LABEL, group: RELATIONS_COPY.GROUP_BAND },
    ...bandOptions.map((b) => ({ value: b, label: BAND_LABELS[b] ?? b, group: RELATIONS_COPY.GROUP_BAND })),
  ];

  const columns: Array<Column<DraftRow>> = [
    { key: "source", title: RELATIONS_COPY.COL_SOURCE, render: ({ key, source, endpoint_domain }) => endpoint_domain === "graph"
      ? <EditableCell.Text aria-label={RELATIONS_COPY.SOURCE_NODE_ARIA} title={RELATIONS_COPY.SOURCE_GRAPH_TITLE} value={source} onChange={(e) => updateRow(key, { source: e.target.value })} />
      : <FilterSelect ariaLabel={smLabeledValueAria(RELATIONS_COPY.COL_SOURCE, source)} title={RELATIONS_COPY.SOURCE_PICK_TITLE} value={source} onValueChange={(v) => updateRow(key, { source: v as string })} options={objectOpts} /> },
    { key: "type", title: RELATIONS_COPY.COL_TYPE, render: ({ key, type }) => <FilterSelect ariaLabel={smLabeledValueAria(RELATIONS_COPY.COL_TYPE, type)} title={RELATIONS_COPY.TYPE_PICK_TITLE} value={type} onValueChange={(v) => updateRow(key, { type: v as string })} options={typeOpts} /> },
    { key: "target", title: RELATIONS_COPY.COL_TARGET, render: ({ key, target, endpoint_domain }) => endpoint_domain === "graph"
      ? <EditableCell.Text aria-label={RELATIONS_COPY.TARGET_NODE_ARIA} title={RELATIONS_COPY.TARGET_GRAPH_TITLE} value={target} onChange={(e) => updateRow(key, { target: e.target.value })} />
      : <FilterSelect ariaLabel={smLabeledValueAria(RELATIONS_COPY.COL_TARGET, target)} title={RELATIONS_COPY.TARGET_PICK_TITLE} value={target} onValueChange={(v) => updateRow(key, { target: v as string })} options={objectOpts} /> },
    { key: "endpoint_domain", title: RELATIONS_COPY.COL_ENDPOINT_DOMAIN, render: ({ key, endpoint_domain }) => <FilterSelect ariaLabel={RELATIONS_COPY.ENDPOINT_DOMAIN_ARIA} title={RELATIONS_COPY.ENDPOINT_DOMAIN_TITLE} value={endpoint_domain || "dictionary"} onValueChange={(v) => updateRow(key, { endpoint_domain: v as "dictionary" | "graph", ...(v !== "graph" ? { confidence_band: undefined } : {}) })} options={[{ value: "dictionary", label: RELATIONS_COPY.ENDPOINT_DICT_LABEL, group: RELATIONS_COPY.GROUP_ENDPOINT_DOMAIN }, { value: "graph", label: RELATIONS_COPY.ENDPOINT_GRAPH_LABEL, group: RELATIONS_COPY.GROUP_ENDPOINT_DOMAIN }]} /> },
    { key: "confidence_band", title: RELATIONS_COPY.COL_CONFIDENCE_BAND, render: ({ key, endpoint_domain, confidence_band }) => endpoint_domain === "graph"
      ? <FilterSelect ariaLabel={RELATIONS_COPY.BAND_ARIA} title={RELATIONS_COPY.BAND_TITLE} value={confidence_band || ""} onValueChange={(v) => updateRow(key, { confidence_band: (v || undefined) as "high" | "medium" | "low" | undefined })} options={bandOpts} />
      : <span className="text-xs text-text-hint">—</span> },
    { key: "note", title: RELATIONS_COPY.COL_NOTE, render: ({ key, note }) => <EditableCell.Text aria-label={RELATIONS_COPY.NOTE_ARIA} value={note || ""} onChange={(e) => updateRow(key, { note: e.target.value })} /> },
    { key: "asserted_by", title: RELATIONS_COPY.COL_ASSERTED_BY, render: ({ key, asserted_by }) => <FilterSelect ariaLabel={RELATIONS_COPY.ASSERTED_BY_ARIA} title={RELATIONS_COPY.ASSERTED_BY_TITLE} value={asserted_by} onValueChange={(v) => updateRow(key, { asserted_by: v as "human" | "rule" })} options={[{ value: "human", label: RELATIONS_COPY.ASSERTED_HUMAN, group: RELATIONS_COPY.GROUP_ASSERTED_BY }, { value: "rule", label: RELATIONS_COPY.ASSERTED_RULE, group: RELATIONS_COPY.GROUP_ASSERTED_BY }]} /> },
    { key: "asserted_at", title: RELATIONS_COPY.COL_ASSERTED_AT, render: ({ key, asserted_at }) => <EditableCell.Text aria-label={RELATIONS_COPY.COL_ASSERTED_AT} value={asserted_at} onChange={(e) => updateRow(key, { asserted_at: e.target.value })} /> },
    {
      key: "actions", title: "", align: "right",
      render: ({ key }) => (
        <Button type="button" variant="ghost" size="icon" title={RELATIONS_COPY.DELETE_ROW_TITLE} aria-label={RELATIONS_COPY.DELETE_ROW_ARIA} onClick={() => setRows(rows.filter((row) => row.key !== key))} className="h-6 w-6 text-status-error hover:bg-status-error-3">
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return <section aria-label={RELATIONS_COPY.SECTION_ARIA} className="space-y-3" data-testid="relations-ledger">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-thin pb-3 text-xs text-text-sub">
      <div>
        <p className="font-medium text-text-main">{RELATIONS_COPY.INTRO}</p>
        <p className="mt-1 font-mono text-text-hint">relations.yaml · {bundle.revision.slice(0, 18)}…</p>
      </div>
      <div className="flex items-center gap-2">
        <span>{RELATIONS_COPY.TOTAL_PREFIX}{rows.length}{RELATIONS_COPY.TOTAL_SUFFIX}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { key: `rel-draft-${Date.now()}`, source: objectOptions[0] || "", target: objectOptions[1] || objectOptions[0] || "", type: typeOptions[0] || "", note: "", asserted_by: "human", asserted_at: today() }])}><Plus className="h-4 w-4" />{TERM.ADD_ACTION}</Button>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}><Save className="h-4 w-4" />{saving ? RELATIONS_COPY.SAVING : RELATIONS_COPY.SAVE_ALL}</Button>
      </div>
    </div>
    {saveError && <p className="text-xs text-status-error" role="alert">{saveError}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect ariaLabel={RELATIONS_COPY.FILTER_TYPE_ARIA} title={RELATIONS_COPY.FILTER_TYPE_ARIA} value={list.filterValues.type?.[0] ?? ""} onValueChange={(v) => list.setFilter("type", v ? [v as string] : [])} emptyTriggerLabel={RELATIONS_COPY.ALL_TYPES} variant="filter" options={[{ value: "", label: RELATIONS_COPY.ALL_TYPES, group: RELATIONS_COPY.GROUP_SCOPE }, ...typeOpts]} />
      <Input aria-label={RELATIONS_COPY.FILTER_SOURCE_ARIA} value={list.filterValues.source?.[0] ?? ""} onChange={(e) => list.setFilter("source", e.target.value ? [e.target.value] : [])} placeholder={RELATIONS_COPY.FILTER_SOURCE_PLACEHOLDER} className="h-8 w-32 text-xs" />
    </div>
    <DataTable
      ariaLabel={RELATIONS_COPY.TABLE_ARIA}
      columns={columns}
      rows={list.items}
      rowKey={({ key }) => key}
      density="md"
      minWidth={880}
      empty={rows.length === 0 ? { title: RELATIONS_COPY.EMPTY_NO_ROWS } : { title: RELATIONS_COPY.EMPTY_NO_MATCH }}
      pagination={<TablePagination ariaLabel={RELATIONS_COPY.PAGINATION_ARIA} page={page} pageSize={pageSize} total={list.visibleCount} onPageChange={setPage} loading={false} />}
    />
  </section>;
}


export function RelationsEditor() {
  const [options, setOptions] = useState<{ objectOptions: string[]; typeOptions: string[]; bandOptions: string[] } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await fetchRelationsBundle();
        setOptions({ objectOptions: data.objectOptions || [], typeOptions: data.typeOptions || [], bandOptions: data.bandOptions || [] });
      } catch {
        setOptions({ objectOptions: [], typeOptions: [], bandOptions: [] });
      }
    })();
  }, []);
  if (!options) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return <div className="space-y-8">
    <RelationLedgerEditor objectOptions={options.objectOptions} typeOptions={options.typeOptions} bandOptions={options.bandOptions} />
  </div>;
}
