// Schema Manager types — 骨架枚举管理
import type { paths } from "@/lib/generated/api-types";
import { normalizeSubdomainEntries } from "./subdomain-entries";

export type EnumsData = paths["/api/schema/enums"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type EnumsWritePayload = paths["/api/schema/enums/preview"]["post"]["requestBody"]["content"]["application/json"];
export type EnumsChangeConfirmation = NonNullable<Extract<EnumsWritePayload, { confirmation: unknown }>["confirmation"]>;
export type EnumsChangePreviewRequest = paths["/api/schema/enums/preview"]["post"]["requestBody"]["content"]["application/json"];
export type EnumsChangePreviewData = paths["/api/schema/enums/preview"]["post"]["responses"][200]["content"]["application/json"]["data"];
/** 完整态（全量读取）：revision 必填，节态（SchemaEnumsSectionData）无此字段——以此 narrowing union */
export type FullEnumsData = Extract<EnumsData, { revision: string }>;
/** 归一后完整态：subdomains 覆盖收窄为词条对象数组（ADR-008 D1 编辑面唯一消费形态；Omit 覆盖——交叉类型对 index signature 不收窄）。 */
export type NormalizedEnumsData = Omit<FullEnumsData, "subdomains"> & { subdomains: SubdomainMap };

/**
 * 节态 → 完整态归一（ADR063 节读取遗留：SchemaEnumsSectionData 全字段 optional）。
 * 编辑器/校验链只消费完整形态；缺失节 = 空值。完整态原样透传（零拷贝语义）。
 * ADR-008 D1：subdomains 词条在此归一为对象数组（双形态防御——server 已归一，此处兜底）。
 */
export function normalizeEnumsData(data: EnumsData): NormalizedEnumsData {
  if ("revision" in data && typeof data.revision === "string") {
    return { ...data, subdomains: normalizeSubdomainEntries(data.subdomains) } as NormalizedEnumsData;
  }
  return {
    domains: data.domains ?? {},
    subdomains: normalizeSubdomainEntries(data.subdomains ?? {}),
    subdomain_constraints: {},
    layers: data.layers ?? [],
    categories: data.categories ?? [],
    article_types: data.article_types ?? [],
    doc_types: data.doc_types ?? [],
    modules: data.modules ?? {},
    tags: {},
    tag_aliases: {},
    disabled_tags: [],
    lifecycle_status: [],
    revision: "",
    sourceFile: "",
  };
}
export type DomainMap = FullEnumsData["domains"];
/** ADR-008 D1：前端编辑面 subdomains 已归一为词条对象数组（string[] 是 legacy 双形态的另一半，编辑器不触碰）。 */
export type SubdomainMap = Record<string, import("./subdomain-entries").SubdomainEntry[]>;
export type LayerDef = FullEnumsData["layers"][number];
export type ModuleDefinition = FullEnumsData["modules"][string];
export type ModuleRegistry = FullEnumsData["modules"];

export type DiscoveryResponse = paths["/api/schema/discovery"]["get"]["responses"][200]["content"]["application/json"]["data"];
// 契约已建模 SchemaDiscoveryData（server/routes/schema-discovery-routes.cjs discoveryData 实返形状），恢复契约单源投影
export type DiscoveryField = keyof DiscoveryResponse["discovery"];
export interface FormalAbsorbRequest {
  field: Extract<DiscoveryField, "layers" | "categories" | "subdomains" | "tags">;
  value: string;
  mode: "formal";
  domain?: string;
  /** Master 2026-10-17 裁决：subdomain 晋升必填词条标签（出生即带义——TALOS 语义字段必填同构） */
  label?: string;
  /** G1'：tags 晋升的裁定方式——formal=升为正式标签（须配 group）/ alias=归为别名（须配 aliasTarget） */
  assignMode?: "formal" | "alias";
  /** assignMode=alias 时的目标正式标签 */
  aliasTarget?: string;
  /** assignMode=formal 时的目标分组 */
  group?: string;
}

// relations：EDGE-RELATION-GOV-001 对象本体批（D1/D3）——人工/治理关系实例页签（类型登记先行，
// 编辑面板/导航挂载随阶段 4 前端批；后端通道已就绪：GET/PUT /api/schema/relations）
import { canonicalTabLabels } from "@/lib/schema-shape";
import { OBJECT_DICTIONARY } from "@/lib/object-dictionary";

export type TabId = "domains" | "layers" | "categories" | "taxonomy" | "modules" | "tags" | "discovery" | "ontology" | "dependencies" | "versions" | "history" | "fields" | "concepts" | "relations";

export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "error";

// SCHEMA-IA-001 批4：TAB_LABELS 转字典派生面——正名单源=contracts/object-dictionary.json
// （canonicalTabLabels：字典正名优先，无对象页签走 schema-shape 声明回退）。此前手写表
// 与字典裁决漂移（「待沉淀标签」「标签维护」两笔 Master 正名均未执行）即此病灶。
const TAB_IDS = [
  "domains", "layers", "categories", "taxonomy", "modules", "discovery",
  "tags", "concepts", "ontology", "dependencies", "versions",
  "history", "relations", "fields",
] as const satisfies readonly TabId[];

export const TAB_LABELS: Record<TabId, string> = canonicalTabLabels(
  OBJECT_DICTIONARY,
  TAB_IDS,
) as Record<TabId, string>;

export const VALID_LAYOUTS = ["central", "left-panel", "right-panel"] as const;

// Layer color palette（WP-147 Radix 换装：分类色 var 通道已迁移至 color-* 新 token，映射见 Radix 决策卡）
export const LAYER_COLOR_MAP: Record<string, string> = {
  gray: "var(--color-gray-9)",
  slate: "var(--color-slate-9)",
  zinc: "var(--color-mauve-9)",
  violet: "var(--color-violet-11)",
  emerald: "var(--color-jade-10)",
  amber: "var(--color-amber-10)",
  red: "var(--color-red-11)",
  rose: "var(--color-ruby-10)",
  cyan: "var(--loading-cyan)",
  teal: "var(--color-teal-10)",
  orange: "var(--color-orange-9)",
  lime: "var(--color-lime-10)",
  blue: "var(--color-blue-9)",
  indigo: "var(--color-iris-9)",
  fuchsia: "var(--color-plum-9)",
  pink: "var(--color-pink-9)",
};

export const LAYER_COLOR_OPTIONS = Object.keys(LAYER_COLOR_MAP);

// ── Ontology types ──

export interface NodeTypeDef {
  description: string;
  category: string;  // Q1: 改名自 domain，消除同名冲突
  color: string;
  icon: string;
  allows_relations: string[];
}

export interface RelationTypeDef {
  description: string;
  direction: string;
  weight_default: number;
  weight_range: [number, number];
  versionable: boolean;
  source_types: string[];
  target_types: string[];
  label_cn: string;
  requires_review?: boolean;
  is_legacy?: boolean;
  assertion_policies: AssertionPolicyDef[];
}

export interface AssertionPolicyDef {
  source_kind: string;
  producer: string;
  decision_mode: "reviewed" | "inherit_source_approval" | "deterministic" | "derived_only" | "forbidden";
  required_evidence: string[];
  working_projection: "approved_only" | "never";
  formal_consumers: string[];
}

export interface InferenceRule {
  name: string;
  description: string;
  pattern: string;
  output: string;
}

export interface OntologyConstraint {
  id: string;
  description: string;
  check: string;
  severity: "error" | "warning";
  scope?: string;
}

export interface OntologyData {
  node_types: Record<string, NodeTypeDef>;
  relation_types: Record<string, RelationTypeDef>;
  inference_rules: InferenceRule[];
  constraints: OntologyConstraint[];
  revision?: string;
}

// E3'b3：schema 提案退役，selector 选项改为内联类型（不再依赖 proposal ontology 端点）
export type AssertionPolicySelectorOptions = {
  sourceKinds: string[];
  producers: string[];
  decisionModes: string[];
  workingProjections: string[];
};

export interface OntologySavePayload {
  node_types?: Record<string, NodeTypeDef>;
  relation_types?: Record<string, RelationTypeDef>;
}

// ── Dependency rule types ──

export type DependencyRulesData = paths["/api/schema/dependencies"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type DependencyRuleItem = DependencyRulesData["items"][number];
export type DependencyRuleDiagnostic = DependencyRulesData["diagnostics"][number];
export type DependencyRuleSavePayload = paths["/api/schema/dependencies/validate"]["post"]["requestBody"]["content"]["application/json"];
export type DependencyImpactPreviewData = paths["/api/schema/dependencies/preview"]["post"]["responses"][200]["content"]["application/json"]["data"];

// ── Product version registry types ──

export type VersionRegistryData = paths["/api/schema/versions"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type VersionRegistryProducts = VersionRegistryData["products"];
export type VersionRegistryEntry = VersionRegistryProducts[string]["versions"][number];
/** 写回/校验载荷取自实际调用的 POST /api/schema/versions/validate 契约（VersionRegistryWriteRequest：revision+schema_version+products） */
export type VersionRegistryWritePayload = paths["/api/schema/versions/validate"]["post"]["requestBody"]["content"]["application/json"];
export type VersionFreezePayload = paths["/api/schema/versions/freeze"]["post"]["requestBody"]["content"]["application/json"];
export type VersionFreezeResult = paths["/api/schema/versions/freeze"]["post"]["responses"][200]["content"]["application/json"];
export type ProductIdentityData = paths["/api/schema/product-identity"]["get"]["responses"][200]["content"]["application/json"]["data"];
export type ProductIdentityWritePayload = paths["/api/schema/product-identity"]["put"]["requestBody"]["content"]["application/json"];
