// DependencyRulesEditor — W4 迁移（决策卡 §12.1）：div 网格→DataTable 语义表（D12）；
// 行选择数字 index 模型改字符串键（I4：item.id）；行内控件样式收编 EditableCell（I5）；
// 删除（行/批量）＝未保存草稿的可逆操作（保存前可放弃），WP-146 件1 起去掉阻断确认：
// 删除即执行＋sonner toast 5 秒内撤销（按原下标回插，撤销时读 store 最新状态防闭包过期）。
// 分页口径 12→20（卡 §十）。FilterSelect 富选择与诊断接线为调用方自管（先例同 RowActions）。
// 文案介质：用户可见文案单源 schema-manager-copy.ts（WP-149，ADR-019 §二）。
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, GitCompareArrows, Loader2, Plus, RefreshCcw, Trash2, Upload, X } from "lucide-react";
import YAML from "yaml";
import { toast } from "sonner";
import { DependencyImpactPreview } from "./components";
import { FilterSelect } from "@/components/filter-select";
import { TablePagination } from "@/components/table-pagination";
import { DataTable } from "@/components/data-table/DataTable";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { useTableList } from "@/hooks/use-table-list";
import { Button } from "@/components/ui/button";
import { useSchemaManagerStore } from "./schema-manager-store";
import { DEP_RULES_COPY, smActionRowAria, smRowItemAria } from "./schema-manager-copy";
import type { DependencyRuleDiagnostic, DependencyRuleItem } from "./schema-manager-types";
// seq211：业务叫法取术语常量表，杜绝就地写自造词（原「图谱实体」不在术语规范里，见 PR-021）
import { TERM } from "@/constants/term-const";

function diagnosticsByIndex(items: DependencyRuleDiagnostic[]) {
  const result = new Map<number, DependencyRuleDiagnostic[]>();
  items.forEach((item) => { if (typeof item.index === "number") result.set(item.index, [...(result.get(item.index) || []), item]); });
  return result;
}

function parseImportedRules(raw: string, format: "yaml" | "table"): DependencyRuleItem[] {
  let rows: unknown;
  if (format === "yaml") { const parsed = YAML.parse(raw); rows = Array.isArray(parsed) ? parsed : parsed?.dependencies; }
  else {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const headers = (lines.shift() || "").split("\t").map((value) => value.trim());
    rows = lines.map((line) => Object.fromEntries(line.split("\t").map((value, index) => [headers[index], value.trim()])));
  }
  // seq201（前端纯净度规则①清存量）：纯客户端导入格式守卫改中性技术诊断（经 importError 行内回显），不再自造业务话术
  if (!Array.isArray(rows)) throw new Error("import content must contain a dependencies array or TSV rows");
  return rows.map((value, index) => { const row = value as Record<string, unknown>; return { id: `dep-import-${Date.now()}-${index}`, source: String(row.source || "").trim(), target: String(row.target || "").trim(), type: String(row.type || "DEPENDS_ON").trim().toUpperCase(), since: String(row.since || "").trim(), until: row.until ? String(row.until).trim() : null, origin: row.origin === "auto" ? "auto" : "manual" }; });
}

type RuleRow = { item: DependencyRuleItem; index: number };

