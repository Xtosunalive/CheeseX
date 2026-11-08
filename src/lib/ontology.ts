// Ontology Registry — ported & simplified from 架构图系统/src/lib/ontology.ts
//
// Runtime facade over the generated TheSchema registry.
// Import-time validation marks unknown relations as pending for review.

import {
  CATEGORY_ALIASES as GENERATED_CATEGORY_ALIASES,
  CATEGORY_CLASSES,
  ENTITY_TYPES as GENERATED_ENTITY_TYPES,
  GRAPH_DATABASE_RELATION_TYPES as GENERATED_GRAPH_DATABASE_RELATION_TYPES,
  RELATION_ALIASES as GENERATED_RELATION_ALIASES,
  RELATION_TYPES as GENERATED_RELATION_TYPES,
} from "./generated/ontology-registry";
import { ENTITY_CATEGORY } from "./domain/EntityCategory";
import { ONTOLOGY_COPY, ontologyConstraintMismatch, ontologyDomainMismatch, ontologyRangeMismatch, ontologyUnknownRelationReason } from "./lib-copy";

// ────────────────────────────────────────────────────
// 实体类别（闭合枚举，全工程唯一事实源）
// ────────────────────────────────────────────────────
export const ENTITY_TYPES = GENERATED_ENTITY_TYPES;

export type EntityType = (typeof ENTITY_TYPES)[number];

export function isValidEntityType(t: string): t is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t);
}

export function normalizeCategory(raw: string): EntityType {
  if (isValidEntityType(raw)) return raw;
  const lower = raw.toLowerCase();
  const aliases: Record<string, string> = {
    ...GENERATED_CATEGORY_ALIASES,
    cache: ENTITY_CATEGORY.STORAGE,
    certificate: ENTITY_CATEGORY.SECURITY,
    concept: ENTITY_CATEGORY.CONCEPT,
    knowledge: ENTITY_CATEGORY.CONCEPT,
    domain: ENTITY_CATEGORY.DOMAIN,
    namespace: ENTITY_CATEGORY.DOMAIN,
    document: ENTITY_CATEGORY.DOCUMENT,
    doc: ENTITY_CATEGORY.DOCUMENT,
    article: ENTITY_CATEGORY.DOCUMENT,
    wiki: ENTITY_CATEGORY.DOCUMENT,
    product: ENTITY_CATEGORY.PRODUCT,
    productversion: ENTITY_CATEGORY.VERSION,
    release: ENTITY_CATEGORY.VERSION,
    plate: ENTITY_CATEGORY.PLATE,
    board: ENTITY_CATEGORY.PLATE,
  };
  const normalized = aliases[raw] || aliases[lower] || ENTITY_CATEGORY.CONCEPT;
  return isValidEntityType(normalized) ? normalized : ENTITY_CATEGORY.CONCEPT;
}

// ────────────────────────────────────────────────────
// 关系类型（闭合枚举）+ domain/range 约束
// ────────────────────────────────────────────────────
export interface AssertionPolicy {
  sourceKind: string;
  producer: string;
  decisionMode: "reviewed" | "inherit_source_approval" | "deterministic" | "derived_only" | "forbidden";
  requiredEvidence: string[];
  workingProjection: "approved_only" | "never";
  formalConsumers: string[];
}

export interface RelationDef {
  label: string;
  domain: EntityType[];
  range: EntityType[];
  description: string;
  legacyPolicy?: string;
  assertionPolicies?: AssertionPolicy[];
}

export const RELATION_TYPES = GENERATED_RELATION_TYPES as unknown as Record<string, RelationDef>;
export const ACTIVE_RELATION_TYPES = Object.fromEntries(
  Object.entries(RELATION_TYPES).filter(([, def]) => def.legacyPolicy !== "delete"),
) as Record<string, RelationDef>;

/** 关系类型名联合（WP-138 R5a）：键单源＝生成物 RELATION_TYPES 键集——registry 改名/删名后，引用处即编译红 */
export type RelationTypeName = keyof typeof GENERATED_RELATION_TYPES;

/**
 * 关系类型 → 用户可见正名（WP-032/PR-147 唯一回落口径）。
 * 未登记类型回落「未登记关系」——裸枚举不上屏（S4 纪律）；此前 13 处四种回落
 * （「未登记关系」/裸 type/裸 type 双兜底/「关系」）全部收编本函数。
 */
