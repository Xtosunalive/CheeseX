// property-gov 页级文案投影（WP-033/PR-148）——六检查用户可见标签的唯一声明处。
// 此前三份并存（CheckResultsPanel 汇总卡数组/展开详情内联/ComponentCheckDetail CHECK_LABELS）
// 且同物多名（「模块未填写」vs「module 属性未填写」）——收编本文件，口径统一不带属性键名。
// 编译期满配钉：Record<CheckKey, string> 七键——后端 findings 加检查键不登记即 tsc 红。
// 字段中文名单源仍是 shared/field-labels.mjs（本文件只管检查标签，不重复字段名）。
// WP-151 散写销账第三批：property-gov 目录其余用户可见文案增量进本文件（文件尾部分段，ADR-019 §二
// 展示面介质唯一出口）——按消费组件分段导出 const 对象，插值句用函数；多组件共用的同一事实只一份
// （PROPERTY_GOV_SHARED_COPY）；与字段中文名同值的列头经 shared/field-labels.mjs 派生，不手写第二份。
// 禁在其他 property-gov 文件内联同值中文（lint CJK 字面量族执法，本文件已在闭集豁免块）。

import { TERM } from "@/constants/term-const";
import { fieldLabel as sharedFieldLabel } from "../../../shared/field-labels.mjs";

/** 检查键集（与 CheckResultItem.checks 形状同源——加键须同批登记标签） */
export type GovCheckKey =
  | "missing_module"
  | "invalid_module"
  | "mount_mismatch"
  | "mount_diagnostic"
  | "stale_property"
  | "format_artifact"
  | "document_module_entity";

/** 六检查（＋诊断档）标签唯一声明处 */
export const CHECK_LABELS: Record<GovCheckKey, string> = {
  missing_module: "模块未填写",
  invalid_module: "模块值无效",
  mount_mismatch: "源文档关联不一致",
  mount_diagnostic: "源文档关联结果",
  stale_property: "属性提取已过期",
  format_artifact: "属性格式异常",
  document_module_entity: "文章模块缺实体",
};

/** 展开详情失败清单——从 checks 派生，不再内联第二份文案 */
export function failedCheckLabels(
  checks: {
    missing_module: { passed: boolean };
    invalid_module: { passed: boolean };
    mount_mismatch: { passed: boolean };
    stale_property: { passed: boolean };
    format_artifact: { passed: boolean };
    document_module_entity?: { passed: boolean } | null;
  },
): string[] {
  const labels: string[] = [];
  if (!checks.missing_module.passed) labels.push(CHECK_LABELS.missing_module);
  if (!checks.invalid_module.passed) labels.push(CHECK_LABELS.invalid_module);
  if (!checks.mount_mismatch.passed) labels.push(CHECK_LABELS.mount_mismatch);
  if (!checks.stale_property.passed) labels.push(CHECK_LABELS.stale_property);
  if (!checks.format_artifact.passed) labels.push(CHECK_LABELS.format_artifact);
  if (checks.document_module_entity && !checks.document_module_entity.passed) {
    labels.push(CHECK_LABELS.document_module_entity);
  }
  return labels;
}

// ═══ WP-151 增量：property-gov 其余用户可见文案 ═══

// ── 跨组件共用 ──
export const PROPERTY_GOV_SHARED_COPY = {
  /** 筛选「全部」选项（检查结果与映射列表两处筛选、映射筛选标签表 all 键同值） */
  ALL: "全部",
  /** 筛选分组：范围（「全部」/占位选项所属组） */
  SCOPE_GROUP: "范围",
  /** 通过（检查结论 healthy 档／单项检查通过徽标） */
  PASSED: "通过",
  /** 模块下拉分组：合法模块 */
  VALID_MODULES_GROUP: "合法模块",
  /** 写回进行中（模块修正与格式修正共用） */
  WRITING_BACK: "写回中…",
  /** 筛选无命中（无搜索词时） */
  NO_FILTER_RESULT: "当前筛选条件下无结果，试试切换筛选条件",
} as const;

// ── property-types：文章图谱映射筛选标签（property-types.ts 原名 FILTER_LABELS 再导出）──
export const MANIFEST_FILTER_LABELS: Record<string, string> = {
  all: PROPERTY_GOV_SHARED_COPY.ALL,
  missing: "未生成映射",
  fresh: "映射最新",
  stale: "映射过期",
  unknown: "映射状态异常",
  relational: "含关系",
  source_only: "仅节点",
  excluded: "已排除",
  missing_eligible: "待生成映射",
};

