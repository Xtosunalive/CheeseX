/**
 * 全局术语常量 — 前端 UI 文案单一权威源
 *
 * 规则：
 * 1. 跨页面重复出现的核心业务名称必须引用此文件中的常量
 * 2. 新增术语前先确认本表与 docs/system/source-of-truth.md 家产清单（terminology-spec.md 已不存在——WP-035 修正悬空引用）
 * 3. 普通按钮动作和完整说明句可直接编写，但不得创造同义业务词
 *
 * 术语事实源即本表（原引用 docs/terminology-spec.md 已不存在）
 */

export const TERM = {
  // ── 架构分层 Layer ──
  /** 页面标题 / 导航 / Tab 标签 */
  LAYER: "架构分层",
  /** 下拉筛选按钮简写 */
  LAYER_FILTER: "分层筛选",

  // ── 图谱实体 Entity ──
  /** 业务页面、表格、导航、筛选（用户日常操作，通用叫法） */
  ENTITY: "实体",
  /** 仅拓扑图表统计场景（节点数 / 边数 / 容器数） */
  NODE: "节点",
  /** 仅特指 arch_component=true 的实体子集 */
  ARCH_COMPONENT: "架构组件",
  /** 拓扑准入图标签 Module 的用户语正名（WP-145 N3）。出处：TheSchema SCHEMA.md §3.2「module — 所属模块」＋enums.yaml `modules` 段（产品词汇即「模块」）；标签白名单单源＝GraphAdmissionService.ENTITY_LABELS（contracts/graph-admission.json entityLabels 前端镜像） */
  MODULE: "模块",

  // ── 关系 Relation / 边 Edge ──
  /** 审核列表表头、筛选、关系类型（通用场景） */
  RELATION: "关系",
  /** 仅拓扑数字统计场景 */
  EDGE: "边",
  /** 有向关系 — 从当前实体出发 */
  OUT_DEP: "外向依赖",
  /** 有向关系 — 指向当前实体 */
  IN_DEP: "被依赖",
  /** 拓扑看板标题 */
  DEP_TOPOLOGY: "依赖拓扑",

  // ── 实体分类 Category ──
  /** 标准名称 */
  CATEGORY: "实体类别",
  /** 筛选按钮简写 */
  CATEGORY_FILTER: "类别筛选",

  // ── 拓扑 Topology / 图谱 ──
  /** 产品对外名称（按钮、导航入口） */
  ARCH_GRAPH: "架构图",
  /** 图谱检索枢纽页名（seq212：拓扑+关系统一入口） */
  GRAPH_EXPLORER: "图谱检索",
  /** 图表内描述用词 */
  GRAPH: "图谱",

  // ── 管道 Pipeline ──
  /** 所有用户可见文案统一用此词 */
  PIPELINE: "管道",
  /** 生成和刷新全量图谱数据的共享应用级管道 */
  GRAPH_PIPELINE: "图谱管道",
  /** 应用栏打开图谱管道浮层的动作名称 */
  OPEN_GRAPH_PIPELINE_ACTION: "打开图谱管道",
  /** 启动完整图谱重建的动作名称（--force 全量重跑并重写工作投影，ADR063 双模式之重建档） */
  RUN_FULL_GRAPH_PIPELINE_ACTION: "运行完整图谱管道",
  /** 启动只读全局诊断的动作名称（对账复核，零副作用，ADR063 双模式之诊断档=默认） */
  RUN_PIPELINE_DIAGNOSTIC_ACTION: "运行全局诊断",
  /** 图谱管道浮层「进阶操作」折叠区标签（WP-146 件1：重建=高风险低频路径收进折叠区，默认收起） */
  PIPELINE_ADVANCED_ACTIONS: "进阶操作",

  // ── 内容生命周期 Content Lifecycle ──
  /** raw/drafts 中保持原始字节不变的用户投稿 */
  ORIGINAL_SUBMISSION: "原始投稿",
  /** 尚未由架构师本地 Skill 完成标准化的资料 */
  PENDING_STANDARDIZATION: "待标准化资料",
  /** raw/precleaned 中待架构师批准进入后续流程的标准 Markdown（deprecated，仅限未迁移页面；文章准入工作区使用 WORKING_DRAFT） */
  STANDARD_ARTICLE_CANDIDATE: "标准文章候选",
  /** 目标态：准入工作区中待标准化校验的工作草稿（ADR019，Slice 2 起用于文章准入工作区） */
  WORKING_DRAFT: "工作草稿",
  /** 目标态：通过标准化校验即可检索阅读的标准文章（ADR019） */
  STANDARD_ARTICLE: "标准文章",
  /** 目标态：工作草稿成为标准文章的机器校验（ERROR 阻断 / WARNING 成待处理问题 / 通过） */
  STANDARDIZATION_VALIDATION: "标准化校验",
  /** 投稿记录表指引句（WP-146 件2 备注列收敛）：标准化动作入口已在工作草稿列表行内——原备注列整列重复句语义收进「状态」表头 title */
  STANDARDIZE_ACTION_IN_DRAFT_HINT: "标准化动作在工作草稿列表行内",
  /** wiki/entities 中作为图谱事实来源的正式文章 */
  WIKI_ENTITY_ARTICLE: "Wiki 实体文章",
  /** 被图谱节点或关系通过 sourcePath 引用的 Markdown */
  GRAPH_SOURCE_DOCUMENT: "图谱引用文档",

  // ── 文档与图谱关联 Article Mapping ──
  /** 单篇图谱引用文档对应的实体、关系和版本映射记录 */
  ARTICLE_GRAPH_MAPPING: "文章图谱映射",
  /** 最近一次图谱管道生成的全量图谱数据 */
  MASTER_GRAPH_DATA: "主图数据",
  /** 实体或架构组件指向事实来源文档的关联 */
  SOURCE_DOCUMENT_ASSOCIATION: "源文档关联",
  /** 文档关系修复提示句（实体修复抽屉与关系修复面板双处消费——WP-145 A12 单源化，禁再手抄） */
  RELATION_REPAIR_HINT: "仅在正文中的组件关系缺失或写错时使用。确认修复后，系统会把所选关系写入对应组件的源文档。",
  /** 已生成文章图谱映射的应处理文档比例 */
  MAPPING_COVERAGE: "映射覆盖率",
  /** 文章图谱映射页面中的架构组件属性页签 */
  ARCH_COMPONENT_ATTRIBUTES: "架构组件属性",
  /** 五组面向用户任务的顶层导航标签 */
  TASK_CONTENT_PIPELINE: "内容管道",
  TASK_KNOWLEDGE_APPROVAL: "知识审批",
  TASK_RULE_CHECK: "规则门禁",
  TASK_IMPACT_ANALYSIS: "影响分析",
  TASK_ASSET_LOOKUP: "图谱架构",
  /** 五组任务下的短入口标签 */
  DATA_CHECK: "数据校验",
  LINK_REVIEW: "链路排查",
  ARTICLE_MAPPING_REPAIR: "文章关联",
  PROPERTY_REPAIR: "属性修复",
  COMPONENT_IMPACT: "架构组件影响",
  VERSION_ANALYSIS: "架构版本对比",
  DATA_MONITOR: "数据监控",
  /** 普通用户页面对数据质量问题的称呼 */
  DATA_QUALITY: "数据质量",

  // ── 风险等级 Severity（跨模块统一） ──
  /** 最高风险 — 阻断流程 / 数据不可用 */
  BLOCKER: "阻断",

  // ── 关系页导航 ──
  /** 实体之间的关系浏览页 */
  NODE_RELATIONS: "实体间关系",
  /** 关系审核页 */
  RELATION_REVIEW: "关系审核",
  /** 关系查询 tab */
  RELATION_QUERY: "关系查询",
  /** 关系总览 tab */
  RELATION_OVERVIEW: "关系总览",
  /** 待审核关系 tab */
  PENDING_RELATIONS: "待审核关系",
  /** 规则冲突 tab */
  RULE_CONFLICTS: "规则冲突",
  /** 审核记录 tab */
  REVIEW_RECORDS: "审核记录",
  /** 数据瑕疵 — 不阻断但需关注 */
  WARNING: "警告",
  /** 仅信息提醒 */
  INFO: "提示",

  /** 入图前源文档质量门禁 */
  SOURCE_QUALITY_GATE: "源稿质量门禁",
  /** 图谱实体进入正式拓扑视图的审批 */
  GRAPH_ADMISSION: "实体准入",
  /** 已准入拓扑的缺口与异常排查 */
  TOPOLOGY_GAP_REVIEW: "拓扑缺口检查",

  // ── 知识域 / 子域 Domain / Subdomain ──
  DOMAIN: "知识域",
  SUBDOMAIN: "子域",

  // ── 图谱规则 ──
  /** 导航 + 页面标题统一 */
  SCHEMA: "图谱规则配置",

  // ── 文档检索 Document Inventory ──
  /** 筛选面板 - 维度筛选分组标题 */
  SEARCH_FILTER: "维度筛选",
  /** 筛选面板 - 标签与关系分组标题 */
  TAG_AND_RELATION: "标签&关系筛选",
  /** 筛选面板 - 标签子筛选 */
  TAG_FILTER: "标签筛选",
  /** 文档检索标签维度 */
  TAG: "标签",
  /** 筛选面板 - 关系子筛选 */
  RELATION_FILTER: "关系筛选",

  // ── 本体 Ontology ──
  /** 仅在本体编辑器内部使用 */
  ONTOLOGY: "本体",

  // ── 数据监控 ──
  /** 图谱规模、待处理问题与数据新鲜度概览 */
  DASHBOARD: "运行概览",
  /** 审核状态标题 */
  REVIEW_STATUS: "审核状态",
  /** 边/关系审核已通过 */
  APPROVED: "已通过",
  /** 边/关系待审核 */
  PENDING_REVIEW: "待审核",
  RULE_EFFECTIVE: "规则生效", // REVIEW-STATUS-001：契约五态之 deterministic（政策盖章生效，非人裁）
  INHERITED_APPROVED: "继承已审", // REVIEW-STATUS-001：契约五态之 inherited_approved（来源审过边继承）
  /** 边/关系审核已拒绝 */
  REJECTED: "已拒绝",
  /** 最近管道生成结果区块 */
  SYNC_LOG: "同步日志",
  /** 实体无外向依赖占位 */
  NO_DEPENDENCIES: "无依赖",
  /** 文档检索入口 */
  DOC_LOOKUP: "文档清单",
  /** 标准文章候选经过检查成为正式标准文章，并可进入后续图谱管道的流程 */
  ARTICLE_ADMISSION: "文章准入",
  /** 审批工作台导航入口：投稿 → 标准化（进入待审）→ 审批 → 发布（不可变 Release 打包 + current 原子切换）。2026-09-11 由「图谱发布」改名：旧名是已退役批次发布页遗留，与页面实际行为（标准文章发布，不重建图）不符 */
  GRAPH_PUBLISH: "审批与发布",
  /** 派生图来源修复入口：修正 owner 来源经关系审核写回，管道重建后经不可变 Release 原子激活 */
  DERIVED_GRAPH_REPAIR_BATCH: "派生图来源修复",
  /** 跨页面查看单个实体档案、直接关系、影响和缺口的抽屉 */
  ENTITY_OVERVIEW: "实体全景",
  /** 无缺口占位 */
  NO_GAPS: "无缺口",
  /** 检查来源文档是否具备必需属性和值 */
  SOURCE_DOC_CHECK: "实体合规检查",
  /** 文章映射和架构组件属性检查组合入口 */
  ARTICLE_AND_COMPONENTS: "属性治理",
  /** 自动检查无法直接确认的待处理问题 */
  PENDING_ISSUES: "待处理问题",

  // ── 应用壳层 Application Shell ──
  /** 品牌名称（应用栏 Logo 无障碍名称） */
  APP_NAME: "cheeseh",
  /** 投稿动作（应用栏全局快捷操作） */
  ARTICLE_SUBMISSION: "投稿",
  /** 打开文档搜索面板 */
  DOCUMENT_SEARCH_ACTION: "搜索文档",
  /** 文档搜索输入框名称（FloatingSearch 以此构建选择器——改值需验证 "/" 快捷键聚焦，#1755） */
  DOCUMENT_SEARCH_INPUT: "全文检索",
  /** 清除筛选动作（title + 无障碍名 + 按钮可见文本通用；各面板的上下文专属 aria-label 不用此键） */
  CLEAR_FILTER_ACTION: "清除筛选",
  /** 关闭文档搜索面板 */
  CLOSE_DOCUMENT_SEARCH_ACTION: "关闭文档搜索",
  /** 恢复最小化的实体补齐任务 */
  RESUME_REPAIR_ACTION: "继续补齐",
  /** 打开补齐任务（无障碍动作名称） */
  OPEN_REPAIR_TASK_ACTION: "打开补齐任务",
  /** 汉堡展开的全局导航（五任务域及全部页面） */
  GLOBAL_NAVIGATION: "全局导航",
  /** 打开全局导航（无障碍动作名称） */
  OPEN_GLOBAL_NAVIGATION: "打开全局导航",
  /** 收起全局导航（侧栏品牌行右侧收起钮，PR③ 原型形态） */
  COLLAPSE_GLOBAL_NAVIGATION: "收起全局导航",
  /** 固定全局导航为展开态（禁用自动折叠） */
  PIN_DOMAIN_NAVIGATION: "固定域内导航",
  /** 取消固定域内导航（恢复自动折叠） */
  UNPIN_DOMAIN_NAVIGATION: "取消固定域内导航",

  // ── 请求状态词 Request Status（term-copy 域切片一：与 interaction-state 五态对应的高频状态词；本段值禁在业务代码硬编码——门禁 check:term-copy 按本段逐字执法） ──
  /** status === "loading" 的占位文案（统一用中文省略号 …，ASCII "..." 为漂移） */
  LOADING: "加载中…",
  /** 主请求失败的兜底文案（requestFailed 的 fallback） */
  LOAD_FAILED: "加载失败",
  /** 非加载类请求失败的通用兜底 */
  REQUEST_FAILED: "请求失败",
  /** 失败后的重试动作（按钮文本） */
  RETRY_ACTION: "重试",
  /** status === "empty" 的空态文案 */
  EMPTY_DATA: "暂无数据",
  /** 写操作失败兜底 */
  SAVE_FAILED: "保存失败",
  /** 写操作成功落账（保存状态指示） */
  SAVED: "已保存",
  /** 后端不可达（网络层失败兜底） */
  API_UNREACHABLE: "无法连接 API",

  // ── 图新鲜度状态词（WP-027/PR-142——schema 管理页图谱跟随提示；check:term-copy） ──
  /** 图与当前规则输入一致 */
  GRAPH_UP_TO_DATE: "图谱已是最新",
  /** 图落后于当前规则输入（保存后等待自动跟随） */
  GRAPH_STALE: "图谱待更新",
  /** 图新鲜度未知（从未增量抽取过） */
  GRAPH_STATE_UNKNOWN: "图状态未知",

  // ── 通用动作词 Common Actions（term-copy 域切片二——门禁 check:term-copy 按本段逐字执法） ──
  // 2026-10-21 按实测频次扩表：取消 9／展开 6／新增 5／收起 4／删除 4；「全部」不入表——
  // 其一半用例是筛选哨兵值/类型联合，属数据非文案。段头含「check:term-copy」即执法段（同请求状态词段）。
  /** 取消当前操作／关闭确认（按钮文本与 aria-label） */
  CANCEL_ACTION: "取消",
  /** 展开折叠内容 */
  EXPAND_ACTION: "展开",
  /** 收起已展开内容（与 EXPAND_ACTION 成对） */
  COLLAPSE_ACTION: "收起",
  /** 新增条目 */
  ADD_ACTION: "新增",
  /** 删除条目（确认按钮与差异分组标题通用） */
  DELETE_ACTION: "删除",
  /** 删除已执行的瞬时反馈（toast 主文案，配 UNDO_ACTION 撤销钮——WP-146 件1：可逆草稿删除不再弹阻断确认） */
  DELETED_NOTICE: "已删除",
  /** 行内撤销刚执行的删除（toast 动作钮，与 DELETED_NOTICE 成对，5 秒内可恢复——WP-146 件1） */
  UNDO_ACTION: "撤销",

  // ── 状态机显示词 Status Display（status-display 域单源词，PR-130/STATUS-DISPLAY-001）──
  // 四台状态机的状态显示词：词属各机、机间独立（不合并状态机）；显示映射单源=src/lib/domain/StatusDisplay.ts。
  // 审批机（ApprovalStatusEnum，契约五态）
  APPROVAL_DRAFT: "草稿",
  APPROVAL_PENDING: "待审",
  APPROVAL_APPROVED: "已批",
  APPROVAL_PENDING_CONFIRM: "待确认",
  STALE_SOURCE_CHANGED: "源已变化",
  APPROVAL_REJECTED: "已驳回",
  APPROVAL_SNAPSHOT: "已发布",
  // 文章标准化机（standardizationStatus，契约三态）
  STANDARDIZATION_PENDING: "待标准化",
  STANDARDIZATION_BLOCKED: "ERROR 阻断",
  STANDARDIZATION_DONE: "已标准化",
  // 投稿任务机（task status，契约七态）
  TASK_AWAITING_ARCHITECT: "等待本地 Skill 处理",
  TASK_AWAITING_APPROVAL: "候选已生成，待标准化检查",
  TASK_STANDARDIZED: "已标准化（待审批）",
  TASK_PUBLISHED: "已发布",
  TASK_SOURCE_DELETED: "源文件已删除",
  TASK_DIGESTED: "已退役消化",
  // 版本生命周期机（version status——契约六 schema 共用三态枚举）
  VERSION_DRAFT: "草稿",
  VERSION_RELEASED: "已发布",
  VERSION_DEPRECATED: "已废弃",
  // 准入机（admissionStatus——契约无枚举，值域单源=StatusDisplay 域 as const）
  ADMISSION_APPROVED: "已准入",
  ADMISSION_PENDING: "待入图审批",

  // ── 架构投影缺口诊断 Gap Diagnosis（check:term-copy 执法段——缺口三态词单源；2026-10-28 收编，原为 architecture-projection 组件私设字面量）──
  // 判定口径单源＝server/services/projection/master-graph-service.cjs::pruneToSubgraph（跳数上限 maxHops=2，判定对象＝SA 声明的组件两两配对）。
  //   缺失组件   = SA 声明了该架构组件，主图中不存在同 id 节点；
  //   间接关联   = 两组件之间无直接关系边，但 2 跳内（最多 1 个中间实体）存在通路；
  //   未发现关联 = 两组件之间无直接关系边，且 2 跳内未找到任何通路——只否定 2 跳邻域，不否定全图连通。
  // 「全部」不入本段：筛选哨兵值属数据非文案（同通用动作词段裁定）。
  /** 声明的架构组件在主图中没有对应节点 */
  GAP_MISSING_COMPONENT: "缺失组件",
  /** 无直接关系边，但 2 跳内可达 */
  GAP_INDIRECT: "间接关联",
  /** 无直接关系边，且 2 跳内未找到通路 */
  GAP_UNRELATED: "未发现关联",

  // ── 空态词 Empty State（WP-145 N1 空态词收编——行内小字形态「暂无X」族单源）──
  // 分段口径（D1 裁决，ADR-019 空态介质行）：整块区域无内容＝EmptyState 组件（文案随组件 props
  // 消费点给出）；表格体空＝DataTable empty 槽（TableEmptyState）；一行小字（嵌在 chip/单元格/
  // 下拉选项/句子里的「暂无X」片段）＝本段词条。区块级与表格槽的空态文案不经本段。
  /** 右侧栏树空叶（sidebar EmptyLeaf 默认文案，装饰破折号在消费点拼接） */
  EMPTY_ENTITY: "暂无实体",
  /** 审批工作台稿件下拉空选项 */
  EMPTY_WORK_DRAFT: "暂无工作草稿",
  /** 异常工作台组件勾选列表：无候选（未筛选到任何组件） */
  EMPTY_COMPONENT_OPTION: "暂无可选组件",
  /** 异常工作台组件勾选列表：有候选但搜索无命中（no-match 变体） */
  NO_MATCH_COMPONENT: "无匹配组件",
  /** 异常工作台版本勾选列表空 */
  EMPTY_VERSION_OPTION: "暂无可选版本",
  /** 实体详情面板「从哪来」关系列表空（孤立实体提示句） */
  EMPTY_RELATION_ORPHAN: "暂无关系，可能是孤立实体。",
  /** 图谱检索选中明细：所选节点无关系边提示句 */
  EMPTY_NODE_EDGE: "该节点暂无已上图的关系边（孤立文件，或其机器推导关系尚未审批）。",
  /** 投稿预处理表移动端分类摘要缺省 */
  EMPTY_CLASSIFICATION: "暂无分类信息",
  /** 候选字段补齐表单：无可补齐字段 */
  EMPTY_COMPLETABLE_FIELD: "暂无可补齐字段",
  /** 投稿历史面板汇总行：无待处理任务 */
  EMPTY_PENDING_SUBMISSION: "暂无待处理投稿",
  /** 分层编辑器子域列表空 */
  EMPTY_SUBDOMAIN: "暂无子域",
  /** 标签编辑器标签列表空 */
  EMPTY_TAG: "暂无标签",
  /** 文档清单筛选树分组无选项 */
  EMPTY_OPTIONS: "暂无选项",

  // ── 回落名 Fallback Names（WP-152 收官批：跨页面同值回落名单源——名称/字段名缺席时的占位称呼）──
  /** 图节点名缺席回落（nodeNameLabel 投影口径；拓扑钩子/关系总览同值消费） */
  UNNAMED_ENTITY: "未命名实体",
  /** 表单选项/卡片里架构组件名缺席回落（entity-compliance/article-associations 选择器——语义确指架构组件，非图节点查表族） */
  UNNAMED_ARCH_COMPONENT: "未命名架构组件",
  /** 字段名缺席（检查项无 field 归因）时的通称（合规卡片/修复抽屉/修复字段模型同值消费） */
  FIELD_LABEL_FALLBACK: "相关属性",
} as const;

/**
 * 图谱检索 topo 页签规模口径说明句（WP-145 N3 裸标签正名）。
 * 原句在 DataDashboardView 内联裸图标签 ArchitectureComponent/Module 上屏；自此正名消费上方
 * TERM.ARCH_COMPONENT／TERM.MODULE 词条，出处注释随词条。白名单单源＝GraphAdmissionService.ENTITY_LABELS
 * （contracts/graph-admission.json entityLabels 的前端镜像，对账钉 src/test/graph-admission-contract.test.ts）。
 * 完整说明句按本文件头规则 3 住闭集，视图整体消费、不再内联该句文案。
 */
export function termTopologyScaleHint(knowledgeNodeCount: number, admittedNodeCount: number): string {
  return `全量知识图共 ${knowledgeNodeCount} 个节点，其中 ${admittedNodeCount} 个为架构实体（标签 ${TERM.ARCH_COMPONENT}/${TERM.MODULE}）；其余业务域、文档等节点不在拓扑视图展示。`;
}