export function relationTypeLabel(type: string): string {
  return RELATION_TYPES[type]?.label ?? ONTOLOGY_COPY.UNREGISTERED_RELATION;
}

// Obsidian 导入专用关系（宽松，不参与严格校验）
export const EXTERNAL_RELATION_TYPES = new Set([
  "LINKS_TO",
  "TAGGED_WITH",
]);

export const GRAPH_DATABASE_RELATION_TYPES = new Set<string>(GENERATED_GRAPH_DATABASE_RELATION_TYPES);

export function normalizeRelationType(raw: string | undefined): string {
  if (!raw) return "CONNECTS_TO";
  const trimmed = raw.trim();
  // WP-049 L4（SPEC-044 C4，实证清单 P6）：手抄十别名全被生成物等值覆盖——纯冗余副本删除，
  // 别名唯一来源＝src/lib/generated/ontology-registry.ts（生成物）。
  const aliases: Record<string, string> = {
    ...GENERATED_RELATION_ALIASES,
  };
  return aliases[trimmed] || aliases[trimmed.toLowerCase()] || trimmed;
}

export function isKnownRelationType(t: string): boolean {
  const normalized = normalizeRelationType(t);
  return (normalized in RELATION_TYPES && RELATION_TYPES[normalized]?.legacyPolicy !== "delete") || EXTERNAL_RELATION_TYPES.has(normalized);
}

/**
 * Resolve an assertion policy by (relationType, sourceKind, producer).
 * Returns the exact matching policy or null. Production wildcard fallback is forbidden.
 */
export function resolveAssertionPolicy(
  relationType: string,
  sourceKind: string,
  producer: string,
): AssertionPolicy | null {
  const normalized = normalizeRelationType(relationType);
  const def = RELATION_TYPES[normalized];
  if (!def || !def.assertionPolicies) return null;

  for (const policy of def.assertionPolicies) {
    if (policy.sourceKind === sourceKind && policy.producer === producer) {
      return policy;
    }
  }
  return null;
}

/**
 * Check if a relation type has any assertion policies defined.
 */
export function hasAssertionPolicies(relationType: string): boolean {
  const normalized = normalizeRelationType(relationType);
  const def = RELATION_TYPES[normalized];
  return !!def?.assertionPolicies && def.assertionPolicies.length > 0;
}

// ────────────────────────────────────────────────────
// 校验函数
// ────────────────────────────────────────────────────
export interface ValidationResult {
  valid: boolean;
  confidence: number;
  reason?: string;
}

/**
 * 校验一条关系是否符合本体约束。
 * 返回 confidence（0-1）和校验原因。
 */
export function validateRelation(
  relationType: string,
  fromCategory: string | undefined,
  toCategory: string | undefined,
): ValidationResult {
  relationType = normalizeRelationType(relationType);

  // 外部关系（Obsidian wikilink/tag）直接放行，低置信度
  if (EXTERNAL_RELATION_TYPES.has(relationType)) {
    return { valid: true, confidence: 0.5, reason: ONTOLOGY_COPY.EXTERNAL_RELATION_REASON };
  }

  // 未知关系类型
  const def = RELATION_TYPES[relationType];
  if (!def || def.legacyPolicy === "delete") {
    return {
      valid: false,
      confidence: 0,
      reason: ontologyUnknownRelationReason(relationType),
    };
  }

  // 缺少实体类别 → 放行但降低置信度
  if (!fromCategory || !toCategory) {
    return { valid: true, confidence: 0.4, reason: ONTOLOGY_COPY.MISSING_CATEGORY_REASON };
  }

  // WP-049 余量批：定义域是类名词表（ADR-014 §3.2），编辑器传入的是分类名——经
  // CATEGORY_CLASSES（node_types.category 反转，生成物单源）翻译后判定；无翻译面的分类
  // （类模型未覆盖）保持原直查行为（不匹配→待审核链路）。
  const matchesDomain = (domain: readonly string[], category: string): boolean =>
    domain.includes(category) ||
    (CATEGORY_CLASSES as Record<string, readonly string[]>)[category]?.some((cls) => domain.includes(cls)) === true;
  const fromOk = matchesDomain(def.domain, fromCategory);
  const toOk = matchesDomain(def.range, toCategory);

  if (fromOk && toOk) {
    return { valid: true, confidence: 1.0 };
  }

  if (GRAPH_DATABASE_RELATION_TYPES.has(relationType)) {
    return {
      valid: true,
      confidence: 0.9,
      reason: ONTOLOGY_COPY.GRAPH_DB_RELATION_REASON,
    };
  }

  const problems: string[] = [];
  if (!fromOk) problems.push(ontologyDomainMismatch(fromCategory, relationType, JSON.stringify(def.domain)));
  if (!toOk) problems.push(ontologyRangeMismatch(toCategory, relationType, JSON.stringify(def.range)));

  return {
    valid: true, // 允许存入但标记为待审核
    confidence: 0.3,
    reason: ontologyConstraintMismatch(problems.join("; ")),
  };
}

