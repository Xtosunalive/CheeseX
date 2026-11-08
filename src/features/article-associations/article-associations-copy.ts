// article-associations 页级文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（文章关联页：标准文章候选选择＋纠错方式＋关联组件/版本＋映射差异预览＋已保存映射表＋api/store 兜底）的
// 用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 页名「文章关联」不在此手写——引用 TERM.ARTICLE_MAPPING_REPAIR（页面正名守卫，copy-vocabulary-closed-set 组四）；
// 文章字段中文名（产品/产品版本）从 shared/field-labels.mjs 派生（seq209 单源，禁手写第二份）。
// 禁在其他 article-associations 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；改文案只改这里。
// 闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES
// 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";
import { FIELD_LABELS } from "../../../shared/field-labels.mjs";

// ── 多组件共用（同一事实只一份）──
export const ARTICLE_ASSOCIATION_COPY = {
  UNNAMED_ARTICLE: "未命名文章",
  /** 「查看映射结果」（工作区动作钮／预览区标题同值） */
  PREVIEW_RESULT: "查看映射结果",
  /** 文章产品／版本字段名（seq209 派生） */
  ARTICLE_PRODUCT: FIELD_LABELS.article.product,
  ARTICLE_VERSION: FIELD_LABELS.article.version,
} as const;

/** 纠错动作名（键＝AssociationAction；决策表「动作」列与工作区分段钮同值） */
export const ASSOCIATION_ACTION_LABELS = {
  add: "补充关联",
  remove: "移除关联",
  replace: "重新指定",
} as const;

// ── api/store 层请求兜底 ──
export const AA_REQUEST_COPY = {
  LOAD_FAILED: `${TERM.ARTICLE_MAPPING_REPAIR}加载失败`,
  PREVIEW_FAILED: `${TERM.ARTICLE_MAPPING_REPAIR}预览失败`,
  SAVE_FAILED: "文章映射写回失败",
} as const;

// ── ArticleAssociationsView（页面入口）──
export const AA_VIEW_COPY = {
  LOADING: `正在加载${TERM.STANDARD_ARTICLE_CANDIDATE}...`,
} as const;

// ── AssociationDecisionPanel（映射修复工作区）──
export const AA_PANEL_COPY = {
  SECTION_ARIA: "文章图谱映射修复工作区",
  ARTICLE_PICK_ARIA: `选择${TERM.STANDARD_ARTICLE_CANDIDATE}`,
  ARTICLE_SEARCH_PLACEHOLDER: "搜索文章标题",
  UNLABELED_PRODUCT: "未标注产品",
  UNLABELED: "未标注",
  APPLICABLE_VERSION: "适用版本",
  SOURCE: "来源",
  ACTION_MODE: "纠错方式",
  COMPONENTS_LABEL: "关联架构组件",
  COMPONENTS_PICK_ARIA: "选择关联架构组件",
  COMPONENTS_SEARCH_PLACEHOLDER: "搜索架构组件名称",
  COMPONENTS_EMPTY: "不选择架构组件",
  VERSIONS_LABEL: "适用产品版本",
  VERSIONS_PICK_ARIA: "选择关联版本",
  VERSIONS_SEARCH_PLACEHOLDER: "搜索产品或版本号",
  VERSIONS_EMPTY: "不选择版本",
  SAVE: "保存映射",
} as const;

// ── AssociationPreview（映射差异预览）──
export const AA_PREVIEW_COPY = {
  UNREGISTERED_ITEM: "未登记项",
  NONE: "无",
  SECTION_ARIA: "文章图谱映射差异预览",
  CURRENT_MAPPING: "当前自动映射",
  NEXT_MAPPING: "修复后映射",
} as const;

export function aaAddedCount(n: number): string {
  return `${TERM.ADD_ACTION} ${n}`;
}
export function aaRemovedCount(n: number): string {
  return `移除 ${n}`;
}

// ── AssociationDecisionList（已保存文章映射表）──
export const AA_DECISION_LIST_COPY = {
  COL_ARTICLE: "文章",
  COL_ACTION: "动作",
  COL_ITEMS: "关联项",
  COL_AUDIT: "审计状态",
  STALE: "来源内容已变化",
  VALID: "审计记录有效",
  SECTION_ARIA: "已保存的文章图谱映射",
  HEADING: "已保存文章映射",
  TABLE_ARIA: "已保存文章映射表",
} as const;

export function aaItemCount(n: number): string {
  return `${n} 项`;
}
