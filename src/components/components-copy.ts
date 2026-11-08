// components 共享组件文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（闭集模块）。
// 收 src/components/**（共享组件库：应用外壳/侧栏、实体全景抽屉、架构投影、表格与筛选基件、池面板、
// 管道浮层、变更决策摘要、实体修复字段族）与 App.tsx 外壳的用户可见文案：按组件族分段导出 const 对象，
// 插值句用函数（学 review-copy 先例）。跨族同值（「请选择」「行操作」「范围」）在本文件只住一份。
// 禁在其他 components 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；改文案只改这里。
// 闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES
// 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。架构投影缺口三态词仍住 term-const（缺口词单源守卫）。

import { TERM } from "@/constants/term-const";

// ── 跨族共用（同一事实只一份）──
export const SHARED_UI_COPY = {
  /** 下拉占位（FilterSelect 默认占位／修复字段下拉占位与空选项同值） */
  SELECT_PLACEHOLDER: "请选择",
  /** 行操作菜单无障碍名（RowActions 默认／行操作列同值） */
  ROW_ACTIONS: "行操作",
  /** 下拉「范围」分组（FilterSelect 多选清空区／修复字段空选项分组同值） */
  OPTION_GROUP_SCOPE: "范围",
  CLEAR: "清除",
  /** 打开 Obsidian 按钮（实体全景抽屉／准入详情抽屉同值） */
  OPEN_OBSIDIAN: "打开 Obsidian",
} as const;

// ── App.tsx 外壳（懒加载占位／创建流标签／任务池）──
export const APP_SHELL_COPY = {
  THEME_PREVIEW_LOADING: "加载主题预览…",
  CREATE_ENTITY_FLOW_LABEL: "架构实体创建",
  VIEW_LOADING: "加载视图…",
  POOL_DOCK_ARIA: "任务池",
  /** AppErrorBoundary 无 message 兜底 */
  UNKNOWN_ERROR: "未知错误",
  /** AppSidebar 设置入口 */
  SETTINGS: "设置",
  /** sidebar-primitives 折叠钮 aria（展开态） */
  COLLAPSE: "折叠",
} as const;

// ── SidebarSearch（侧栏页面搜索）──
export const SIDEBAR_SEARCH_COPY = {
  SEARCH_ARIA: "搜索页面",
  SEARCH_PLACEHOLDER: "搜索页面…",
  NO_MATCH: "无匹配页面",
} as const;

// ── ModeToggle（显示模式菜单）──
export const MODE_TOGGLE_COPY = {
  LIGHT: "白天",
  DARK: "夜间",
  WARM: "护眼",
  AUTO: "跟随系统",
  /** 菜单 aria 与菜单标题同值 */
  MENU_TITLE: "显示模式",
} as const;

export function modeToggleTriggerLabel(current: string): string {
  return `${MODE_TOGGLE_COPY.MENU_TITLE}：${current}`;
}

// ── PageHeader（应用栏）──
export const PAGE_HEADER_COPY = {
  SUBMISSION_LABEL: `${TERM.ARTICLE_SUBMISSION} · 进入${TERM.ARTICLE_ADMISSION}`,
  OPEN_ENTITY_HUB: `打开${TERM.ENTITY_OVERVIEW}`,
} as const;

// ── EntityHubDrawer（实体全景抽屉）──
export const ENTITY_HUB_COPY = {
  OPEN_OBSIDIAN_TITLE: "在 Obsidian 中打开当前实体",
  RECALL: `唤回${TERM.ENTITY_OVERVIEW}`,
  CLOSE_ARIA: "关闭实体全景",
  /** 未选中实体空态（WP-152：原 JSX 文本误写 `${...}` 致上屏多出两个「$」，迁移时随句修正） */
  EMPTY_TITLE: "尚未选中实体",
  EMPTY_DESCRIPTION: `在图谱检索、${TERM.DOC_LOOKUP}结果或${TERM.TASK_IMPACT_ANALYSIS}中选择实体后，可在此查看其档案、直接关系、影响范围和数据质量问题。`,
  GO_EXPLORER: `前往${TERM.GRAPH_EXPLORER}`,
  /** 维度一：基础档案 */
  PROFILE_SECTION: "基础档案",
  DT_NAME: "名称",
  DT_CATEGORY: "类别",
  DT_DEGREE: "直接关系数",
  /** 图节点标签（profile.labels——图库节点标签，非实体 tags 字段） */
  DT_LABELS: "标签",
  DT_RELEASE: "正式读取版本",
  PROFILE_NOT_FOUND: "架构图中未找到该实体",
  /** 维度二：直接依赖 */
  DEPS_SECTION: "直接依赖关系",
  NO_DEPS: "无直接依赖关系",
  /** 维度三：影响面 */
  IMPACT_SECTION: "影响面简报",
  ANALYZING: "正在分析…",
  DOWNSTREAM: "下游实体",
  UPSTREAM: "上游实体",
  TRAVERSED: "遍历关系",
  IMPACT_UNAVAILABLE: "无法获取影响面数据",
  /** 维度四：数据质量 */
  QUALITY_SECTION: "数据质量问题",
  NO_QUALITY_ISSUES: "未发现数据质量问题",
  VIEW_IN_ANOMALIES: "在待处理问题中查看",
  CLEAR_SELECTION: "清除选中实体",
} as const;

