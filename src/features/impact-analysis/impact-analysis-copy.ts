// impact-analysis 页级文案单源（WP-151 散写销账第三批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（ImpactAnalysisPanel 影响分析面板＋ImpactHopGroup／ImpactLineage／ImpactPathGraph＋
// relation-overview 关系依据卡（实体全景抽屉等跨页共用）＋api/store 层）的用户可见文案只在本文件声明：
// 按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）；多组件共用的同一事实只一份
// （「未记录」占位：ImpactLineage 与 RelationOverview 共用 IMPACT_SHARED_COPY）。
// 禁在其他 impact-analysis 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";

// ── 跨组件共用 ──
export const IMPACT_SHARED_COPY = {
  /** 指纹/决定记录/来源缺省占位（ImpactLineage hashLabel＋RelationOverview 多处） */
  UNRECORDED: "未记录",
} as const;

// ── api／store 层请求兜底（env.error 缺省时的 fallback；api 抛错与 store requestFailed 共用一键）──
export const IMPACT_REQUEST_COPY = {
  VERSIONS_LOAD_FAILED: "产品版本加载失败",
  ANALYSIS_FAILED: `架构组件${TERM.TASK_IMPACT_ANALYSIS}失败`,
} as const;

// ── ImpactAnalysisPanel（影响分析面板）──
/** 风险分类人读名（WP-006 第2项；语义源＝ADR009 R11-R15，见 ontology schema riskKind 描述） */
export const IMPACT_RISK_KIND_LABELS: Record<string, string> = {
  data: "数据",
  recovery: "恢复",
  searchability: "可检索",
  confidentiality: "机密",
  dependency: "依赖",
};

/** 已排除关系的排除原因人读名 */
export const IMPACT_FILTER_REASON_LABELS: Record<string, string> = {
  EDGE_TYPE: "不参与影响传导",
  INVALID_CONFIDENCE: "置信信息无效",
  REJECTED: "关系已被驳回",
  MISSING_LINEAGE: "缺少完整来源依据",
  STALE_SOURCE: "来源已过期",
  UNVERIFIED_FRESHNESS: "无法证明来源为最新",
  LOW_CONFIDENCE: "低于置信阈值",
};

/** 推断规则人读名 */
export const IMPACT_INFERENCE_RULE_LABELS: Record<string, string> = {
  transitive_dependency: "依赖关系传递",
  document_covers_related: "文档覆盖关系传递",
};

/** 推断关系置信档人读名 */
export const IMPACT_CONFIDENCE_BAND_LABELS: Record<string, string> = {
  HIGH: "高置信",
  MEDIUM: "中置信",
  LOW: "低置信",
};

export const IMPACT_PANEL_COPY = {
  TITLE: "分析架构组件变更会影响什么",
  SUBTITLE: "沿关系链追踪上游支撑、下游影响和关联文档。",
  /** 版本下拉分组 */
  VERSION_GROUP_RELEASED: "已发布版本",
  VERSION_GROUP_DRAFT: "草稿版本",
  VERSION_GROUP_HISTORY: "历史版本",
  /** 分析起点选择 */
  SEED_ARIA: "分析起点实体",
  SEED_TITLE: "选择架构组件",
  SEED_SEARCH: "搜索架构组件名称",
  SEED_EMPTY: "未选择架构组件",
  /** 传导方向 */
  DIRECTION_ARIA: "传导方向",
  DIRECTION_TITLE: "按流向筛选",
  DIRECTION_SEARCH: "筛选流向",
  DIRECTION_DOWNSTREAM: "下游",
  DIRECTION_UPSTREAM: "上游",
  DIRECTION_BOTH: "双向",
  DIRECTION_GROUP: "流向类型",
  /** 产品版本 */
  VERSION_ARIA: "分析产品版本",
  VERSION_TITLE: "选择产品版本",
  VERSION_SEARCH: "筛选产品版本",
  /** 滑块与开关（标签与 aria 同值处共用一键，数值前空格由 JSX 给出） */
  MAX_HOPS_LABEL: "最大关系跳数",
  CONFIDENCE_PREFIX: "置信度 ≥ ",
  CONFIDENCE_ARIA: "置信度阈值",
  ENABLE_INFERENCE: "启用关系推断",
  INFERENCE_DEPTH_LABEL: "推断深度",
  /** 版本范围读取失败的回落说明 */
  NO_RELEASE_FALLBACK: "当前无已发布的正式版本，本次将按当前主图分析。",
  /** 分析按钮 */
  ANALYZING: "分析中…",
  ANALYZE_ACTION: "查看影响结果",
  EMPTY_RESULT: "所选实体没有匹配的影响结果，请切换方向或扩大关系跳数。",
  /** 已排除关系 */
  FILTER_REASON_FALLBACK: "未参与本次分析",
  /** 推断关系 */
  INFERRED_EDGES_LABEL: "推断关系",
  INFERENCE_BASIS_PREFIX: "生成依据：",
  INFERENCE_RULE_FALLBACK: "已登记推断规则",
  INFERENCE_CHAIN_PREFIX: "推断路径：",
  RISK_BREAKDOWN_PREFIX: "风险分类：",
  RELATED_DOCS: "关联文档",
} as const;

