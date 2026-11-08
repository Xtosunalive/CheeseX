// schema-shape — 配置语义投影单源（复用域 schema-shape；SCHEMA-IA-001 批1 开域）
//
// 借镜 OpenMAIC lib/model-settings/shape.ts 的机制：配置数据先经**纯函数**投影成语义视图，
// 消费方向投影提问，不各自直读原始结构。OpenMAIC 用它让"页面骨架先于页面存在"
// （render it only if using it can change something）；本模块承其机制面——
// 分区模型＋引用拓扑＋悬空引用现算——呈现（导航/警示条/徽标）归消费方。
//
// 纪律：纯函数（同输入两次调用结果 deepEqual）、全 total（空/缺输入不抛错）、
// 零 feature 依赖（输入为结构化最小面，特征侧 NormalizedEnumsData/OntologyData
// 结构性可赋值即直通）。悬空判定与 server schema-validators.cjs 同规则
// （validateNodeType/validateRelationType 互查；对端空集时跳过——同源口径），
// 但本模块只做呈现面现算，执法仍在写网关。
// WP-152：分区标题/注记与页签回退正名的文案住 lib 层闭集 lib-copy.ts（本文件只留结构与现算）。

import { SCHEMA_PARTITION_COPY, SCHEMA_TAB_NAMES } from "./lib-copy";

/** 配置语义分区 id——schema 管理页五分区（SCHEMA-IA-001 设计稿 §2.1） */
export type PartitionId = "classification" | "vocabulary" | "type-system" | "ledger" | "intake";

/** 导航形态——PD-1 已裁（2026-10-26「1A 只留意图分区」）：目录镜像退役，意图分区唯一导航 */
/** 导航形态——PD-1 已裁（Master 2026-10-26「1A 只留意图分区」）：目录镜像退役，
 * 意图分区为唯一导航（SPEC-019 A 档「导航=目录镜像」由本裁决修订）。 */

export interface ShapePartition {
  id: PartitionId;
  /** 分区标题（新分组文案，不与 TAB_LABELS 业务词同义替换） */
  title: string;
  /** 一行注记：该分区治理什么 */
  note: string;
  /** 覆盖的页签 id（特征侧 TabId 为字符串字面量集；测试面做与 TAB_LABELS 的往返全等断言） */
  tabs: readonly string[];
}

/** 分区清单——静态单源（单架构师形态下 13 页签全常驻；不抄 OpenMAIC 的按角色动态裁剪） */
export function schemaPartitions(): readonly ShapePartition[] {
  return SCHEMA_PARTITIONS;
}

const SCHEMA_PARTITIONS: readonly ShapePartition[] = [
  {
    id: "classification",
    ...SCHEMA_PARTITION_COPY.classification,
    tabs: ["domains", "layers", "categories", "taxonomy"],
  },
  {
    id: "vocabulary",
    ...SCHEMA_PARTITION_COPY.vocabulary,
    tabs: ["tags", "concepts"],
  },
  {
    id: "type-system",
    ...SCHEMA_PARTITION_COPY["type-system"],
    tabs: ["ontology", "dependencies", "fields"],
  },
  {
    id: "ledger",
    ...SCHEMA_PARTITION_COPY.ledger,
    tabs: ["relations", "versions", "modules", "history"],
  },
  {
    id: "intake",
    ...SCHEMA_PARTITION_COPY.intake,
    tabs: ["discovery"],
  },
];

// ── 引用拓扑 ──

export type TopologyEdgeKind =
  | "policy-domain"
  | "policy-key"
  | "module-subdomain"
  | "tag-alias"
  | "allows-relation"
  | "relation-endpoint";

export interface TopologyEdge {
  kind: TopologyEdgeKind;
  /** 引用方（编辑器内定位串，如 modules.gateway.subdomain） */
  from: string;
  /** 被引用键 */
  to: string;
}

export interface DanglingRef {
  kind: TopologyEdgeKind;
  from: string;
  to: string;
}

/** 投影覆盖面信号——哪些数据面缺席（缺席＝该面的边与悬空**未知**，不得当 0/干净呈现） */
export interface SchemaTopologyCoverage {
  /** ontology 面是否参与投影（false＝懒加载未就绪：allows-relation/relation-endpoint 两类边整体缺席） */
  ontology: boolean;
}

export interface SchemaTopology {
  edges: TopologyEdge[];
  dangling: DanglingRef[];
  coverage: SchemaTopologyCoverage;
}

