// data-dashboard 页级文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（图谱检索枢纽 DataDashboardView＋拓扑工具栏／三上下文侧栏／关系图／关系库／关系总览／分类与分层侧栏）
// 的用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 禁在其他 data-dashboard 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";

// ── 多组件共用（同一事实只一份）──
/** 关系条数短语（拓扑工具栏计数／三上下文侧栏连接数／关系总览余量共用） */
export function ddRelationCount(n: number): string {
  return `${n} 条关系`;
}

// ── DataDashboardView（图谱检索枢纽）──
export const DD_VIEW_COPY = {
  TAB_TOPO: "拓扑",
  WORKTREE_BADGE: "工作投影",
  WORKTREE_BADGE_TITLE: "数据来自工作树投影，非正式 Release",
  HUB_TABS_ARIA: `${TERM.GRAPH_EXPLORER}视图`,
  /** 规模主视觉统计卡（label/hint 含 TERM 插值） */
  STAT_ENTITY_LABEL: `${TERM.ENTITY}数`,
  STAT_ENTITY_HINT: `已准入${TERM.ENTITY}总数`,
  STAT_RELATION_LABEL: `${TERM.RELATION}数`,
  STAT_RELATION_HINT: `已构建${TERM.RELATION}总数（含被筛选隐藏）`,
  /** 规模口径提示条（说明句本体住 term-const termTopologyScaleHint） */
  GO_RELATIONS_LINK: "去「关系」视图看全部节点与关系",
  SCALE_ALERT_TITLE: "本页只统计已准入的架构实体",
  /** 投影维度折叠子视图 */
  TAXONOMY_SUBVIEW: "按知识分类浏览（分类轴）",
  BAND_SUBVIEW: "按架构分层浏览（结构轴）",
  RELATIONS_TABS_ARIA: `${TERM.GRAPH_EXPLORER}关系视图`,
} as const;

// ── GraphExplorerToolbar（拓扑页签工具栏：关系类型 chip＋范围切换）──
export const GRAPH_TOOLBAR_COPY = {
  SCOPE_FULL: "全量图谱",
  SCOPE_FULL_HINT: "全部已准入实体与关系",
  SCOPE_ARCH: "仅架构组件",
  SCOPE_ARCH_HINT: "围绕架构组件的子图（含缺口诊断数据）",
  TYPE_FILTER_ARIA: "按关系类型过滤",
  SCOPE_SWITCH_ARIA: "范围切换",
} as const;

export function graphToolbarTypeTitle(type: string): string {
  return `过滤关系类型 ${type}`;
}
/** 类型过滤后显示数/总数双数示差 */
export function graphToolbarShownCount(shown: number, total: number): string {
  return `${shown} / ${ddRelationCount(total)}`;
}

// ── EntityDetailPanel（三上下文侧栏：是什么／从哪来／连到哪）──
export const ENTITY_DETAIL_COPY = {
  CTX_WHAT: "是什么",
  CTX_FROM: "从哪来",
  CTX_TO: "连到哪",
  /** 节点「是什么」定义列表 */
  DT_NAME: "名称",
  DT_CATEGORY: "类别",
  DT_ID: "标识",
  DT_DEGREE: "连接数",
  UNCATEGORIZED: "未分类",
  /** 「从哪来」溯源区 */
  SOURCE_UNRECORDED: "来源未记录",
  PROVENANCE_GAP_NOTE: "部分关系的推导规则/置信度未随边携带——溯源缺口按原样展示；完整溯源属独立后端任务，这里不伪造数值。",
  /** 「连到哪」上下游 */
  NO_CONNECTION: "无连接",
  UPSTREAM_HEADING: "上游（连向它）",
  DOWNSTREAM_HEADING: "下游（它连出）",
  EDGE_ROW_TITLE: "查看这条关系的三层上下文",
  /** 边「是什么」定义列表 */
  DT_SOURCE: "源",
  DT_TARGET: "目标",
  /** 边「从哪来」字段行（MissingValue 标签同值复用） */
  SOURCE_KIND: "来源方式",
  RULE: "推导规则",
  EVIDENCE_FILE: "证据文件",
  MACHINE_CONFIDENCE: "机器置信度",
  CONFIDENCE: "置信度",
  EDGE_PROVENANCE_NOTE: `关系由管道从笔记推导；「${TERM.PENDING_REVIEW}」= AI 提议尚未升格，「${TERM.APPROVED}」= 已由人裁定为知识。未记录字段按原样展示，不伪造。`,
  RELATION_DESC_FALLBACK: "类型化架构关系",
  VIEW_SOURCE_TITLE: "查看源实体",
  VIEW_TARGET_TITLE: "查看目标实体",
  /** 面板与空态 */
  PANEL_ARIA: "实体三层上下文",
  EMPTY_LINE1: "点击左侧的节点或关系，",
  EMPTY_LINE2: "查看它的三层上下文。",
} as const;