export function DependencyRulesEditor({ disabled }: { disabled?: boolean }) {
  const store = useSchemaManagerStore();
  const data = store.dependencies;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<"yaml" | "table">("yaml");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const diagnostics = useMemo(() => diagnosticsByIndex(data?.diagnostics || []), [data?.diagnostics]);

  const sourceRows = useMemo(() => (data?.items || []).map((item, index) => ({ item, index })), [data?.items]);
  const list = useTableList<RuleRow>({
    rows: sourceRows,
    filters: {
      source: { values: [], match: ({ item }, value) => item.source.includes(value) },
      target: { values: [], match: ({ item }, value) => item.target.includes(value) },
      origin: { values: [], match: ({ item }, value) => item.origin === value },
      version: { values: [], match: ({ item }, value) => (item.since || "").includes(value) || (item.until || "").includes(value) },
    },
  });
  const { page, pageSize, setPage } = list;

  if (store.dependenciesRequest.status === "loading" && !data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!data) return <p className="py-10 text-center text-sm text-status-error">{store.dependenciesRequest.error || DEP_RULES_COPY.NOT_LOADED}</p>;
  // seq211：与「架构组件」并列的是「实体」（指非架构组件的实体），不是「图谱实体」
  const entityOptions = data.entityOptions.map((item) => ({ value: item.id, label: `${item.label} · ${item.scope === "architecture-component" ? TERM.ARCH_COMPONENT : TERM.ENTITY}`, group: item.scope }));
  const relationOptions = data.relationTypeOptions.map((item) => ({ value: item.id, label: item.label, group: item.versionable ? DEP_RULES_COPY.GROUP_VERSIONABLE : DEP_RULES_COPY.GROUP_PLAIN_RELATION }));
  const setItems = (items: DependencyRuleItem[]) => store.setDependencyItems(items);
  const updateItem = (index: number, patch: Partial<DependencyRuleItem>) => setItems(data.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const importRules = () => { try { setItems([...data.items, ...parseImportedRules(importText, importFormat)]); setImportOpen(false); setImportText(""); setImportError(null); } catch (error) { setImportError(error instanceof Error ? error.message : DEP_RULES_COPY.IMPORT_FAILED); } };
  // WP-146 件1：删除即执行（草稿可逆，不再弹阻断确认）＋toast 5 秒内撤销——撤销按原下标回插，
  // 经 useSchemaManagerStore.getState() 读最新 items，避免闭包里的 data 过期覆盖用户后续编辑。
  const deleteRows = (indices: number[], clearSelection: boolean) => {
    const removed = indices.map((index) => ({ index, item: data.items[index] })).sort((left, right) => left.index - right.index);
    const drop = new Set(indices);
    setItems(data.items.filter((_item, itemIndex) => !drop.has(itemIndex)));
    if (clearSelection) setSelectedIds(new Set());
    toast.success(TERM.DELETED_NOTICE, {
      duration: 5000,
      action: {
        label: TERM.UNDO_ACTION,
        onClick: () => {
          const current = useSchemaManagerStore.getState().dependencies?.items ?? [];
          const next = [...current];
          for (const { index, item } of removed) next.splice(Math.min(index, next.length), 0, item);
          store.setDependencyItems(next);
        },
      },
    });
  };

  const columns: Array<Column<RuleRow>> = [
    {
      key: "source",
      title: DEP_RULES_COPY.COL_SOURCE,
      render: ({ item, index }) => <FilterSelect ariaLabel={smRowItemAria(DEP_RULES_COPY.COL_SOURCE, index + 1)} title={smRowItemAria(DEP_RULES_COPY.COL_SOURCE, index + 1)} value={item.source} onValueChange={(value) => updateItem(index, { source: value as string })} disabled={disabled} options={entityOptions} />,
    },
    {
      key: "type",
      title: DEP_RULES_COPY.COL_TYPE,
      render: ({ item, index }) => <FilterSelect ariaLabel={smRowItemAria(DEP_RULES_COPY.COL_TYPE, index + 1)} title={smRowItemAria(DEP_RULES_COPY.COL_TYPE, index + 1)} value={item.type} onValueChange={(value) => updateItem(index, { type: value as string })} disabled={disabled} options={relationOptions} />,
    },
    {
      key: "target",
      title: DEP_RULES_COPY.COL_TARGET,
      render: ({ item, index }) => <FilterSelect ariaLabel={smRowItemAria(DEP_RULES_COPY.COL_TARGET, index + 1)} title={smRowItemAria(DEP_RULES_COPY.COL_TARGET, index + 1)} value={item.target} onValueChange={(value) => updateItem(index, { target: value as string })} disabled={disabled} options={entityOptions} />,
    },
    {
      key: "since",
      title: DEP_RULES_COPY.COL_SINCE,
      render: ({ item, index }) => <EditableCell.Text aria-label={smRowItemAria(DEP_RULES_COPY.COL_SINCE, index + 1)} value={item.since || ""} onChange={(event) => updateItem(index, { since: event.target.value })} />,
    },
    {
      key: "until",
      title: DEP_RULES_COPY.COL_UNTIL,
      render: ({ item, index }) => <EditableCell.Text aria-label={smRowItemAria(DEP_RULES_COPY.COL_UNTIL, index + 1)} value={item.until || ""} onChange={(event) => updateItem(index, { until: event.target.value || null })} />,
    },
    {
      key: "origin",
      title: DEP_RULES_COPY.COL_ORIGIN,
      render: ({ item, index }) => <FilterSelect ariaLabel={smRowItemAria(DEP_RULES_COPY.COL_ORIGIN, index + 1)} title={smRowItemAria(DEP_RULES_COPY.COL_ORIGIN, index + 1)} value={item.origin} onValueChange={(value) => updateItem(index, { origin: value as "auto" | "manual" })} disabled={disabled} options={[{ value: "manual", label: DEP_RULES_COPY.ORIGIN_MANUAL, group: DEP_RULES_COPY.GROUP_ORIGIN }, { value: "auto", label: DEP_RULES_COPY.ORIGIN_AUTO, group: DEP_RULES_COPY.GROUP_ORIGIN }]} />,
    },
    {
      key: "diagnostics",
      title: DEP_RULES_COPY.COL_DIAGNOSTICS,
      render: ({ index }) => {
        const rowDiagnostics = diagnostics.get(index) || [];
        return (
          <div className="flex min-h-8 flex-wrap gap-1">
            {rowDiagnostics.length
              ? rowDiagnostics.map((item) => <span key={`${item.code}-${item.field}`} title={item.message} className="text-xs text-status-warn"><AlertTriangle className="mr-1 inline h-3 w-3" />{item.code}</span>)
              : <span className="text-xs text-status-fact"><CheckCircle2 className="mr-1 inline h-3 w-3" />{DEP_RULES_COPY.DIAG_OK}</span>}
          </div>
        );
      },
    },
    {
      key: "actions",
      title: "",
      align: "right",
      render: (row) => (
        <Button type="button" variant="ghost" size="icon" title={DEP_RULES_COPY.ROW_DELETE_TITLE} aria-label={smActionRowAria(TERM.DELETE_ACTION, DEP_RULES_COPY.ITEM_NOUN, row.index + 1)} disabled={disabled} onClick={() => deleteRows([row.index], false)} className="h-7 w-7 text-status-error hover:bg-status-error-3">
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return <div data-testid="dependency-rules-editor" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-thin pb-3 text-xs text-text-sub"><div><p className="font-medium text-text-main">{DEP_RULES_COPY.INTRO}</p><p className="mt-1 font-mono text-text-hint">{data.sourceFile} · {data.revision.slice(0, 18)}…</p></div><div className="flex gap-2"><span>{DEP_RULES_COPY.SUMMARY_RULES}{data.summary.total}</span><span className="text-status-error">{DEP_RULES_COPY.SUMMARY_ERRORS}{data.summary.errors}</span><span className="text-status-warn">{DEP_RULES_COPY.SUMMARY_WARNINGS}{data.summary.warnings}</span></div></div>
    {store.dependenciesSaveError && <p className="text-xs text-status-error">{store.dependenciesSaveError}</p>}{store.dependencyPreview && <DependencyImpactPreview data={store.dependencyPreview} onClose={store.clearDependencyPreview} />}
    <div className="flex flex-wrap items-center gap-2"><FilterSelect ariaLabel={DEP_RULES_COPY.FILTER_SOURCE_ARIA} title={DEP_RULES_COPY.FILTER_SOURCE_ARIA} value={list.filterValues.source?.[0] ?? ""} onValueChange={(value) => list.setFilter("source", value ? [value as string] : [])} emptyTriggerLabel={DEP_RULES_COPY.ALL_SOURCE} options={[{ value: "", label: DEP_RULES_COPY.ALL_SOURCE, group: DEP_RULES_COPY.GROUP_SCOPE }, ...entityOptions]} variant="filter" /><FilterSelect ariaLabel={DEP_RULES_COPY.FILTER_TARGET_ARIA} title={DEP_RULES_COPY.FILTER_TARGET_ARIA} value={list.filterValues.target?.[0] ?? ""} onValueChange={(value) => list.setFilter("target", value ? [value as string] : [])} emptyTriggerLabel={DEP_RULES_COPY.ALL_TARGET} options={[{ value: "", label: DEP_RULES_COPY.ALL_TARGET, group: DEP_RULES_COPY.GROUP_SCOPE }, ...entityOptions]} variant="filter" /><FilterSelect ariaLabel={DEP_RULES_COPY.FILTER_ORIGIN_ARIA} title={DEP_RULES_COPY.FILTER_ORIGIN_ARIA} value={list.filterValues.origin?.[0] ?? ""} onValueChange={(value) => list.setFilter("origin", value ? [value as string] : [])} emptyTriggerLabel={DEP_RULES_COPY.ALL_ORIGIN} options={[{ value: "", label: DEP_RULES_COPY.ALL_ORIGIN, group: DEP_RULES_COPY.GROUP_SCOPE }, { value: "manual", label: DEP_RULES_COPY.ORIGIN_MANUAL, group: DEP_RULES_COPY.GROUP_ORIGIN }, { value: "auto", label: DEP_RULES_COPY.ORIGIN_AUTO, group: DEP_RULES_COPY.GROUP_ORIGIN }]} variant="filter" /><input aria-label={DEP_RULES_COPY.FILTER_VERSION_ARIA} value={list.filterValues.version?.[0] ?? ""} onChange={(event) => list.setFilter("version", event.target.value ? [event.target.value] : [])} placeholder={DEP_RULES_COPY.FILTER_VERSION_PLACEHOLDER} className="h-8 w-28 rounded-md bg-surface-root px-2 text-xs ring-1 ring-border-thin" />
      <button type="button" title={DEP_RULES_COPY.VALIDATE_TITLE} onClick={() => void store.validateDependencies()} disabled={disabled} className="ml-auto flex h-8 items-center gap-1 px-2 text-xs"><RefreshCcw className="h-4 w-4" />{DEP_RULES_COPY.VALIDATE_ACTION}</button><button type="button" title={DEP_RULES_COPY.PREVIEW_TITLE} onClick={() => void store.previewDependencies()} disabled={disabled} className="flex h-8 items-center gap-1 px-2 text-xs"><GitCompareArrows className="h-4 w-4" />{DEP_RULES_COPY.PREVIEW_ACTION}</button><button type="button" onClick={() => setItems([...data.items, { id: `dep-draft-${Date.now()}`, source: "", target: "", type: relationOptions[0]?.value || "DEPENDS_ON", since: "", until: null, origin: "manual" }])} disabled={disabled} className="flex h-8 items-center gap-1 px-2 text-xs"><Plus className="h-4 w-4" />{TERM.ADD_ACTION}</button><button type="button" onClick={() => setImportOpen(true)} disabled={disabled} className="flex h-8 items-center gap-1 px-2 text-xs"><Upload className="h-4 w-4" />{DEP_RULES_COPY.IMPORT_RULES_ACTION}</button><button type="button" onClick={() => deleteRows(data.items.flatMap((item, index) => (selectedIds.has(item.id) ? [index] : [])), true)} disabled={disabled || !selectedIds.size} className="flex h-8 items-center gap-1 px-2 text-xs text-status-error disabled:opacity-40"><Trash2 className="h-4 w-4" />{DEP_RULES_COPY.DELETE_SELECTED} ({selectedIds.size})</button>
    </div>
    {importOpen && <section aria-label={DEP_RULES_COPY.IMPORT_SECTION_ARIA} className="space-y-3 border-y border-border-thin py-4"><div className="flex justify-between"><div className="flex ring-1 ring-border-thin"><button type="button" onClick={() => setImportFormat("yaml")} className={`h-8 px-3 text-xs ${importFormat === "yaml" ? "bg-surface-hover" : ""}`}>YAML</button><button type="button" onClick={() => setImportFormat("table")} className={`h-8 px-3 text-xs ${importFormat === "table" ? "bg-surface-hover" : ""}`}>{DEP_RULES_COPY.IMPORT_FORMAT_TSV}</button></div><button type="button" title={DEP_RULES_COPY.IMPORT_CLOSE_TITLE} onClick={() => setImportOpen(false)}><X className="h-4 w-4" /></button></div><textarea aria-label={DEP_RULES_COPY.IMPORT_TEXTAREA_ARIA} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={importFormat === "yaml" ? "dependencies:\n  - source: service-a\n    target: foundation\n    type: DEPENDS_ON\n    origin: manual" : "source\ttarget\ttype\tsince\tuntil\torigin"} className="min-h-40 w-full rounded-md bg-surface-root p-3 font-mono text-xs ring-1 ring-border-thin" />{importError && <p className="text-xs text-status-error">{importError}</p>}<button type="button" onClick={importRules} disabled={!importText.trim()} className="h-8 rounded-md bg-accent-base px-3 text-xs text-accent-contrast disabled:opacity-40">{DEP_RULES_COPY.IMPORT_SUBMIT}</button></section>}
    <DataTable
      ariaLabel={DEP_RULES_COPY.TABLE_ARIA}
      columns={columns}
      rows={list.items}
      rowKey={({ item, index }) => item.id || `rule-${index}`}
      density="md"
      minWidth={1040}
      empty={data.items.length === 0 ? { title: DEP_RULES_COPY.EMPTY_NO_RULES } : { title: DEP_RULES_COPY.EMPTY_NO_MATCH }}
      rowSelection={{
        selectedKeys: selectedIds,
        headerLabel: DEP_RULES_COPY.SELECT_HEADER,
        rowLabel: ({ index }) => smActionRowAria(DEP_RULES_COPY.SELECT_HEADER, DEP_RULES_COPY.ITEM_NOUN, index + 1),
        onToggle: ({ item, index }) => {
          const key = item.id || `rule-${index}`;
          const next = new Set(selectedIds);
          if (next.has(key)) next.delete(key); else next.add(key);
          setSelectedIds(next);
        },
      }}
      pagination={<TablePagination ariaLabel={DEP_RULES_COPY.PAGINATION_ARIA} page={page} pageSize={pageSize} total={list.visibleCount} onPageChange={setPage} loading={store.dependenciesRequest.status === "loading"} />}
    />
  </div>;
}