/** 版本范围读取失败（非「无正式版本」）的回落说明 */
export function impactScopeErrorFallback(error: string): string {
  return `${error}，本次将按当前主图分析。`;
}

/** 已排除关系折叠条标题 */
export function impactFilteredEdgesSummary(count: number): string {
  return `已排除关系 (${count})`;
}

/** 推断关系折叠条标题 */
export function impactInferredEdgesSummary(count: number): string {
  return `${IMPACT_PANEL_COPY.INFERRED_EDGES_LABEL} (${count})`;
}

// ── ImpactHopGroup（按跳分组）──
/** 影响分级人读名 */
export const IMPACT_RISK_LABELS: Record<string, string> = {
  HIGH: "高影响",
  MEDIUM: "中影响",
  LOW: "低影响",
};

export const IMPACT_HOP_GROUP_COPY = {
  DOWNSTREAM: "下游影响",
  UPSTREAM: "上游支撑",
  RISK_UNGRADED: "影响未分级",
} as const;

/** 分组标题层级尾巴 */
export function impactHopLayerSuffix(hop: number): string {
  return ` · 第 ${hop} 层影响`;
}

// ── ImpactLineage（分析可信状态条）──
export const IMPACT_LINEAGE_COPY = {
  ARIA: "分析可信状态",
  SCOPE_PREFIX: "产品版本：",
  GRAPH_HASH_PREFIX: "主图指纹：",
  RELEASE_PREFIX: "正式读取：",
} as const;

// ── ImpactPathGraph（影响路径拓扑）──
export const IMPACT_PATH_GRAPH_COPY = {
  /** 区块 aria 与标题同值 */
  TITLE: "影响路径拓扑",
  TRUNCATED: "结果已截断",
  TOO_MANY_NODES: "架构组件超过 500 个，已停止绘制路径拓扑",
  NO_PATHS: "没有可展示的影响路径",
} as const;

/** 标题下计数行 */
export function impactPathCountText(pathCount: number, nodeCount: number): string {
  return `${pathCount} 条路径 · ${nodeCount} 个架构组件`;
}

/** 节点按钮 title */
export function impactOpenEntityTitle(label: string): string {
  return `打开实体全景：${label}`;
}

/** 关系箭头按钮 aria */
export function impactEdgeBasisAria(sourceLabel: string, targetLabel: string): string {
  return `查看 ${sourceLabel} 到 ${targetLabel} 的关系依据`;
}

// ── relation-overview（关系依据卡，跨页共用）──
/** 数据新鲜度三态展示文案（freshnessView 唯一映射消费） */
export const RELATION_FRESHNESS_COPY = {
  FRESH_LABEL: "来源与当前管道一致",
  FRESH_DETAIL: "可用于本次分析",
  STALE_LABEL: "来源已变化",
  STALE_DETAIL: "结论需要重跑管道后复核",
  UNKNOWN_LABEL: "来源状态待确认",
  UNKNOWN_DETAIL: "当前无法证明结论使用了最新来源",
} as const;

/** 生成依据 reasonCode 人读名 */
export const RELATION_REASON_LABELS: Record<string, string> = {
  SOURCE_RELATION_WITH_VERSION_RULE: "来源正文关系，并由版本规则补充有效范围",
  SOURCE_RELATION: "来源正文中的类型化关系",
  APPROVED_RELATION: "已审核关系",
  DERIVED_STRUCTURE: "规则自动生成的结构关系",
  RELATION_TRAVERSAL: "按已准入关系进行路径分析",
};

export const RELATION_OVERVIEW_COPY = {
  VERSION_UNBOUNDED: "未限定版本范围",
  REASON_FALLBACK: "正式关系来源",
  SUMMARY: "查看关系依据",
  DT_SOURCE: "来源",
  DT_VERSION_RANGE: "适用版本",
  DT_REASON: "生成依据",
  DT_DECISION: "决定记录",
  DT_EVIDENCE_HASH: "证据指纹",
  DT_SOURCE_HASH: "来源指纹",
  DT_FRESHNESS: "当前有效性",
  DT_RELEASE: "正式读取版本",
  /** 跳待处理问题页（页名取 TERM.PENDING_ISSUES；document-inventory 文章全景同句同源） */
  ANOMALY_HANDOFF_ACTION: `在${TERM.PENDING_ISSUES}中查看`,
  /** 决定记录 kind 人读名（relationOverviewFromImpactEdge 拼装） */
  DECISION_MANUAL: "人工决定",
  DECISION_AUTO: "自动规则",
} as const;

/** 适用版本区间（起止均有） */
export function relationVersionRangeBoth(since: string, until: string): string {
  return `${since} 起，${until} 前`;
}

/** 适用版本区间（仅起） */
export function relationVersionRangeSince(since: string): string {
  return `${since} 起`;
}

/** 适用版本区间（仅止） */
export function relationVersionRangeUntil(until: string): string {
  return `${until} 前`;
}

/** 来源行号尾巴 */
export function relationSourceLineSuffix(line: number): string {
  return ` · 第 ${line} 行`;
}
