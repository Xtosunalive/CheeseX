// review 页级文案单源（WP-150 散写销账第二批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（ReviewView 三页签：EdgeReviewPanel／InferenceConflictPanel／AuditLogPanel＋api 层两文件）
// 的用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 schema-manager-copy 先例）。
// 禁在其他 review 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";
// seq209：字段中文名从 shared/field-labels.mjs 派生（status 字段名「状态」——禁手写第二份）
import { fieldLabel as sharedFieldLabel } from "../../../shared/field-labels.mjs";

// ── 三页签共用（同一事实只一份）──
export const REVIEW_COPY = {
  /** DataTable 空态（筛选无命中，三页签同值） */
  EMPTY_NO_MATCH: "无匹配结果",
} as const;

// ── api 层请求兜底错误（env.error 缺省时的 fallback）──
// 消费面：review-api／inference-conflict-api（学 schema-manager-copy SM_REQUEST_COPY 先例）
export const REVIEW_REQUEST_COPY = {
  /** review-api request 包装（fetchPendingReview／fetchReviewHistory／reviewEdge 共用） */
  REQUEST_FAILED: "关系评审请求失败",
  /** GET /api/kg/inference-conflicts 读取 */
  CONFLICTS_FETCH_FAILED: "获取冲突列表失败",
} as const;

// ── ReviewView（关系审核 Tab 页入口）──
export const REVIEW_VIEW_COPY = {
  TABS_ARIA: "关系审核视图",
} as const;

/** ReviewView 主视觉统计卡（label/hint 含 TERM.RELATION——学 schema-manager-copy 插值句先例） */
export function reviewPendingStatLabel(): string {
  return `待审核${TERM.RELATION}`;
}
export function reviewPendingStatHint(): string {
  return `全部待审核${TERM.RELATION}总数`;
}

// ── EdgeReviewPanel（待审核关系表）──
export const EDGE_REVIEW_COPY = {
  /** 操作 toast / 失败兜底 */
  ACTION_FAILED_RETRY: "操作失败，请重试",
  /** 列头与排序句柄 */
  COL_SOURCE: "源实体",
  COL_SOURCE_ASC: "源实体 A-Z",
  COL_SOURCE_DESC: "源实体 Z-A",
  COL_TARGET: "目标实体",
  COL_TARGET_ASC: "目标实体 A-Z",
  COL_TARGET_DESC: "目标实体 Z-A",
  COL_TYPE_SOURCE: "类型 / 来源",
  COL_TYPE_ASC: "类型 A-Z",
  COL_TYPE_DESC: "类型 Z-A",
  COL_ACTIONS: "操作",
  /** 建议置信度行（JSX 段原样搬迁——尾随空格保留） */
  SUGGEST_PREFIX: "建议 ",
  BASIS_UNRECORDED: "依据未记录",
  SOURCE_PREFIX: "来源 ",
  CONFIDENCE_SOURCE_PREFIX: "置信度来源 ",
  /** 档位选择（title 悬浮教学＋四选项） */
  BAND_SELECT_TITLE: "选择置信度档位：选定后系统会先更新该关系的正式记录，再进入评审；不选则保持现状",
  BAND_NONE: "不评分位",
  BAND_HIGH: "高",
  BAND_MEDIUM: "中",
  BAND_LOW: "低",
  /** 行内批准/驳回（title 悬浮＋按钮面） */
  APPROVE_BLOCKED_TITLE: "存在未解决的实体问题，暂时无法批准——可先到待处理问题页处理",
  APPROVE_TITLE: "批准此关系入图",
  APPROVE_ACTION: "批准",
  REJECT_TITLE: "驳回此关系",
  REJECT_ACTION: "驳回",
  /** 防篡改对账折叠条（WP-034：默认收起，悬浮显全文） */
  WORKING_REV_SUMMARY: "待审核关系",
  WORKING_REV_COLLAPSED_HINT: "（校验信息默认收起）",
  WORKING_REV_MISSING: "校验信息缺失，审核结论暂不会进入正式发布",
  /** DataTable 三态/工具栏 */
  TABLE_ARIA: "待审核关系表",
  LOADING_LABEL: "加载待审核关系...",
  EMPTY_ALL_REVIEWED: "所有关系均已审核",
  SEARCH_ARIA: "搜索待审核关系",
  SEARCH_PLACEHOLDER: "搜索源实体、目标实体、类型或来源",
  FILTER_TYPE_ARIA: "筛选关系类型",
  FILTER_TYPE_TITLE: "按关系类型筛选",
  FILTER_TYPE_SEARCH: "筛选关系类型",
  EMPTY_ALL_TYPES: "全部类型",
  PLACEHOLDER_TYPE: "类型",
  GROUP_TYPE: "关系类型",
  FILTER_SOURCE_ARIA: "筛选关系来源",
  FILTER_SOURCE_TITLE: "按关系来源筛选",
  FILTER_SOURCE_SEARCH: "筛选关系来源",
  EMPTY_ALL_SOURCES: "全部来源",
  PLACEHOLDER_SOURCE: "来源",
  GROUP_SOURCE: "关系来源",
  REFRESH: "刷新待审核关系",
  PAGINATION_ARIA: "关系审核分页",
  /** EndpointCell 文档节点徽章 */
  DOC_BADGE: "文档",
  /** 阻断原因深链（EdgeMeta） */
  BLOCKERS_ARIA: "阻断原因",
  BLOCKER_LINK_TITLE: "跳转异常工作台处理该问题",
  BLOCKER_KIND_MISSING_ENTITY: "缺实体",
  BLOCKER_KIND_UNRECOGNIZED: "未识别实体",
  BLOCKER_UNKNOWN_ENDPOINT: "未知端点",
  /** 关系类型缺登记回落（relationMeta description 兜底） */
  UNREGISTERED_RELATION_TYPE: "尚未登记的关系类型",
  /** 置信度来源值域的人话映射（WP-034/PR-149 收编；满配钉在 src/test/review-leaks.test.ts） */
  CONFIDENCE_SOURCE_LABEL: {
    band: "评分档",
    native: "原生数据",
    suggestion: "系统建议",
    none: "无",
  },
  CONFIDENCE_SOURCE_UNLABELED: "未标记",
} as const;

