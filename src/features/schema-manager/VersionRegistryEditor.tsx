import { useEffect, useMemo, useState } from "react";
import { TERM } from "@/constants/term-const";
import { VERSIONS_COPY, smOrdinalAria } from "./schema-manager-copy";
import { CheckCircle2, Loader2, Plus, Save, Snowflake, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/DataTable";
import { Tag } from "@/components/ui/tag";
import { EditableCell } from "@/components/data-table/editable-cell-group";
import type { Column } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useSchemaManagerStore } from "./schema-manager-store";
import { OBJECT_DICTIONARY } from "@/lib/object-dictionary";
import { fieldSemanticOf } from "@/lib/schema-shape";
// seq197 P3b：VERSION_PATTERN 单源（seq195 立法：server/shared/version-contract.cjs 唯一定义处）。
// #1610 缺陷修复轮：Vite dev 对项目内 .cjs 原样返回、无 CJS→ESM 互操作——前端 import（具名/默认）均 SyntaxError → dev 全站白屏（vitest 绿 + build 绿 ≠ dev 绿）。
// 改由 vite.config Node 侧 require 单源 + define 编译期内联，前端不再 import .cjs；dev/build/vitest 三态一致，取值语义不变。
import type { VersionRegistryData, VersionRegistryEntry, VersionRegistryProducts } from "./schema-manager-types";

declare const __VERSION_PATTERN_SOURCE__: string;
declare const __VERSION_PATTERN_FLAGS__: string;
const VERSION_PATTERN = new RegExp(__VERSION_PATTERN_SOURCE__, __VERSION_PATTERN_FLAGS__);

const STATUS_LABEL: Record<VersionRegistryEntry["status"], string> = {
  draft: VERSIONS_COPY.STATUS_DRAFT,
  released: VERSIONS_COPY.STATUS_RELEASED,
  deprecated: VERSIONS_COPY.STATUS_DEPRECATED,
};

// 状态列统一走 ui/tag 语义 tone（表间观感一致性批 2026-10-16）
const STATUS_TONE: Record<VersionRegistryEntry["status"], "warn" | "fact" | "neutral"> = {
  draft: "warn",
  released: "fact",
  deprecated: "neutral",
};

const VERSION_PATH_PATTERN = /^\$\.products\.(.+)\.versions\[(\d+)\](?:\.(.+))?$/;

type VersionDiagnostic = VersionRegistryData["diagnostics"][number];

interface ParsedVersionDiagnostic {
  product: string;
  index: number;
  field: string | null;
}

function parseVersionDiagnosticPath(path: string): ParsedVersionDiagnostic | null {
  const match = VERSION_PATH_PATTERN.exec(path);
  if (!match) return null;
  return { product: match[1], index: Number(match[2]), field: match[3] ?? null };
}

function diagnosticDetails(diagnostic: VersionDiagnostic): Record<string, unknown> {
  return diagnostic.details && typeof diagnostic.details === "object" && !Array.isArray(diagnostic.details)
    ? diagnostic.details as Record<string, unknown>
    : {};
}

function formatVersionDiagnostic(diagnostic: VersionDiagnostic, entry?: VersionRegistryEntry): string {
  const details = diagnosticDetails(diagnostic);
  if (diagnostic.code === "INVALID_VERSION" || diagnostic.code === "INVALID_VERSION_TYPE") {
    const value = entry?.id || String(details.value ?? "");
    const labelSuggestion = entry?.label && VERSION_PATTERN.test(entry.label.trim())
      ? VERSIONS_COPY.DIAG_LABEL_SUGGESTION(entry.label.trim())
      : "";
    return VERSIONS_COPY.DIAG_INVALID_VERSION(value || VERSIONS_COPY.DIAG_VALUE_EMPTY, labelSuggestion);
  }
  if (diagnostic.code === "VERSION_LABEL_REQUIRED") {
    return VERSIONS_COPY.DIAG_LABEL_REQUIRED;
  }
  if (diagnostic.code === "DUPLICATE_VERSION") {
    const firstIndex = Number(details.firstIndex);
    const duplicateHint = Number.isInteger(firstIndex) ? VERSIONS_COPY.DIAG_DUPLICATE_HINT(firstIndex) : "";
    return VERSIONS_COPY.DIAG_DUPLICATE(entry?.id || VERSIONS_COPY.DIAG_VALUE_EMPTY, duplicateHint);
  }
  if (diagnostic.code.includes("ALIAS")) {
    return `${VERSIONS_COPY.DIAG_ALIAS_PREFIX}${diagnostic.message}${VERSIONS_COPY.DIAG_ALIAS_SUFFIX}`;
  }
  return diagnostic.message;
}

