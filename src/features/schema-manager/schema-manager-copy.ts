// schema-manager 页级文案单源（WP-149 散写销账）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（SchemaManagerView 全部页签编辑器＋store/api 层）的用户可见文案只在本文件声明：
// 按消费组件分段导出 const 对象，插值句用函数（学 term-const.ts termTopologyScaleHint 先例）。
// 禁在其他 schema-manager 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

// ── 请求兜底错误（env.error 缺省／非 Error 对象时的 fallback）──
// 消费面：api 层六文件（schema-manager-api／ontology-api／dependencies-api／schema-discovery-api／
// version-registry-api／schema-write-api）＋store 层两文件（schema-manager-store／schema-manager-version-slice）。
// 同一操作的 api 兜底与 store catch 兜底共用一键（同一事实只一份）。
export const SM_REQUEST_COPY = {
  /** GET /api/schema/enums 读取 */
  ENUMS_FETCH_FAILED: "获取图谱规则字典失败",
  /** store load／loadDiscovery 读态 */
  RULES_LOAD_FAILED: "加载图谱规则失败",
  /** POST /api/schema/enums/preview */
  ENUMS_PREVIEW_FAILED: "分类变更影响预览失败",
  /** GET /api/schema/enums/history */
  SCHEMA_HISTORY_LOAD_FAILED: "读取 Schema 快照失败",
  /** PUT /api/schema/enums 写回 */
  RULES_SAVE_FAILED: "保存规则失败",
  /** POST /api/schema/enums/rollback */
  ENUMS_ROLLBACK_FAILED: "回滚失败",
  /** GET /api/schema/ontology 读取 */
  ONTOLOGY_FETCH_FAILED: "获取实体与关系规则失败",
  /** store loadOntology 读态 */
  ONTOLOGY_LOAD_FAILED: "加载本体失败",
  /** PUT /api/schema/ontology 写回 */
  ONTOLOGY_SAVE_FAILED: "保存本体失败",
  /** GET /api/schema/dependencies 读取 */
  DEPENDENCY_FETCH_FAILED: "获取依赖规则失败",
  /** store loadDependencies 读态 */
  DEPENDENCY_LOAD_FAILED: "加载依赖规则失败",
  /** POST /api/schema/dependencies/validate */
  DEPENDENCY_VALIDATE_FAILED: "校验依赖规则失败",
  /** POST /api/schema/dependencies/preview */
  DEPENDENCY_PREVIEW_FAILED: "依赖规则影响预览失败",
  /** PUT /api/schema/dependencies 写回 */
  DEPENDENCY_SAVE_FAILED: "保存依赖规则失败",
  /** GET /api/schema/discovery 读取 */
  DISCOVERY_FETCH_FAILED: "获取未收录值失败",
  /** store reloadDiscoveryWithThreshold 读态 */
  DISCOVERY_RELOAD_THRESHOLD_FAILED: "按阈值重取画像失败",
  /** store reloadDiscoveryWithMinCount 读态 */
  DISCOVERY_RELOAD_MINCOUNT_FAILED: "按门槛重取信号失败",
  /** POST /api/schema/discovery/absorb 写入（store absorbFormal 同键） */
  DISCOVERY_ABSORB_FAILED: "提交未收录值失败",
  /** store growEntity 写入 */
  ENTITY_GROW_FAILED: "实体生长提交失败",
  /** store allowMatrixCandidate 写入 */
  POLICY_SUBMIT_FAILED: "组合裁定提交失败",
  /** GET /api/schema/versions 读取（版本切片 loadVersions 同键） */
  VERSIONS_LOAD_FAILED: "加载产品版本失败",
  /** POST /api/schema/versions/validate（版本切片同键） */
  VERSIONS_VALIDATE_FAILED: "验证产品版本失败",
  /** PUT /api/schema/versions 写回（版本切片同键） */
  VERSIONS_SAVE_FAILED: "保存产品版本失败",
  /** POST /api/schema/versions/freeze（版本切片同键） */
  VERSION_FREEZE_FAILED: "提交产品版本冻结失败",
  /** GET /api/schema/product-identity 读取 */
  PRODUCT_IDENTITY_LOAD_FAILED: "加载产品身份失败",
  /** PUT /api/schema/product-identity 写回（版本切片同键） */
  PRODUCT_IDENTITY_SAVE_FAILED: "保存产品身份失败",
} as const;

/** growEntity 出生反查成功提示（WP-134 波 3：可见列举与「等」截断一处算出） */
export function smGrownEntityNotice(entityValue: string, mentionedCount: number, visibleFiles: string[], hasRest: boolean): string {
  return `已建实体「${entityValue}」——反查到 ${mentionedCount} 处提及：${visibleFiles.join("、")}${hasRest ? " 等" : ""}`;
}

/** allowMatrixCandidate 组合裁定成功提示 */
export function smMatrixConfirmNotice(matrixKey: string): string {
  return `已确认：${matrixKey} 写入分类矩阵——保存后将按矩阵规则自动校验`;
}

/** 行号定位 aria/title 句柄（「第 N 条X」——表格行控件无障碍名与悬停提示通用，WP-149 收编） */
export function smRowItemAria(itemLabel: string, rowNumber: number): string {
  return `第 ${rowNumber} 条${itemLabel}`;
}

/** 带动作前缀的行号定位句柄（「动作第 N 条X」，如 删除第 2 条依赖规则／选择第 1 条依赖规则） */
export function smActionRowAria(actionLabel: string, itemLabel: string, rowNumber: number): string {
  return `${actionLabel}第 ${rowNumber} 条${itemLabel}`;
}

// ── DependencyRulesEditor（依赖规则编辑器）──
export const DEP_RULES_COPY = {
  NOT_LOADED: "依赖规则未加载",
  IMPORT_FAILED: "导入失败",
  COL_SOURCE: "源实体",
  COL_TYPE: "关系类型",
  COL_TARGET: "目标实体",
  COL_SINCE: "生效版本",
  COL_UNTIL: "失效版本",
  COL_ORIGIN: "来源",
  COL_DIAGNOSTICS: "诊断",
  ORIGIN_MANUAL: "人工配置",
  ORIGIN_AUTO: "文档提取",
  GROUP_ORIGIN: "来源",
  GROUP_VERSIONABLE: "支持版本",
  GROUP_PLAIN_RELATION: "普通关系",
  DIAG_OK: "正常",
  ROW_DELETE_TITLE: "删除规则",
  INTRO: "依赖规则维护版本范围和来源，可导入、筛选与删除。",
  SUMMARY_RULES: "规则 ",
  SUMMARY_ERRORS: "错误 ",
  SUMMARY_WARNINGS: "提醒 ",
  FILTER_SOURCE_ARIA: "筛选源实体",
  FILTER_TARGET_ARIA: "筛选目标实体",
  FILTER_ORIGIN_ARIA: "筛选来源",
  FILTER_VERSION_ARIA: "筛选版本",
  FILTER_VERSION_PLACEHOLDER: "筛选版本",
  ALL_SOURCE: "全部源实体",
  ALL_TARGET: "全部目标实体",
  ALL_ORIGIN: "全部来源",
  GROUP_SCOPE: "范围",
  CATEGORIES_READONLY_HINT: "实体类别由分类矩阵生成——可在上方「分类矩阵候选」确认组合，此处暂只读。",
  COUNT_DOCS_UNIT: " 篇 · ",
  COUNT_FILES_UNIT: " 个文件",
  VALIDATE_TITLE: "校验规则",
  VALIDATE_ACTION: "校验",
  PREVIEW_TITLE: "影响预览",
  PREVIEW_ACTION: "预览",
  IMPORT_RULES_ACTION: "导入规则",
  IMPORT_SECTION_ARIA: "导入规则",
  IMPORT_CLOSE_TITLE: "关闭导入",
  IMPORT_FORMAT_TSV: "表格 TSV",
  IMPORT_TEXTAREA_ARIA: "依赖规则导入内容",
  IMPORT_SUBMIT: "加入待保存规则",
  ITEM_NOUN: "依赖规则",
  TABLE_ARIA: "依赖规则表",
  EMPTY_NO_RULES: "暂无依赖规则",
  EMPTY_NO_MATCH: "没有匹配的依赖规则",
  SELECT_HEADER: "选择",
  DELETE_SELECTED: "删除选中",
  PAGINATION_ARIA: "依赖规则分页",
} as const;