/** 行内批准/驳回 toast（F2 瞬时路线） */
export function edgeReviewActionToast(action: "approved" | "rejected", sourceLabel: string, targetLabel: string): string {
  return action === "approved"
    ? `已批准关系: ${sourceLabel} → ${targetLabel}`
    : `已驳回关系: ${sourceLabel} → ${targetLabel}`;
}

/** 建议置信度悬浮 title（证据：共现文章＋观测时间） */
export function edgeReviewEvidenceTitle(articleRefs: string[], observedAt: string | undefined): string {
  return `证据：${articleRefs.join("、")}${observedAt ? `（观测 ${observedAt}）` : ""}`;
}

/** 建议置信度依据段（共现计数；未记录回退） */
export function edgeReviewBasisText(cooccurrenceCount: number | undefined): string {
  return cooccurrenceCount === undefined ? EDGE_REVIEW_COPY.BASIS_UNRECORDED : `依据 ${cooccurrenceCount} 篇共现`;
}

/** meta 计数串（visibleCount / total 条待审核关系） */
export function edgeReviewMetaText(visible: number, total: number): string {
  return `${visible} / ${total} 条待审核关系`;
}

/** 阻断原因深链行文案（kind 已译名时直用；端点缺登记回退未知端点） */
export function edgeReviewBlockerText(kindLabel: string, entityId: string | null | undefined): string {
  return `${kindLabel}：${entityId ?? EDGE_REVIEW_COPY.BLOCKER_UNKNOWN_ENDPOINT} · 去处理`;
}