// ── api／store 层请求兜底 ──
export const PROPERTY_REQUEST_COPY = {
  /** GET /api/property/check 读取（env.error 缺省） */
  CHECK_RESULTS_FETCH_FAILED: "获取属性检查结果失败",
  /** store repair 写回失败兜底 */
  REPAIR_WRITE_FAILED: "修复写回失败",
  /** store repair 成功但未回报字段时的摘要 */
  REPAIR_WRITTEN: "已写回",
} as const;

/** GET /api/pipeline/status 非 2xx 兜底（服务端 message/error 缺省） */
export function pipelineStatusFetchFailed(httpStatus: number): string {
  return `管道状态读取失败（HTTP ${httpStatus}）`;
}

// ── pipeline-gen-presentation（管道生成状态展示）──
export const PIPELINE_GEN_COPY = {
  TIME_UNKNOWN: "时间未知",
  STAGE_UNKNOWN: "未知",
  RUN_FAILED: "管道运行失败",
} as const;

/** 运行中标签 */
export function pipelineGenRunningLabel(stage: string): string {
  return `运行中 · 阶段 ${stage}`;
}

/** 失败标签 */
export function pipelineGenFailedLabel(stage: string): string {
  return `失败 · 阶段 ${stage}`;
}

/** 成功标签（实体/关系总量） */
export function pipelineGenSuccessLabel(nodes: number, connections: number): string {
  return `成功 · ${nodes} ${TERM.ENTITY} · ${connections} ${TERM.RELATION}`;
}

/** 成功 title */
export function pipelineGenSuccessTitle(timeText: string): string {
  return `最近一次管道生成的主图总量 · ${timeText}`;
}

// ── PropertyGovView（属性治理页签）──
export const PROPERTY_GOV_VIEW_COPY = {
  TAB_MAPPING: "人工映射校正",
  TABS_ARIA: "文章与组件视图",
} as const;

// ── CheckResultsPanel（架构组件属性结果）──
export const CHECK_RESULTS_COPY = {
  /** 筛选分组 */
  FILTER_GROUP_SEVERITY: "严重程度",
  FILTER_GROUP_CHECK: "检查项",
  /** 列头与排序句柄 */
  COL_NAME: "名称",
  COL_NAME_ASC: "名称 A-Z",
  COL_NAME_DESC: "名称 Z-A",
  COL_MODULE: TERM.MODULE,
  COL_MODULE_ASC: "模块 A-Z",
  COL_MODULE_DESC: "模块 Z-A",
  COL_LAYER_ASC: "分层 A-Z",
  COL_LAYER_DESC: "分层 Z-A",
  COL_STATUS: "检查结论",
  COL_STATUS_ASC: "检查结论 A-Z",
  COL_STATUS_DESC: "检查结论 Z-A",
  /** 校验信息折叠条 */
  WORKING_REV_SUMMARY: "校验信息",
  WORKING_REV_COLLAPSED_HINT: "（源文件版本核对用，默认收起）",
  REVISION_UNAVAILABLE_TITLE: "校验值不可用",
  REVISION_UNAVAILABLE: "不可用",
  WORKING_REV_MISSING: "校验信息缺失，修复功能暂不可用",
  APPLIED_PREFIX: "已直接写回正式源：",
  /** 概览统计 */
  SUMMARY_TITLE: "架构组件属性概览",
  STAT_COVERAGE_LABEL: "模块配置有效率",
  STAT_COVERAGE_HINT: "已填写 module 且值在合法模块列表中的受检架构组件比例",
  STAT_BLOCKER_LABEL: "阻断架构组件",
  STAT_BLOCKER_HINT: "存在模块未填写、模块值无效或源文档关联不一致问题的架构组件数",
  STAT_WARNING_LABEL: "警告架构组件",
  STAT_WARNING_HINT: "不存在阻断问题，但存在属性提取过期或属性格式异常的架构组件数",
  STAT_TOTAL_LABEL: "受检架构组件",
  STAT_TOTAL_HINT: "本次参与属性质量检查的架构组件总数",
  /** 工具行 */
  SEARCH_ARIA: "搜索架构组件属性",
  SEARCH_PLACEHOLDER: "搜索架构组件名称或源文档路径",
  FILTER_ARIA: "筛选架构组件属性问题",
  FILTER_TITLE: "按架构组件属性问题筛选",
  FILTER_SEARCH: "筛选严重程度或检查项",
  FILTER_TRIGGER: "问题筛选",
  CLEAR_FILTERS: "清除架构组件属性筛选",
  /** 三态 */
  LOADING: "加载架构组件属性结果...",
  TABLE_ARIA: "架构组件属性结果表",
  EMPTY_TITLE: "无匹配的架构组件属性结果",
  EMPTY_ALL_PASSED: "当前受检架构组件均通过属性检查",
  PAGINATION_ARIA: "架构组件属性分页",
  /** 展开详情 */
  ALL_PASSED: "全部通过",
} as const;

