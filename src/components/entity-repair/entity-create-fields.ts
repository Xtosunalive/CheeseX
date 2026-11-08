// seq209：字段中文名从 shared/field-labels.mjs 派生（本域=entity），本文件不再持有中文字面量。
import { FIELD_LABELS } from "../../../shared/field-labels.mjs";
import { ENTITY_FIELD_GROUP_LABELS, ENTITY_FIELD_PLACEHOLDER_COPY } from "../components-copy";

export type EntityFieldGroup = "identity" | "classification" | "lifecycle" | "relations";
export type EntityFieldControl = "text" | "date" | "boolean" | "array" | "json" | "select" | "readonly-system";
export type EntityFieldSpec = { field: string; label: string; group: EntityFieldGroup; required: boolean; control: EntityFieldControl; readOnly?: boolean; placeholder?: string };

// required 语义（2026-09-13 裁决）：严格跟随后端 rules.json 的 required:true（硬阻断 6 项）。
// module/arch_layer/arch_category/updated 在后端是 warn 级「建议填」（onEmpty:warn），此处 required:false（可留空，下拉候选/提示已承载建议语义）。
// 对齐锁测试 src/test/entity-fields-ssot.test.ts 锁「前端 required 集 ≡ 后端 rules.json required 集」。
export const ENTITY_CREATE_FIELDS: EntityFieldSpec[] = [
  { field: "title", label: FIELD_LABELS.entity.title, group: "identity", required: true, control: "text" },
  // WP-113 M2 字段托管：新建组件身份由服务端在唯一取号点铸造（server/shared/entity-identity-mint.cjs），
  // 人不填此号——沿 status/date 既有托管 control 家族（control:"readonly-system" + readOnly:true）；
  // 写侧来源门拒自带值（rule=system-minted，400），编辑改号仍按 F02 immutable 声明位拒（422），两条路不混。
  { field: "architecture-node-id", label: FIELD_LABELS.entity["architecture-node-id"], group: "identity", required: true, control: "readonly-system", readOnly: true, placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.SYSTEM_MINTED_ID },
  { field: "arch_component", label: FIELD_LABELS.entity.arch_component, group: "identity", required: true, control: "boolean" },
  { field: "module", label: FIELD_LABELS.entity.module, group: "classification", required: false, control: "array" },
  { field: "arch_layer", label: FIELD_LABELS.entity.arch_layer, group: "classification", required: false, control: "select" },
  { field: "arch_category", label: FIELD_LABELS.entity.arch_category, group: "classification", required: false, control: "select" },
  { field: "arch_subdomain", label: FIELD_LABELS.entity.arch_subdomain, group: "classification", required: false, control: "select" },
  // 2026-10-08 字段托管：date/updated/status 系统托管只读——表单只读展示，服务端写路径注入（契约 system:true + control:readonly-system 单源）。
  { field: "status", label: FIELD_LABELS.entity.status, group: "lifecycle", required: true, control: "readonly-system", readOnly: true },
  { field: "date", label: FIELD_LABELS.entity.date, group: "lifecycle", required: true, control: "readonly-system", readOnly: true },
  { field: "updated", label: FIELD_LABELS.entity.updated, group: "lifecycle", required: false, control: "readonly-system", readOnly: true },
  { field: "arch_since", label: FIELD_LABELS.entity.arch_since, group: "lifecycle", required: false, control: "text", placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.VERSION_EXAMPLE },
  { field: "arch_until", label: FIELD_LABELS.entity.arch_until, group: "lifecycle", required: false, control: "text", placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.VERSION_UNTIL_EXAMPLE },
  { field: "arch_version_overrides", label: FIELD_LABELS.entity.arch_version_overrides, group: "lifecycle", required: false, control: "json", placeholder: '[{"version":"7.0.0.0","arch_layer":"service"}]' },
  // placeholder 表述必须与控件真实行为一致：TokenInput 只在回车/失焦时把整串作为一个标签加入，
  // 不切分逗号（后端只接受 string[]），故不得再引导用户输入逗号分隔串。
  { field: "tags", label: FIELD_LABELS.entity.tags, group: "relations", required: true, control: "array", placeholder: ENTITY_FIELD_PLACEHOLDER_COPY.TAGS_INPUT },
];

export const ENTITY_CREATE_GROUPS: Array<{ id: EntityFieldGroup; label: string }> = [
  { id: "identity", label: ENTITY_FIELD_GROUP_LABELS.identity },
  { id: "classification", label: ENTITY_FIELD_GROUP_LABELS.classification },
  { id: "lifecycle", label: ENTITY_FIELD_GROUP_LABELS.lifecycle },
  { id: "relations", label: ENTITY_FIELD_GROUP_LABELS.relations },
];