export function entityHubMoreGaps(rest: number): string {
  return `…及其他 ${rest} 个缺口`;
}
export function entityHubMoreEdges(rest: number): string {
  return `…及其他 ${rest} 条`;
}
export function entityHubRelationAria(source: string, target: string): string {
  return `查看 ${source} 到 ${target} 的关系依据`;
}

// ── 架构投影（Evidence／Mobile／Node／Toolbar／model）──
export const ARCH_PROJECTION_COPY = {
  CLOSE_EVIDENCE_PANEL: "关闭证据面板",
  CLOSE_EVIDENCE: "关闭证据",
  START_PREFIX: "起点:",
  END_PREFIX: "终点:",
  PATH_CHAIN_PREFIX: "路径链:",
  PATH_PREFIX: "路径: ",
  TYPE_PREFIX: "类型: ",
  UNRESOLVED_PAIR_NOTE: "这两个架构组件之间无直接关系，2 跳范围内也未找到通路",
  ALL_REACHABLE: "所有架构组件都存在且两两可达",
  DATA_VERSION_PREFIX: "数据版本: ",
  UPDATED_AT_PREFIX: "更新时间: ",
  FRESHNESS_PREFIX: "新鲜度: ",
  FRESH: "新鲜",
  HIGHLIGHT: "在拓扑中高亮",
  /** 终态节点／移动端完整提示同值 */
  COMPLETE_MARK: "✓ 投影完整",
  COMPLETE_EVIDENCE: "投影完整",
  CANDIDATE_PREFIX: "候选:",
  /** 工具栏 */
  GAP_OVERLAY: "缺口叠加",
  FILTER_ALL: "全部",
  ZOOM_OUT: "缩小",
  ZOOM_IN: "放大",
  FIT_CANVAS: "适配画布",
  EXIT_FULLSCREEN: "退出全屏",
  FULLSCREEN: "全屏",
  READONLY_TITLE: "节点与连线由事实源生成，修改请通过变更提案（Proposal）",
  READONLY_HINT: "只读视图 · 交互态刷新后重置",
  CLEAR_HIGHLIGHT: "清除高亮",
  OVERLAY_TITLE: `在真实拓扑之上叠加缺口诊断（${TERM.GAP_INDIRECT}/${TERM.GAP_UNRELATED}/${TERM.GAP_MISSING_COMPONENT}）`,
  /** model：缺口诊断层节点/边标签 */
  NO_COMPONENTS: `无${TERM.ARCH_COMPONENT}`,
  EXISTS_DECISION: `${TERM.ARCH_COMPONENT}存在?`,
  EDGE_EXISTS: "存在",
  EDGE_DONE: "完成",
} as const;

/** 候选路径数缺席时与原 JSX 插值同样留空（不上屏 undefined） */
export function archProjCandidatePaths(count: number | undefined): string {
  return `存在 ${count ?? ""} 条候选路径`;
}
export function archProjStaleAge(ageHours: number): string {
  return `${ageHours}h 前 (已过期)`;
}
export function archProjDiagnosticBranches(count: number): string {
  return `诊断分支 (${count})`;
}
export function archProjNodeDegree(degree: number): string {
  return ` · ${degree} 连`;
}
export function archProjStartLabel(seedCount: number): string {
  return `架构投影开始 · ${seedCount} 个${TERM.ARCH_COMPONENT}`;
}
export function archProjCandidateEdge(count: number): string {
  return `候选(${count})`;
}