/** 有搜索词时的空态说明 */
export function checkResultsNoMatchQuery(query: string): string {
  return `没有找到匹配「${query}」的检查项，请尝试调整搜索关键词或切换筛选`;
}

// ── ComponentCheckDetail（单组件检查详情）──
/** 严重度分组标题 */
export const COMPONENT_CHECK_SEVERITY_LABELS: Record<"blocker" | "warning" | "info", string> = {
  blocker: `${TERM.BLOCKER}项`,
  warning: `${TERM.WARNING}项`,
  info: "诊断信息",
};

export const COMPONENT_CHECK_COPY = {
  SOURCE_FILE_MISSING: "文件缺失",
  SOURCE_REVISION_MISSING: "源文件校验缺失，仅可查看",
  /** 模块未填写卡 */
  MISSING_MODULE_DESC: "该文章的文档元数据未设置所属模块，影响架构组件归类。",
  MISSING_MODULE_HINT: "选择模块后，系统将更新源文档的所属模块信息",
  MISSING_MODULE_ARIA: "选择缺失模块",
  SELECT_MODULE: "选择模块",
  FILTER_MODULE: "筛选模块",
  SELECT_MODULE_OPTION: "— 选择模块 —",
  APPLYING: "应用中…",
  APPLY_REPAIR: "应用修复",
  /** 模块值无效卡（「当前值」与 code 片段间空格由 JSX 给出） */
  CURRENT_VALUE_PREFIX: "当前值",
  EMPTY_VALUE: "(空)",
  NOT_IN_VALID_MODULES: "不在合法模块列表中。",
  SELECT_VALID_MODULE: "选择合法模块",
  FILTER_VALID_MODULE: "筛选合法模块",
  SELECT_VALID_MODULE_OPTION: "— 选择合法模块 —",
  WRITE_BACK_MODULE: "写回修正模块",
  /** 属性提取过期卡（尾随空格保留——JSX 原文同行空格） */
  ARTICLE_MTIME_PREFIX: "文章最后修改 ",
  EXTRACTED_AT_PREFIX: "属性提取时间 ",
  QUEUED: "已加入队列…",
  REGENERATE: "重新生成属性",
  /** 关联诊断卡 */
  MISSING_ENTITIES_PREFIX: "缺失实体: ",
} as const;

/** 分组标题旁通过计数（": 通过数/总数 通过"） */
export function componentCheckGroupPassText(passed: number, total: number): string {
  return `: ${passed}/${total} ${PROPERTY_GOV_SHARED_COPY.PASSED}`;
}

/** 合法模块徽章折叠余数 */
export function componentCheckMoreModulesText(rest: number): string {
  return `等 ${rest} 项`;
}

/** 源文档关联不一致卡：原因说明（JSX 原文跨行处折为一个空格——渲染结果逐字不变） */
export function mountMismatchExplanation(): string {
  return `架构组件记录的源文档路径在当前${TERM.GRAPH}中找不到对应${TERM.ENTITY}。 常见原因是${TERM.PIPELINE}尚未运行、文章已重命名或文章尚未被索引。`;
}

/** 源文档关联不一致卡：处理指引 */
export function mountMismatchGuidance(): string {
  return `请先核对源文档路径，再重新运行${TERM.PIPELINE}；当前页面不直接修改源文档关联。`;
}

// ── DocumentModuleEntityCard（文章模块缺实体卡；卡标题取 CHECK_LABELS.document_module_entity）──
export const DOCUMENT_MODULE_ENTITY_COPY = {
  /** 「文章 "标题" 声明 module 为 X」句的两段（引号与空格保留） */
  ARTICLE_QUOTE_OPEN: "文章 \"",
  DECLARES_MODULE: "\" 声明 module 为",
  MODULE_IN_ENUMS_NO_ENTITY: "，该模块名在枚举中合法，但图谱中不存在对应的知识实体节点。",
  MODULE_NOT_IN_ENUMS: "，该值不在模块枚举列表中。",
  SOURCE_PREFIX: "来源：",
  REGISTER_MODULE_HINT: "请先在 enums.yaml 中注册此模块，或在 wiki/entities/ 中创建模块实体页。",
} as const;

/** 模块合法但缺实体时的修复建议 */
export function documentModuleEntityFixHint(moduleName: string): string {
  return `修复建议：在知识库中创建 wiki/entities/${moduleName}.md 实体页，然后重新运行管道。`;
}

// ── FormatArtifactCard（属性格式异常卡；卡标题取 CHECK_LABELS.format_artifact）──
export const FORMAT_ARTIFACT_COPY = {
  MANUAL_CONFIRM_REQUIRED: "需要在来源文档中人工确认",
} as const;

