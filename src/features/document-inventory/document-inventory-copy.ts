// document-inventory 页级文案单源（WP-151 散写销账第三批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（DocumentInventoryView 文档清单页＋components 检索条/结果卡/文章全景等＋api/store 层）的用户可见文案
// 只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）；多组件共用的同一事实只一份
// （图谱状态词与「文内关系」前缀：DocumentResultCard 与 ArticlePanorama 共用 DOCUMENT_SHARED_COPY）。
// 分工：字段中文名仍住同目录 article-panorama-labels.ts／document-result-field-labels.ts（从
// shared/field-labels.mjs 派生，本文件不收字段名）；本文件只收页面文案。
// 禁在其他 document-inventory 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";
import type { DocumentInventoryDocument } from "./document-inventory-types";

// ── 跨组件共用 ──
export const DOCUMENT_SHARED_COPY = {
  /** 图谱状态（graphStatus === "indexed" 与否） */
  GRAPH_STATUS_INDEXED: "已入图",
  GRAPH_STATUS_PENDING: "待抽取",
  RELATIONS_PREFIX: "文内关系：",
} as const;

// ── api／store 层请求兜底（env.error 缺省时的 fallback；api 与 store 同一操作共用一键）──
export const DOCUMENT_REQUEST_COPY = {
  SEARCH_FAILED: "文档检索失败",
  CANDIDATE_SEARCH_FAILED: "半成品名称检索失败",
  DETAIL_FAILED: "文档详情查询失败",
} as const;

// ── DocumentInventoryView（文档清单页）──
export const DOCUMENT_INVENTORY_VIEW_COPY = {
  TOTAL_STAT_LABEL: "正式版文档总数",
  TOTAL_STAT_HINT: "当前正式版本中的标准文章与已批准文档",
  CLEAR_FILTERS_TITLE: "清除所有筛选条件",
  CLEAR_FILTERS_ARIA: "清除文档筛选",
  SEARCHING: "正在检索…",
  EMPTY_NO_MATCH: "没有匹配文档",
  /** 半成品名称结果区 */
  CANDIDATE_RESULTS_TITLE: "半成品名称",
  CANDIDATE_BADGE_TITLE: "数据来自 precleaned 工作区，非正式版本",
  CANDIDATE_BADGE: "半成品",
} as const;

/** 空态指引下的待抽取计数 */
export function documentPendingExtractionText(count: number): string {
  return `${DOCUMENT_SHARED_COPY.GRAPH_STATUS_PENDING} ${count} 篇`;
}

/** 半成品名称结果条数 */
export function documentCandidateTotalText(count: number): string {
  return `${count} 条`;
}

// ── ArticlePanorama（正式文章全景）──
export const ARTICLE_PANORAMA_COPY = {
  IDENTITY_MISMATCH: "正式文章详情身份不匹配",
  DETAIL_QUERY_FAILED: "正式文章详情查询失败",
  DETAIL_LOADING: "正在读取正式文章详情…",
  DETAIL_UNAVAILABLE: "正式文章详情不可用",
  ARIA: "文章全景",
  UNSCOPED: "未限定",
  /** 跳待处理问题页（页名取 TERM.PENDING_ISSUES；impact-analysis 关系依据卡同句同源） */
  ANOMALY_HANDOFF_ACTION: `在${TERM.PENDING_ISSUES}中查看`,
} as const;

// ── DocumentResultCard（文档结果卡）──
/** 文档类别人读名（documentKind 值域满配钉：Record 键集随契约类型，加类别不登记即 tsc 红） */
export const DOCUMENT_KIND_LABELS: Record<DocumentInventoryDocument["documentKind"], string> = {
  entity: "实体文档",
  "standard-article": TERM.STANDARD_ARTICLE,
  source: "来源文档",
  overview: "总览",
  query: "查询",
  comparison: "对比",
  todo: "待办",
};

export const DOCUMENT_RESULT_CARD_COPY = {
  QUICK_JUMP: "快捷跳转",
  /** 实体全景按钮 title（按钮可见文本取 TERM.ENTITY_OVERVIEW） */
  OPEN_ENTITY_OVERVIEW_TITLE: "打开实体全景",
  IMPACT_TITLE: "查看此实体的影响面",
  IMPACT_ACTION: "影响面",
  GRAPH_HIGHLIGHT_TITLE: "在关系分析中高亮此实体",
  GRAPH_ACTION: TERM.GRAPH,
} as const;

// ── DocumentLinkPopover ──
/** Obsidian 打开链接 title */
export function documentOpenInObsidianTitle(relativePath: string): string {
  return `在 Obsidian 中打开 ${relativePath}`;
}

// ── CardNav／DocumentSearchBar（检索条）──
export const DOCUMENT_SEARCH_COPY = {
  FILTER_MENU_ARIA: "筛选菜单",
  SEARCH_PLACEHOLDER: "搜索标题、文档元数据、正文和关联内容",
  EXPAND_SEARCH_ARIA: "展开文档搜索",
  SEARCH_TITLE: "文档搜索",
} as const;

// ── FilterChipBar／FilterGroupPopover（筛选片与分组下拉）──
/** 筛选片清除按钮 aria */
export function documentClearChipAria(label: string): string {
  return `清除 ${label}`;
}

/** 分组下拉 aria 与搜索占位（同值） */
export function documentFilterGroupAria(label: string): string {
  return `筛选${label}`;
}

/** 分组下拉 title */
export function documentFilterGroupTitle(label: string): string {
  return `按${label}筛选`;
}

/** 分组下拉「全部」空选项 */
export function documentFilterGroupEmpty(label: string): string {
  return `全部${label}`;
}