/** 计数＋量词标签（「N 种关系」「N 条政策」——数字在前的中文计数句，WP-149 收编） */
export function smCountedLabel(count: number, unitLabel: string): string {
  return `${count} ${unitLabel}`;
}

// ── OntologyEditor（本体编辑器：节点类型／关系类型／推理规则／数据约束）──
export const ONTOLOGY_COPY = {
  SEV_ERROR: "错误",
  SEV_WARNING: "提醒",
  DIRECTION_DIRECTED: "有方向",
  DIRECTION_BIDIRECTIONAL: "双向",
  DIRECTION_UNSET: "未设置方向",
  UNSAVED_CHANGES: "未保存的更改",
  SAVING: "保存中...",
  NODE_TYPES_HEADER: "节点类型",
  RELATION_TYPES_HEADER: "关系类型",
  INFERENCE_TITLE: "自动关联规则",
  INFERENCE_EMPTY: "无推理规则",
  INFERENCE_FALLBACK_DESC: "按既定实体和关系语义生成候选关联",
  CONSTRAINTS_HEADER: "数据约束",
  CONSTRAINTS_EMPTY: "无约束规则",
  COL_TYPE: "类型",
  COL_CATEGORY: "归属类别",
  COL_RELATIONS: "允许关系",
  COL_DIRECTION: "方向",
  COL_POLICIES: "断言政策",
  COL_FLAGS: "标记",
  NEW_NODE_TYPE: "新节点类型",
  UNNAMED_NODE_TYPE: "未命名节点类型",
  UNNAMED_RELATION: "未命名关系",
  NEW_RELATION_TYPE: "新关系类型",
  CATEGORY_UNSET: "未设类别",
  UNIT_RELATIONS: "种关系",
  UNIT_POLICIES: "条政策",
  POLICY_MISSING: "ERROR 缺失政策",
  FLAG_LEGACY: "兼容旧关系",
  FLAG_NEEDS_REVIEW: "需要人工审核",
  NODE_TABLE_ARIA: "节点类型编辑表",
  RELATION_TABLE_ARIA: "关系类型编辑表",
  LABEL_KEY: "创建标识",
  PLACEHOLDER_KEY: "请输入唯一英文标识",
  LABEL_DESC: "描述",
  PLACEHOLDER_DESC: "描述",
  LABEL_CATEGORY: "归属类别",
  PLACEHOLDER_CATEGORY: "如 服务",
  LABEL_ICON: "图标名称",
  PLACEHOLDER_ICON: "如 server",
  LABEL_COLOR: "颜色",
  COLOR_ARIA_SUFFIX: " 颜色",
  COLOR_PICK_TITLE: "选择实体颜色",
  COLOR_FILTER_PLACEHOLDER: "筛选颜色",
  GROUP_COLOR: "颜色",
  LABEL_ALLOWED_RELATIONS: "可建立的关系类型",
  LABEL_CN_TAG: "中文标签",
  PLACEHOLDER_CN_TAG: "如 依赖",
  LABEL_DIRECTION: "方向",
  LABEL_WEIGHT_DEFAULT: "默认权重",
  LABEL_WEIGHT_MIN: "权重范围 min",
  LABEL_WEIGHT_MAX: "权重范围 max",
  CHECK_VERSIONABLE: "支持版本关系",
  CHECK_REQUIRES_REVIEW: "新关系需要审核",
  CHECK_IS_LEGACY: "兼容旧关系",
  LABEL_SOURCE_TYPES: "允许的源节点类型",
  LABEL_TARGET_TYPES: "允许的目标节点类型",
  ADD_ACTION: "添加",
} as const;

// ── FieldsEditor（字段字典编辑器）──
// REQUIRED_OPTIONS／LAYER_OPTIONS 既是存储数据域（PUT /api/schema/fields 的值）也是下拉选项文案，
// 值域单源搬进闭集：FieldRow 类型经 typeof 从这里派生（改值＝改存储域＋文案同一处）。
export const FIELDS_COPY = {
  /** required 数据域兼选项文案（字段字典存储值） */
  REQUIRED_OPTIONS: ["是", "否", "建议"],
  /** layer 数据域兼选项文案（字段字典存储值） */
  LAYER_OPTIONS: ["管理属性", "业务属性", "内容属性"],
  SCOPE_ENTITY: "实体",
  SCOPE_ARTICLE: "文章",
  LOAD_HINT: "加载字段字典…",
  READ_FAILED: "字段字典读取失败",
  SAVE_OK_SYNCED: "已保存（投影同步重生成）",
  SAVE_OK_UNSYNCED: "已保存（投影重生成失败——跑 npm run project:frontmatter-schema 补齐）",
  SAVING: "保存中…",
  SAVE_ACTION: "保存字段字典",
  REBUILDING: "重建中…",
  REBUILD_ACTION: "重建派生物",
  REBUILD_TITLE: "同步重建全部在册派生物（解析物/投影——清单来自数据角色注册表）",
  REBUILD_SEE_SERVER_LOG: "详见服务端日志",
  ADD_FIELD: "新增字段",
  TABLE_ARIA: "字段字典编辑表",
  SECTION_ARIA: "字段字典编辑区",
  EMPTY: "暂无字段，点击「新增字段」创建",
  COL_NAME: "字段名",
  COL_LABEL: "人读名",
  COL_TYPE: "类型",
  COL_REQUIRED: "必填",
  COL_LAYER: "层",
  COL_SCOPE: "作用域",
  COL_VALUE_DOMAIN: "值域",
  COL_DESC: "说明",
  PLACEHOLDER_NAME: "字段名",
  PLACEHOLDER_LABEL: "人读名",
  PLACEHOLDER_VALUE_DOMAIN: "值域(enums段/free)",
  VALUE_DOMAIN_JUMP_TITLE: "点击跳转到值域词表编辑",
  PLACEHOLDER_DESC: "字段说明",
  ARIA_LABEL_TAG: "标签",
  DELETE_ROW_PREFIX: "删除字段",
} as const;

/** 字段字典头部汇总句（条数在前的说明句） */
export function smFieldsSummary(fieldCount: number): string {
  return `${fieldCount} 个字段 · 值域 source 指向 enums 段或 free · 保存即重生成 entity-frontmatter-schema.md 投影`;
}

/** 派生物重建成功句（后端报总数档） */
export function smRebuildNoteKnownTotal(total: number, changed: number): string {
  return `派生物已核对：${total} 项中重建 ${changed} 项、已最新 ${total - changed} 项`;
}