/** 格式修正写回按钮 */
export function formatArtifactRepairLabel(field: string): string {
  return `写回修正 ${field} 格式`;
}

// ── ManifestListPanel（文章图谱映射列表）──
export const MANIFEST_LIST_COPY = {
  /** 概览统计 hint（label 取 MANIFEST_FILTER_LABELS 同名状态词） */
  SUMMARY_TOTAL_RAW_HINT: "知识图谱中引用的所有 .md 文件总数",
  SUMMARY_EXCLUDED_HINT: "不参与管道处理的文件：TheSchema 参考文件、README 索引页、模板、配置目录等",
  SUMMARY_ELIGIBLE_LABEL: "应生成映射",
  SUMMARY_ELIGIBLE_HINT: "排除参考文件、索引页和模板后，需要生成文章图谱映射的文档数",
  SUMMARY_FRESH_HINT: "文章图谱映射与当前主图版本一致的文档数",
  SUMMARY_STALE_HINT: "文章图谱映射对应的主图版本已变化，需要重新运行管道",
  SUMMARY_MISSING_ELIGIBLE_HINT: "应处理但尚无文章图谱映射的文档数",
  /** 旧口径（非覆盖率）概览 hint */
  LEGACY_TOTAL_HINT: "知识图谱引用的所有 .md 文件总数",
  LEGACY_STALE_HINT: "文章图谱映射对应的主图版本已变化",
  LEGACY_MISSING_HINT: "管道尚未生成文章图谱映射的文档数",
  /** 类型徽章 */
  KIND_ARTICLE: "文章",
  KIND_WIKI_ENTITY: "实体文档",
  KIND_OTHER: "其他文档",
  /** 映射模式补充说明 */
  MODE_SOURCE_ONLY_HINT: "仅生成节点，未形成图谱关系",
  MODE_RELATIONAL_FRESH_HINT: "已映射实体与关系，映射状态最新",
  /** 筛选分组 */
  FILTER_GROUP_STATUS: "处理状态",
  FILTER_GROUP_COVERAGE: "内容分类",
  /** 列头与排序句柄（「标题」＝shared/field-labels.mjs 文章域 title 字段中文名，经派生不手写第二份） */
  COL_TITLE: sharedFieldLabel("title", "article"),
  COL_TITLE_ASC: "标题 A-Z",
  COL_TITLE_DESC: "标题 Z-A",
  COL_KIND: "类型",
  COL_KIND_ASC: "类型 A-Z",
  COL_KIND_DESC: "类型 Z-A",
  COL_RELATION_COUNT: `${TERM.RELATION}数`,
  COL_RELATION_COUNT_ASC: "关系数 低-高",
  COL_RELATION_COUNT_DESC: "关系数 高-低",
  COL_STATUS: "映射状态",
  COL_STATUS_ASC: "映射状态 A-Z",
  COL_STATUS_DESC: "映射状态 Z-A",
  /** 工具行 */
  SEARCH_ARIA: `搜索${TERM.GRAPH_SOURCE_DOCUMENT}`,
  SEARCH_PLACEHOLDER: "搜索标题或源文件路径",
  FILTER_ARIA: `筛选${TERM.ARTICLE_GRAPH_MAPPING}状态`,
  FILTER_TITLE: `按${TERM.ARTICLE_GRAPH_MAPPING}状态筛选`,
  FILTER_SEARCH: "筛选映射状态或内容类型",
  FILTER_TRIGGER: "映射筛选",
  CLEAR_FILTERS: "清除图谱引用文档筛选",
  /** 表格与空态 */
  TABLE_ARIA: `${TERM.ARTICLE_GRAPH_MAPPING}列表`,
  EMPTY_NO_DATA_TITLE: `还没有${TERM.GRAPH_SOURCE_DOCUMENT}`,
  EMPTY_NO_MATCH_TITLE: `无匹配的${TERM.GRAPH_SOURCE_DOCUMENT}`,
  PAGINATION_ARIA: `${TERM.ARTICLE_GRAPH_MAPPING}分页`,
} as const;

/** 映射覆盖率主视觉 sub */
export function manifestCoverageSub(covered: number, eligible: number): string {
  return `${covered}/${eligible} 已映射`;
}

/** 映射覆盖率主视觉 hint */
export function manifestCoverageHint(covered: number, eligible: number, pct: string): string {
  return `${covered} 篇已有文章图谱映射，占应生成映射 ${eligible} 篇的 ${pct}%`;
}

/** 有搜索词时的空态说明 */
export function manifestNoMatchQuery(query: string): string {
  return `没有找到匹配「${query}」的图谱引用文档，请尝试调整搜索关键词或切换筛选`;
}