// ── DataTable（表格基座）──
export const DATA_TABLE_COPY = {
  ERROR_RETRY_HINT: "数据没有加载出来，可以重试一次。",
  TABLE_ARIA_DEFAULT: "数据表格",
  SELECT_ALL: "全选",
  SELECT_PAGE: "全选本页",
  COLLAPSE_ROW: "收起行详情",
  EXPAND_ROW: "展开行详情",
} as const;

export function dataTableSelectRow(ordinal: number): string {
  return `选择第 ${ordinal} 行`;
}

// ── FilterSelect（筛选下拉基件）──
export const FILTER_SELECT_COPY = {
  OPTION_GROUP_DEFAULT: "选项",
  RECENT: "最近的",
  NO_MATCH: "无匹配选项",
} as const;

export function filterSelectSearchFallback(title: string | undefined): string {
  return `筛选${title}`;
}

// ── TablePagination／TableSortHeader（表格分页与排序头）──
export const TABLE_PAGINATION_COPY = {
  ARIA_DEFAULT: "表格分页",
  TOTAL_PREFIX: " / 共 ",
  PAGE_PREFIX: "第",
} as const;

export function tablePaginationPageCount(pageCount: number): string {
  return `/ ${pageCount} 页`;
}
export function tablePaginationJumpAria(ariaLabel: string): string {
  return `${ariaLabel} 跳转页码`;
}
export function tablePaginationPrevAria(ariaLabel: string): string {
  return `${ariaLabel} 上一页`;
}
export function tablePaginationNextAria(ariaLabel: string): string {
  return `${ariaLabel} 下一页`;
}
export function tableSortAria(label: string): string {
  return `${label}排序`;
}
export function tableSortMenuLabel(label: string): string {
  return `按${label}排序`;
}

// ── 其余小基件（FloatingSearch／MissingValue／SidePanel／TopologyStateGate／Avatar／池面板）──
export const SMALL_UI_COPY = {
  FLOATING_SEARCH_INTRO: "输入关键词搜索文档，可使用筛选条件精确匹配，按 Enter 查看完整结果",
  MISSING_VALUE_TITLE: "真实数据中未携带该值——缺口原样可见，不伪造",
  MISSING_VALUE_SUFFIX: "未记录",
  TOPOLOGY_LOADING_DEFAULT: "加载拓扑数据...",
  AVATAR_UNASSIGNED: "未分配",
  /** 池面板（PoolShell 默认 aria 既有测试按名寻获，逐字保留） */
  POOL_MINIMIZE_DEFAULT: "最小化补齐面板",
  POOL_CLOSE_DEFAULT: "结束补齐任务",
  POOL_MINIMIZE_TITLE: "最小化，保留当前内容",
  POOL_CLOSE_TITLE: "关闭面板",
  BOOLEAN_YES: "是",
  BOOLEAN_NO: "否",
} as const;

export function sidePanelOpenTitle(title: string): string {
  return `打开 ${title}`;
}
export function poolSourceTitle(sourceKey: string): string {
  return `来源文档：${sourceKey}`;
}

// ── PipelinePanel（图谱管道浮层）──
export const PIPELINE_PANEL_COPY = {
  READING_STATUS: "正在读取运行状态",
  STATE_UNKNOWN: "状态未知",
  RUNNING_REBUILD: "正在执行完整图谱重建",
  RUNNING_DIAGNOSTIC: "正在执行全局管道诊断",
  DIAGNOSTIC_TITLE: "只读诊断：不重写图。排查图谱为何未更新——内容阻断会汇入待处理问题",
  DIAGNOSTIC: "诊断",
  REBUILD: "重建图谱",
  REBUILD_CONFIRM_TEXT: "完整重建将全量重跑管道并重写工作投影（主图、语义架构、布局、文档索引）；来源为空时将重建为空投影。不批准文章、不发布正式版本。",
  CONFIRM_REBUILD: "确认重建",
  OPEN_PENDING_ISSUES: `打开${TERM.PENDING_ISSUES}`,
} as const;

/** 管道作业状态显示（键＝契约 job.state） */
export const PIPELINE_STATE_LABELS: Record<string, string> = {
  idle: "尚未运行",
  running: "运行中",
  cancelling: "正在取消",
  cancelled: "已取消",
  succeeded: "最近运行成功",
  failed: "最近运行失败",
};

