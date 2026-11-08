
import { resolveVersionOptions, type ManagedArticleProduct } from "./managed-article-field-helpers";
import { ENTITY_REPAIR_COPY, managedDomainAria, managedNotInEnum, managedSubdomainAria } from "../components-copy";

// PR-050（渲染器收敛·控制层）：文章受管字段控件语义单源。
// 此前 CandidateFieldForm（补齐表单）与 RepairFieldEditor（修复抽屉）各自实现一套字段→控件映射，
// 字段契约一变就要人工记住同步两处——PR-046 只改补齐表单漏改抽屉（category-path 双口径 13:53 报障）
// 即此结构的直接产物。收敛后：控件形态/联动/回退语义只在本文件定义一次，两棵表单树复用；
// 各自保留流程壳（提交路径/预览流/分组），不合并业务流程。
// 字段语义表（与 contracts article.fields 元数据对齐）：
//   category-path → 两段聚合控件（WP-040 Master 2026-10-29「2A」：domain/subdomain 双下拉，整值=domain:subdomain
//     ——topic 段退役〔PR-063 的文件名派生与 sourcePath 依赖整体移除，修复抽屉漏接 sourcePath 的缺陷随之消解〕）
//   version → 产品联动下拉（在册版本才可选，无产品/无版本时禁用）
//   product/article_type/module/doc-type → 闭合枚举下拉（带「当前值不在枚举」回退项）

type Props = {
  field: string;
  label: string;
  value: string;
  options?: string[];
  products?: ManagedArticleProduct[];
  productValue?: string;
  disabled?: boolean;
  placeholder?: string;
  /** 视觉变体：补齐表单（root）/ 修复抽屉（hover）底色不同，语义不变 */
  surface?: "root" | "hover";
  onChange: (value: string) => void;
};

const SURFACE_CLASS = {
  root: "h-8 rounded-md border border-border-thin bg-surface-root px-2 text-sm text-text-main",
  hover: "mt-1 h-8 w-full rounded-md bg-surface-hover px-2.5 text-sm text-text-main ring-1 ring-border-thin focus:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50",
} as const;


export function ManagedArticleFieldControl({ field, label, value, options = [], products, productValue, disabled = false, surface = "root", onChange }: Props) {
  const base = SURFACE_CLASS[surface];

  if (field === "category-path") {
    // WP-040（Master 2026-10-29「2A」）：两段聚合控件——domain/subdomain 从 options（二段枚举）选，
    // 整值 = domain:subdomain。topic 段退役（PR-063 文件名派生移除）。
    const parts = value.split(":");
    const domain = parts[0] || "";
    const subdomain = parts[1] || "";
    const twoPart = options.filter((option) => !option.includes(" ") && option.includes(":"));
    const domains = [...new Set(twoPart.map((o) => o.split(":")[0]))];
    const subdomainOptions = twoPart.filter((o) => o.startsWith(domain + ":")).map((o) => o.split(":")[1]);
    return (
      <div className="flex items-center gap-1">
        <select aria-label={managedDomainAria(label)} className={base} value={domain} disabled={disabled}
          onChange={(event) => { const d = event.target.value; const s = (twoPart.find((o) => o.startsWith(d + ":")) || "").split(":")[1] || ""; onChange(`${d}:${s}`); }}>
          <option value="">{ENTITY_REPAIR_COPY.PICK_DOMAIN}</option>
          {domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label={managedSubdomainAria(label)} className={base} value={subdomain} disabled={disabled || !domain}
          onChange={(event) => onChange(`${domain}:${event.target.value}`)}>
          <option value="">{ENTITY_REPAIR_COPY.PICK_SUBDOMAIN}</option>
          {subdomainOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    );
  }

  const resolved = field === "version" ? resolveVersionOptions({ products, productValue, options }) : options;
  const known = value === "" || resolved.includes(value);
  const versionStarved = field === "version" && resolved.length === 0;
  return (
    <select
      aria-label={label}
      className={`${base} ${known ? "" : "ring-1 ring-status-warn"}`}
      value={value}
      disabled={disabled || versionStarved}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{ENTITY_REPAIR_COPY.UNFILLED_OPTION}</option>
      {!known && value !== "" && <option value={value}>{managedNotInEnum(value)}</option>}
      {resolved.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
    </select>
  );
}