/** 空态副行：三上下文标题串（与三段标题同源） */
export const ENTITY_DETAIL_CTX_SUMMARY = `${ENTITY_DETAIL_COPY.CTX_WHAT} · ${ENTITY_DETAIL_COPY.CTX_FROM} · ${ENTITY_DETAIL_COPY.CTX_TO}`;

export function entityDetailUpDown(up: number, down: number): string {
  return `（上游 ${up} · 下游 ${down}）`;
}
export function entityDetailRestHint(rest: number): string {
  return `…其余 ${rest} 条见「${ENTITY_DETAIL_COPY.CTX_TO}」`;
}
export function entityDetailViewSource(name: string): string {
  return `看源实体「${name}」`;
}
export function entityDetailViewTarget(name: string): string {
  return `看目标实体「${name}」`;
}

// ── LocalGraph（关系页签主体：Obsidian 式关系图＋选中明细）──
export const LOCAL_GRAPH_COPY = {
  /** G6 画布渲染失败留痕（console 诊断，不上屏） */
  RENDER_FAILED_WARN: "[LocalGraph] 渲染失败，图区降级为空",
  NEIGHBOR_ROW_TITLE: "选中该邻居（图与明细联动）",
  SECTION_ARIA: "关系图谱",
  INTRO: "关系图谱——Obsidian 式全图展示；边＝手写双链（REFERENCES）＋已审批关系，未审批的机器推导关系不入图；节点可拖拽（松手钉住）、画布可拖移、滚轮缩放；悬停=聚焦预览、点击=选中；明细表随选中联动。",
  SEARCH_PLACEHOLDER: "搜索节点名称过滤（其余淡化）",
  SEARCH_ARIA: "图内搜索",
  COLOR_ON_TITLE: "节点按分类色表着色（点击关闭）",
  COLOR_OFF_TITLE: "节点按分类色表着色（点击开启）",
  COLOR_BY_CATEGORY: "按分类着色",
  CLEAR_SEARCH: "清除搜索",
  CANVAS_ARIA: "图谱画布",
  ZOOM_IN: "放大",
  ZOOM_OUT: "缩小",
  FIT_VIEW: "适配视口",
  EMPTY_TITLE: "图谱暂无内容",
  EMPTY_DESCRIPTION: "还没有文件节点入图——完成投稿准入或重建图谱后，这里会随文件实时展示。",
  DETAIL_HEADING: "选中明细",
  DETAIL_HINT: "点击图中任一节点查看它的关系明细",
  CLEAR_SELECTION: "清除选中",
} as const;

/** 选中明细行尾的出入链计数（前导分隔符随句） */
export function localGraphLinkSummary(outCount: number, inCount: number): string {
  return ` · 出链 ${outCount} · 反链 ${inCount}`;
}
export function localGraphOutLinks(n: number): string {
  return `出链（${n}）`;
}
export function localGraphInLinks(n: number): string {
  return `反链（${n}）`;
}