function diagnosticsForRow(diagnostics: VersionDiagnostic[], product: string, index: number) {
  return diagnostics.filter((diagnostic) => {
    const parsed = parseVersionDiagnosticPath(diagnostic.path);
    return parsed?.product === product && parsed.index === index;
  });
}

function updateEntry(products: VersionRegistryProducts, product: string, index: number, patch: Partial<VersionRegistryEntry>): VersionRegistryProducts {
  const next = structuredClone(products);
  next[product].versions[index] = { ...next[product].versions[index], ...patch };
  return next;
}

export function VersionRegistryEditor({ disabled }: { disabled: boolean }) {
  // 字段级语义单源（B 档）：标签与说明自字典投影——编辑器禁自造字段文案；未登记字段回退旧文案
  const canonicalField = fieldSemanticOf(OBJECT_DICTIONARY, "versions", "canonical_product");
  const aliasesField = fieldSemanticOf(OBJECT_DICTIONARY, "versions", "product_aliases");
  const canonicalLabel = canonicalField?.label ?? VERSIONS_COPY.FALLBACK_CANONICAL_LABEL;
  const aliasesLabel = aliasesField?.label ?? VERSIONS_COPY.FALLBACK_ALIASES_LABEL;
  // 首次设定草稿：仅 canonicalProduct 空态（归档清空/未注册）可填——设定后身份锚点不可改（后端 IDENTITY_ANCHOR_IMMUTABLE 兜底）
  const [canonicalDraft, setCanonicalDraft] = useState("");
  const store = useSchemaManagerStore();
  const unconfigured = !store.productIdentity?.canonicalProduct;
  const data = store.versions;
  const productNames = useMemo(() => Object.keys(data?.products ?? {}).sort(), [data?.products]);
  const [activeProduct, setActiveProduct] = useState("");

  useEffect(() => {
    if (!activeProduct || !productNames.includes(activeProduct)) {
      const canonicalProduct = store.productIdentity?.canonicalProduct ?? "";
      setActiveProduct(productNames.includes(canonicalProduct) ? canonicalProduct : productNames[0] ?? "");
    }
  }, [activeProduct, productNames, store.productIdentity?.canonicalProduct]);

  if (store.versionsRequest.status === "loading" && !data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-accent-base" /></div>;
  if (store.versionsRequest.error && !data) return <div className="flex flex-col items-center gap-3 py-12"><p className="text-sm text-status-error">{store.versionsRequest.error}</p><button onClick={() => void store.loadVersions()} className="rounded-md bg-accent-bg px-3 py-1.5 text-sm text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)]">{TERM.RETRY_ACTION}</button></div>;
  if (!data) return null;

  const entries = activeProduct ? data.products[activeProduct]?.versions ?? [] : [];
  const totalVersions = Object.values(data.products).reduce((sum, definition) => sum + definition.versions.length, 0);
  const busy = disabled || store.versionsSaveStatus === "saving" || store.productIdentitySaveStatus === "saving" || store.versionsRequest.status === "loading";
  const hasDiagnostics = data.diagnostics.length > 0;
  const showSaveError = store.versionsSaveError && (!hasDiagnostics || store.versionsSaveError !== VERSIONS_COPY.SERVER_VALIDATION_FAILED_MSG);

  const addVersion = () => {
    const product = activeProduct || store.productIdentity?.canonicalProduct || "";
    if (!product) return;
    const next = structuredClone(data.products);
    if (!next[product]) next[product] = { versions: [] };
    next[product].versions.push({ id: "", label: "", status: "draft", release_date: null, aliases: [], snapshot: null });
    store.setVersionProducts(next);
    setActiveProduct(product);
  };

  const freeze = async (entry: VersionRegistryEntry) => {
    if (!window.confirm(VERSIONS_COPY.FREEZE_CONFIRM(activeProduct, entry.id))) return;
    await store.freezeVersion(activeProduct, entry.id);
  };

  // W4（卡 §12.1）：版本行迁移为语义表；冻结确认＝window.confirm 为既有测试契约钉死
  // （schema-version-registry.test：confirm 文案含「直接写回」），保留。草稿版本删除＝未保存草稿的
  // 可逆操作（仅草稿态可删、保存前可放弃）——WP-146 件1 起去掉阻断确认：删除即执行＋sonner toast
  // 5 秒内撤销（按原产品原下标回插，撤销时读 store 最新状态防闭包过期；已发布版本不受影响）。
  const deleteDraftVersion = (product: string, index: number) => {
    const entry = data?.products[product]?.versions[index];
    if (!entry) return;
    const next = structuredClone(data?.products ?? {});
    if (next[product]) next[product].versions.splice(index, 1);
    store.setVersionProducts(next);
    toast.success(TERM.DELETED_NOTICE, {
      duration: 5000,
      action: {
        label: TERM.UNDO_ACTION,
        onClick: () => {
          const current = useSchemaManagerStore.getState().versions;
          if (!current) return;
          const restored = structuredClone(current.products ?? {});
          if (!restored[product]) restored[product] = { versions: [] };
          restored[product].versions.splice(Math.min(index, restored[product].versions.length), 0, structuredClone(entry));
          store.setVersionProducts(restored);
        },
      },
    });
  };

  const columns: Array<Column<VersionRegistryEntry & { __index: number }>> = [
    {
      key: "id",
      title: VERSIONS_COPY.COL_ID,
      width: 160,
      render: (entry) => {
        const rowDiagnostics = diagnosticsForRow(data.diagnostics, activeProduct, entry.__index);
        const versionDiagnostics = rowDiagnostics.filter((diagnostic) => parseVersionDiagnosticPath(diagnostic.path)?.field?.startsWith("id"));
        const otherDiagnostics = rowDiagnostics.filter((diagnostic) => !["id", "label", "aliases"].some((field) => parseVersionDiagnosticPath(diagnostic.path)?.field?.startsWith(field)));
        const errorId = `version-${entry.__index}-number-error`;
        return (
          <div className="space-y-1">
            <EditableCell.Text aria-label={smOrdinalAria(VERSIONS_COPY.COL_ID, entry.__index + 1)} aria-invalid={versionDiagnostics.length > 0} aria-describedby={versionDiagnostics.length > 0 ? errorId : undefined} value={entry.id} placeholder={VERSIONS_COPY.PLACEHOLDER_ID} disabled={entry.status !== "draft" || busy} invalid={versionDiagnostics.length > 0} onChange={(event) => store.setVersionProducts(updateEntry(data.products, activeProduct, entry.__index, { id: event.target.value }))} />
            {versionDiagnostics.map((diagnostic, diagnosticIndex) => <p id={diagnosticIndex === 0 ? errorId : undefined} key={`${diagnostic.code}-${diagnosticIndex}`} className="text-xs leading-5 text-status-error">{formatVersionDiagnostic(diagnostic, entry)}</p>)}
            {otherDiagnostics.map((diagnostic, diagnosticIndex) => <p key={`other-${diagnostic.code}-${diagnosticIndex}`} className="text-xs leading-5 text-status-error">{formatVersionDiagnostic(diagnostic, entry)}</p>)}
          </div>
        );
      },
    },
    {
      key: "label",
      title: VERSIONS_COPY.COL_LABEL,
      render: (entry) => {
        const labelDiagnostics = diagnosticsForRow(data.diagnostics, activeProduct, entry.__index).filter((diagnostic) => parseVersionDiagnosticPath(diagnostic.path)?.field?.startsWith("label"));
        const errorId = `version-${entry.__index}-label-error`;
        return (
          <div className="space-y-1">
            <EditableCell.Text aria-label={smOrdinalAria(VERSIONS_COPY.COL_LABEL, entry.__index + 1)} aria-invalid={labelDiagnostics.length > 0} aria-describedby={labelDiagnostics.length > 0 ? errorId : undefined} value={entry.label} placeholder={VERSIONS_COPY.PLACEHOLDER_LABEL} disabled={entry.status !== "draft" || busy} invalid={labelDiagnostics.length > 0} onChange={(event) => store.setVersionProducts(updateEntry(data.products, activeProduct, entry.__index, { label: event.target.value }))} />
            {labelDiagnostics.map((diagnostic, diagnosticIndex) => <p id={diagnosticIndex === 0 ? errorId : undefined} key={`${diagnostic.code}-${diagnosticIndex}`} className="text-xs leading-5 text-status-error">{formatVersionDiagnostic(diagnostic, entry)}</p>)}
          </div>
        );
      },
    },
    {
      key: "aliases",
      title: VERSIONS_COPY.COL_ALIASES,
      width: 190,
      render: (entry) => {
        const aliasDiagnostics = diagnosticsForRow(data.diagnostics, activeProduct, entry.__index).filter((diagnostic) => parseVersionDiagnosticPath(diagnostic.path)?.field?.startsWith("aliases"));
        const errorId = `version-${entry.__index}-alias-error`;
        return (
          <div className="space-y-1">
            <EditableCell.Text aria-label={smOrdinalAria(VERSIONS_COPY.ALIASES_ARIA_SUFFIX, entry.__index + 1)} aria-invalid={aliasDiagnostics.length > 0} aria-describedby={aliasDiagnostics.length > 0 ? errorId : undefined} value={entry.aliases.join(", ")} placeholder={VERSIONS_COPY.PLACEHOLDER_ALIASES} disabled={entry.status !== "draft" || busy} invalid={aliasDiagnostics.length > 0} onChange={(event) => store.setVersionProducts(updateEntry(data.products, activeProduct, entry.__index, { aliases: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
            {aliasDiagnostics.map((diagnostic, diagnosticIndex) => <p id={diagnosticIndex === 0 ? errorId : undefined} key={`${diagnostic.code}-${diagnosticIndex}`} className="text-xs leading-5 text-status-error">{formatVersionDiagnostic(diagnostic, entry)}</p>)}
          </div>
        );
      },
    },
    {
      key: "status",
      title: VERSIONS_COPY.COL_STATUS,
      width: 100,
      render: (entry) => <Tag tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Tag>,
    },
    {
      key: "actions",
      title: VERSIONS_COPY.COL_ACTIONS,
      align: "right",
      width: 92,
      render: (entry) => (
        <div className="flex items-center justify-end gap-1">
          {entry.status === "draft" && <Button type="button" variant="ghost" size="icon" aria-label={VERSIONS_COPY.FREEZE_ARIA(entry.id)} title={VERSIONS_COPY.FREEZE_TITLE} onClick={() => void freeze(entry)} disabled={busy || store.versionsSaveStatus === "dirty" || !entry.id} className="h-8 w-8 text-cyan-11 hover:bg-surface-hover"><Snowflake className="h-4 w-4" /></Button>}
          {entry.status === "draft" && <Button type="button" variant="ghost" size="icon" aria-label={VERSIONS_COPY.DELETE_ARIA(entry.id, entry.__index + 1)} title={VERSIONS_COPY.DELETE_DRAFT_TITLE} onClick={() => deleteDraftVersion(activeProduct, entry.__index)} disabled={busy} className="h-8 w-8 text-status-error hover:bg-surface-hover"><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <div data-testid="version-registry-editor" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-thin pb-3">
        <div>
          <h3 className="text-sm font-semibold text-text-main">{VERSIONS_COPY.HEADER_TITLE}</h3>
          <p className="mt-1 text-xs text-text-hint">{data.sourceFile}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-sub">{totalVersions}{VERSIONS_COPY.TOTAL_SUFFIX}</span>
          <button type="button" aria-label={VERSIONS_COPY.VALIDATE_ARIA} onClick={() => void store.validateVersions()} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-main ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />{VERSIONS_COPY.VALIDATE_ACTION}</button>
        </div>
      </div>

      {store.productIdentity && <div className="grid gap-3 border-y border-border-thin py-3 md:grid-cols-[180px_1fr_auto] md:items-end">
        <label className="space-y-1 text-xs text-text-sub">
          <span>{canonicalLabel}</span>
          <input
            aria-label={canonicalLabel}
            value={unconfigured ? canonicalDraft : store.productIdentity.canonicalProduct ?? ""}
            readOnly={!unconfigured}
            placeholder={unconfigured ? VERSIONS_COPY.CANONICAL_FIRST_SET_PLACEHOLDER : undefined}
            title={unconfigured ? undefined : VERSIONS_COPY.CANONICAL_LOCKED_TITLE}
            onChange={unconfigured ? (event) => setCanonicalDraft(event.target.value) : undefined}
            disabled={busy && unconfigured}
            className="h-8 w-full rounded-md bg-surface-root px-2 text-sm text-text-main ring-1 ring-border-thin disabled:opacity-40"
          />
        </label>
        <label className="space-y-1 text-xs text-text-sub">
          <span>{aliasesLabel}</span>
          <input aria-label={VERSIONS_COPY.ALIASES_ARIA} value={store.productIdentity.aliases.join(", ")} placeholder={VERSIONS_COPY.PLACEHOLDER_ALIASES} disabled={busy} onChange={(event) => store.setProductAliases(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} className="h-8 w-full rounded-md bg-surface-root px-2 text-sm text-text-main ring-1 ring-border-thin disabled:opacity-40" />
        </label>
        <button type="button" aria-label={unconfigured ? VERSIONS_COPY.SAVE_IDENTITY_ACTION : VERSIONS_COPY.SAVE_ALIASES_ACTION} title={VERSIONS_COPY.SAVE_IDENTITY_TITLE} onClick={() => void store.saveProductIdentity(canonicalDraft || undefined)} disabled={busy || (store.productIdentitySaveStatus !== "dirty" && !(unconfigured && canonicalDraft.trim()))} className="flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs text-text-main ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40"><Save className="h-4 w-4" />{unconfigured ? VERSIONS_COPY.SAVE_IDENTITY_ACTION : VERSIONS_COPY.SAVE_ALIASES_ACTION}</button>
        <p className="text-xs text-text-hint md:col-span-2">{store.productIdentity.sourceFile}{store.productIdentity.note ? `${VERSIONS_COPY.IDENTITY_NOTE_PREFIX}${store.productIdentity.note}` : ""}{unconfigured ? VERSIONS_COPY.IDENTITY_EMPTY_HINT : ""}</p>
        {store.productIdentityError && <p className="text-xs text-status-error md:col-span-3">{store.productIdentityError}</p>}
      </div>}

      {totalVersions < 2 && <p className="text-xs text-status-warn">{VERSIONS_COPY.MIN_VERSIONS_WARNING}</p>}
      {showSaveError && <p className="text-xs text-status-error">{store.versionsSaveError}</p>}
      {hasDiagnostics && <p className="text-xs text-status-error">{VERSIONS_COPY.DIAGNOSTICS_SUMMARY(data.diagnostics.length)}</p>}

      <div className="flex flex-wrap items-end gap-2">
        {productNames.length > 1 && <label className="text-xs text-text-sub">{VERSIONS_COPY.PRODUCT_LABEL}<Select aria-label={VERSIONS_COPY.SELECT_PRODUCT_ARIA} value={activeProduct} onChange={(event) => setActiveProduct(event.target.value)} className="ml-2">{productNames.map((product) => <option key={product}>{product}</option>)}</Select></label>}
      </div>

      {activeProduct && <DataTable
        ariaLabel={VERSIONS_COPY.TABLE_ARIA}
        columns={columns}
        rows={entries.map((entry, index) => ({ ...entry, __index: index }))}
        rowKey={(entry) => `${entry.id}-${entry.__index}`}
        density="md"
        minWidth={820}
        empty={{ title: VERSIONS_COPY.EMPTY_NO_VERSIONS }}
      />}

      {(activeProduct || store.productIdentity?.canonicalProduct) && <button type="button" onClick={addVersion} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-main ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-40"><Plus className="h-4 w-4" />{VERSIONS_COPY.ADD_VERSION}</button>}
    </div>
  );
}
