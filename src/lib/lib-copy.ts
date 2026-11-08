// lib 层文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（闭集模块）。
// 收 src/lib/** 非闭集文件的用户可见文案与诊断串：api/store 层请求兜底、写门阻断中文化映射、
// 本体校验理由、导航守卫诊断、结构轴防区显示名、schema 配置页分区文案与页签正名镜像。
// 纪律：本文件零 feature 依赖（lib 是 feature 的下层——schema-edit「零 feature 依赖」纪律随之成立）；
// 插值句用函数（学 review-copy 先例）；禁在 lib 其他文件内联同值中文（lint CJK 字面量族执法，本文件经
// 闭集豁免块豁免）。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

// ── 请求兜底（api/store 层 error fallback：后端 env.error／message 优先，缺省才用本表）──
export const LIB_REQUEST_COPY = {
  /** entity-repair-api preview/apply 两通道（entity-compliance-store 同值复用——同一失败同一句） */
  REPAIR_PREVIEW_FAILED: "修复预览失败",
  REPAIR_APPLY_FAILED: "修复写回失败",
  /** graph-data：/api/kg/query 非成功信封 */
  GRAPH_DATA_LOAD_FAILED: "数据加载失败",
  /** obsidian：打开 Obsidian 失败（ObsidianLink toast 同值复用） */
  OBSIDIAN_OPEN_FAILED: "无法打开 Obsidian",
  /** pipeline-store：管道状态读取／启动／取消 */
  PIPELINE_STATUS_FAILED: "管道状态读取失败",
  PIPELINE_START_FAILED: "管道启动失败",
  PIPELINE_CANCEL_FAILED: "取消失败",
  /** topology-store：信封 success=false */
  TOPOLOGY_INVALID_RESPONSE: "API 返回 success=false",
} as const;

/** edge-api：非 2xx 且无 message 时的兜底 */
export function edgeApiRequestFailed(status: number): string {
  return `请求失败（${status}）`;
}
/** pipeline-api：非 2xx 且无 message/error 时的兜底 */
export function pipelineRequestFailed(status: number): string {
  return `管道请求失败（HTTP ${status}）`;
}

// ── entity-repair-api 写门阻断中文化（#1798：展示层投影——后端 ruleId/message 是机器契约不动；未知 ruleId 回退原文）──
// 映射按真实拦截频次维护（F02 中文 id / F16 tags 缺失 = 新建实体两大实录）。
// WP-113 M2 随迁：新建身份改由系统铸造——F02 说明不再引导人填号（人不填是现语义），
// 保留「必填」字样覆盖存量空号实体的补填语义（describeBlocker 用例锁此词）。
export const ENTITY_REPAIR_BLOCKER_MESSAGES: Record<string, string> = {
  F02: "架构组件身份（architecture-node-id）是必填字段——新建时由系统铸造（人不填写、自带值即被拒），全库唯一，创建后不可修改。",
  F16: "标签（tags）是必填字段，请至少填写一个标签（多个使用列表保存）。",
  F01: "实体名称（title）为必填字段。",
  F03: "该字段取值不在注册表允许范围内，请从下拉选项中选择。",
  // #1801 实录补全（tr_8ef76b6d）：用户选有效期起点≥终点踩中 F09——映射覆盖声明式引擎显式规则
  F09: "组件有效期起点必须早于或等于终点（组件可以只在单个版本有效），请调整版本下拉。",
  F10: "标签内容不合规（数组内部项校验），请检查标签取值。",
  F05b: "子域取值与所选分类不匹配，请按「架构分层 → 实体类别 → 子域」的层级重新选择。",
};

export const ENTITY_REPAIR_BLOCKER_COPY = {
  /** 阻断记录缺 message 时的占位 */
  REASON_MISSING: "不合规原因未提供",
} as const;

/** 中文映射＋原文并列（英文原文兜底，不吞信息） */
export function entityRepairBlockerWithRaw(zh: string, raw: string): string {
  return `${zh}（原始信息：${raw}）`;
}
/** #1801：newViolations 携带的当前值拼入 message */
export function entityRepairCurrentValue(value: string): string {
  return `（当前值：${value}）`;
}