/** 子域词条双形态防御（与 subdomain-entries.ts 同口径：server 已归一为对象，容裸标量 legacy） */
type SubdomainEntryInput = string | { id?: unknown };

function subdomainId(item: SubdomainEntryInput | null | undefined): string | null {
  if (typeof item === "string") return item.trim() || null;
  if (item && typeof item === "object" && typeof item.id === "string") return item.id.trim() || null;
  return null;
}

function subdomainIdsOf(entries: ReadonlyArray<SubdomainEntryInput> | undefined | null): string[] {
  const out: string[] = [];
  for (const item of entries ?? []) {
    const id = subdomainId(item);
    if (id) out.push(id);
  }
  return out;
}

/** enums 投影输入——特征侧 NormalizedEnumsData 的结构化最小面（多余字段不影响可赋值性） */
export interface ShapeEnumsInput {
  domains?: Record<string, unknown>;
  subdomains?: Record<string, ReadonlyArray<SubdomainEntryInput>>;
  subdomain_constraints?: Record<string, { domain_id?: string } | undefined>;
  tags?: Record<string, readonly string[]>;
  tag_aliases?: Record<string, readonly string[]>;
  modules?: Record<string, { subdomain?: string } | undefined> | ReadonlyArray<string | { id?: unknown }>;
  /** 批16 候选投影扩入（实体表单候选源）。词条双形态＝裸标量 legacy｜{id,…} 对象（ADR-008 D1——对象被过滤=静默漏词，禁止） */
  layers?: ReadonlyArray<string | { id?: unknown }>;
  categories?: readonly string[];
  lifecycle_status?: readonly string[];
}

/** ontology 投影输入——特征侧 OntologyData 的结构化最小面 */
export interface ShapeOntologyInput {
  node_types?: Record<string, { allows_relations?: readonly string[] } | undefined>;
  relation_types?: Record<string, { source_types?: readonly string[]; target_types?: readonly string[] } | undefined>;
}

/**
 * 配置引用拓扑＋悬空引用现算。
 *
 * 六类引用边与悬空判定：
 * - policy-domain：subdomain_constraints[k].domain_id → domains 键；不在册即悬空。
 * - policy-key：矩阵键 k ∈ subdomains[domain_id] 词条 id 集（编辑器写入口径：键=子域 id）；
 *   domain_id 本身悬空时跳过本判定（同一条坏行不双报）。
 * - module-subdomain：modules[m].subdomain → 全域子域词条 id 并集；空/缺失不判。
 * - tag-alias：tag_aliases 键 → tags 各组值并集（别名指向的规范标签应在册）。
 * - allows-relation：node_types[n].allows_relations[i] → relation_types 键；
 *   relation_types 为空集时整体跳过（server validateNodeType 同款守卫）。
 * - relation-endpoint：relation_types[r].source_types/target_types[i] → node_types 键；
 *   node_types 为空集时整体跳过（对偶守卫）。
 *
 * ontology 缺省（懒加载未就绪）时类型系统两类边整体缺席并置 coverage.ontology=false——
 * 数据缺席 ≠ 零悬空，消费方凭 coverage 编程判断（徽标隐藏而非显示 0），
 * 不得把"无 type-system 边"当"类型系统干净"呈现。
 */