// ── RelationLibraryTab（实体关系库表：三分支空态＋排序筛选）──
export const RELATION_LIBRARY_COPY = {
  RELATION_DESC_FALLBACK: "未收录到本体字典的关系类型",
  /** 空态归因三分支（#1416） */
  EMPTY_NODE_NO_EDGES_DESC: "该实体尚未与其他组件建立关系；声明关系并审核通过后会出现在这里。",
  EMPTY_NO_EDGES_TITLE: "当前知识拓扑还没有任何关系边",
  EMPTY_NO_EDGES_DESC: "创建第二个实体并声明关系（如在实体页写 依赖::[[目标实体]]，或经关系审核）后，关系记录会出现在这里。",
  EMPTY_NO_MATCH: "无匹配结果",
  /** 列头与排序句柄 */
  COL_SOURCE: "源实体",
  COL_SOURCE_ASC: "源实体 A-Z",
  COL_SOURCE_DESC: "源实体 Z-A",
  COL_TARGET: "目标实体",
  COL_TARGET_ASC: "目标实体 A-Z",
  COL_TARGET_DESC: "目标实体 Z-A",
  COL_TYPE: "关系类型",
  COL_TYPE_ASC: "类型 A-Z",
  COL_TYPE_DESC: "类型 Z-A",
  COL_GROUP: "来源分组",
  COL_GROUP_ASC: "分组 A-Z",
  COL_GROUP_DESC: "分组 Z-A",
  COL_SOURCE_KEY: "来源说明",
  COL_SOURCE_KEY_ASC: "来源说明 A-Z",
  COL_SOURCE_KEY_DESC: "来源说明 Z-A",
  COL_STATUS_ASC: "状态 A-Z",
  COL_STATUS_DESC: "状态 Z-A",
  /** 表格与工具栏 */
  TABLE_ARIA: "实体关系库",
  SEARCH_ARIA: "搜索关系",
  SEARCH_PLACEHOLDER: "搜索源实体、目标实体、类型或来源",
  RUN_QUERY: "执行查询",
  QUERY: "查询",
  /** 三筛选（aria 与搜索占位同值） */
  GROUP_FILTER_ARIA: "筛选来源分组",
  GROUP_FILTER_TITLE: "按来源分组筛选",
  SOURCE_FILTER_ARIA: "筛选来源说明",
  SOURCE_FILTER_TITLE: "按来源说明筛选",
  STATUS_FILTER_ARIA: "筛选审核状态",
  STATUS_FILTER_TITLE: "按审核状态筛选",
  ALL_GROUPS: "全部分组",
  ALL_SOURCES: "全部来源",
  ALL_STATUSES: "全部状态",
  OPTION_GROUP_SCOPE: "范围",
  PAGINATION_ARIA: "实体关系分页",
} as const;

export function relationLibraryNodeNoEdges(label: string): string {
  return `实体「${label}」已存在，但当前没有任何关系边`;
}
export function relationLibraryCount(visible: number, total: number): string {
  return `${visible} / ${total} 条`;
}

// ── RelationsPanel（关系总览页签）──
export const RELATIONS_PANEL_COPY = {
  CONCEPTS_HEADING: "知识概念",
  CONCEPTS_HINT: "知识图中暂未建立有向关系，展示已收录的知识概念（含孤立概念）",
  EMPTY_NODES: "暂无知识节点",
  OVERVIEW_HINT: "展示知识图中的有向关系",
  /** 「全部关系 (N)」计数前缀（右括号随 JSX 结构） */
  ALL_RELATIONS_PREFIX: "全部关系 (",
} as const;

// ── BandStack（结构轴侧栏）＋TaxonomySidebar（分类轴侧栏）──
export const BAND_STACK_COPY = {
  ORDER_TITLE: "分层序号",
  FOOTER_SUFFIX: `层有${TERM.ENTITY} · 点层高亮拓扑`,
} as const;

/** 分层／节点数据质量警告计数悬浮句 */
export function bandWarnTitle(n: number): string {
  return `${n} 个${TERM.DATA_QUALITY}${TERM.WARNING}`;
}
export function taxonomyDocCountTitle(n: number): string {
  return `${n} 文档`;
}