/** 派生物重建成功句（后端未报总数档——按本页口径说话，不顶替总数） */
export function smRebuildNotePageOnly(pageCount: number, changed: number): string {
  return `派生物已核对：本页 ${pageCount} 项中重建 ${changed} 项、已最新 ${pageCount - changed} 项（后端未报总数）`;
}

/** 派生物重建失败句（列出失败工件） */
export function smRebuildNoteFailed(failed: number | string, failedList: string, serverMessage: string): string {
  return `重建失败 ${failed} 项（${failedList}）：${serverMessage}`;
}

/** 派生物重建请求异常句 */
export function smRebuildNoteError(detail: string): string {
  return `重建请求失败：${detail}`;
}

/** 标签＋序号 aria/title 句柄（「字段名 3」——无行号「第 N 条」形态的平铺句） */
export function smLabelIndexAria(label: string, index: number): string {
  return `${label} ${index}`;
}

/** 序数 aria/title 句柄（「第 N 个X」——版本行的无障碍名形态） */
export function smOrdinalAria(itemLabel: string, ordinal: number): string {
  return `第 ${ordinal} 个${itemLabel}`;
}

// ── VersionRegistryEditor（产品版本注册编辑器）──
export const VERSIONS_COPY = {
  STATUS_DRAFT: "草稿",
  STATUS_RELEASED: "已发布",
  /** 与 TERM.VERSION_DEPRECATED（已废弃）不同字——版本注册表历史文案，字节原样搬迁 */
  STATUS_DEPRECATED: "已停用",
  /** 服务端校验失败消息的比对键（产出单源＝server/services/version-registry-service.cjs serviceError）
   *  ——非展示文案，前端仅用于 showSaveError 抑制判断；随搬迁入闭集，改值须两处同步 */
  SERVER_VALIDATION_FAILED_MSG: "产品版本注册表校验失败",
  /** 诊断句族（formatVersionDiagnostic——改写须对 schema-version-registry.test 文案断言） */
  DIAG_INVALID_VERSION: (value: string, labelSuggestion: string) =>
    `版本号“${value || "空值"}”格式不正确。请填写 2.2、2.2.2 或 2.2.2.2；显示名称可自由填写。${labelSuggestion}`,
  DIAG_LABEL_SUGGESTION: (label: string) =>
    ` 显示名称“${label}”看起来像版本号，可将它移到“版本号”字段。`,
  DIAG_VALUE_EMPTY: "空值",
  DIAG_LABEL_REQUIRED: "显示名称不能为空。它用于界面展示，例如“MyProduct 1.0.0”。",
  DIAG_DUPLICATE: (value: string, duplicateHint: string) =>
    `版本号“${value || "空值"}”${duplicateHint}。同一产品内的版本号必须唯一。`,
  DIAG_DUPLICATE_HINT: (firstOrdinal: number) => `，与第 ${firstOrdinal + 1} 个版本重复`,
  DIAG_ALIAS_PREFIX: "版本别名有误：",
  DIAG_ALIAS_SUFFIX: "。多个别名请使用英文逗号分隔。",
  /** 字段标签回退（字典投影缺登记时的旧文案） */
  FALLBACK_CANONICAL_LABEL: "主产品名（身份锚点）",
  FALLBACK_ALIASES_LABEL: "产品别名",
  COL_ID: "版本号",
  COL_LABEL: "显示名称",
  COL_ALIASES: "别名",
  COL_STATUS: "状态",
  COL_ACTIONS: "操作",
  PLACEHOLDER_ID: "例如 7.0.6.8",
  PLACEHOLDER_LABEL: "例如 MyProduct 1.0.0",
  PLACEHOLDER_ALIASES: "多个别名用英文逗号分隔",
  FREEZE_ARIA: (versionId: string) => `提交冻结 ${versionId}`,
  FREEZE_TITLE: "提交冻结快照",
  FREEZE_CONFIRM: (product: string, versionId: string) =>
    `将 ${product} ${versionId} 的冻结快照直接写回版本注册表？经校验通过后立即生效。`,
  DELETE_ARIA: (versionId: string, ordinal: number) => `删除 ${versionId || smOrdinalAria("版本", ordinal)}`,
  DELETE_DRAFT_TITLE: "删除草稿版本",
  HEADER_TITLE: "产品版本注册",
  TOTAL_SUFFIX: " 个版本",
  VALIDATE_ARIA: "验证产品版本",
  VALIDATE_ACTION: "验证",
  CANONICAL_FIRST_SET_PLACEHOLDER: "首次设定，例如 AnyShare",
  CANONICAL_LOCKED_TITLE: "身份锚点已设定：改名=换身份，不在本表单改（renameSupported=false）；别名可维护",
  ALIASES_ARIA: "产品别名",
  ALIASES_ARIA_SUFFIX: "版本别名",
  SAVE_IDENTITY_ACTION: "保存产品身份",
  SAVE_ALIASES_ACTION: "保存别名",
  SAVE_IDENTITY_TITLE: "保存产品身份（主产品名仅空态首次设定）",
  IDENTITY_EMPTY_HINT: "——空态可首次设定主产品名（设定后不可改名，别名随时可维护）",
  IDENTITY_NOTE_PREFIX: "——",
  MIN_VERSIONS_WARNING: "至少登记两个产品版本后才能进行版本分析",
  DIAGNOSTICS_SUMMARY: (count: number) => `发现 ${count} 个版本数据问题，请按标红字段修正后重新验证。`,
  SELECT_PRODUCT_ARIA: "选择产品",
  PRODUCT_LABEL: "产品",
  TABLE_ARIA: "产品版本表",
  EMPTY_NO_VERSIONS: "当前产品还没有版本",
  ADD_VERSION: "新增版本",
} as const;

/** 标签＋值 aria/title 句柄（「源对象 client-x」——值内插的无障碍名形态） */
export function smLabeledValueAria(label: string, value: string): string {
  return `${label} ${value}`;
}

