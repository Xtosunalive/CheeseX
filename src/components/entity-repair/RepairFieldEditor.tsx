import { FilterSelect } from "@/components/filter-select";
import { Input } from "@/components/ui/input";
import { TokenInput } from "./TokenInput";
import { DateField } from "./DateField";
import { AutocompleteField } from "./AutocompleteField";
// PR-050：文章受管字段（product/version/module/article_type/doc-type/category-path）的控件形态
// 收敛到 managed-article-field 单源——本编辑器只做 kind 分发，不再自持文章字段语义
// （旧自持语义的 version 走 suggestions 文本框，注册表在册版本可自由输入，属读侧缺口）。
import { ManagedArticleFieldControl } from "./managed-article-field";
import { ENTITY_REPAIR_COPY, SHARED_UI_COPY, repairDateAria, repairGrowableAria, repairOptionsAria, repairSelectTitle, repairSuggestionBasis } from "../components-copy";

export type RepairFieldKind = "text" | "date" | "boolean" | "array" | "json" | "select";

/** PR-050：受管文章字段集——这些字段在文章源上下文中一律走单源控件（不论 kind 升降维判定） */
const MANAGED_ARTICLE_FIELDS = new Set(["product", "article_type", "module", "doc-type", "category-path"]);

export type RepairFieldEditorProps = {
  field: string;
  label: string;
  /** 契约 ComplianceFinding.message 为可选；缺省时不渲染说明行 */
  message?: string;
  value: unknown;
  kind: RepairFieldKind;
  allowedValues?: string[];
  placeholder?: string;
  hint?: string;
  pattern?: string;
  booleanLabel?: string;
  required?: boolean;
  suggestions?: string[];
  /** 契约 ComplianceFinding.suggestions[] 项形状（reason/confidence 可选）；reason 缺省时不渲染建议行 */
  suggestion?: { reason?: string; confidence?: number };
  disabled?: boolean;
  showLabel?: boolean;
  /** seq178：写门拒绝时该字段对应的合规阻断原因（错误色回显；无则不渲染） */
  errorText?: string;
  onChange: (value: unknown) => void;
  /** PR-050：文章源上下文——受管文章字段分发给单源控件（version 联动产品、category-path 两段式 WP-040） */
  isArticle?: boolean;
  /** PR-050：单源 version 联动所需——当前产品值与产品注册表（name→versions） */
  productValue?: string;
  products?: { name: string; versions: string[] }[];
};

