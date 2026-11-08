// admission 页级文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（实体准入页：准入规模统计卡＋实体多维大表〔快速搜索/QA 式高级筛选/排序/分页〕＋源文档与准入详情抽屉
// ＋api 层兜底）的用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 页名「实体准入」不在此手写——引用 TERM.GRAPH_ADMISSION（页面正名守卫，copy-vocabulary-closed-set 组四）。
// 类别名（准入表类别色键）是数据值，按名引用 lib/domain/EntityCategory，不住本文件。
// 禁在其他 admission 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；改文案只改这里。
// 闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES
// 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";

// ── 多组件共用（同一事实只一份）──
export const ADMISSION_COPY = {
  /** 准入状态（筛选字段名／排序列头／抽屉定义项同值） */
  ADMISSION_STATUS: "准入状态",
  /** 源文档详情（行操作列头／抽屉空态标题同值） */
  SOURCE_DOC_DETAIL: "源文档详情",
} as const;

// ── api 层请求兜底 ──
export const ADMISSION_REQUEST_COPY = {
  CLASSIFICATION_MISSING_DATA: "分类列表响应缺少数据",
} as const;

// ── AdmissionView（准入规模统计卡）──
export const ADMISSION_VIEW_COPY = {
  PENDING_LABEL: `待准入${TERM.ENTITY}`,
  ADMITTED_LABEL: `已准入${TERM.ENTITY}`,
  ADMITTED_HINT: "已进入正式拓扑视图",
  ADMITTED_DOCS_LABEL: "已准入文档",
} as const;

export function admissionPendingHint(registryTotal: number | null): string {
  return `注册表 ${registryTotal} 项中尚未准入`;
}
export function admissionDocsHint(candidateDocs: number | null): string {
  return `${candidateDocs} 篇候选文档（文档准入与${TERM.GRAPH_ADMISSION}分账）`;
}

// ── EntityRegistryTable（实体多维大表）──
export const ENTITY_REGISTRY_COPY = {
  /** 高级筛选匹配方式（键＝FilterOp） */
  OP_CONTAINS: "包含",
  OP_EQ: "等于",
  OP_NEQ: "不等于",
  OP_NOT_CONTAINS: "不包含",
  ALL_FIELDS: "全部字段",
  COMPONENT_NAME: `${TERM.ARCH_COMPONENT}名称`,
  /** 列头排序句柄 */
  NAME_ASC: "名称 A-Z",
  NAME_DESC: "名称 Z-A",
  LAYER_ASC: "层级 A-Z",
  LAYER_DESC: "层级 Z-A",
  CATEGORY_ASC: "分类 A-Z",
  CATEGORY_DESC: "分类 Z-A",
  DOC_ASC: "文档 A-Z",
  DOC_DESC: "文档 Z-A",
  STATUS_ASC: "状态 A-Z",
  STATUS_DESC: "状态 Z-A",
  /** 工具栏 */
  SEARCH_ARIA: "搜索入图实体",
  SEARCH_PLACEHOLDER: "搜索架构组件、实体、分层、类别或文档",
  ADVANCED_FILTER: "高级筛选",
  CLEAR_FILTER_ARIA: "清除入图筛选",
  PASS_RATE_LABEL: "已准入比例",
  /** QA 式高级筛选面板 */
  NO_CONDITIONS: "尚未添加条件，点击下方按钮添加",
  FIELD_SELECT_TITLE: "选择筛选字段",
  FIELD_SELECT_SEARCH: "筛选字段",
  FIELD_OPTION_GROUP: "字段",
  OP_SELECT_TITLE: "选择匹配条件",
  OP_SELECT_SEARCH: "筛选条件",
  OP_OPTION_GROUP: "匹配方式",
  VALUE_PLACEHOLDER: "输入值后回车查询...",
  APPLY_FILTERS: "应用筛选",
  ADD_CONDITION: "添加条件",
  CLEAR_ALL: "清除所有",
  /** 表格空态与分页 */
  EMPTY_NO_ITEMS: "还没有可准入的实体",
  EMPTY_NO_MATCH: "无匹配结果",
  EMPTY_NO_MATCH_DESC: "调整搜索或筛选条件后再试。",
  TABLE_ARIA: `${TERM.GRAPH_ADMISSION}表`,
  PAGINATION_ARIA: `${TERM.GRAPH_ADMISSION}分页`,
} as const;

export function registryViewAction(componentName: string): string {
  return `查看 ${componentName}`;
}
export function registryRowActionsAria(componentName: string): string {
  return `${componentName}行操作`;
}
export function registryVisibleCount(visible: number, total: number): string {
  return `${visible} / ${total} 条`;
}
export function registryFieldSelectAria(ordinal: number): string {
  return `筛选字段 ${ordinal}`;
}
export function registryOpSelectAria(ordinal: number): string {
  return `筛选条件 ${ordinal}`;
}
export function registryRemoveConditionAria(ordinal: number): string {
  return `删除筛选条件 ${ordinal}`;
}

// ── ArticleDrawer（源文档与准入详情抽屉）──
export const ARTICLE_DRAWER_COPY = {
  TITLE: "源文档与准入详情",
  CLOSE_ARIA: "关闭源文档详情",
  PATH_SECTION: "物理磁盘映射路径",
  FRONTMATTER_SECTION: "源文档字段快照",
  NO_SOURCE_DOC: `该${TERM.ENTITY}未关联${TERM.GRAPH_SOURCE_DOCUMENT}。`,
  ADMISSION_SECTION: "准入信息",
  CLOSE_SIDEBAR: "关闭侧边栏",
  NO_SELECTION: `未选择${TERM.ENTITY}`,
} as const;