// ── RelationsEditor（治理关系实例账编辑器）──
export const RELATIONS_COPY = {
  SAVE_CONFLICT: "账本已被他人更新（409）——请刷新后重试",
  GROUP_DICT_OBJECT: "字典在册对象",
  GROUP_RELATION_TYPES: "relation_types 注册表",
  BAND_HIGH: "高",
  BAND_MEDIUM: "中",
  BAND_LOW: "低",
  BAND_EMPTY_LABEL: "—",
  GROUP_BAND: "档位",
  COL_SOURCE: "源对象",
  COL_TYPE: "类型",
  COL_TARGET: "目标对象",
  COL_ENDPOINT_DOMAIN: "域",
  COL_CONFIDENCE_BAND: "档位",
  COL_NOTE: "注记",
  COL_ASSERTED_BY: "裁定者",
  COL_ASSERTED_AT: "裁定日期",
  SOURCE_NODE_ARIA: "源节点 id",
  SOURCE_GRAPH_TITLE: "图域端点＝图谱节点 id（保存时校验）",
  TARGET_NODE_ARIA: "目标节点 id",
  TARGET_GRAPH_TITLE: "图域端点＝图谱节点 id",
  SOURCE_PICK_TITLE: "选择源对象",
  TYPE_PICK_TITLE: "选择类型",
  TARGET_PICK_TITLE: "选择目标对象",
  ENDPOINT_DOMAIN_ARIA: "端点域",
  ENDPOINT_DOMAIN_TITLE: "dictionary＝字典在册名；graph＝图谱节点 id（置信度覆盖行，SPEC-027 C11）",
  ENDPOINT_DICT_LABEL: "字典",
  ENDPOINT_GRAPH_LABEL: "图域",
  GROUP_ENDPOINT_DOMAIN: "端点域",
  BAND_ARIA: "置信度档位",
  BAND_TITLE: "可选档位（裁定 A——人不填数）",
  NOTE_ARIA: "注记",
  ASSERTED_BY_ARIA: "裁定者",
  ASSERTED_BY_TITLE: "选择裁定者",
  ASSERTED_HUMAN: "人工",
  ASSERTED_RULE: "规则",
  GROUP_ASSERTED_BY: "裁定者",
  DELETE_ROW_TITLE: "删除关系",
  DELETE_ROW_ARIA: "删除这条治理关系",
  SECTION_ARIA: "治理关系实例账",
  INTRO: "治理关系实例账——身份＝源对象|目标对象|类型（同身份只存一条，重写即更新）。",
  TOTAL_PREFIX: "共 ",
  TOTAL_SUFFIX: " 条",
  SAVING: "保存中…",
  SAVE_ALL: "保存全部",
  FILTER_TYPE_ARIA: "筛选类型",
  FILTER_SOURCE_ARIA: "筛选源对象",
  FILTER_SOURCE_PLACEHOLDER: "筛选源对象",
  ALL_TYPES: "全部类型",
  GROUP_SCOPE: "范围",
  CATEGORIES_READONLY_HINT: "实体类别由分类矩阵生成——可在上方「分类矩阵候选」确认组合，此处暂只读。",
  COUNT_DOCS_UNIT: " 篇 · ",
  COUNT_FILES_UNIT: " 个文件",
  TABLE_ARIA: "治理关系实例表",
  EMPTY_NO_ROWS: "暂无治理关系",
  EMPTY_NO_MATCH: "没有匹配的治理关系",
  PAGINATION_ARIA: "治理关系分页",
} as const;

// ── RulesChannelSection（规则通道：候选信号＋规则台账）──
// check/gate token → 中文（2026-10-27 降档批人话卡目录）：check 语义=entity-compliance-declarative-engine
// 检查实现；gate 语义=write-gate-policy 挂点。未登记 token 回退原文（宁显原文不显示错话）。
export const RULES_CHECK_LABELS: Record<string, string> = {
  "enum-ref": "引用校验（值必须在册）",
  "required": "必填校验",
  "typed-wikilink-count": "关系连线计数",
  "resolve-target": "连线目标解析",
  "ref-exists": "文档引用存在性",
  "known-labels": "关系前缀在册",
};

export const RULES_GATE_LABELS: Record<string, string> = {
  "entity-repair.apply-create": "实体修复写门",
  "entity-repair.preview-edit": "修复预览",
  "pipeline.stage-0-5": "管线入图资格",
};

// 规则族（ruleId 前缀 = 检查域维度；分组纯派生，数据零新增）。
// 族全名出处：F/B=entity-compliance-declarative-engine（frontmatter 字段/正文关系检查）；
// A=article-compliance-service（文章源检查，A01-A10）；W=article-admission-policy（标准化警告）；
// CREATE=缺失实体补齐流（entity-compliance-routes CREATE 字段清单序）。
export const RULES_FAMILIES: Array<{ prefix: string; name: string; desc: string }> = [
  { prefix: "CREATE", name: "补齐流族（Create Flow）", desc: "缺失实体补齐的字段序（CREATE-N 与字段清单键序对应）" },
  { prefix: "F", name: "实体元数据族（Frontmatter）", desc: "实体 frontmatter 字段检查：必填/枚举引用/唯一性/组合矩阵" },
  { prefix: "B", name: "正文关系族（Body）", desc: "实体正文类型化 wikilink 关系检查：连线解析/别名提示" },
  { prefix: "A", name: "文章源检查族（Article）", desc: "标准文章必填/枚举/分类/版本合规（A01-A10）" },
  { prefix: "W", name: "标准化警告族（Standardization）", desc: "标准化提案的正文质量警告（如 W01 内容过短）" },
];

export const RULES_CHANNEL_COPY = {
  LEDGER_LOAD_FAILED: "规则台账加载失败",
  LEDGER_NOT_READY: "规则台账未加载（缺乐观锁基线），正在重新读取——请稍后重试",
  PROPOSE_FAILED: "立规失败",
  RETIRE_FAILED: "退役失败",
  /** propose 写请求的 message 字段值（服务端台账展示用） */
  CANDIDATE_MESSAGE: (signalKey: string, count: number) => `规则候选（来自问题信号 ${signalKey}，出现 ${count} 次）`,
  SIGNALS_HEADER: "规则候选 · Rule Signals",
  THRESHOLD_LABEL: "信号门槛",
  THRESHOLD_TITLE: "信号门槛：同类违规 ≥N 次才出信号（页面配置项，默认 2）——与实体阈值同款",
  SIGNALS_INTRO_PREFIX: "问题台反复出现的模式（同类违规 ≥",
  SIGNALS_INTRO_MIDDLE: " 次）。[立为规则] 经裁定写入规则契约（warn 级起步），引擎查表执行。",
  EMPTY_SIGNALS_PREFIX: "当前门槛下没有信号——降低门槛可看到更多（问题台账共 ",
  EMPTY_SIGNALS_MIDDLE: " 条，聚类 ",
  EMPTY_SIGNALS_SUFFIX: " 条）。",
  PROPOSE_TITLE: (sampleIds: string) => `立为规则（样本：${sampleIds}）`,
  PROPOSING: "立规中…",
  PROPOSE_ACTION: "立为规则",
  /** 信号卡次行注记（「规则 {ruleId} · {count} 条待处理问题聚类（同类 ≥{threshold} 次）」） */
  SIGNAL_META_RULE_PREFIX: "规则 ",
  SIGNAL_META_COUNT_PREFIX: " 条待处理问题聚类（同类 ≥",
  SIGNAL_META_SUFFIX: " 次）",
  LEDGER_HEADER: "规则台账 · Policy Registry",
  SEALED_TITLE: "存量规则强度封存：Enforce/Advise 切换须先呈快照对账经裁决（先例：波4 F06 降档）",
  SEALED_LABEL: "强度封存",
  RETIRING: "退役中…",
  RETIRE_ACTION: "退役",
  CHECK_PREFIX: "检查：",
  GATES_PREFIX: "挂点：",
  NO_GATE_TITLE: "未挂任何执行门=不执法（问题台账现算呈现仍可见）",
  NO_GATE_LABEL: "⚠ 未挂执行门",
  VIOLATIONS_TITLE: "当前待处理问题（按此规则聚合）——点击前往问题台账",
  VIOLATIONS_PREFIX: "当前违规 ",
  NO_VIOLATIONS_TITLE: "问题台账现算无此规则的待处理问题",
  NO_VIOLATIONS_LABEL: "无当前违规",
  UNKNOWN_FAMILY: "未识别族",
  UNKNOWN_FAMILY_HINT: "ruleId 无已知前缀——登记进 RULES_FAMILIES 或核查命名",
  FOOTER: "字段校验（F 族）已降档为代码内声明（改规则=改代码+发版），台账只收真规则；存量规则强度封存（切换须呈快照对账经裁决——先例：波4 F06 降档）；新立规则一律 Advise（warn）起步，可退役。",
} as const;