/**
 * 推断关系类型：给定两个实体的类别，返回最可能的关系类型。
 */
export function inferRelationType(
  fromCategory: string,
  toCategory: string,
): string | null {
  const from = normalizeCategory(fromCategory);
  const to = normalizeCategory(toCategory);

  // 推断优先序的语义宿主＝本数组单点（序即语义：存储于 > 索引于 > 备份于 > 加密 > 依赖，
  // 命中即返回；序未覆盖的类别组合再落 CONNECTS_TO 兜底）。键类型 RelationTypeName 来自
  // 生成物键集（WP-138 R5a）——registry 改名/删名后此处立即编译红；新关系类型是否入序由
  // 维护者显式决定（不入序则不参与推断，与手抄期行为一致）。
  const priorityOrder: readonly RelationTypeName[] = [
    "STORES_IN", "INDEXES", "BACKS_UP", "ENCRYPTS", "DEPENDS_ON",
  ];

  for (const relType of priorityOrder) {
    const def = RELATION_TYPES[relType];
    if (def && def.domain.includes(from) && def.range.includes(to)) {
      return relType;
    }
  }

  const connectDef = RELATION_TYPES.CONNECTS_TO;
  if (connectDef && connectDef.domain.includes(from) && connectDef.range.includes(to)) {
    return "CONNECTS_TO";
  }

  return null;
}

// ────────────────────────────────────────────────────
// 图级异常检测
// ────────────────────────────────────────────────────
export interface GraphEdge {
  from: string;
  to: string;
  relationType?: string;
}

export interface AnomalyReport {
  cycles: string[][];
  isolatedNodes: string[];
  longChains: { path: string[]; hops: number }[];
}

/**
 * 检测图谱中的全局异常：环路、孤立节点、过长依赖链。
 * 纯只读分析，不修改任何数据。
 */
export function detectGraphAnomalies(
  nodeIds: string[],
  edges: GraphEdge[],
  maxChainLength = 5,
): AnomalyReport {
  const adj = new Map<string, Set<string>>();
  const hasEdge = new Set<string>();

  for (const node of nodeIds) adj.set(node, new Set());
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from)!.add(e.to);
    hasEdge.add(e.from);
    hasEdge.add(e.to);
  }

  // 1. 环路检测：DFS 找所有简单环
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) cycles.push([...path.slice(cycleStart), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const neighbor of adj.get(node) ?? []) dfs(neighbor);
    path.pop();
    stack.delete(node);
  }

  for (const node of adj.keys()) dfs(node);

  // 2. 孤立节点
  const isolatedNodes = nodeIds.filter((id) => !hasEdge.has(id));

  // 3. 长链检测：沿 DEPENDS_ON 关系找最长路径
  const dependsEdges = edges.filter((e) => e.relationType === "DEPENDS_ON");
  const depAdj = new Map<string, string[]>();
  for (const e of dependsEdges) {
    if (!depAdj.has(e.from)) depAdj.set(e.from, []);
    depAdj.get(e.from)!.push(e.to);
  }

  const longChains: { path: string[]; hops: number }[] = [];

  function findChains(node: string, currentPath: string[]) {
    if (currentPath.length > maxChainLength) {
      longChains.push({ path: [...currentPath], hops: currentPath.length - 1 });
      return;
    }
    const targets = depAdj.get(node);
    if (!targets || targets.length === 0) {
      if (currentPath.length - 1 > maxChainLength) {
        longChains.push({ path: [...currentPath], hops: currentPath.length - 1 });
      }
      return;
    }
    for (const t of targets) {
      if (currentPath.includes(t)) continue;
      findChains(t, [...currentPath, t]);
    }
  }

  for (const e of dependsEdges) {
    findChains(e.from, [e.from]);
  }

  return { cycles, isolatedNodes, longChains };
}