// ── ontology：关系类型回落名＋本体校验理由（validateRelation 返回 reason，供待审核链路展示）──
export const ONTOLOGY_COPY = {
  /** relationTypeLabel 未登记类型回落（WP-032/PR-147 唯一回落口径——裸枚举不上屏） */
  UNREGISTERED_RELATION: "未登记关系",
  EXTERNAL_RELATION_REASON: "外部导入关系，需人工确认语义",
  MISSING_CATEGORY_REASON: "实体缺少类别，无法严格校验",
  GRAPH_DB_RELATION_REASON: "图数据库语义关系已保留；类别约束仅作提示，不降级为待审核",
} as const;

export function ontologyUnknownRelationReason(relationType: string): string {
  return `未知关系类型 "${relationType}"，不在本体定义中`;
}
export function ontologyDomainMismatch(category: string, relationType: string, domainJson: string): string {
  return `"${category}" 不在 ${relationType} 的 domain ${domainJson} 中`;
}
export function ontologyRangeMismatch(category: string, relationType: string, rangeJson: string): string {
  return `"${category}" 不在 ${relationType} 的 range ${rangeJson} 中`;
}
export function ontologyConstraintMismatch(problems: string): string {
  return `本体约束不匹配: ${problems}`;
}

// ── navigation 守卫诊断（console.error 不上屏——非法目标可判定可见，不静默回落）──
export const NAV_DIAG_COPY = {
  /** 登记形态缺席占位 */
  NONE: "无",
} as const;

export function navIllegalSubRoute(route: string, sub: string, allowed: string): string {
  return `[navigation] 非法子路由: ${route}/${sub}（登记形态: ${allowed}）`;
}
export function navIllegalTarget(hash: string): string {
  return `[navigation] 非法跳转目标: ${hash}（不在 NAV_ROUTES）`;
}
export function navIllegalHashSubRoute(hash: string, head: string, registered: string): string {
  return `[navigation] 非法子路由: ${hash}（${head} 登记: ${registered}）`;
}

// ── dashboard-containers：结构轴防区显示名（键＝container id；色值仍住色板唯一源 dashboard-containers.ts）──
export const BAND_DISPLAY_NAMES = {
  container_gateway: "网关层 (Gateway Band)",
  container_service: "服务层 (Service Band)",
  container_storage: "存储层 (Storage Band)",
  container_infra: "基础设施层 (Infrastructure Band)",
  container_security: "安全层 (Security Band)",
  container_unknown: "? 未注册防区 — 在 enums.yaml 补充 arch_layer",
} as const;

// ── schema-shape：配置页五分区标题与注记（SCHEMA_PARTITIONS 静态单源的文案半；键＝分区 id）──
export const SCHEMA_PARTITION_COPY = {
  classification: {
    title: "分类与矩阵",
    note: "域→子域→约束矩阵；分层、类别（派生只读）、文章字段值域",
  },
  vocabulary: {
    title: "词表与标签",
    note: "正式标签、别名归并与停用位；概念词表",
  },
  "type-system": {
    title: "类型系统",
    note: "节点/关系类型互查、依赖规则、字段字典",
  },
  ledger: {
    title: "账与版本",
    note: "关系实例账、产品身份与版本、产品模块、历史快照（WP-040 裁④：产品族配置同区）",
  },
  intake: {
    title: "未收录值",
    note: "四类值（layers/categories/subdomains/tags）待归类值裁定队列＋实体/矩阵/规则候选（实时计算）",
  },
} as const;

// ── schema-edit／schema-shape：页签字典正名镜像（R4 装配声明键 TAB_EDIT_META 的键面＋无对象页签回退名）──
// 正名单源＝contracts/object-dictionary.json（经 canonicalTabLabels 投影）；本表是装配声明的手抄键——
// 刻意保留为绊线：字典正名演化而此处未跟随即 schema-shape.test 键集全等断言红（漂移机器可见）。
export const SCHEMA_TAB_NAMES = {
  DOMAINS: "知识域/子域",
  LAYERS: "架构分层",
  CATEGORIES: "实体类别",
  TAXONOMY: "文章字段值域",
  MODULES: "产品模块",
  TAGS: "标签词表",
  CONCEPTS: "概念词表",
  ONTOLOGY: "知识本体",
  DEPENDENCIES: "依赖版本区间",
  VERSIONS: "产品版本",
  /** 版本快照＝git 账页（无字典对象，TAB_LABEL_FALLBACKS 声明回退名） */
  HISTORY: "版本快照",
  RELATIONS: "关系类型",
  FIELDS: "字段字典",
  DISCOVERY: "未收录值",
} as const;