// ── SchemaDiscoveryTab（未收录值裁定页签）──
export const DISCOVERY_COPY = {
  GROUP_UNCOLLECTED_TAGS: "未收录标签",
  EMPTY_STATE: "暂无可裁定的未收录值——各候选区现算自知识库内容，内容到位后自动出现。",
  /** 正式标签下拉选项标签（「值（分组）」） */
  FORMAL_TAG_OPTION: (value: string, group: string) => `${value}（${group}）`,
  GROUP_FORMAL_TAGS: "正式标签",
  CLOSE_NOTICE_ARIA: "关闭提示",
  WILD_TAG_NOTICE: "野生标签不自动吞并——由人裁定：升为正式标签，或归为某正式标签的别名。",
  /** 实体总目折叠头（「实体总目 · N 实体 / M 组」） */
  ENTITY_CATALOG_HEADER: (entities: number, groups: number) => `实体总目 · ${entities} 实体 / ${groups} 组`,
  MATRIX_HEADER: "分类矩阵候选 · 子域×类别",
  MATRIX_STAGE_CONFIGURED: "确认期",
  MATRIX_STAGE_OBSERVING: "观察期",
  MATRIX_INTRO: "组合在实体中反复出现即为候选；确认后写入分类矩阵，此后按矩阵规则自动校验，实体类别转为自动生成。",
  MATRIX_OCCURRENCES_UNIT: " 实体 · 观察 ",
  MATRIX_ROUNDS_UNIT: " 轮 · 累计 ",
  MATRIX_TOTAL_UNIT: " 次",
  MATRIX_TOTAL_UNKNOWN: "—",
  MATRIX_FIRST_SEEN_PREFIX: " · 首见 ",
  /** firstSeen 哨兵值（服务端产出，兼比较键与展示） */
  FIRST_SEEN_CURRENT: "本轮",
  MATRIX_CONFIRM_TITLE: "写入分类矩阵（子域允许该类别）",
  SUBMITTING: "提交中...",
  MATRIX_CONFIRM_ACTION: "允许入矩阵",
  SAMPLE_FILES_SUMMARY: "样例实体",
  ASSIGN_DOMAIN_ARIA_SUFFIX: "归属知识域",
  ASSIGN_DOMAIN_TITLE: "选择归属知识域",
  DOMAIN_FILTER_PLACEHOLDER: "筛选知识域",
  DOMAIN_PICK_OPTION: "选择知识域",
  LABEL_ARIA_SUFFIX: "标签",
  LABEL_REQUIRED_TITLE: "词条标签（人读名，必填）",
  LABEL_REQUIRED_PLACEHOLDER: "标签（必填）",
  PROMOTE_GROUP_ARIA_SUFFIX: "晋升分组",
  PROMOTE_GROUP_TITLE: "升为正式标签的分组",
  GROUP_FILTER_PLACEHOLDER: "筛选分组",
  PROMOTE_GROUP_OPTION: "升为正式标签→选分组",
  GROUP_ADJUDICATION: "裁定",
  GROUP_TAG_GROUPS: "标签分组",
  ALIAS_TARGET_ARIA_SUFFIX: "别名目标",
  ALIAS_TARGET_TITLE: "归为别名的目标标签",
  ALIAS_TARGET_FILTER_PLACEHOLDER: "筛选目标标签",
  ALIAS_TARGET_OPTION: "归为别名→选目标",
  SUBMIT_TITLE: "提交到正式规则",
  SUBMIT_ACTION: "提交",
  VIEW_FILES_SUMMARY: "查看文件",
  GROUP_SCOPE: "范围",
  CATEGORIES_READONLY_HINT: "实体类别由分类矩阵生成——可在上方「分类矩阵候选」确认组合，此处暂只读。",
  COUNT_DOCS_UNIT: " 篇 · ",
  COUNT_FILES_UNIT: " 个文件",
} as const;

// ── components/ModuleRegistryEditor（产品模块注册表编辑器）──
export const MODULES_COPY = {
  /** 字段完整度问题清单（与迁移前口径逐字一致——schema-manager-view.test 依赖） */
  ISSUE_SYSTEM_REQUIRED: "system 不能为空",
  ISSUE_SUBDOMAIN_REQUIRED: "subdomain 不能为空",
  ISSUE_SYSTEM_SAME_AS_SUBDOMAIN: "system 与 subdomain 不应相同",
  ISSUE_SYSTEM_DUPLICATED: "system 与其他模块重复",
  COL_NAME: "模块名称",
  NAME_ARIA_SUFFIX: "名称",
  COL_SYSTEM_TITLE: "模块归属的主系统节点（kebab-case，如 ecms-cluster）——抽取管线 module_system_map 按此把模块挂到架构 System 节点；全局唯一",
  COL_SYSTEM: "system 系统节点",
  SYSTEM_PLACEHOLDER: "例如 observability",
  COL_SUBDOMAIN_TITLE: "模块挂靠的子域——从「知识域/子域」页签的子域词表选取；抽取管线晋升规则按此挂靠（值=子域 id）",
  COL_SUBDOMAIN: "子域挂靠",
  SUBDOMAIN_PICK_TITLE: "选择挂靠子域（知识域/子域 词表）",
  SUBDOMAIN_FILTER_PLACEHOLDER: "筛选子域",
  DELETE_ARIA_PREFIX: "删除产品模块",
  DELETE_TITLE: "删除产品模块",
  SECTION_ARIA: "产品模块注册表",
  HEADER: "产品模块",
  INTRO: "文章 module 字段的取值词条＋挂靠信息：子域从词表选取；system 填主系统节点（kebab）；版本区间用产品版本号。列头悬停有说明。",
  PRODUCTS_EMPTY_PREFIX: "产品注册表为空（保留态：条目待多主体机制就位后按主体重新注册）——适用产品需先注册：",
  GO_VERSIONS_LINK: "去「产品版本」页签注册",
  GO_VERSIONS_FALLBACK: "请在「产品版本」页签注册",
  VERSIONS_LOADING: "产品注册表加载中…",
  FIELD_GOVERNANCE_NOTE: "字段治理口径（单源=对象字典；WP-040 裁⑤削减后）：名称／system／subdomain 必填，适用产品选填——父模块与版本区间退役（零消费方/仅软过滤，schema 字段保留兼容位）。",
  SUBDOMAIN_EMPTY_PREFIX: "子域词表为空——挂靠需先建子域：",
  GO_DOMAINS_LINK: "去「知识域/子域」页签创建",
  GO_DOMAINS_FALLBACK: "请在「知识域/子域」页签创建",
  COUNT_SUFFIX: " 个模块",
  TABLE_ARIA: "产品模块表",
  EMPTY: "暂无产品模块",
  PRODUCTS_ROW_TITLE: "模块适用的产品——从「产品版本」页签注册表选取（真源 versions.yaml products）",
  PRODUCTS_ROW_LABEL: "适用产品",
  PRODUCTS_PICK_TITLE: "选择适用产品（产品版本 注册表）",
  PRODUCTS_FILTER_PLACEHOLDER: "筛选产品",
  PRODUCTS_EMPTY_LABEL: "全部产品",
  GROUP_ACTIVE_PRODUCTS: "现役产品",
  FIELD_ISSUES_PREFIX: "",
  FIELD_ISSUES_OK: "字段完整",
  NEW_NAME_ARIA: "新增产品模块名称",
  ADD_ARIA: "添加产品模块",
  ADD_ACTION: "添加",
} as const;