export function schemaTopology(
  enums?: ShapeEnumsInput | null,
  ontology?: ShapeOntologyInput | null,
): SchemaTopology {
  const edges: TopologyEdge[] = [];
  const dangling: DanglingRef[] = [];
  const domains = enums?.domains ?? {};
  const subdomains = enums?.subdomains ?? {};
  const constraints = enums?.subdomain_constraints ?? {};
  const tags = enums?.tags ?? {};
  const tagAliases = enums?.tag_aliases ?? {};
  const modules = enums?.modules ?? {};
  const nodeTypes = ontology?.node_types ?? {};
  const relationTypes = ontology?.relation_types ?? {};

  const allSubdomainIds = new Set<string>();
  for (const entries of Object.values(subdomains)) {
    for (const id of subdomainIdsOf(entries)) allSubdomainIds.add(id);
  }

  // 矩阵行：policy-domain ＋ policy-key（同源跳过）
  for (const [key, policy] of Object.entries(constraints)) {
    if (!policy) continue;
    const domainId = typeof policy.domain_id === "string" ? policy.domain_id : "";
    edges.push({ kind: "policy-domain", from: `subdomain_constraints.${key}.domain_id`, to: domainId });
    const domainMissing = !(domainId in domains);
    if (domainMissing && domainId) dangling.push({ kind: "policy-domain", from: `subdomain_constraints.${key}.domain_id`, to: domainId });
    const siblingIds = subdomainIdsOf(subdomains[domainId]);
    if (!domainMissing) {
      edges.push({ kind: "policy-key", from: `subdomain_constraints.${key}`, to: key });
      if (!siblingIds.includes(key)) {
        dangling.push({ kind: "policy-key", from: `subdomain_constraints.${key}`, to: key });
      }
    }
  }

  // 产品模块挂靠
  for (const [name, module] of Object.entries(modules)) {
    const target = module?.subdomain;
    if (!target) continue;
    edges.push({ kind: "module-subdomain", from: `modules.${name}.subdomain`, to: target });
    if (!allSubdomainIds.has(target)) {
      dangling.push({ kind: "module-subdomain", from: `modules.${name}.subdomain`, to: target });
    }
  }

  // 标签别名归并
  const canonicalTags = new Set<string>();
  for (const values of Object.values(tags)) {
    for (const value of values ?? []) canonicalTags.add(value);
  }
  for (const aliasKey of Object.keys(tagAliases)) {
    edges.push({ kind: "tag-alias", from: `tag_aliases.${aliasKey}`, to: aliasKey });
    if (!canonicalTags.has(aliasKey)) {
      dangling.push({ kind: "tag-alias", from: `tag_aliases.${aliasKey}`, to: aliasKey });
    }
  }

  // 类型系统互查（对端空集跳过——server 同款守卫；ontology 缺省时自然跳过）
  const relationKeys = Object.keys(relationTypes);
  const nodeKeys = Object.keys(nodeTypes);
  if (relationKeys.length > 0) {
    for (const [nodeKey, nodeType] of Object.entries(nodeTypes)) {
      for (const rel of nodeType?.allows_relations ?? []) {
        edges.push({ kind: "allows-relation", from: `node_types.${nodeKey}.allows_relations`, to: rel });
        if (!relationTypes[rel]) {
          dangling.push({ kind: "allows-relation", from: `node_types.${nodeKey}.allows_relations`, to: rel });
        }
      }
    }
  }
  if (nodeKeys.length > 0) {
    for (const [relKey, relType] of Object.entries(relationTypes)) {
      for (const endpoint of [...(relType?.source_types ?? []), ...(relType?.target_types ?? [])]) {
        edges.push({ kind: "relation-endpoint", from: `relation_types.${relKey}`, to: endpoint });
        if (!nodeTypes[endpoint]) {
          dangling.push({ kind: "relation-endpoint", from: `relation_types.${relKey}`, to: endpoint });
        }
      }
    }
  }

  return { edges, dangling, coverage: { ontology: ontology != null } };
}

// ── 语义投影（批4 扩域，Master 2026-10-26「搬」指示）──
// 借镜 OpenMAIC shape 三层中的语义层：每个配置单元带机器可读语义（正名/定义/编辑性），
// 呈现层据此决定显示什么——此前只搬结构层（分区+边）系判断失误，「正名裁决躺字典两年
// 未执行」即症状。语义单源=contracts/object-dictionary.json（loader 结构性直通本输入面）。

/** 字典对象最小输入面（src/lib/object-dictionary.ts 的 DictionaryObject 结构性可赋值直通） */
export interface ShapeDictionaryObject {
  canonical_name: string;
  definition: string;
  edited_by_tab: string;
  editable: boolean;
  object_kind: string;
  /** 字段级语义条目（可选面——B 档治理粒度；未登记对象无此面） */
  fields?: ReadonlyArray<{ field: string; label: string; description: string }>;
}

/** 无字典对象页签的声明位（如 history=git 快照账，非字典对象）；正名单源仍归字典 */
export const TAB_LABEL_FALLBACKS: Readonly<Record<string, string>> = {
  history: SCHEMA_TAB_NAMES.HISTORY,
};

/** 页签表达形态（批8 结构性收敛——形态从各编辑器私产升为投影单源声明：
 * 新编辑器立项时对本表选型，存量判定（master-detail/chips 保留、cards 候选流）在册可查） */
export type TabForm = "table" | "master-detail" | "chips" | "cards";

