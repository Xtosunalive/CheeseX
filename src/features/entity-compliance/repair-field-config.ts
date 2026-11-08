// 修复抽屉字段配置（自 EntityRepairDrawer 拆出——组件文件只留组件；本文件承载
// 抽屉域的字段形态判定与示例文案表，测试与抽屉共用）。
import type { RepairFieldKind } from "@/components/entity-repair";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import { ENTITY_FIELD_PLACEHOLDER_COPY } from "@/components/components-copy";

// 字段形态集合（module/tags/aliases 数组；arch_version_overrides JSON；date/updated 日期）
export const ARRAY_FIELDS = new Set(["module", "tags", "aliases"]);
export const JSON_FIELDS = new Set(["arch_version_overrides"]);
export const DATE_FIELDS = new Set(["date", "updated"]);

// 示例文案母版=entity-create-fields.ts spec.placeholder（seq190 P3c 2→1 单源化）：
// 两个历史漂移点（architecture-node-id / tags）现已由母版派生，本文件不存任何漂移映射字面量，快照锁死一字不差；
// tags 的母版文案以 TokenInput 真实行为为准（回车或失焦把整串作为一个标签入列、不切分逗号，后端只收 string[]），
// 故不得再出现引导用户输入逗号分隔串的表述。
// drawer 专属 4 项（母版无 placeholder）为声明超集；arch_version_overrides 虽随派生但被 JSON_FIELDS 短路，运行时无感。禁止回填漂移字面量。
export const PLACEHOLDERS: Record<string, string> = {
  ...Object.fromEntries(ENTITY_CREATE_FIELDS.filter((spec) => spec.placeholder).map((spec) => [spec.field, spec.placeholder as string])),
  aliases: ENTITY_FIELD_PLACEHOLDER_COPY.ALIASES_INPUT,
  article_id: ENTITY_FIELD_PLACEHOLDER_COPY.ARTICLE_ID_EXAMPLE,
  version: ENTITY_FIELD_PLACEHOLDER_COPY.VERSION_EXAMPLE,
  "category-path": ENTITY_FIELD_PLACEHOLDER_COPY.CATEGORY_PATH_EXAMPLE,
};

// #1396：文章意识——文章源（standard-article）的 module 是单值字符串（后端 article 分支校验
// "module 必须是非空字符串"），不得按实体语义渲染多选数组；tags 两侧均为数组不受影响。
export function articleAwareFieldKind(field: string, allowedValues: string[], isArticle: boolean): RepairFieldKind {
  if (field === "arch_component") return "boolean";
  if (ARRAY_FIELDS.has(field) && !(isArticle && field === "module")) return "array";
  if (allowedValues.length) return "select";
  if (JSON_FIELDS.has(field)) return "json";
  if (DATE_FIELDS.has(field)) return "date";
  return "text";
}
