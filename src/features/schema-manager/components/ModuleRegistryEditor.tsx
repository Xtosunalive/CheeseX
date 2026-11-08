// ModuleRegistryEditor — W4 迁移（决策卡 §12.1）：div 网格→DataTable 语义表（D12）；
// 行内输入收编 EditableCell（I5，datalist 建议输入与 warn 环经 className 覆盖）；
// 适用产品行＋字段完整度状态行走 expandable 常显行（T05 结果卡先例）；
// 模块删除＝未保存草稿改动的可逆操作（保存前可放弃）——WP-146 件1 起去掉阻断确认：删除即执行
// ＋sonner toast 5 秒内撤销（按名回插原定义，经 ref 读最新 modules 防闭包过期）。datalist 建议源与添加行保持原样。
import { useRef, useState } from "react";
import { TERM } from "@/constants/term-const";
import { Plus, Trash2, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import type { ModuleDefinition, ModuleRegistry } from "@/features/schema-manager/schema-manager-types";
import { FilterSelect } from "@/components/filter-select";
import { DataTable } from "@/components/data-table/DataTable";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { MODULES_COPY, smLabeledValueAria } from "@/features/schema-manager/schema-manager-copy";

interface ModuleRegistryEditorProps {
  modules: ModuleRegistry;
  /** 子域挂靠真源（知识域/子域页签词表投影）——批9：挂靠目标从词表选取，不再自由输入撞校验 */
  subdomainGroups: Array<{ domainId: string; domainLabel: string; entries: Array<{ id: string; label?: string }> }>;
  /** 子域词表为空时的引导跳转（去知识域/子域页签先建词条） */
  onGoDomains?: () => void;
  /** 适用产品真源（产品版本页签注册表 products 键）——批11：从自抄 datalist 改注册表选取 */
  productNames: string[];
  /** 产品注册表为空时的引导跳转（去产品版本页签先注册产品） */
  onGoVersions?: () => void;
  /** 注册表加载态（懒加载未回时不显示空表误导） */
  versionsLoading?: boolean;
  disabled: boolean;
  onChange: (modules: ModuleRegistry) => void;
}

/** 字段完整度问题清单（与迁移前口径逐字一致） */
function moduleIssues(definition: ModuleDefinition, duplicateSystems: Set<string>): string[] {
  return [
    !definition.system && MODULES_COPY.ISSUE_SYSTEM_REQUIRED,
    !definition.subdomain && MODULES_COPY.ISSUE_SUBDOMAIN_REQUIRED,
    definition.system && definition.subdomain && definition.system === definition.subdomain && MODULES_COPY.ISSUE_SYSTEM_SAME_AS_SUBDOMAIN,
    definition.system && duplicateSystems.has(definition.system) && MODULES_COPY.ISSUE_SYSTEM_DUPLICATED,
  ].filter(Boolean) as string[];
}

export function ModuleRegistryEditor({ modules, subdomainGroups, onGoDomains, productNames, onGoVersions, versionsLoading, disabled, onChange }: ModuleRegistryEditorProps) {
  const [newName, setNewName] = useState("");
  // 撤销回插读最新 props（toast 闭包里的 modules 会过期）
  const modulesRef = useRef(modules);
  modulesRef.current = modules;
  const names = Object.keys(modules).sort((left, right) => (modules[left].parent_id || "").localeCompare(modules[right].parent_id || "") || left.localeCompare(right, "zh-CN"));
  const systems = [...new Set(names.map((name) => modules[name].system).filter((value): value is string => Boolean(value)))].sort();
  const duplicateSystems = new Set(systems.filter((value) => names.filter((name) => modules[name].system === value).length > 1));

  const updateModule = (name: string, patch: Partial<ModuleDefinition>) => {
    onChange({ ...modules, [name]: { ...modules[name], ...patch } });
  };

  const renameModule = (oldName: string, nextName: string) => {
    const normalized = nextName.trim();
    if (!normalized || normalized === oldName || modules[normalized]) return;
    const next: ModuleRegistry = {};
    for (const [name, definition] of Object.entries(modules)) next[name === oldName ? normalized : name] = { ...definition, parent_id: definition.parent_id === oldName ? normalized : definition.parent_id };
    onChange(next);
  };

  const addModule = () => {
    const name = newName.trim();
    if (!name || modules[name]) return;
    onChange({ ...modules, [name]: { parent_id: "", subdomain: "", system: "", since: "", until: "", products: [] } });
    setNewName("");
  };

  // WP-146 件1：删除即执行（草稿可逆，不再弹阻断确认）＋toast 5 秒内撤销——撤销按名回插原定义，
  // 经 modulesRef 读最新注册表，避免闭包里的 modules 过期覆盖用户后续编辑。
  const deleteModule = (name: string) => {
    const definition = modules[name];
    const next = { ...modules };
    delete next[name];
    onChange(next);
    toast.success(TERM.DELETED_NOTICE, {
      duration: 5000,
      action: {
        label: TERM.UNDO_ACTION,
        onClick: () => {
          onChange({ ...modulesRef.current, [name]: definition });
        },
      },
    });
  };

  const columns: Array<Column<{ name: string; definition: ModuleDefinition }>> = [
    {
      key: "name",
      title: MODULES_COPY.COL_NAME,
      render: ({ name }) => <EditableCell.Text aria-label={smLabeledValueAria(name, MODULES_COPY.NAME_ARIA_SUFFIX)} style={{ paddingLeft: 8 }} defaultValue={name} disabled={disabled} onBlur={(event) => renameModule(name, event.target.value)} />,
    },
    {
      key: "system",
      title: <span title={MODULES_COPY.COL_SYSTEM_TITLE}>{MODULES_COPY.COL_SYSTEM}</span>,
      render: ({ name, definition }) => (
        <EditableCell.Text
          list="module-system-options"
          aria-label={`${name} system`}
          value={definition.system ?? ""}
          disabled={disabled}
          placeholder={MODULES_COPY.SYSTEM_PLACEHOLDER}
          onChange={(event) => updateModule(name, { system: event.target.value })}
          className={moduleIssues(definition, duplicateSystems).some((issue) => issue.includes("system")) ? "ring-status-warn-8" : ""}
        />
      ),
    },
    {
      key: "subdomain",
      title: <span title={MODULES_COPY.COL_SUBDOMAIN_TITLE}>{MODULES_COPY.COL_SUBDOMAIN}</span>,
      render: ({ name, definition }) => (
        <FilterSelect
          ariaLabel={`${name} subdomain`}
          title={MODULES_COPY.SUBDOMAIN_PICK_TITLE}
          searchPlaceholder={MODULES_COPY.SUBDOMAIN_FILTER_PLACEHOLDER}
          value={definition.subdomain ?? ""}
          onValueChange={(value) => updateModule(name, { subdomain: value as string })}
          disabled={disabled}
          className="w-full rounded"
          options={subdomainGroups.flatMap((group) =>
            group.entries.map((entry) => ({ value: entry.id, label: entry.label && entry.label !== entry.id ? `${entry.label} · ${entry.id}` : entry.id, group: group.domainLabel })),
          )}
        />
      ),
    },
    {
      key: "actions",
      title: "",
      align: "right",
      render: ({ name }) => (
        <Button type="button" variant="ghost" size="icon" aria-label={smLabeledValueAria(MODULES_COPY.DELETE_ARIA_PREFIX, name)} title={MODULES_COPY.DELETE_TITLE} disabled={disabled} onClick={() => deleteModule(name)} className="h-7 w-7 text-status-error hover:bg-status-error-3">
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <section aria-label={MODULES_COPY.SECTION_ARIA} className="space-y-3">
      <div className="rounded-lg border border-border-thin bg-surface-root/35">
        <div className="flex items-center justify-between border-b border-border-thin px-3 py-2">
          <div><h4 className="text-sm font-semibold text-text-main">{MODULES_COPY.HEADER}</h4><p className="mt-0.5 text-xs text-text-hint">{MODULES_COPY.INTRO}</p>
            {productNames.length === 0 && !versionsLoading && (
              <p className="mt-1 text-xs text-status-warn" data-testid="module-products-empty-hint">
                {MODULES_COPY.PRODUCTS_EMPTY_PREFIX}{onGoVersions ? <Button type="button" variant="link" onClick={onGoVersions} className="h-auto p-0 text-xs text-status-warn underline decoration-dotted">{MODULES_COPY.GO_VERSIONS_LINK}</Button> : MODULES_COPY.GO_VERSIONS_FALLBACK}
              </p>
            )}
            {versionsLoading && <p className="mt-1 text-xs text-text-hint">{MODULES_COPY.VERSIONS_LOADING}</p>}
            <p className="mt-1 text-xs text-text-sub" data-testid="module-field-governance">{MODULES_COPY.FIELD_GOVERNANCE_NOTE}</p>
            {subdomainGroups.every((group) => group.entries.length === 0) && (
              <p className="mt-1 text-xs text-status-warn" data-testid="module-subdomain-empty-hint">
                {MODULES_COPY.SUBDOMAIN_EMPTY_PREFIX}{onGoDomains ? <Button type="button" variant="link" onClick={onGoDomains} className="h-auto p-0 text-xs text-status-warn underline decoration-dotted">{MODULES_COPY.GO_DOMAINS_LINK}</Button> : MODULES_COPY.GO_DOMAINS_FALLBACK}
              </p>
            )}</div>
          <span className="text-xs text-text-hint">{names.length}{MODULES_COPY.COUNT_SUFFIX}</span>
        </div>
        <DataTable
          ariaLabel={MODULES_COPY.TABLE_ARIA}
          columns={columns}
          rows={names.map((name) => ({ name, definition: modules[name] }))}
          rowKey={({ name }) => name}
          density="md"
          minWidth={900}
          empty={{ title: MODULES_COPY.EMPTY }}
          rowClassName={({ definition }) => (moduleIssues(definition, duplicateSystems).length ? "bg-amber-9/[0.04]" : "")}
          expandable={{
            rowExpanded: () => true,
            onToggle: () => undefined,
            toggleColumn: false,
            render: ({ name, definition }) => {
              const issues = moduleIssues(definition, duplicateSystems);
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-text-hint" data-testid={`module-products-${name}`}>
                    <span className="w-20 shrink-0" title={MODULES_COPY.PRODUCTS_ROW_TITLE}>{MODULES_COPY.PRODUCTS_ROW_LABEL}</span>
                    <FilterSelect
                      multiple
                      ariaLabel={`${name} products`}
                      title={MODULES_COPY.PRODUCTS_PICK_TITLE}
                      searchPlaceholder={MODULES_COPY.PRODUCTS_FILTER_PLACEHOLDER}
                      value={definition.products ?? []}
                      onValueChange={(values) => updateModule(name, { products: values as string[] })}
                      disabled={disabled}
                      className="flex-1 rounded"
                      emptyLabel={MODULES_COPY.PRODUCTS_EMPTY_LABEL}
                      options={productNames.map((value) => ({ value, label: value, group: MODULES_COPY.GROUP_ACTIVE_PRODUCTS }))}
                    />
                  </div>
                  <div className={`flex min-h-5 items-center gap-1.5 text-xs ${issues.length ? "text-status-warn" : "text-status-fact-11"}`} role="status">{issues.length ? <><AlertTriangle className="h-4 w-4" />{issues.join("；")}</> : <><Check className="h-4 w-4" />{MODULES_COPY.FIELD_ISSUES_OK}</>}</div>
                </div>
              );
            },
          }}
        />
      </div>
      <datalist id="module-system-options">{systems.map((value) => <option key={value} value={value} />)}</datalist>
      <div className="flex max-w-xl items-center gap-2">
        <input aria-label={MODULES_COPY.NEW_NAME_ARIA} value={newName} disabled={disabled} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addModule(); }} className="h-8 min-w-0 flex-1 rounded-md bg-surface-root px-2 text-sm text-text-main ring-1 ring-border-thin" />
        <button type="button" aria-label={MODULES_COPY.ADD_ARIA} onClick={addModule} disabled={disabled || !newName.trim() || Boolean(modules[newName.trim()])} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-main ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40"><Plus className="h-4 w-4" />{MODULES_COPY.ADD_ACTION}</button>
      </div>
    </section>
  );
}