export function pipelineStageSuffix(stage: string | number): string {
  return ` · 阶段 ${stage}`;
}
export function pipelineRunLogs(count: number): string {
  return `运行日志 (${count})`;
}

// ── ReasoningSummary（变更决策状态摘要；键＝契约 ReasoningEvaluation.status）──
export const REASONING_STATUS_COPY = {
  clear: { label: "未发现额外处置条件", detail: "当前结果可继续使用。" },
  change_required: { label: "需要纳入变更处置", detail: "结果可继续使用，并保留影响范围供后续决策。" },
  waived: { label: "已满足自动豁免条件", detail: "当前变化无需进入正式变更处置。" },
  blocked: { label: "当前操作已阻止", detail: "请先处理来源或规则指出的阻断条件。" },
  review_required: { label: "需要人工复核", detail: "只读结果保留，写入操作暂停。" },
  conflicted: { label: "候选结论存在冲突", detail: "只读结果保留，完成裁决前不允许写入。" },
  stale: { label: "已有决定已失效", detail: "来源内容发生变化，需要重新复核。" },
} as const;

export const REASONING_SUMMARY_COPY = {
  SECTION_ARIA: "变更决策状态",
} as const;

export function reasoningSummaryCounts(candidates: number, conflicts: number): string {
  return `${candidates} 项规则结论 · ${conflicts} 项待处理冲突`;
}

// ── 实体修复字段族（RepairFieldEditor／DateField／AutocompleteField／TokenInput／managed-article-field）──
export const ENTITY_REPAIR_COPY = {
  BLOCKER_REASON_PREFIX: "阻断原因：",
  CLEAR_ALL: "清除全部",
  OPTION_GROUP_SCHEMA: "Schema 可用值",
  GROWABLE_TITLE: "直接选择已有类别，或输入新类别（保存时自动写入该实体子域的分类矩阵）",
  GROWABLE_PLACEHOLDER: "选已有或填新类别",
  CLEAR_SUBDOMAIN: "清除源稿子域字段",
  DATE_PLACEHOLDER: "请选择日期",
  CLEAR_DATE: "清除日期",
  PICK_DOMAIN: "选域",
  PICK_SUBDOMAIN: "选子域",
  UNFILLED_OPTION: "（未填）",
} as const;

export function repairOptionsAria(label: string): string {
  return `${label} 选项`;
}
export function repairSelectTitle(label: string): string {
  return `选择${label}`;
}
export function repairGrowableAria(label: string): string {
  return `${label}（可选可立）`;
}
export function repairDateAria(label: string): string {
  return `${label} 日期`;
}
export function repairSuggestionBasis(reason: string, percent: number): string {
  return `建议依据：${reason}（${percent}%）`;
}
export function repairSuggestionsAria(label: string): string {
  return `${label} 建议`;
}
export function repairRemoveTokenAria(token: string): string {
  return `移除 ${token}`;
}
export function managedDomainAria(label: string): string {
  return `${label} 域`;
}
export function managedSubdomainAria(label: string): string {
  return `${label} 子域`;
}
export function managedNotInEnum(value: string): string {
  return `${value}（当前值不在枚举）`;
}

// ── 实体字段占位示例（修复字段母版 entity-create-fields／entity-repair-field-model 与修复抽屉超集 repair-field-config 同句复用）──
export const ENTITY_FIELD_PLACEHOLDER_COPY = {
  SYSTEM_MINTED_ID: "由系统生成，创建后不可修改",
  VERSION_EXAMPLE: "例如 7.0.0.0",
  VERSION_UNTIL_EXAMPLE: "例如 8.0.0.0",
  /** 与 TokenInput 真实行为一致：回车/失焦整串入列、不切分逗号 */
  TAGS_INPUT: "回车或失焦添加一个标签",
  ARTICLE_ID_EXAMPLE: "例如 mysql-force-primary",
  CATEGORY_PATH_EXAMPLE: "例如 ops:deploy:nginx-502",
  ALIASES_INPUT: "多个别名用英文逗号分隔",
} as const;

/** 新建实体表单字段分组名（键＝EntityFieldGroup） */
export const ENTITY_FIELD_GROUP_LABELS = {
  identity: "身份",
  classification: "归类",
  lifecycle: "生命周期",
  relations: "检索与关联",
} as const;