function displayValue(kind: RepairFieldKind, value: unknown) {
  if (kind === "json") return typeof value === "string" ? value : JSON.stringify(value ?? [], null, 2);
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

/** 行内阻断原因（seq178 承诺「按字段回显」）：文案与样式的唯一出处，编辑器与修复抽屉共用它 */
export function FieldBlockerReason({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-status-error">{ENTITY_REPAIR_COPY.BLOCKER_REASON_PREFIX}{message}</p>;
}

export function RepairFieldEditor({ field, label, message, value, kind, allowedValues = [], placeholder, hint, pattern, booleanLabel, required, suggestions = [], suggestion, disabled = false, showLabel = true, errorText, onChange, isArticle, productValue, products }: RepairFieldEditorProps) {
  // 行内阻断原因回显（seq178 的承诺是「按字段回显」）：此前这段只在末路分支渲染，
  // 数组（tags/module）提前 return 就把写门带回的字段级原因静默丢掉；布尔走抽屉的 BooleanPoolRow，同一段文案在此处也够不着。
  // 文案与样式统一走导出的 FieldBlockerReason，避免抽屉与编辑器各抄一份。
  const reasonBlock = errorText ? <FieldBlockerReason message={errorText} /> : null;

  if (kind === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-text-main" aria-required={required || undefined}>
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-border-thin accent-accent-main" />
        {booleanLabel || label}{required && <span className="text-status-error" aria-hidden="true">*</span>}
      </label>
    );
  }

  // 数组字段：有枚举用 FilterSelect multiple，否则用 TokenInput
  if (kind === "array") {
    const arrayValue = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    if (allowedValues.length > 0) {
      return (
        <div aria-required={required || undefined}>
          <FilterSelect
            ariaLabel={repairOptionsAria(label)}
            title={repairSelectTitle(label)}
            value={arrayValue}
            onValueChange={(next) => onChange(Array.isArray(next) ? next : next ? [next] : [])}
            multiple
            disabled={disabled}
            placeholder={repairSelectTitle(label)}
            emptyLabel={ENTITY_REPAIR_COPY.CLEAR_ALL}
            className="mt-1 w-full text-sm"
            options={allowedValues.map((option) => ({ value: option, label: option, group: ENTITY_REPAIR_COPY.OPTION_GROUP_SCHEMA }))}
          />
          {reasonBlock}
        </div>
      );
    }
    return (
      <>
        <TokenInput ariaLabel={label} values={arrayValue} onChange={onChange} placeholder={placeholder} suggestions={suggestions} disabled={disabled} />
        {reasonBlock}
      </>
    );
  }

  // hint 与 placeholder 是同一件事的两份来源（hint=后端 rules.json fields[*].hint 随 finding 下发；
  // placeholder=前端母版回落）。两条同时出现会在同一张卡片上给出两份「填写要求」（如 architecture-node-id
  // 既显示占位示例又显示「格式：…」），故 hint 优先、placeholder 仅作回落。
  // 条件与下方 hint 渲染条件保持同一判据，避免「hint 不渲染却把 placeholder 也吞掉」的空白态。
  const showHint = Boolean(hint) && kind !== "select";
  const effectivePlaceholder = showHint ? undefined : placeholder;

  // PR-050：文章源上下文中的受管字段（product/article_type/module/doc-type/category-path/version）
  // 一律分发给单源控件——控件形态（两段式/产品联动/枚举回退）只在一处定义。
  // version 不进 MANAGED_ARTICLE_FIELDS 集合判断（它还要在无产品注册表信息时退回 suggestions），
  // 单独在此分流：有 products 时走单源联动下拉，否则维持原 suggestions 语义（实体源/降级场景）。
  const managedArticle = isArticle && (MANAGED_ARTICLE_FIELDS.has(field) || field === "version");
  const managedControl = managedArticle ? (
    <ManagedArticleFieldControl
      field={field}
      label={label}
      value={displayValue("text", value)}
      options={field === "version" ? allowedValues : [...new Set([...allowedValues, ...suggestions])]}
      products={field === "version" ? products : undefined}
      productValue={field === "version" ? productValue : undefined}
      disabled={disabled || (field === "version" && !products)}
      placeholder={placeholder}
      surface="hover"
      onChange={onChange}
    />
  ) : null;

  // ADR-006 修订A（Master 2026-10-29「按A」）：实体侧 arch_category＝生长字段——可选可立
  // （datalist 建议既有类别；新值直接填，保存时生长进该实体子域的分类矩阵，配置页同步可见）。
  const growableCategory = field === "arch_category" && !isArticle && kind === "select";
  const control = managedControl ?? (growableCategory ? (
    <div className="mt-1">
      <Input
        list="entity-category-growth-options"
        aria-label={repairGrowableAria(label)}
        title={ENTITY_REPAIR_COPY.GROWABLE_TITLE}
        className="h-8 w-full rounded-md border border-border-thin bg-surface-root px-2 text-sm text-text-main"
        value={Array.isArray(value) ? String(value[0] || "") : String(value ?? "")}
        disabled={disabled}
        placeholder={ENTITY_REPAIR_COPY.GROWABLE_PLACEHOLDER}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id="entity-category-growth-options">
        {allowedValues.map((option) => <option key={option} value={option} />)}
      </datalist>
    </div>
  ) : kind === "select" ? (
    <FilterSelect
      ariaLabel={repairOptionsAria(label)}
      title={repairSelectTitle(label)}
      value={Array.isArray(value) ? String(value[0] || "") : String(value ?? "")}
      onValueChange={onChange}
      disabled={disabled}
      placeholder={SHARED_UI_COPY.SELECT_PLACEHOLDER}
      className="mt-1 w-full text-sm"
      options={[
        { value: "", label: field === "arch_subdomain" ? ENTITY_REPAIR_COPY.CLEAR_SUBDOMAIN : SHARED_UI_COPY.SELECT_PLACEHOLDER, group: SHARED_UI_COPY.OPTION_GROUP_SCOPE },
        ...allowedValues.map((option) => ({ value: option, label: option, group: ENTITY_REPAIR_COPY.OPTION_GROUP_SCHEMA })),
      ]}
    />
  ) : kind === "date" ? (
    <DateField ariaLabel={repairDateAria(label)} value={value} onChange={onChange} required={required} disabled={disabled} />
  ) : kind === "json" ? (
    <textarea
      aria-label={`${label} JSON`}
      placeholder={effectivePlaceholder}
      className="mt-1 min-h-24 w-full rounded-md bg-surface-hover p-2 font-mono text-xs text-text-main ring-1 ring-border-thin focus:ring-border-focus"
      value={displayValue(kind, value)}
      onChange={(event) => {
        try { onChange(JSON.parse(event.target.value)); }
        catch { onChange(event.target.value); }
      }}
    />
  ) : suggestions.length > 0 ? (
    <AutocompleteField field={field} label={label} value={value} suggestions={suggestions} placeholder={effectivePlaceholder} pattern={pattern} required={required} disabled={disabled} onChange={onChange} />
  ) : (
    <input type="text" aria-label={label} aria-required={required || undefined} disabled={disabled} pattern={pattern} placeholder={effectivePlaceholder} className="mt-1 h-8 w-full rounded-md bg-surface-hover px-2.5 text-sm text-text-main ring-1 ring-border-thin focus:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50" value={displayValue(kind, value)} onChange={(event) => onChange(event.target.value)} />
  ));

  return (
    <div className="block" aria-required={required || undefined}>
      {showLabel && <span className="text-xs font-medium text-text-main">{label}{required && <span className="ml-0.5 text-status-error" aria-hidden="true">*</span>}</span>}
      {message ? <span className="block text-xs text-text-sub">{showLabel ? `${label} · ` : ""}{message}</span> : null}
      {control}
      {reasonBlock}
      {/* hint 自带语义（有的是必填声明、有的是格式示例），不得再套「格式：」前缀——
          否则产出「格式：实体名称（title）是必填字段」这类不通的文案。 */}
      {showHint && <p className="mt-1 text-xs text-text-hint">{hint}</p>}
      {suggestion?.reason && <p className="mt-1 text-xs text-status-loading">{repairSuggestionBasis(suggestion.reason, Math.round((suggestion.confidence ?? 0) * 100))}</p>}
    </div>
  );
}