/** 形态声明表（事实面=SchemaManagerView 装配；table=词条清单走基座） */
export const TAB_FORMS: Readonly<Record<string, TabForm>> = {
  domains: "master-detail",
  layers: "table",
  categories: "master-detail",
  taxonomy: "table",
  discovery: "cards",
  tags: "chips",
  concepts: "master-detail",
  ontology: "table",
  dependencies: "table",
  versions: "table",
  history: "table",
  modules: "table",
  relations: "table",
  fields: "table",
};

export interface TabSemantics {
  tab: string;
  /** 该页签编辑的全部字典对象（保持字典原序——首对象即主对象） */
  objects: ShapeDictionaryObject[];
  /** 页签正名=主对象 canonical_name */
  primaryName: string;
  /** 页签整体可编辑性：任一对象可编辑即有可编辑面；全 false=派生只读页签 */
  editable: boolean;
  /** 表达形态（TAB_FORMS 声明投影——缺省 table） */
  form: TabForm;
}

/** 页签语义（无字典对象页签返回 null——走 TAB_LABEL_FALLBACKS，不假装有对象语义） */
export function tabSemantics(objects: readonly ShapeDictionaryObject[], tab: string): TabSemantics | null {
  const own = objects.filter((o) => o.edited_by_tab === tab && o.canonical_name);
  if (own.length === 0) return null;
  return { tab, objects: own, primaryName: own[0].canonical_name, editable: own.some((o) => o.editable), form: TAB_FORMS[tab] ?? "table" };
}

/** 页签正名表：字典正名优先，无对象页签走声明回退，仍缺以 tab id 兜底（total——缺位不抛错；13/13 齐备由测试面断言执法） */
export function canonicalTabLabels(
  objects: readonly ShapeDictionaryObject[],
  tabs: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tab of tabs) {
    out[tab] = tabSemantics(objects, tab)?.primaryName ?? TAB_LABEL_FALLBACKS[tab] ?? tab;
  }
  return out;
}

/** 写侧角色面（事实源=server/shared/auth/route-roles.cjs ROUTE_ROLES——schema 写族=admin；
 * relations/discovery 写无角色钉扎=任一认证主体。本表是呈现面投影：执法在后端 preHandler，
 * 此处只回答「当前角色能不能改」供渲染；roles 缺席=身份未知→只出静态面，不假设放行/拒绝） */
export const TAB_WRITE_ROLES: Readonly<Record<string, readonly string[]>> = {
  domains: ["admin"], layers: ["admin"], categories: ["admin"], taxonomy: ["admin"],
  tags: ["admin"], concepts: ["admin"],
  ontology: ["admin"], dependencies: ["admin"], fields: ["admin"],
  versions: ["admin"], history: ["admin"],
  relations: [],
  discovery: [],
};

export type EditabilityState = "editable" | "role-denied" | "derived-readonly";

/** 编辑性谓词（OpenMAIC「能不能改变」谓词的 cheeseh 落法）：对象静态编辑性 × 页签写侧角色 × 当前角色 */
export function editabilityState(
  tab: string,
  objectEditable: boolean,
  roles: readonly string[] | null,
): EditabilityState {
  if (!objectEditable) return "derived-readonly";
  const required = TAB_WRITE_ROLES[tab];
  if (required && required.length > 0 && roles && !required.some((r) => roles.includes(r))) {
    return "role-denied";
  }
  return "editable";
}

/** 页签内容区块 id（批14：内容组装层入投影——未声明=无挂载点，脚手架住不进来） */
export type SectionId =
  | "classification-workspace"
  | "layer-editor"
  | "derived-categories-readonly"
  | "taxonomy-editor"
  | "module-registry"
  | "tag-governance"
  | "discovery-intake"
  | "concept-vocabulary"
  | "ontology-editor"
  | "dependency-rules"
  | "version-registry"
  | "version-snapshots"
  | "relation-ledger"
  | "field-graph"
  | "fields-editor";

/**
 * 页签→内容区块声明（渲染顺序即数组序）。视图按本表装配——区块不在声明中即无挂载点
 * （宪法「只留能动配置的东西」的结构执法位；批13 的出链/图谱面板正是未被声明的先例：
 * 它们在 TAB_SECTIONS 无条目，物理上挂不进配置页）。区块 id 全局唯一（视图侧注册表键）。
 */
export const TAB_SECTIONS: Readonly<Record<string, readonly SectionId[]>> = {
  domains: ["classification-workspace"],
  layers: ["layer-editor"],
  categories: ["derived-categories-readonly"],
  taxonomy: ["taxonomy-editor"],
  modules: ["module-registry"],
  tags: ["tag-governance"],
  discovery: ["discovery-intake"],
  concepts: ["concept-vocabulary"],
  ontology: ["ontology-editor"],
  dependencies: ["dependency-rules"],
  versions: ["version-registry"],
  history: ["version-snapshots"],
  relations: ["relation-ledger"],
  fields: ["field-graph", "fields-editor"],
};