// ── InferenceConflictPanel（规则冲突表）──
export const INFERENCE_CONFLICT_COPY = {
  /** 状态筛选三选（STATUS_OPTIONS）＋statusLabel 同族（同一事实只一份） */
  STATUS_ALL: "全部状态",
  STATUS_UNRESOLVED: "待解决",
  STATUS_RESOLVED: "历史审计",
  GROUP_STATUS: "冲突状态",
  /** 适用范围回退（无结论时） */
  SCOPE_FALLBACK: "当前产品版本",
  /** conclusionKey 正名（两键穷尽，未知键回退业务键） */
  CONCLUSION_ARCH_CHANGE: "架构变更处置",
  CONCLUSION_BUSINESS: "业务结论裁决",
  /** 详情展开段（unresolved 阻断说明／resolved 历史审计段） */
  BLOCKED_NOTE: "当前无权威来源可承载裁决，写入保持阻断",
  AUDIT_NOTE: "历史审计记录，不作为当前写入放行依据",
  HISTORY_ADOPTED: "历史采用结论",
  DECISION_UNSTRUCTURED: "历史决定未结构化",
  /** 列头与排序句柄 */
  COL_SCOPE: "适用范围",
  COL_SCOPE_ASC: "版本升序",
  COL_SCOPE_DESC: "版本降序",
  COL_CONCLUSION: "处理事项",
  COL_CONCLUSION_ASC: "事项升序",
  COL_CONCLUSION_DESC: "事项降序",
  COL_CANDIDATES: "候选结论",
  COL_CANDIDATES_ASC: "结论升序",
  COL_CANDIDATES_DESC: "结论降序",
  // 「状态」＝shared/field-labels.mjs 实体域 status 字段中文名（seq209 单源原则：字段中文名不手写第二份，经派生）
  COL_STATUS: sharedFieldLabel("status"),
  COL_STATUS_ASC: "待解决优先",
  COL_STATUS_DESC: "历史审计优先",
  COL_ADOPTED: "采用结论",
  COL_ADOPTED_ASC: "最早解决优先",
  COL_ADOPTED_DESC: "最近解决优先",
  COL_ACTIONS: "操作",
  /** 采用结论回退（无结构化决定且无 resolution） */
  ADOPTED_UNDECIDED: "尚未决定",
  /** DataTable 三态/工具栏 */
  TABLE_ARIA: "规则冲突表",
  EMPTY_EMPTY: "暂无推理规则冲突",
  SEARCH_ARIA: "搜索规则冲突",
  SEARCH_PLACEHOLDER: "搜索适用范围、处理事项或采用结论",
  FILTER_STATUS_ARIA: "筛选冲突状态",
  FILTER_STATUS_TITLE: "按冲突状态筛选",
  FILTER_STATUS_SEARCH: "筛选冲突状态",
  CLEAR_ARIA: "清除冲突筛选",
  PAGINATION_ARIA: "规则冲突分页",
} as const;

/** 展开行 aria 名（展开/收行动词＋适用范围＋裁决） */
export function inferenceConflictExpandAria(expanded: boolean, scope: string): string {
  return `${expanded ? TERM.COLLAPSE_ACTION : TERM.EXPAND_ACTION}${scope}裁决`;
}

/** meta 计数串（visibleCount / total 条规则冲突） */
export function inferenceConflictMetaText(visible: number, total: number): string {
  return `${visible} / ${total} 条规则冲突`;
}

// ── AuditLogPanel（审核记录表）──
export const AUDIT_LOG_COPY = {
  /** 动作正名（review_actions 账本枚举 → 用户语） */
  ACTION_LABEL: {
    approved: "通过",
    rejected: "驳回",
    reopen: "重开",
    reset_to_pending: "重置",
  },
  /** 列头与排序句柄 */
  COL_RELATION: "源实体 → 目标实体",
  COL_RELATION_ASC: "关系 A-Z",
  COL_RELATION_DESC: "关系 Z-A",
  COL_ACTION: "动作",
  COL_ACTION_ASC: "动作 A-Z",
  COL_ACTION_DESC: "动作 Z-A",
  COL_REVIEWER: "审核人",
  COL_REVIEWER_ASC: "审核人 A-Z",
  COL_REVIEWER_DESC: "审核人 Z-A",
  COL_REASON: "原因",
  COL_REASON_ASC: "原因 A-Z",
  COL_REASON_DESC: "原因 Z-A",
  COL_TIME: "时间",
  COL_TIME_ASC: "最旧优先",
  COL_TIME_DESC: "最新优先",
  /** DataTable 三态/工具栏 */
  TABLE_ARIA: "审核记录表",
  EMPTY_EMPTY: "暂无审核记录",
  EMPTY_NO_MATCH_HINT: "调整搜索或筛选条件后再试",
  SEARCH_ARIA: "搜索审核记录",
  SEARCH_PLACEHOLDER: "搜索关系、审核人或原因",
  FILTER_ACTION_ARIA: "筛选审核动作",
  FILTER_ACTION_TITLE: "按审核动作筛选",
  FILTER_ACTION_SEARCH: "筛选审核动作",
  EMPTY_ALL_ACTIONS: "全部动作",
  PLACEHOLDER_ACTION: "动作",
  GROUP_ACTION: "审核动作",
  FILTER_REVIEWER_ARIA: "筛选审核人",
  FILTER_REVIEWER_TITLE: "按审核人筛选",
  FILTER_REVIEWER_SEARCH: "筛选审核人",
  EMPTY_ALL_REVIEWERS: "全部审核人",
  PLACEHOLDER_REVIEWER: "审核人",
  GROUP_REVIEWER: "审核人",
  CLEAR_ARIA: "清除审核记录筛选",
  REFRESH: "刷新审核记录",
  PAGINATION_ARIA: "审核记录分页",
} as const;

/** meta 计数串（visibleCount / total 条审核记录） */
export function auditLogMetaText(visible: number, total: number): string {
  return `${visible} / ${total} 条审核记录`;
}