// ── components/AssertionPolicyEditor（关系断言政策编辑器）──
export const POLICY_COPY = {
  SECTION_ARIA_SUFFIX: " 关系断言政策",
  HEADER: "关系断言政策",
  EMPTY_ALERT: "ERROR：缺失政策，Checks 将阻断",
  INCOMPLETE_ALERT_PREFIX: "ERROR：",
  INCOMPLETE_ALERT_SUFFIX: " 条政策不完整",
  ADD_ACTION: "新增政策",
  ITEM_PREFIX: "政策 ",
  DELETE_ARIA_PREFIX: "删除政策 ",
  LABEL_SOURCE_KIND: "事实来源",
  SOURCE_PICK_TITLE: "选择事实来源",
  SOURCE_FILTER_PLACEHOLDER: "筛选事实来源",
  LABEL_PRODUCER: "生产者",
  PRODUCER_PICK_TITLE: "选择生产者",
  PRODUCER_FILTER_PLACEHOLDER: "筛选生产者",
  LABEL_DECISION_MODE: "决策模式",
  DECISION_PICK_TITLE: "选择决策模式",
  LABEL_WORKING_PROJECTION: "工作投影",
  PROJECTION_PICK_TITLE: "选择工作投影",
  LABEL_REQUIRED_EVIDENCE: "必需证据",
  EVIDENCE_PLACEHOLDER: "输入证据键并回车",
  LABEL_FORMAL_CONSUMERS: "正式消费者",
  CONSUMERS_PLACEHOLDER: "输入消费者并回车",
  GROUP_SERVER_VALUES: "服务端可用值",
  /** 政策行 aria 前缀（「政策 N 事实来源」） */
  ITEM_ARIA: (ordinal: number, fieldLabel: string) => `政策 ${ordinal} ${fieldLabel}`,
} as const;

// ── LayerEditor（架构分层编辑器）──
export const LAYER_COPY = {
  COL_ID: "ID",
  COL_LABEL: "层名称",
  COL_COLOR: "颜色",
  COL_LAYOUT: "布局",
  /** 层缺省名（label/id 全空时 aria 用） */
  FALLBACK_LAYER_NAME: "层",
  COLOR_ARIA_SUFFIX: " 颜色",
  COLOR_PICK_TITLE: "选择分层颜色",
  COLOR_FILTER_PLACEHOLDER: "筛选颜色",
  GROUP_COLOR: "颜色",
  LAYOUT_ARIA_SUFFIX: " 布局",
  LAYOUT_PICK_TITLE: "选择分层布局",
  LAYOUT_FILTER_PLACEHOLDER: "筛选布局",
  GROUP_LAYOUT: "布局",
  DRAG_HANDLE_TITLE: "拖拽调整顺序",
  DELETE_ROW_ACTION: "删除层",
  ADD_LAYER: "添加层",
  TABLE_ARIA: "架构分层编辑表",
  DOMAIN_ARIA_SUFFIX: " 所属域",
  DOMAIN_PICK_TITLE: "选择所属域",
  DOMAIN_UNBOUND: "未绑定",
  GROUP_SCOPE: "范围",
  GROUP_DOMAIN: "知识域",
  LEGEND_ALLOWED_CATEGORIES: "允许实体类别",
  LEGEND_ALLOWED_DEPENDENCIES: "允许依赖的层",
  EMPTY: "暂无分层，点击「添加层」创建",
  /** 行号定位 aria（「第 N 层X」） */
  ROW_ARIA: (ordinal: number, fieldLabel: string) => `第 ${ordinal} 层${fieldLabel}`,
} as const;

// ── SchemaPartitionOverview（分区引用总览面板）──
/** 引用边的正向语义（与 dangling-kind-labels KIND_LABELS 的悬空语义成对，各一份不复用——一正一误两件事） */
export const PARTITION_KIND_TITLES: Record<string, string> = {
  "policy-domain": "策略矩阵 → 所属域",
  "policy-key": "策略键 → 所属域的子域",
  "module-subdomain": "产品模块 → 挂靠子域",
  "tag-alias": "标签别名 → 规范标签",
  "allows-relation": "本体节点 → 允许的关系类型",
  "relation-endpoint": "关系实例 → 端点类型",
};

export const PARTITION_COPY = {
  EDITABILITY_EDITABLE: "可编辑",
  EDITABILITY_ROLE_DENIED: "需 admin（当前角色无写权）",
  EDITABILITY_DERIVED_READONLY: "只读 · 派生",
  FORM_TABLE: "表格行内编辑",
  FORM_MASTER_DETAIL: "主从面板",
  FORM_CHIPS: "标签列表",
  FORM_CARDS: "候选卡流",
  SECTION_ARIA_PREFIX: "分区引用总览：",
  HEADER_PREFIX: "分区引用总览 · ",
  FORM_BADGE_PREFIX: "形态 · ",
  LIVE_STATS_NOTE: "此处实时统计当前配置；保存时由服务端统一校验（此处只展示，不拦截）",
  ONTOLOGY_BLIND: "本体数据未加载：允许的关系类型 / 关系端点两类引用未参与计算（未知 ≠ 零）。",
  OBJECTS_TITLE: "本页签治理对象（字典正名）",
  EMPTY_NO_EDGES: "本分区无跨文件引用边——引用关系集中在「分类与矩阵」「词表与标签」「类型系统」三个分区。",
  TOTAL_SUFFIX: " 条",
  DANGLING_PREFIX: "悬空 ",
  EXPAND_ALL_PREFIX: "展开全部 ",
  EXPAND_ALL_SUFFIX: " 条",
} as const;

// ── FieldGraphPanel（字段值域引用图谱只读面板）──
export const FIELD_GRAPH_COPY = {
  COL_NAME: "字段",
  COL_RECIPE: "值域来自（怎么算）",
  COL_VALUE_COUNT: "合法值",
  STALE_TITLE: "fields.yaml 配方与 resolved-domains.json 解析物不同步——重跑 npm run project:resolved-domains",
  STALE_LABEL: "⚠ 不同步",
  SEGMENT_FREE_SLUG: "自由段",
  SEGMENT_SCOPED_SUFFIX: "（随域收窄）",
  SEGMENT_VALUES_SUFFIX: " 值",
  COMPOSITE_TITLE: "复合分段结构",
  VALUE_FREE: "自由",
  SEGMENT_JOIN: " → ",
  COL_META: "别名/缺省",
  META_ALIAS: (count: number) => `${count} 别名`,
  META_DEFAULT_DIVIDER: "／",
  META_DEFAULT_PREFIX: "缺省 ",
  UNAVAILABLE: "图谱暂不可用",
  HEADER_LOADING_SUFFIX: "源→操作→值数",
  HEADER_COUNT_SUFFIX: " 字段",
  HEADER_PREFIX: "字段值域引用图谱（",
  HEADER_SUFFIX: "）",
  ERROR_PREFIX: "图谱暂不可用：",
  ERROR_SUFFIX: "——确认 API 在运行且 resolved-domains.json 已生成（npm run project:resolved-domains）",
  RETRY_ACTION: "重试",
  TABLE_ARIA: "字段值域引用图谱表",
  EMPTY: "图谱为空",
} as const;

