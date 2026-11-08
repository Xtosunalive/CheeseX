import { ENTITY_CREATE_FIELDS, type EntityFieldControl, type EntityFieldGroup } from "./entity-create-fields";
import type { RepairFieldKind } from "./RepairFieldEditor";
// seq209：字段中文名从 shared/field-labels.mjs 派生（本域=article 的文章级属性 / entity 的实体属性），
// 本文件不再持有中文字面量。
import { FIELD_LABELS } from "../../../shared/field-labels.mjs";
import { TERM } from "@/constants/term-const";
import { ENTITY_FIELD_PLACEHOLDER_COPY } from "../components-copy";

/**
 * 实体修复字段模型 —— 两个修复入口（待处理问题补齐 / 实体合规修复）的
 * 字段定义、控件路由、必填校验唯一权威源。
 *
 * 禁止在组件内用散落的 Set（ARRAY_FIELDS / DATE_FIELDS 等）判断字段类型，
 * 一律通过本模块的 resolveFieldKind / fieldDefFor 获取。
 */

export type RepairFieldDef = {
  field: string;
  label: string;
  control: EntityFieldControl;
  required: boolean;
  group: EntityFieldGroup | "article";
  placeholder?: string;
  booleanLabel?: string;
};

/** 实体创建模板之外的文章级受管属性（实体合规修复入口使用） */
const ARTICLE_REPAIR_FIELDS: RepairFieldDef[] = [
  { field: "article_id", label: FIELD_LABELS.article.article_id, control: "text", required: false, group: "article", placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.ARTICLE_ID_EXAMPLE },
  { field: "product", label: FIELD_LABELS.article.product, control: "text", required: false, group: "article" },
  { field: "version", label: FIELD_LABELS.article.version, control: "text", required: false, group: "article", placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.VERSION_EXAMPLE },
  { field: "article_type", label: FIELD_LABELS.article.article_type, control: "select", required: false, group: "article" },
  { field: "doc-type", label: FIELD_LABELS.article["doc-type"], control: "select", required: false, group: "article" },
  { field: "category-path", label: FIELD_LABELS.article["category-path"], control: "text", required: false, group: "article", placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.CATEGORY_PATH_EXAMPLE },
];

/** 全量字段定义：实体创建模板 + 文章级受管属性 */
export const REPAIR_FIELD_DEFS: RepairFieldDef[] = [
  ...ENTITY_CREATE_FIELDS.map((spec) => ({
    field: spec.field,
    label: spec.label,
    control: spec.control,
    required: spec.required,
    group: spec.group as RepairFieldDef["group"],
    placeholder: spec.placeholder,
    booleanLabel: spec.field === "arch_component" ? FIELD_LABELS.entity.arch_component : undefined,
  })),
  ...ARTICLE_REPAIR_FIELDS,
];

const DEF_INDEX = new Map(REPAIR_FIELD_DEFS.map((def) => [def.field, def]));

/** 按字段名查找定义；未知字段返回 undefined */
export function fieldDefFor(field: string | null | undefined): RepairFieldDef | undefined {
  return field ? DEF_INDEX.get(field) : undefined;
}

/** 字段标签（回退到字段名本身）；复合键（如 "arch_since/arch_until"）逐段映射（#1804 用户看懂哪个字段填错） */
export function fieldLabel(field: string | null | undefined): string {
  if (!field) return TERM.FIELD_LABEL_FALLBACK;
  if (field.includes("/")) {
    return field.split("/").map((part) => fieldDefFor(part)?.label || part).join(" / ");
  }
  return fieldDefFor(field)?.label || field;
}

/**
 * #1804：把写门明细文本里的英文字段名替换为页面中文字段名（label 单源 = REPAIR_FIELD_DEFS）。
 * 服务端 message 常以裸字段名表述（如「arch_since 必须小于 arch_until」），用户无从对应表单输入框；
 * 按字段名长度降序替换（避免短名先替换破坏长名，如 tags / arch_tags 类前缀重叠）。
 */
export function humanizeFieldTerms(message: string): string {
  let out = message;
  const defs = [...REPAIR_FIELD_DEFS].sort((a, b) => b.field.length - a.field.length);
  for (const def of defs) {
    // frontmatter.<field> 是服务端 schema 技术路径（排障信息）——保持原文不替换
    const pattern = new RegExp("(?<!frontmatter\\.)" + def.field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    if (pattern.test(out)) {
      out = out.replace(pattern, def.label);
    }
  }
  return out;
}

/**
 * 控件类型由字段 metadata（control）决定，不再依赖字段名散落在多个 Set 中。
 * select 类字段在没有枚举可用值时降级为 text；
 * text 类字段在合规检查提供受管选项（allowedValues）时升级为单选下拉。
 * 由调用方传入 allowedValues。
 */
export function resolveFieldKind(control: EntityFieldControl, allowedValues: string[] = []): RepairFieldKind {
  if (control === "select" && allowedValues.length === 0) return "text";
  if (control === "text" && allowedValues.length > 0) return "select";
  // 2026-10-08 字段托管：readonly-system 是表单层拦截形态（抽屉行只读不展开），
  // 不该流到编辑器；防御性窄化为 text（若调用方漏拦，编辑器按文本渲染但写侧仍拒——双层防线）。
  if (control === "readonly-system" || control === "boolean" || control === "date" || control === "json" || control === "array") return control === "readonly-system" ? "text" : control;
  return control;
}

/**
 * 裁决 2C（2026-09-27）：字段本应是枚举选择（control=select 或历史上由 allowedValues 升维），
 * 但 Schema 枚举表为空 → 该字段在写侧必被 fail-closed 拒绝（enum-table-empty）。
 * UI 不再把这种字段降级为自由文本框诱导无效输入，而是保持 disabled 等待枚举表补录。
 * module 特例：实体语义下 control=array，但写侧同样走 moduleNames 枚举校验，一并禁用。
 */
export function isEnumStarvedField(field: string, allowedValues: string[]): boolean {
  const ENUM_BOUND_FIELDS = new Set(["arch_layer", "arch_category", "arch_subdomain", "status", "module", "article_type", "doc-type"]);
  return ENUM_BOUND_FIELDS.has(field) && allowedValues.length === 0;
}

/** 判断字段值是否为空（null / undefined / 空串 / 空数组） */
export function isFieldEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * 预览前统一 required 校验。
 * 返回缺失必填字段的标签列表；空数组表示校验通过。
 */
export function validateRequiredFields(defs: RepairFieldDef[], values: Record<string, unknown>): string[] {
  return defs.filter((def) => def.required && isFieldEmpty(values[def.field])).map((def) => def.label);
}
