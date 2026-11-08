import type { components } from "./generated/api-types";
import type { EntityType } from "./ontology";
import { isHumanApprovedReviewStatus } from "./domain/ReviewStatus";
import { ENTITY_CATEGORY } from "./domain/EntityCategory";

// Topology types & visual constants — shared across features.
// Migrated from features/dashboard/dashboard-types.ts (Phase 0 store breakup).



export interface TopoNode {
  id: string;
  label: string;
  category: string;
  degree: number;
  labels?: string[];
  properties?: Record<string, unknown>;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface TopoEdge {
  edgeId: string;
  source: string;
  target: string;
  type: string;
  sourceFile?: string;
  lineNumber?: number;
  evidenceHash?: string;
  reviewStatus?: string;
  properties?: Record<string, unknown>;
}

export type ScopeMode = "full" | "architecture";

// TopologyStats 单源化：直接投影契约 DashboardTopologyData（identity union + gaps + 全统计字段），
// 手写形状与契约漂移（freshness/gaps 缺登记、releaseId 必填谎言）由此退役
export type TopologyStats = components["schemas"]["DashboardTopologyData"];

export interface TaxonomyNode {
  id: string;
  label: string;
  children?: TaxonomyNode[];
  entityCount?: number;
  docCount?: number;
  entityIds?: string[];
}

// 实体类型色表键名从生成物驱动（WP-138 R5a）：键集 = EntityType（ontology.ts 对生成物
// ENTITY_TYPES 的单源派生）——ontology.yaml 新增/改名实体类型并再生成后，本表缺键或持
// 陈旧键即编译红（satisfies Record<EntityType, string> 执法），不靠手抄清单人工对账。
// 「其他」在手抄期不在表中、渲染落 DEFAULT_COLOR 兜底灰——等价替换：条目显式引用
// DEFAULT_COLOR，渲染值不变；导出面仍为宽键 Record<string, string>，消费侧运行时未知
// 类别仍走 `|| DEFAULT_COLOR` 兜底。
export const DEFAULT_COLOR = "var(--color-gray-9)";
export const CATEGORY_COLORS: Record<string, string> = {
  [ENTITY_CATEGORY.TERMINAL]: "var(--color-slate-10)", [ENTITY_CATEGORY.SERVICE]: "var(--color-cyan-9)", [ENTITY_CATEGORY.STORAGE]: "var(--color-amber-11)", [ENTITY_CATEGORY.INFRASTRUCTURE]: "var(--color-iris-9)",
  [ENTITY_CATEGORY.SECURITY]: "var(--error-rose)", [ENTITY_CATEGORY.PLATE]: "var(--color-orange-9)", [ENTITY_CATEGORY.CONCEPT]: "var(--color-violet-9)", [ENTITY_CATEGORY.OTHER]: DEFAULT_COLOR,
  [ENTITY_CATEGORY.PRODUCT]: "var(--color-grass-9)", [ENTITY_CATEGORY.VERSION]: "var(--color-yellow-9)", [ENTITY_CATEGORY.DOMAIN]: "var(--violet-500)", [ENTITY_CATEGORY.DOCUMENT]: "var(--color-pink-9)",
} satisfies Record<EntityType, string>;

// 关系类型 → 边色（图谱检索枢纽拓扑边上色用；键集与 ontology-registry RELATION_TYPES 的
// 活性面对账（ontology-registry.test.ts 钉断言——WP-049 余量批：legacy_policy=delete 的
// USES 不再持配色，回落 DEFAULT_RELATION_COLOR）；未登记类型回落——未知关系不猜色）
export const RELATION_COLORS: Record<string, string> = {
  CONNECTS_TO: "var(--color-cyan-9)", DEPENDS_ON: "var(--color-amber-11)", BACKS_UP: "var(--color-grass-9)", INDEXES: "var(--color-violet-9)",
  STORES_IN: "var(--color-blue-10)", ENCRYPTS: "var(--color-red-10)", BELONGS_TO: "var(--color-sky-9)", DOCUMENTS: "var(--color-lime-9)",
  REFERENCES: "var(--color-plum-9)", MENTIONS: "var(--color-pink-9)", RELATED: "var(--color-slate-9)", HAS_VERSION: "var(--color-grass-12)",
  HAS_SYMPTOM: "var(--color-orange-11)", APPLIES_TO: "var(--color-violet-11)", ASSOCIATED_WITH: "var(--color-teal-9)",
};
export const DEFAULT_RELATION_COLOR = "var(--color-slate-10)";

// ── 关系图谱可见性判定（Master 2026-10-29 裁定）──
// 无文件背书的节点标签：注册表结构节点（BusinessDomain/Subdomain/Team，TheSchema 投影，extract_graph
// Step 1-2/8 无条件产出）＋派生聚合（Plate 四轴晋升、Product/ProductVersion frontmatter 推导）——
// 不对应 vault 任何页面，须有可见边才进关系图。标签集单源=extract_graph 节点产出面；
// 无 labels 的数据（旧契约/测试桩）按文件背书处理不误杀。
const NON_FILE_LABELS = new Set(["BusinessDomain", "Subdomain", "Team", "Plate", "Product", "ProductVersion"]);

/** 边可见性：REFERENCES=作者手写双链（SPEC-027 置信度恒 1.0）全显；其余类型为机器推导断言，仅人裁 approved 上图。
 * WP-138 R5c：「人裁放行」桶改调 review-status 域单源谓词（isHumanApprovedReviewStatus）——
 * 语义不变（Master 2026-10-29 裁定：派生章不入图，与生效集口径区分见 ReviewStatus.ts 声明处）。 */
export function isEdgeVisible(edge: TopoEdge): boolean {
  return edge.type === "REFERENCES" || isHumanApprovedReviewStatus(edge.reviewStatus);
}

/** 节点背书：文件背书节点（每个节点对应 vault 一篇页面）常驻关系图——Obsidian 孤儿笔记口径 */
export function isFileBackedNode(node: TopoNode): boolean {
  const labels = node.labels ?? [];
  return labels.length === 0 || labels.some((l) => !NON_FILE_LABELS.has(l));
}

/** 图内搜索匹配（Obsidian filters 口径：标签/ID 包含即命中，大小写不敏感；空串=无过滤全通过） */
export function matchesQuery(node: Pick<TopoNode, "id" | "label">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
}

// ── 边 provenance 类型化读取（C7：消除 Record 兜底；数据诚实度——有则展、无则 undefined 由侧栏标「未记录」） ──

export interface EdgeProvenance {
  ruleId?: string;
  ruleRevision?: string;
  sourceKind?: string;
  assertedBy?: string;
  confidence?: number;
}

/** 从 TopoEdge.properties 防御性读取 provenance；真实 feed 中 ruleId/ruleRevision 多数在、confidence 个别在、assertedBy/sourceKind 不在 */
export function readEdgeProvenance(edge: TopoEdge): EdgeProvenance {
  const props = edge.properties ?? {};
  const asString = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const asNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    ruleId: asString(props.ruleId),
    ruleRevision: asString(props.ruleRevision),
    sourceKind: asString(props.sourceKind),
    assertedBy: asString(props.assertedBy),
    confidence: asNumber(props.confidence),
  };
}