// ── DomainSubdomainEditor（知识域／子域编辑器）──
export const DOMAIN_EDITOR_COPY = {
  SECTION_ARIA: "子域编辑区",
  RENAME_TITLE: "重命名",
  DELETE_DOMAIN_TITLE: "删除知识域",
  NEW_DOMAIN_ID_PLACEHOLDER: "ID (英文)",
  NEW_DOMAIN_LABEL_PLACEHOLDER: "标签 (中文)",
  ADD_DOMAIN: "添加知识域",
  CONFIRM_RENAME_TITLE: "确认重命名",
  CANCEL_RENAME_TITLE: "取消重命名",
  RENAME_CATEGORY_TITLE: "重命名分类",
  DELETE_CATEGORY_TITLE: "删除分类",
  SUBDOMAIN_HEADER: "子域 — ",
  SUBDOMAIN_ID_ARIA: "子域 ID",
  SUBDOMAIN_LABEL_ARIA: "子域标签（人读名，选填）",
  SUBDOMAIN_LABEL_PLACEHOLDER: "标签 (选填)",
  MISSING_LABEL_HINT: "（待补标签）",
  EDIT_TITLE: "编辑",
  POLICY_LEGEND: "允许使用的实体类别",
  POLICY_EMPTY_HINT: "请先配置实体类别",
  NEW_SUBDOMAIN_ID_PLACEHOLDER: "新子域 ID",
  ADD_ACTION: "添加",
  EMPTY_DOMAIN_HINT: "请先添加一个领域",
} as const;

// ── VocabularyProfileSection（词表画像区）──
// Seed/Growing/Verified/Blueprint/Grown 是产品词表生命周期阶段名（pending 裁决）——按原样入闭集，不改名。
export const VOCAB_PROFILE_COPY = {
  DIM_LAYER: "架构分层 Layers",
  DIM_CATEGORY: "类别 Categories",
  DIM_SUBDOMAIN: "子域 Subdomains",
  DIM_MODULE: "模块 Modules",
  DIM_TAG: "标签 Tags",
  STAGE_SEED: "Seed",
  STAGE_GROWING: "Growing",
  STAGE_VERIFIED: "Verified",
  ORIGIN_GROWN: "Grown",
  ORIGIN_BLUEPRINT: "Blueprint",
  /** origin 徽章悬停提示（来源血缘说明） */
  ORIGIN_GROWN_HINT: "生长词——经发现通道人工裁定晋升（有 lineage 血缘记录）",
  ORIGIN_BLUEPRINT_HINT: "蓝图词——单方声明尚无使用（或人工直接编辑词表，无通道血缘）",
  HEADER: "词表画像 · Reference Data Profiling",
  SUMMARY_TOTAL_PREFIX: "共 ",
  SUMMARY_TOTAL_MIDDLE: " 词 · 死词 ",
  SUMMARY_WILD_PREFIX: " · 野生值 ",
  SUMMARY_GROWN_PREFIX: "· 生长词 ",
  THRESHOLD_TITLE: "Verified 阈值：使用次数 ≥ N 判为 Verified（页面配置项，默认 1）",
  THRESHOLD_LABEL: "Verified 阈值",
  /** 阶段口径说明句（阈值内插——vocab-profile-section.test 断言） */
  STAGE_RULE_NOTE: (threshold: number) => `各词阶段按使用次数现算：≥${threshold} 次为 Verified，零使用为 Seed，其余为 Growing。`,
  DIM_UNLABELED_PREFIX: "· 缺语义 ",
  DIM_GROWN_PREFIX: "· Grown ",
  DIM_DEAD_PREFIX: "· 死词 ",
  /** 词条悬停提示拼接（零使用＝死词修剪面／有使用＝次数） */
  WORD_HINT_DEAD: "；零使用（死词）——候选修剪面",
  WORD_HINT_USAGE_PREFIX: "；使用 ",
  WORD_HINT_USAGE_SUFFIX: " 次",
} as const;

// ── SchemaManagerView（配置页宿主）──
export const VIEW_COPY = {
  PREVIEW_FAILED: "分类变更影响预览失败",
  DIM_SUBDOMAIN: "子域",
  DIM_LAYER: "架构分层",
  RENAME_IMPACT_NOT_APPLIED: "尚未生效：",
  RENAME_IMPACT_GUIDE_PREFIX: "点击“保存规则”后还需查看影响并确认。确认后仅保存规则，需要重跑时请到全局管线控制发起；重跑后，仍引用 ",
  RENAME_IMPACT_GUIDE_MIDDLE: " 的源文档才会进入待处理问题；将同步更新 ",
  RENAME_IMPACT_GUIDE_SUFFIX: " 个产品模块引用。",
  CATEGORIES_DERIVED_NOTE: "下方的类别名单＝声明宿主（矩阵勾选框的选项源，可编辑）；「架构分层」旁的实体类别表＝矩阵并集派生视图（只读跟随）。两类名单不要混同：先在此登记类别名，再到「知识域/子域」为各子域勾选允许类别。",
  CATEGORY_INPUT_PLACEHOLDER: "输入类别名称",
  PANEL_ARIA: "图谱规则配置面板",
  PAGE_DESCRIPTION: "维护图谱生成所依赖的规则与词表。",
  SAVING: "保存中...",
  PIPELINE_RUNNING: "管道运行中...",
  CHECKING_IMPACT: "检查影响...",
  /** 「保存规则」＝五义动作词（D-R9-6 pending）——本批只搬迁不改交互不改名 */
  SAVE_RULES_ACTION: "保存规则",
  SECTION_FALLBACK_PREFIX: "[schema-sections] 未注册的内容区：",
} as const;

// ── SchemaIntentNav（治理意图分区导航）──
export const INTENT_NAV_COPY = {
  NAV_ARIA: "治理意图分区导航",
  DANGLING_COUNT_TITLE: "悬空引用数量实时统计；保存时统一校验拦截",
} as const;

// ── SchemaDanglingNotice（悬空引用警示条）──
export const DANGLING_NOTICE_COPY = {
  BANNER: (count: number) => `配置悬空引用 ${count} 处（保存时统一校验）`,
} as const;

// ── ConceptVocabularyTab（概念词表页签）──
export const CONCEPT_TAB_COPY = {
  /** concept 域显示名缺省（domains 投影缺键时回落） */
  CONCEPT_DOMAIN_FALLBACK: "概念",
  SECTION_ARIA: "概念词表编辑区",
} as const;

// ── TagEditor（通用词条编辑器）──
export const TAG_EDITOR_COPY = {
  NAME_PLACEHOLDER_FALLBACK: "输入名称",
  ADD_ACTION: "添加",
} as const;

// ── SkeletonSidebar（分类结构专属目录侧栏）──
export const SKELETON_COPY = {
  NAV_ARIA: "分类结构专属目录",
  ADD_GROUP_TITLE: "新增分类",
  NEW_ID_PLACEHOLDER: "ID (英文)",
  NEW_LABEL_PLACEHOLDER: "标签 (中文)",
  ADD_DOMAIN_ACTION: "添加分类",
} as const;

// ── GraphFreshnessChip（图新鲜度状态提示）──
export const FRESHNESS_COPY = {
  FRESH_TITLE: "图谱与当前规则输入一致",
  UNKNOWN_TITLE: "从未增量抽取过（或对账不可达）——首次跑管道后可见",
  STALE_TITLE: "规则输入已变更，图尚未跟上——保存后数分钟内自动重抽，或到图谱管道手动运行",
  STALE_REFRESH_SUFFIX: " 自动刷新",
} as const;

// ── UsageBadgesStrip（维度使用概览条）──
export const USAGE_BADGES_COPY = {
  OVERVIEW_SUFFIX: " 使用概览",
  DEAD_WORDS_TITLE: "零使用词——候选修剪面",
  DEAD_WORDS_PREFIX: "死词 ",
  DATA_SOURCE_NOTE: "数据：discovery 词表画像（现算）",
} as const;