/** 悬空引用的分区归属（徽标/警示条按当前页签过滤的取数口；ledger/intake 无引用边） */
export function partitionOfKind(kind: TopologyEdgeKind): PartitionId {
  switch (kind) {
    case "policy-domain":
    case "policy-key":
    case "module-subdomain":
      return "classification";
    case "tag-alias":
      return "vocabulary";
    case "allows-relation":
    case "relation-endpoint":
      return "type-system";
  }
}

/** 分区页签归属反查（视图按 activeTab 取提示条数据；未登记页签返回 null） */
export function partitionOfTab(tab: string): PartitionId | null {
  for (const partition of SCHEMA_PARTITIONS) {
    if (partition.tabs.includes(tab)) return partition.id;
  }
  return null;
}

/** 当前页签所属分区的悬空引用（警示条取数口——消费方一行拿数，不重抄过滤样板） */
export function danglingForTab(tab: string, topology: SchemaTopology): DanglingRef[] {
  const partition = partitionOfTab(tab);
  if (!partition) return [];
  return topology.dangling.filter((d) => partitionOfKind(d.kind) === partition);
}

/** 各分区悬空计数（导航徽标取数口；ledger/intake 恒 0——无引用边） */
export function partitionDanglingCounts(topology: SchemaTopology): Record<PartitionId, number> {
  const counts: Record<PartitionId, number> = {
    classification: 0,
    vocabulary: 0,
    "type-system": 0,
    ledger: 0,
    intake: 0,
  };
  for (const ref of topology.dangling) counts[partitionOfKind(ref.kind)] += 1;
  return counts;
}

/** 六类引用边的在册序（概览取数序单源——消费方不再各抄一份 kind 列表） */
export const TOPOLOGY_EDGE_KINDS: readonly TopologyEdgeKind[] = [
  "policy-domain",
  "policy-key",
  "module-subdomain",
  "tag-alias",
  "allows-relation",
  "relation-endpoint",
];

/** 分区内一类边的可见分组（healthy 与 dangling 一处算出，消费方不再自做差集） */
export interface PartitionEdgeGroup {
  kind: TopologyEdgeKind;
  dangling: DanglingRef[];
  healthy: TopologyEdge[];
}

/**
 * 当前页签所属分区的边分组（按 kind 序；两类皆空的 kind 整体略过）。
 *
 * WP-134 波4：概览面板此前在组件内算「健康＝边 − 悬空」并手拼对端键，是与 danglingForTab 同层职责的
 * 第二份实现——悬空口径一改，徽标与面板即分叉。差集键以 `\u0000` 分隔（id 内不出现该字符），
 * 不用可见字符拼接（BKN `ref_id` 三种分隔符混用即此形状的后患）。
 */
export function partitionEdgeGroups(tab: string, topology: SchemaTopology): PartitionEdgeGroup[] {
  const partition = partitionOfTab(tab);
  if (partition === null) return [];
  const key = (a: string, b: string) => a + "\u0000" + b;
  const groups: PartitionEdgeGroup[] = [];
  for (const kind of TOPOLOGY_EDGE_KINDS) {
    if (partitionOfKind(kind) !== partition) continue;
    const dangling = topology.dangling.filter((d) => d.kind === kind);
    const danglingKeys = new Set(dangling.map((d) => key(d.from, d.to)));
    const healthy = topology.edges.filter((e) => e.kind === kind && !danglingKeys.has(key(e.from, e.to)));
    if (healthy.length === 0 && dangling.length === 0) continue;
    groups.push({ kind, dangling, healthy });
  }
  return groups;
}

/** 分区盲区判定单源：该分区的边面是否因数据缺席而不可出数（数据缺席 ≠ 零悬空） */
export function partitionIsBlind(partition: PartitionId | null, topology: SchemaTopology): boolean {
  return partition === "type-system" && !topology.coverage.ontology;
}

/**
 * 徽标取数口（null＝不可出数，消费方隐藏而非显示 0）。
 * 此前 coverage 门控在导航徽标与概览面板各判一遍——同一策略两份代码即两处会漂。
 */