// ── Container (band) types ──
// Geometry was removed when the topology view moved from an SVG canvas to a
// tree-table renderer. Containers now carry only band identity, ordering, and
// style tokens — no coordinates.

export interface ContainerDef {
  id: string;
  displayName: string;
  /** Vertical band order (1 = top). Used for sorting and reverse-dependency detection. */
  order: number;
  /** Match rule: which node categories belong in this container */
  categories: string[];
  styleToken: {
    borderColor: string;
    bgColor: string;
    labelColor: string;
    dashed: boolean;
  };
}

/**
 * LocalGraph canvas 色板（批15 lint 债清账·批16 尾笔）。
 * G6 canvas 不解析 CSS var()——组件运行时从 :root 解析 token，解析失败时用本表兜底；
 * 兜底值必须与 src/index.css 的 token 真值一致（本表是 index.css 的镜像兜底，色值唯一源仍在 index.css——
 * lint 豁免仅因色板权威定义身份，与上方分类色板同待遇；改 token 值须同步此处）。
 * 勘误（批15 原实现漂移一处）：--color-accent-base 真值 violet-500 #8b5cf6（原兜底误写蓝 #4f6ef7）。
 * vendor 浅色真值（Radix slate-9 #8b8d98 / slate-10 #80838d，node_modules/@radix-ui/colors/slate.css 实读）。
 */
export const CANVAS_PALETTE = {
  selectedNode: { token: "--color-accent-base", fallback: "#8b5cf6" },
  relatedNode: { token: "--color-slate-9", fallback: "#8b8d98" },
  dimNode: { token: "--color-slate-10", fallback: "#80838d" },
  nodeStroke: { token: "--color-slate-10", fallback: "#80838d" },
  relatedEdge: { token: "--color-accent-base", fallback: "#8b5cf6" },
  dimEdge: { token: "--color-slate-10", fallback: "#80838d" },
} as const;