// ── TagGovernanceEditor（标签维护编辑器）──
export const TAG_GOV_COPY = {
  SECTION_ARIA: "标签维护",
  HEADER: "标签维护",
  INTRO: "正式标签按组维护；别名归并到规范标签，停用标签不会出现在笔记候选项中。",
  DELETE_EMPTY_GROUP_TITLE: "删除空分组",
  ALIAS_ARIA_SUFFIX: "别名",
  ALIAS_PLACEHOLDER: "别名，用逗号分隔",
  ENABLE_TITLE: "启用标签",
  DISABLE_TITLE: "停用标签",
  ENABLE_ACTION: "启用",
  DISABLE_ACTION: "停用",
  DELETE_TAG_TITLE: "删除标签",
  NEW_TAG_ARIA_SUFFIX: "新标签",
  ADD_TAG_ACTION: "添加标签",
  NEW_GROUP_ARIA: "新标签分组",
  NEW_GROUP_PLACEHOLDER: "新分组名称",
  ADD_GROUP_ACTION: "添加分组",
} as const;

// ── SchemaHistoryEditor（Schema 版本快照）──
export const HISTORY_COPY = {
  READ_FAILED: "读取失败",
  ROLLBACK_FAILED: "快照恢复失败",
  COL_TIME: "生成时间",
  COL_REVISION: "版本（sha256）",
  ROLLBACK_TITLE: "回滚到该快照",
  ROLLBACK_BUSY: "回滚中...",
  ROLLBACK_ACTION: "回滚",
  SECTION_ARIA: "Schema 版本快照",
  HEADER: "Schema 版本快照",
  INTRO: "历史版本来自 git 提交记录（SPEC-023：git 即账）——回滚＝写回该版本。",
  TABLE_ARIA: "Schema 版本快照表",
  EMPTY: "规则变更随 git 提交入历史（首个提交后可回滚）",
} as const;

// ── EntityGrowthCards（实体生长候选卡）──
export const GROWTH_CARDS_COPY = {
  CANDIDATES_HEADER: "实体候选 · 从文章提及生长",
  CANDIDATES_INTRO: "文章正文反复出现、尚无实体的名称——可建为实体，或挂到已有实体归并为别名。",
  MENTION_SUFFIX: " 次提及",
  LINK_TARGET_ARIA_SUFFIX: "挂载目标",
  LINK_TARGET_TITLE: "挂到已有实体的别名",
  ENTITY_FILTER_PLACEHOLDER: "筛选实体",
  LINK_EXISTING_OPTION: "挂到已有→选实体",
  GROUP_ADJUDICATION: "裁定",
  GROUP_EXISTING_ENTITIES: "已有实体",
  MERGE_TITLE_PREFIX: "归并为 ",
  MERGE_TITLE_SUFFIX: " 的别名",
  CREATE_NEW_TITLE: "建为新实体（自动记录来源文章）",
  SUBMITTING: "提交中...",
  LINK_EXISTING_ACTION: "挂到已有",
  CREATE_ACTION: "建实体",
  SOURCES_SUMMARY: "来源样例",
  ORPHANS_HEADER: "零提及实体 · 卫生信号",
  ORPHANS_INTRO: "以下实体在文章中零提及（观察信号，暂不提供修剪）。",
} as const;

// ── DocumentTaxonomyEditor（文章字段值域页签）──
export const DOC_TAX_COPY = {
  SECTION_ARTICLE_TYPES: "知识文章类型",
  ARTICLE_TYPES_HINT: "体裁（article_type）——读者拿这篇干什么：排错、升级复盘、可复制做法…（与板块轴 category-path、载体轴 doc-type 三轴分工，KNOWLEDGE_SCENARIOS §三轴）",
  SECTION_DOC_TYPES: "文档类型",
  DOC_TYPES_HINT: "载体（doc-type）——这篇在哪套出版物里出现：运维手册、技术文档…",
  PRIMARY_NAME_FALLBACK: "文章字段值域",
} as const;

// ── components/SubdomainChangePreviewDialog（子域改名影响预览弹窗）──
export const SUBDOMAIN_PREVIEW_COPY = {
  EMPTY_VALUES: "无",
  DIALOG_TITLE: "确认分类身份变更",
  INTRO: "子域值是实体引用的稳定分类身份。确认后仅保存规则，不会自动重跑管道；需要重跑时请到全局管线控制发起。源文档不会被自动改写。",
  CHANGES_TITLE: "规则修改",
  REMOVED_LABEL: "移除",
  MODULES_TITLE: "规则配置中的产品模块绑定 · ",
  UNSET_VALUE: "未设置",
  MODULES_EMPTY: "规则配置中没有产品模块引用旧值。",
  DOCUMENTS_TITLE: "源稿中直接填写旧子域的文档 · ",
  CURRENT_VALUE_PREFIX: " · 当前值 ",
  DOCUMENTS_EMPTY: "扫描范围内没有源文档引用旧值。",
  PIPELINE_NOTE: "管道重跑后，旧值引用会进入“待处理问题”，由用户逐项预览和确认写回。",
  SOURCE_LABEL: "规则来源：",
  REVISION_LABEL: "版本依据：",
  INVALID_DOCS_PREFIX: "另有 ",
  INVALID_DOCS_SUFFIX: " 篇文档无法解析，保存前应先处理扫描诊断。",
  CONFIRMING: "执行中...",
  CONFIRM_ACTION: "确认修改并保存",
} as const;

// ── components/DependencyImpactPreview（依赖规则影响预览卡）──
export const DEP_IMPACT_COPY = {
  SUMMARY_VERSIONS: "受影响版本",
  SUMMARY_RELATIONS_ADDED: "新增关系",
  SUMMARY_RELATIONS_REMOVED: "移除关系",
  SUMMARY_COMPONENTS: "涉及架构组件",
  SUMMARY_PATHS: "影响路径",
  SUMMARY_DOCUMENTS: "关联文章",
  SECTION_ARIA: "依赖规则影响预览",
  HEADER: "影响预览",
  INTRO: "仅计算草稿差异，尚未保存依赖规则。",
  CLOSE_ARIA: "关闭影响预览",
  EMPTY_NO_EFFECT: "草稿不会改变已登记产品版本的有效关系",
  RELATION_DELTA_PREFIX: "关系 +",
  RELATION_DELTA_MIDDLE: " / -",
  COMPONENTS_PREFIX: "架构组件 ",
  PATHS_PREFIX: "路径 ",
  DOCUMENTS_PREFIX: "文章 ",
} as const;

// ── components/RelationConstraintMatrix（关系类型约束图）──
export const REL_MATRIX_COPY = {
  UNNAMED_NODE_TYPE: "未命名节点类型",
  SECTION_ARIA: "关系类型约束图",
  HEADER: "关系类型约束图",
  INTRO: "只读呈现每类关系允许连接的节点类型，配置仍在下方关系类型中维护。",
  EMPTY: "尚未配置关系类型的源/目标节点类型",
  UNNAMED_RELATION: "未命名关系",
} as const;

// ── components/TaxonomyListEditor（词表清单编辑器，通用行组件）──
export const TAXONOMY_LIST_COPY = {
  DELETE_PREFIX: "删除",
  LIST_SUFFIX: "列表",
  TABLE_SUFFIX: "列表表",
  EMPTY_PREFIX: "暂无",
  ADD_PREFIX: "新增",
  ADD_ACTION_PREFIX: "添加",
  ADD_ACTION: "添加",
} as const;