export function danglingBadgeForPartition(partition: PartitionId, topology: SchemaTopology | null): number | null {
  if (topology === null || partitionIsBlind(partition, topology)) return null;
  return partitionDanglingCounts(topology)[partition];
}

// ── 批（2026-10-27）：字段级语义投影（B 档治理粒度——字段正名/说明单源自字典，编辑器禁自造）──

/** 字段级语义视图：字段正名与说明（消费方取标签/提示，不再手写字段文案） */
export interface FieldSemantic {
  field: string;
  label: string;
  description: string;
}

/** 某页签对象的全部字段语义（未登记 fields 的对象 → 空数组，消费方自定回退文案） */
export function tabFieldSemantics(
  objects: readonly ShapeDictionaryObject[],
  tab: string,
): readonly FieldSemantic[] {
  const entry = objects.find((o) => o.edited_by_tab === tab);
  return entry?.fields ?? [];
}

/** 单字段语义查找（编辑器逐控件取数口；未登记 → null，消费方自定回退文案） */
export function fieldSemanticOf(
  objects: readonly ShapeDictionaryObject[],
  tab: string,
  field: string,
): FieldSemantic | null {
  return tabFieldSemantics(objects, tab).find((f) => f.field === field) ?? null;
}

// ── 批16 扩域：实体字段候选投影（收编 EntityComplianceView/AnomalyEntityRepairDrawer 双份拍平——第二/第三消费场景）──

/** 实体表单候选字段键（EntityRepairForm 消费的 enumOptions 键面；arch_since/arch_until 共用版本候选） */
export type EntityFieldKey =
  | "arch_layer"
  | "arch_category"
  | "arch_subdomain"
  | "module"
  | "tags"
  | "status"
  | "arch_since"
  | "arch_until";

/** 版本注册表 → 版本 id 候选；products 双形态（数组｜记录表）、版本条目双形态（{id,…}｜裸标量）。registry 缺席 → 空数组（total） */
function versionIdListOf(registry: unknown): string[] {
  if (!registry || typeof registry !== "object") return [];
  const products = (registry as { products?: unknown }).products;
  if (!products || typeof products !== "object") return [];
  const ids = new Set<string>();
  const list = Array.isArray(products) ? products : Object.values(products as Record<string, unknown>);
  for (const product of list) {
    if (!product || typeof product !== "object") continue;
    const versions = (product as { versions?: unknown }).versions;
    if (!Array.isArray(versions)) continue;
    for (const entry of versions) {
      const id = subdomainId(entry);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * 实体表单字段 → 词表候选值投影（批16 单源；基线实现取异常侧抽屉加固版——layers/subdomains 双形态取 id）。
 * 消费方一行取数，不各自拍平 enums（第二份拍平=修一处漏一处，check:schema-shape 执法）。
 * versionRegistry 可选（#1800：arch_since/arch_until 版本下拉；缺席时该两键为空数组）。
 */
export function entityFieldCandidates(
  enums?: ShapeEnumsInput | null,
  versionRegistry?: unknown,
): Record<EntityFieldKey, string[]> {
  const e = enums ?? {};
  const layers = (e.layers ?? []).map(subdomainId).filter((id): id is string => id !== null);
  const categories = (e.categories ?? []).filter((value): value is string => typeof value === "string");
  const subdomains = Object.values(e.subdomains ?? {})
    .flat()
    .map(subdomainId)
    .filter((id): id is string => id !== null);
  const modules = Array.isArray(e.modules)
    ? e.modules.map(subdomainId).filter((id): id is string => id !== null)
    : e.modules && typeof e.modules === "object"
      ? Object.keys(e.modules)
      : [];
  const tags = Object.values(e.tags ?? {})
    .flat()
    .filter((value): value is string => typeof value === "string");
  const status = (e.lifecycle_status ?? []).filter((value): value is string => typeof value === "string");
  const versions = versionIdListOf(versionRegistry);
  return {
    arch_layer: layers,
    arch_category: categories,
    arch_subdomain: [...new Set(subdomains)],
    module: modules,
    tags: [...new Set(tags)],
    status,
    arch_since: versions,
    arch_until: versions,
  };
}

/**
 * 呈现面野生值谓词：值非空且不在候选集（表单高亮/提示用）。
 * 野生值**检测**执法在服务端（vocabulary-profiling 画像／合规检查／anomaly wild_tag）——
 * 本函数只做呈现判定，不是检测引擎（勿在此堆启发式）。
 */
export function isWildChoice(value: unknown, candidates: readonly string[]): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return !candidates.includes(value);
}
