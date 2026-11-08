import type { AnomalyIssue, AnomalyStatus } from "./anomaly-workbench-types";
import { isAnomalyPending } from "./anomaly-workbench-types";
import { TERM } from "@/constants/term-const";
import { ACTION_ROUTING, buildHandoffHash } from "./action-routing";
import type { AnomalyActionKind } from "./anomaly-action-registry";
// seq209：字段中文名从 shared/field-labels.mjs 派生（异常工作台是实体修复主链路，
// entity 域优先、article 域兜底——同一条修复链路会同时出现实体字段与文章字段）。
import { fieldLabel as sharedFieldLabel } from "../../../shared/field-labels.mjs";

/** issueKind 正名（单源导出——规则通道信号卡等跨面消费，禁各处另抄） */
export const ISSUE_KIND_LABELS: Record<AnomalyIssue["issueKind"], string> = {
  missing_field: "字段缺失",
  unrecognized_entity: "未识别实体",
  relation_conflict: "关系冲突",
  article_association: "文章图谱映射",
  version_scope: "版本超范围",
  stale_source: "来源已过期",
  missing_entity: "实体缺失",
  missing_lineage: "关系血缘缺失",
  pipeline_failure: "管道失败",
  standardization_warning: "标准化警告",
  release_publication_failure: "Release 激活失败",
  wild_tag: "野生标签待裁定",
};

/** 处置模式短标签（枚举单源：AnomalyIssue["handling"]，来自生成类型；此处只做转译，不复制枚举定义） */
export const HANDLING_LABELS: Record<AnomalyIssue["handling"], string> = {
  fix: "需处理",
  adjudicate: "需评审",
  operate: "可重试",
  note: "无需处理",
};

/**
 * 处置模式分组页签提示句（Linear 壳 task/anomaly-workbench-linear-shell）——句子级文案
 * 但归 copy 单源（词族守卫：组件层禁止内联）。序=operate 置顶（照原型）。
 */
export const HANDLING_GROUP_HINTS: Record<AnomalyIssue["handling"], string> = {
  operate: "系统事件 · 置顶",
  fix: "现场修复 · 同源可批量",
  adjudicate: "裁决/映射 · 专业页完成",
  note: "非阻断 · 随处理自动销账",
};

/** 视图页签标签（确认 3 口径：已处理=verified+closed，后端无 rejected）——WP-145 自造词统一（销账→处理），迁入页级闭集 */
export const VIEW_TAB_LABELS = { pending: "待处理", settled: "已处理", all: "全部问题" } as const;

/** 分组维度三选（整改 2 原型 Display 菜单）——WP-145 控件名中文化（Filter/Display/Grouping→中文），迁入页级闭集 */
export const GROUPING_LABELS = { mode: "处置模式（默认）", source: "来源文章 / 分桶", kind: "问题类型" } as const;

/** 跳转收纳触发钮文案（WP-146 件3：动作条主次分级——跳转类次操作收进「前往处理」下拉） */
export const ACTION_TOOLBAR_JUMP_TRIGGER_LABEL = "前往处理";

/** 跳转收纳触发钮无障碍名（含收纳数，读屏可感知这是菜单入口而非直点动作） */
export function actionToolbarJumpTriggerAriaLabel(count: number): string {
  return `${ACTION_TOOLBAR_JUMP_TRIGGER_LABEL}（${count} 项跳转）`;
}

/** 闸点提示涉及的动作名（AnomalyGateNotice 消费） */
export type AnomalyGateAction = "publish_graph" | "complete_global_diagnostic";
export const ANOMALY_GATE_ACTION_LABELS: Record<AnomalyGateAction, string> = {
  publish_graph: "合并并激活 Release",
  complete_global_diagnostic: "完成全局管道诊断",
};
/** 闸点提示句（WP-145 B7 双重否定改人话——单句陈述：议题数＋不拦截本次操作） */
export function gateNoticeText(blockedCount: number, action: AnomalyGateAction): string {
  return `另有 ${blockedCount} 条未处理议题与${ANOMALY_GATE_ACTION_LABELS[action]}相关，不拦截本次操作`;
}

const STATUS_LABELS: Record<AnomalyStatus, string> = {
  open: "待办",
  previewed: "预览待确认",
  confirmed: "已确认，待全局诊断",
  rerunning: "管道重跑中",
  executed: "已重跑管道，待复核",
  verified: "已复核",
  stale: "来源已变化",
  blocked: "处理已阻断",
  closed: "已关闭",
  reopened: "已重开",
};

const RULE_LABELS: Record<string, string> = {
  F01: "标题完整性检查",
  F02: "架构组件身份检查",
  F03: "架构组件标记检查",
  F04: "架构分层检查",
  F05: "实体类别检查",
  F06: "架构组件子域检查",
  F07: "架构组件有效期检查",
  F08: "架构组件截止版本检查",
  F10: "版本属性覆盖检查",
  F11: "产品模块检查",
  F12: "创建日期检查",
  F13: "更新时间检查",
  F14: "复查周期检查",
  F15: "状态检查",
  F16: "标签检查",
  B02: "关系目标识别检查",
};

export function issueImpactText(issue: Pick<AnomalyIssue, "issueKind">): string | null {
  const graphQualityKinds = new Set(["relation_conflict", "unrecognized_entity", "missing_entity", "missing_lineage", "article_association"]);
  if (issue.issueKind === "standardization_warning") return null;
  if (issue.issueKind === "pipeline_failure") return "影响：派生数据停留在上一成功状态，重跑管道可刷新。";
  if (issue.issueKind === "release_publication_failure") return "影响：系统继续服务上一合法 Release。";
  if (graphQualityKinds.has(issue.issueKind)) return "影响：其中的阻断项会拦住对应操作（如发布）；未处理时可能随版本进入正式消费。";
  return "影响：此问题解决前，文章无法进入正式版本。";
}

export function issueKindLabel(issueKind: AnomalyIssue["issueKind"]): string {
  return ISSUE_KIND_LABELS[issueKind] || "知识质量问题";
}

/**
 * 组内各议题 handling 计数去重 → 徽章文案串（如 "需处理 ×2"、"参考信息 ×1"），按枚举声明序稳定输出。
 * 旧数据缺 handling 时不产出徽章（不臆造处置模式）。
 */
export function handlingBadgeTexts(issues: AnomalyIssue[]): string[] {
  const counts = new Map<AnomalyIssue["handling"], number>();
  for (const issue of issues) {
    const handling = issue.handling as AnomalyIssue["handling"] | undefined;
    if (!handling || !(handling in HANDLING_LABELS)) continue;
    counts.set(handling, (counts.get(handling) || 0) + 1);
  }
  return (Object.keys(HANDLING_LABELS) as AnomalyIssue["handling"][])
    .filter((handling) => counts.has(handling))
    .map((handling) => `${HANDLING_LABELS[handling]} ×${counts.get(handling) || 0}`);
}

export function displayTitle(issue: AnomalyIssue): string {
  const action = record(issue.proposedAction);
  if (typeof action.field === "string" && action.field.trim()) return `补充${fieldLabel(action.field)}`;
  return issue.title
    .replace(/arch_subdomain/g, sharedFieldLabel("arch_subdomain"))
    .replace(/arch_since/g, sharedFieldLabel("arch_since"))
    .replace(/arch_until/g, sharedFieldLabel("arch_until"));
}

export function statusLabel(status: AnomalyStatus): string {
  return STATUS_LABELS[status] || "待办";
}

/** 议题状态语义色（PR-130 复查补漏：与 STATUS_LABELS 同源同文件——tone 单源随 label，
 *  值域=AnomalyStatus 十态；「表间观感一致性批 2026-10-16」的 tone 语义原样迁入，
 *  Form 内私设 ISSUE_STATUS_TONE 已删，同机两份并一）。 */
export type AnomalyStatusTone = "fact" | "warn" | "error" | "loading" | "neutral";

const STATUS_TONE: Record<AnomalyStatus, AnomalyStatusTone> = {
  open: "warn", previewed: "warn", confirmed: "warn", executed: "warn", reopened: "warn",
  rerunning: "loading", verified: "fact", closed: "fact", blocked: "error", stale: "neutral",
};

export function statusTone(status: AnomalyStatus): AnomalyStatusTone {
  return STATUS_TONE[status] ?? "neutral";
}

export function fieldLabel(field: unknown): string {
  return typeof field === "string" && field.trim() ? sharedFieldLabel(field) : "相关属性";
}

export function ruleLabel(ruleId: unknown): string {
  return typeof ruleId === "string" && ruleId.trim() ? RULE_LABELS[ruleId] || "来源检查规则" : "来源检查规则";
}

export function issueExplanation(issueKind: AnomalyIssue["issueKind"]): string {
  const explanations: Record<AnomalyIssue["issueKind"], string> = {
    missing_field: "来源文档缺少生成架构图所需的结构化属性，系统无法安全补全。",
    unrecognized_entity: "来源文档中的实体或关系目标无法与现有身份目录对应，继续生成可能产生错误关联。",
    relation_conflict: "多条关系规则对同一结论给出不同结果，需要人工选择后才能继续。",
    article_association: "文章的自动图谱映射需要人工校正，避免文档与错误架构组件或版本建立关系。",
    version_scope: "组件、关系或文章的产品版本范围不完整或互相矛盾。",
    stale_source: "生成预览后来源内容发生变化，原决定不再能安全复用。",
    missing_entity: "文章声明的模块在知识图谱中缺少对应的知识实体节点，需先创建实体页再重新运行管道。",
    missing_lineage: "已确认的关系缺少原文坐标或完整派生输入链，不能作为可信分析和图谱发布依据。",
    pipeline_failure: "全局管道诊断未完成，系统已保留失败阶段和运行依据用于排查。",
    standardization_warning: "标准化校验发现需要后续完善的内容；该提醒不阻断文章成为标准文章或进入检索阅读。",
    release_publication_failure: "新版本发布失败（构建或校验未通过），系统继续使用上一正式版本，本问题保留待处理。",
    wild_tag: "文档或实体中出现了词表外的自由标签（既非正式标签也非别名），需在配置页「未收录值」裁定：升为正式标签或归为某正式标签的别名。",
  };
  return explanations[issueKind];
}

export function isDerivedGraphRepairIssue(issue: AnomalyIssue): boolean {
  const action = record(issue.proposedAction);
  return action.type === "derived-graph-repair" || ["missing_lineage"].includes(issue.issueKind);
}

export function evidencePath(issue: AnomalyIssue): string {
  const firstEvidence = record(issue.evidence[0]);
  const action = record(issue.proposedAction);
  const path = firstEvidence.path || firstEvidence.sourcePath || action.sourceKey;
  return typeof path === "string" && path.trim() ? path : "来源路径未提供";
}

export function evidencePathPresentation(path: string) {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized || normalized === "来源路径未提供") {
    return { displayName: "来源定位未提供", label: "定位未提供", openableInObsidian: false, description: "该问题没有提供可打开的来源路径。" };
  }
  if (normalized === ".ledger/master_graph.json" || normalized.startsWith(".ledger/")) {
    return { displayName: "图谱检查结果", label: "图谱检查对象", openableInObsidian: false, description: "这是系统诊断使用的图谱数据，不是待入图文章。" };
  }
  if (/\.md$/i.test(normalized)) {
    return { displayName: normalized, label: "来源文档", openableInObsidian: true, description: "在 Obsidian 中打开来源文档。" };
  }
  return { displayName: "系统检查结果", label: "系统检查对象", openableInObsidian: false, description: "这是系统检查使用的数据文件，不是可在 Obsidian 中处理的来源文档。" };
}

export function actionLabel(issue: AnomalyIssue): string {
  const action = record(issue.proposedAction);
  if (issue.issueKind === "pipeline_failure" && issue.title.includes("SA 零组件")) return "检查架构组件源";
  if (issue.issueKind === "stale_source") return "查看过期来源记录";
  if (action.type === "entity-repair") return `检查并补充${fieldLabel(action.field)}`;
  if (action.type === "entity-relation-repair") return "确认并修复正文关系";
  if (action.type === "article-association-reload") return "重新检查文章图谱映射";
  if (action.type === "inference-review") return "处理关系冲突";
  if (action.type === "derived-graph-repair") return "修复图谱来源";
  return `处理${issueKindLabel(issue.issueKind)}`;
}

export function anomalyActionTarget(issue: AnomalyIssue): { hash: string; label: string; description: string } | null {
  const action = record(issue.proposedAction);
  // A stale source is an audit condition, not an editable association. Sending it
  // to the mapping editor creates a dead-end loop when the old article is inactive.
  if (issue.issueKind === "stale_source") return null;
  if (issue.issueKind === "pipeline_failure" && issue.title.includes("SA 零组件")) {
    return { hash: "#/property/checks", label: "打开架构组件检查", description: "当前正式 Vault 没有可用架构组件。请在架构组件源中补充真实实体并重新生成架构数据。" };
  }
  // 11:0x 收编：跳转 hash 统一改由登记表（ACTION_ROUTING）生成——本函数只保留
  // 标签/描述的文案职责。散装手拼 hash（一键补齐/review/article-associations/publish）
  // 全部退役，分派唯一性：一个动作一个出生地。
  const routing = ACTION_ROUTING[issue.issueKind];
  const tableHash = routing ? buildHandoffHash(routing, action) : undefined;
  if (issue.issueKind === "missing_entity" && typeof action.sourceKey === "string") {
    if (!tableHash) return null;
    return { hash: tableHash, label: "打开一键补齐", description: "创建缺失实体模板并补齐必需字段。" };
  }
  if (["entity-repair", "entity-relation-repair"].includes(String(action.type))) {
    const sourceKey = typeof action.sourceKey === "string" ? action.sourceKey.trim() : "";
    if (!sourceKey) return null;
    // 登记表有声明的 kind（missing_field/version_scope）走表 hash；unrecognized_entity
    // 登记为纯 in-page 无 handoff——按钮为「附赠查看入口」，按 sourceKey 手拼（表无此
    // 声明，不能虚构分派），与登记表无冲突（kind 不在 ACTION_ROUTING.handoff 面）。
    const hash = tableHash ?? `#/entity-compliance?sourceKey=${encodeURIComponent(sourceKey)}`;
    return { hash, label: "打开源文档检查", description: "查看该文件的全部字段规则和来源状态。" };
  }
  if (action.type === "inference-review" && typeof action.conflictId === "string" && tableHash) return { hash: tableHash, label: "打开关系审核", description: "比较规则结论和完整证据。" };
  if (action.type === "article-association-reload" && typeof action.articleId === "string" && tableHash) return { hash: tableHash, label: "打开文章映射", description: "重新确认组件和版本关联。" };
  if (action.type === "derived-graph-repair") {
    return tableHash
      ? { hash: tableHash, label: `打开${TERM.GRAPH_PUBLISH}`, description: "在审批工作区修正 owner 来源（关系审核直接写回），管道重建后跟踪不可变 Release 的原子激活结果。" }
      : null;
  }
  // version_scope 与无 sourceKey/entityId 的 missing_entity 没有可定位到具体问题的目标页，
  // 不再提供会落到无对应问题总览页的跳转；问题证据与处理表单仍在本页可见可操作。
  return null;
}

export function anomalyOverviewTarget(issue: AnomalyIssue): { hash: string; label: string; description: string } | null {
  // 2026-10-07 退役（案3 连带·死代码清理）：property/checks?entityId 形态无生产消费方
  // （全维档案 #2 已记）——entityId=Document 节点 id，目标页不消费此定位（F 项核对结论）。
  // 保留函数壳（test 仍引用行为断言），行为退化为 anomalyActionTarget 直通。
  return anomalyActionTarget(issue);
}

export function expectedRevisionCount(issue: AnomalyIssue): number {
  return Object.keys(record(issue.expectedRevisions)).length;
}

// 值转记录（唯一定义，防两处漂移）
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// 值转展示标签（唯一定义，递归处理嵌套对象/数组）
export function valueLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return ANOMALY_VALUE_PLACEHOLDER_COPY.EMPTY;
  if (Array.isArray(value)) return value.length ? value.map(valueLabel).join("、") : ANOMALY_VALUE_PLACEHOLDER_COPY.EMPTY_LIST;
  if (typeof value === "object") return Object.values(record(value)).flatMap((item) => Array.isArray(item) ? item : [item]).map(valueLabel).join("、") || "无";
  return String(value);
}

// ═══════════ WP-150 散写销账增量（波 3 续批：组件/store/api/registry 剩余可见文案收编。
// 本文件已在闭集（波 3 在册），增量键免仪式；文案字节原样搬迁零改名。按消费组件分段。）

// ── api 层请求兜底错误（消费面：anomaly-workbench-api＋anomaly-workbench-store catch 兜底同键）──
export const ANOMALY_REQUEST_COPY = {
  /** GET /api/anomalies（store.load catch 兜底同键） */
  LIST_FETCH_FAILED: "获取待处理问题失败",
  /** POST /api/anomalies/reconcile */
  RECONCILE_FAILED: "reconcile 失败",
  /** POST /api/anomalies/:id/:operation（store.operate catch 兜底同键） */
  OPERATION_FAILED: "异常操作失败",
  /** store.reconcileAndLoad catch 兜底 */
  RECONCILE_RELOAD_FAILED: "重检失败",
  /** GET /api/articles/field-completion-options */
  ARTICLE_OPTIONS_FETCH_FAILED: "文章字段选项加载失败",
} as const;

// ── anomaly-workbench-store（错误态＋刷新摘要）──
export const ANOMALY_STORE_COPY = {
  /** handoff 定位失败（load 精确匹配落空） */
  HANDOFF_MISS_ERROR: "未找到与当前正式详情精确匹配的待处理问题。已停止自动选择，避免处理无关问题。",
} as const;

/** 关系目标变化摘要段（announce 面包屑前缀，三段拼「；」） */
export function anomalyTargetSummary(resolved: string[], added: string[], remaining: number): string {
  return [
    resolved.length ? `已识别 ${resolved.join("、")}` : "",
    added.length ? `新增未解析目标 ${added.join("、")}` : "",
    resolved.length || added.length ? `仍有 ${remaining} 个关系目标待处理` : "",
  ].filter(Boolean).join("；");
}

/** 刷新摘要句（三态：带目标摘要／带增减计数／无变化） */
export function anomalyRefreshSummary(targetSummary: string, added: number, removed: number, total: number): string {
  return targetSummary
    ? `列表已刷新：${targetSummary}；新增 ${added} 项问题，移除 ${removed} 项问题`
    : added || removed
      ? `列表已刷新：新增 ${added} 项，移除 ${removed} 项，当前 ${total} 项待处理`
      : `列表已刷新：问题数量无变化，当前 ${total} 项待处理`;
}

// ── anomaly-action-registry（批量操作条动作正名，键=AnomalyActionKind 单源 union）──
export const ANOMALY_ACTION_LABELS: Record<AnomalyActionKind, string> = {
  "entity-repair": "补齐字段",
  "relation-repair": "修复关系",
  "handoff-article-mapping": "转到文章映射修复",
  "handoff-source-check": "转到源文档检查",
  "handoff-component-check": "转到架构组件检查",
  "handoff-relation-review": "转到关系审核",
  "handoff-graph-publish": "转到审批与发布",
  "handoff-tag-adjudicate": "转到标签裁定",
  "handoff-pending-adjudication": "处理方式待定（已登记待裁决）",
};

// ── action-routing（豁免/待定理由声明串）──
// 机器审计面非展示文案，单源在 ./action-routing-reasons.ts（独立叶子闭集文件——
// ACTION_ROUTING 模块初始化期即读这些串，住本模块会成双向值依赖，vitest 实测 TDZ 红）。

// ── AnomalyWorkbenchView（三栏工作台）──
export const ANOMALY_VIEW_COPY = {
  /** 侧栏来源文章分区 */
  SOURCES_LABEL: "来源文章",
  SOURCES_EMPTY: "（无来源文章）",
  MAIN_LIST_ARIA: "问题列表",
  VIEW_TABS_ARIA: "问题视图",
  /** 来源过滤激活 chip（尾随「×」为清除手势的原文形态） */
  FILTERING_BY_SOURCE: "来源过滤中 ×",
  FILTER_LABEL: "筛选",
  GROUPING_MODE_LABEL: "处置模式",
  GROUPING_KIND_LABEL: "问题类型",
  CLEAR_ALL_FILTERS: "清除全部筛选",
  GROUPING_CHIP_LABEL: "分组",
  GROUPING_MENU_ARIA: "分组维度",
  /** peek 开关（Open details） */
  PEEK_OPEN_ARIA: "打开详情面板",
  PEEK_COLLAPSE_TITLE: "收起详情面板",
  PEEK_EXPAND_TITLE: "展开详情面板",
  /** 全局三态 */
  LOADING_TEXT: "正在加载待处理问题…",
} as const;

/** 来源文章计数（侧栏列头＋空态同键） */
export function anomalySourcesCountText(count: number): string {
  return `来源文章（${count}）`;
}

/** Filter 筹码激活计数尾巴 */
export function anomalyFilterCountSuffix(count: number): string {
  return ` · ${count}`;
}

// ── AnomalyPeekPanel（peek 侧栏）──
export const ANOMALY_PEEK_COPY = {
  /** 阻断动作中文名（与列表行 BlockIcon title 同口径；未登记枚举回退原文） */
  BLOCKED_ACTION_LABELS: { publish_graph: "发布", complete_global_diagnostic: "全局诊断" } as Record<string, string>,
  EMPTY_ARIA: "问题详情",
  HEADER_TITLE: "详情",
  EMPTY_GUIDE_PRIMARY: "选择一条问题开始处理",
  EMPTY_GUIDE_INTERACTION: "点击行选中 · 双击直接打开 · Esc 关闭",
  DECISION_TITLE: "处理决定",
  PREVIEW_FRESH_HINT: "预览已生成；确认始终使用最新一版预览。",
  /** 采信依据折叠卡 */
  BASIS_COLLAPSED_HINT: "默认收起，裁决前可展开核对",
  TRIPLE_TARGET_UNKNOWN: "目标端点未识别——需裁决是否采信",
  /** 校验信息二级折叠 */
  HASH_SECTION_TITLE: "校验信息（候选/证据集/来源集哈希与内部键）",
  HASH_LABEL_GROUP: "冲突组",
  HASH_LABEL_CANDIDATE_ID: "候选身份",
  HASH_LABEL_CANDIDATE_HASH: "候选哈希",
  HASH_LABEL_EVIDENCE_SET: "证据集哈希",
  HASH_LABEL_SOURCE_SET: "来源集哈希",
  /** 属性栅格（三字段） */
  PROP_BLOCKED: "阻断",
  PROP_OWNER: "处理人",
  PROP_DETECTED: "检出",
  PROP_VALUE_NONE: "无",
  PROP_VALUE_UNASSIGNED: "未分配",
  /** footer 动作区 */
  REOPEN_ACTION: "重开",
  CLOSE_EXPLICIT_ACTION: "显式关闭",
  CONFIRM_ACTION: "确认这次处理",
  CONFIRM_READY_TITLE: "确认当前预览的处理",
  CONFIRM_BLOCKED_TITLE: "选值并生成预览后可确认",
  REJECT_CANDIDATE_ACTION: "驳回候选",
  HANDOFF_HINT: "跳转动作在勾选后的底部操作条",
  CLOSE_HEADER_ARIA: "关闭详情",
} as const;

/** 问题三元组方向正名 */
export const ANOMALY_DIRECTION_LABELS: Record<string, string> = { outgoing: "正向", incoming: "反向", bidirectional: "双向" };

/** peek 面板 aria 名（有选中条目带账本号/issueId，空态不带） */
export function peekPanelAriaLabel(issueId?: string): string {
  return issueId ? `${ANOMALY_PEEK_COPY.EMPTY_ARIA} ${issueId}` : ANOMALY_PEEK_COPY.EMPTY_ARIA;
}

/** 图谱修复派生提示（TERM.GRAPH_PUBLISH 插值） */
export function peekDerivedRepairHint(): string {
  return `图谱修复走「打开${TERM.GRAPH_PUBLISH}」四步流（勾选后操作条）。`;
}

/** 采信依据折叠卡摘要（候选版本数插值） */
export function peekBasisSummaryText(versionCount: number): string {
  return `采信依据（${versionCount} 个候选版本）`;
}

/** 候选证据版本行标 */
export function peekCandidateVersionLabel(index: number, total: number): string {
  return `候选证据版本 ${index + 1} / ${total}`;
}

/** 端点已识别句（方向正名插值） */
export function peekEndpointResolvedText(direction: string): string {
  return `端点已识别（${ANOMALY_DIRECTION_LABELS[direction] ?? direction}）`;
}

/** 来源坐标行 */
export function peekSourceCoordinateText(coordinate: string): string {
  return `来源坐标：${coordinate}`;
}

/** 候选已拒绝注记（附审计理由时带「：理由」尾巴） */
export function peekCandidateRejectedText(reason?: string): string {
  return `候选已拒绝${reason ? `：${reason}` : ""}`;
}

/** 内容哈希行标（截短 id 插值） */
export function peekContentHashLabel(shortId: string): string {
  return `内容哈希 ${shortId}`;
}

// ── AnomalyIssueList（Linear 行列表）──
export const ANOMALY_LIST_COPY = {
  BLOCK_PUBLISH_TITLE: "阻断：发布（publish_graph）",
  BLOCK_PUBLISH_SR: "阻断：发布",
  BLOCK_DIAGNOSTIC_TITLE: "阻断：全局诊断",
  BLOCK_DIAGNOSTIC_SR: "阻断：全局诊断",
  BLOCK_NONE_TITLE: "无阻断",
  BLOCK_NONE_SR: "无阻断",
  /** 勾选粒度=文章组（组页签） */
  GROUP_TABS_ARIA: "处置模式分组",
  GROUP_ALL_TAB: "全部",
  EMPTY_NO_MATCH: "没有匹配的问题",
  EMPTY_ADJUST_HINT: "调整筛选或切换分组页签",
} as const;

/** 行 aria 名（问题行 ANOM-N：标题） */
export function anomalyRowAriaLabel(issueId: string, title: string): string {
  return `问题行 ${issueId}：${title}`;
}

/** 行勾选框 aria 名 */
export function anomalyRowSelectAriaLabel(title: string): string {
  return `选择：${title}`;
}

/** 处理人缺登记回退（列表行头像＋peek 属性栅格同键） */
export const ANOMALY_OWNER_UNASSIGNED = "未分配";

// ── AnomalyIssueForm（待处理项表）──
export const ANOMALY_ISSUE_FORM_COPY = {
  COL_PATH: "问题来源",
  COL_PATH_ASC: "路径 A-Z",
  COL_PATH_DESC: "路径 Z-A",
  COL_FIELD: "待处理字段或关系",
  COL_FIELD_ASC: "字段 A-Z",
  COL_FIELD_DESC: "字段 Z-A",
  COL_KIND: "问题类型",
  COL_KIND_ASC: "类型 A-Z",
  COL_KIND_DESC: "类型 Z-A",
  COL_CURRENT: "当前值",
  COL_CURRENT_ASC: "当前值升序",
  COL_CURRENT_DESC: "当前值降序",
  COL_EXPECTED: "规则要求",
  COL_EXPECTED_ASC: "规则要求升序",
  COL_EXPECTED_DESC: "规则要求降序",
  // 「状态」＝shared/field-labels.mjs 实体域 status 字段中文名（seq209 L2 锁：禁手写字段名，经派生）
  COL_STATUS: sharedFieldLabel("status"),
  COL_STATUS_ASC: "状态升序",
  COL_STATUS_DESC: "状态降序",
  /** stale_source 行的来源列描述覆盖（仅历史审计，不能直接打开处理） */
  STALE_SOURCE_PATH_DESC: "来源内容已失效或已移动，仅保留历史审计记录，不能直接打开处理。",
  OBSIDIAN_OPEN_ARIA_PREFIX: "在 Obsidian 中打开来源文档：",
  OBSIDIAN_OPEN_TITLE: "打开来源文档，集中处理这篇文章的全部问题",
  PANEL_ARIA: "问题来源待处理项",
  HEADER_TITLE: "待处理项",
  HEADER_HELP_TITLE: "逐项确认缺什么、当前值是什么、需要补成什么。先选择待处理项，再在下方操作区填写决定并生成预览。",
  TABLE_ARIA: "待处理项表",
  EMPTY_NO_MATCH: "没有匹配的待处理项",
  SEARCH_ARIA: "搜索待处理项",
  SEARCH_PLACEHOLDER: "搜索字段、路径、问题类型或规则要求",
  FILTER_PATH_ARIA: "筛选待处理问题来源",
  FILTER_PATH_TITLE: "按问题来源筛选",
  FILTER_PATH_SEARCH: "筛选问题来源",
  FILTER_KIND_ARIA: "筛选待处理问题类型",
  FILTER_KIND_TITLE: "按问题类型筛选",
  FILTER_KIND_SEARCH: "筛选问题类型",
  FILTER_STATUS_ARIA: "筛选待处理状态",
  FILTER_STATUS_TITLE: "按处理状态筛选",
  FILTER_STATUS_SEARCH: "筛选处理状态",
  FILTER_STATUS_GROUP: "处理状态",
  FILTER_ALL_GROUP: "范围",
  CLEAR_ARIA: "清除待处理项筛选",
  PAGINATION_ARIA: "待处理项分页",
} as const;

/** 来源列问题计数尾巴 */
export function anomalyIssueCountText(count: number): string {
  return `${count} 项问题`;
}

/** meta 计数串（visibleCount / total 条待处理项） */
export function anomalyIssueFormMetaText(visible: number, total: number): string {
  return `${visible} / ${total} 条待处理项`;
}

// ── AnomalyEntityRepairDrawer（实体修复抽屉）──
export const ANOMALY_REPAIR_DRAWER_COPY = {
  /** 文章源路径前缀（服务端源 key 分类比对键——非展示文案，随搬迁入闭集，改值须两处同步） */
  ARTICLE_SOURCE_PREFIXES: ["知识库/raw/precleaned/", "知识库/raw/drafts/"],
  TITLE_CREATE_ENTITY: "创建并补齐实体",
  /** 枚举/合规加载失败兜底 */
  ARTICLE_OPTIONS_LOAD_FAILED: "无法加载文章字段选项",
  ENUMS_LOAD_FAILED: "无法加载 Schema 枚举",
  FIELD_REQUIRED_EMPTY: "必填字段不能为空",
  NO_CHANGES_ERROR: "请先修改至少一个字段",
  BATCH_PREVIEW_FAILED: "修复预览失败",
  BATCH_APPLY_FAILED: "修复写回失败",
  /** 字段卡片 */
  SYSTEM_MANAGED_HINT: "系统托管字段，值由服务端写入（状态迁移走审批通道）",
  TAG_CURRENT_ISSUE: "当前问题",
  TAG_SUPPLEMENTAL: "可补充",
  /** 分组标题 */
  GROUP_PENDING_ENTITY: "实体字段模板",
  GROUP_PENDING_FIELDS: "当前待处理字段",
  GROUP_SUPPLEMENTAL: "其他可补充字段",
  /** footer 动作 */
  PREVIEW_BUSY_ACTION: "生成中…",
  PREVIEW_ACTION: "查看修复结果",
  APPLY_ACTION: "应用修复",
  /** 三态提示 */
  COMPLIANCE_LOADING: "正在读取源文档当前字段…",
  COMPLIANCE_ERROR: "未能读取其他字段的当前值；当前待处理字段仍可修复，其他字段已停用以避免覆盖源文档。",
  ENUMS_LOADING: "正在加载 Schema 枚举，枚举字段暂不可填写…",
  ENUMS_RETRY_ACTION: "重新加载选项",
  /** 文章源标题改动警示 */
  ARTICLE_TITLE_WARNING: "改「标题」可能与文件名不一致；写入后需回文章准入重新标准化，正文请在 Obsidian 修改。",
  PREVIEW_SECTION_TITLE: "修复预览",
  /** 写门阻断明细 */
  BLOCKERS_TITLE: "保存被以下规则阻断（修改后重试即可）：",
  /** 写回后校验计数 */
  CONFIRMED_ARTICLE: "修复已写入候选文件（附自动备份）。请回到文章准入对该文章重新运行标准化校验，校验状态才会更新。",
  CONFIRMED_ENTITY: "修复已直接写回权威源（附自动备份），重跑管道后生效。",
} as const;

/** 抽屉标题（缺实体＝创建模板；字段族＝带待处理计数） */
export function repairDrawerTitle(isMissingEntity: boolean, pendingCount: number): string {
  return isMissingEntity ? ANOMALY_REPAIR_DRAWER_COPY.TITLE_CREATE_ENTITY : `补齐字段（${pendingCount} 个待处理）`;
}

/** Schema 枚举加载失败句（错误详情插值，缺省回退刷新提示） */
export function repairDrawerEnumsErrorText(error?: string | null): string {
  return `Schema 枚举加载失败：${error || "请刷新后重试"}。没有可用选项的枚举字段已停用，避免写入无效值。`;
}

/** 写回后校验计数句（阻断/警告插值） */
export function repairPostCheckSummaryText(blockerCount: number, warningCount: number): string {
  return `写回后 ${blockerCount} 个阻断问题 / ${warningCount} 个警告问题`;
}

/** 写门阻断条目行（字段标注＋规则消息插值） */
export function repairBlockerLineText(fieldPart: string, message: string): string {
  return `${fieldPart}：${message}`;
}

/** 值占位共用键（本模块 valueLabel 与抽屉 formatValue 同值单源） */
export const ANOMALY_VALUE_PLACEHOLDER_COPY = { EMPTY: "未填写", EMPTY_LIST: "空列表" } as const;

// ── AnomalyResolutionForm（五形态处理决定表单）──
export const ANOMALY_RESOLUTION_COPY = {
  RELOAD_PREVIEW_ACTION: "重新生成映射预览",
  UNGROUPED_LABEL: "未分组",
  /** 关联架构组件（N 已选 / M 个候选） */
  COMPONENT_SEARCH_ARIA: "搜索架构组件",
  COMPONENT_SEARCH_PLACEHOLDER: "搜索组件（id 或名称）",
  COMPONENT_GROUP_LEGEND: "架构组件域候选（分组）",
  VERSION_FIELDSET_LEGEND: "适用产品版本",
  ADD_PREVIEW_ACTION: "生成映射预览",
  /** 关系修复（旧链接重定向） */
  EMPTY_TYPE_TITLE: "当前问题不是无法解析的旧链接，而是尚未声明类型化架构关系。",
  EMPTY_TYPE_HINT: "请在来源文件中使用如 依赖::[[target]] 的类型化关系。",
  DECLARE_RELATION_ACTION: "在 Obsidian 中声明类型化关系",
  ORIGINAL_TARGET_LABEL: "需要修正的旧链接",
  ORIGINAL_TARGET_PLACEHOLDER: "请选择无法解析的目标",
  REPLACEMENT_LABEL: "替换为已有实体",
  REPLACEMENT_PLACEHOLDER: "请选择正确实体",
  REPLACEMENT_EMPTY: "没有可用的其他实体",
  ARTICLE_CANDIDATE_TITLE: "发现同名文章或文章候选，但它不是架构实体",
  ARTICLE_CANDIDATE_NOTE: "文章应在“文章与组件”中挂载，不能作为组件关系的替换目标。选择旧链接后，可预览并移除实体原文中的重复反向链接。",
  OTHER_CANDIDATE_TITLE: "发现已创建但尚未进入实体目录的页面",
  /** 受管目录回退（otherCandidates 引导句插值用） */
  GOVERNED_DIRECTORY_FALLBACK: "知识库/wiki/entities/",
  RETARGET_NOTE: "可将旧链接替换为已通过身份检查的实体，或从实体原文中移除错误关系行；普通正文引用不会被删除。",
  RETARGET_ACTION: "预览替换为实体",
  REMOVE_OLD_ACTION: "预览移除旧链接",
  CREATE_OR_FIX_ACTION: "在 Obsidian 中创建实体或修正链接",
  /** 冲突裁决 */
  CONCLUSION_LEGEND: "采用结论",
  CONCLUSION_FALLBACK: "采用此结论",
  REASON_LABEL: "决定原因",
  REASON_PLACEHOLDER: "说明为什么采用这个结论",
  ADJUDICATE_PREVIEW_ACTION: "生成裁决预览",
  /** 派生图修复 */
  DERIVED_REBUILD_TITLE: "确认后系统按当前事实源重建派生图。",
  DERIVED_REBUILD_NOTE: "请在审批工作区修正 owner 来源（关系审核直接写回）；管道重建与不可变 Release 原子激活使用同一条受控链路。",
  OPEN_ARTICLE_WORKBENCH_ACTION: "打开文章工作台（审批与发布）",
  /** blocked 态与兜底 */
  BLOCKED_NOTICE: "上一轮处理已停止。请调整值并重新生成预览，成功后可重新确认。",
  ENTITY_REPAIR_HINT: "勾选问题后，用右下角悬浮操作条的「补齐字段」即可就地创建并补齐该实体。",
  NO_ACTION_FALLBACK: "当前问题没有可执行的事实源处理动作。",
} as const;

/** 关系类型为空检测句（currentValue 前缀比对键＋展示句同段，改值须两处同步） */
export function resolutionEmptyTypeTitle(currentValue: unknown): string {
  return typeof currentValue === "string" && currentValue.startsWith("关系类型为空：") ? "检测到关系目标，但双冒号前缺少关系类型。" : ANOMALY_RESOLUTION_COPY.EMPTY_TYPE_TITLE;
}

/** 关联架构组件计数句 */
export function resolutionComponentCountText(selected: number, candidates: number): string {
  return `关联架构组件（${selected} 已选 / ${candidates} 个候选）`;
}

/** 未受管候选行（目标：来源路径） */
export function resolutionUnmanagedCandidateText(target: string, sourcePath: string): string {
  return `${target}：${sourcePath}`;
}

/** 未受管页面迁移引导句（受管目录插值） */
export function resolutionMovePageHint(directory: string): string {
  return `请将页面移动到 ${directory} 并补充实体身份字段。保存后运行完整图谱管道统一复核。`;
}

/** 文章候选来源正则（sourcePath 分类比对键——非展示文案，随搬迁入闭集，改值须两处同步） */
export const UNMANAGED_ARTICLE_CANDIDATE_PATTERN = /^\u77e5\u8bc6\u5e93\/(?:raw\/(?:drafts|precleaned)|wiki\/articles)\//;

// ── AnomalyActionPreview（处理预览卡）──
export const ANOMALY_ACTION_PREVIEW_COPY = {
  PANEL_ARIA: "处理预览",
  TITLE: "处理预览",
  DERIVED_HISTORY_NOTE: "此类修复现已改经关系审核完成，此预览仅作历史参考。",
  DEFAULT_NOTE: "预览确认后才会执行修复并重跑管道。",
  /** 校验依据/安全规则卡 */
  EVIDENCE_CARD_TITLE: "来源版本检查",
  SAFETY_CARD_TITLE: "安全规则",
  SAFETY_CARD_NOTE: "来源内容变化时自动停止处理",
  PREVIEW_READY_TITLE: "业务预览已生成",
  /** 派生图统计四格 */
  STAT_UNAPPROVED_ARTICLES: "未准入文章节点",
  STAT_RELATIONS: "关系",
  STAT_MISSING_LINEAGE: "谱系缺失关系",
  STAT_APPROVED_ARTICLES: "当前批准文章",
  REBUILD_SOURCES_TITLE: "需由抽取规则重建的关系来源",
  REBUILD_SOURCE_UNKNOWN: "未知规则",
  CHANGES_TITLE: "将写入以下修改",
  /** 正文链接修正 */
  BODY_PATCH_REMOVED: "删除正文链接",
  BODY_PATCH_FIXED: "正文链接修正",
  BODY_PATCH_WILL_REMOVE: "将删除",
  /** 决定/校验 */
  PRE_CHECK_TITLE: "写回前校验",
  EMPTY_HINT: "填写处理决定并生成预览后，这里会展示修改前后对比和写回校验结果。",
} as const;

/** 关系结论效果正名（effectLabel 前两值，余经 valueLabel） */
export function anomalyEffectLabel(value: unknown): string {
  if (value === "ASSERT") return "采用该关系结论";
  if (value === "BLOCK") return "阻止该关系结论";
  return valueLabel(value);
}

/** 校验依据计数句 */
export function actionPreviewEvidenceText(revisionCount: number): string {
  return `已记录 ${revisionCount} 项校验依据`;
}

/** 业务预览生成句（字段清单插值；无字段回退动作名句） */
export function actionPreviewWillUpdateText(fields: string[], actionName: string): string {
  return fields.length ? `将更新：${fields.join("、")}` : `已生成 ${actionName} 的业务预览`;
}

/** 重建关系来源计数 chip */
export function actionPreviewRelationSourceText(source: unknown, count: unknown): string {
  return `${String(source || ANOMALY_ACTION_PREVIEW_COPY.REBUILD_SOURCE_UNKNOWN)}：${Number(count || 0)}`;
}

/** 文章映射更新句（标题/新增/移除插值） */
export function actionPreviewArticleMappingText(articleTitle: string, added: string, removed: string): string {
  return `将更新文章映射：${articleTitle}；新增 ${added}，移除 ${removed}。`;
}

/** 决定原因行 */
export function actionPreviewDecisionReasonText(reason: string): string {
  return `决定原因：${reason}`;
}

/** 写回前校验计数句（前置校验存在时带「N → M」迁移形态） */
export function actionPreviewPrePostCheckText(preBlockers: number | null, postBlockers: number, preWarnings: number | null, postWarnings: number): string {
  const blockerPart = preBlockers !== null ? `${preBlockers} → ` : "";
  const warningPart = preWarnings !== null ? `${preWarnings} → ` : "";
  return `阻断问题 ${blockerPart}${postBlockers}；提醒 ${warningPart}${postWarnings}`;
}

// ── AnomalyActionToolbar（批量操作条）──
export const ANOMALY_TOOLBAR_COPY = {
  ARIA: "批量操作条",
  CLEAR_ACTION: "清除",
  SELECTED_SUFFIX: " 篇已选",
} as const;

// ── AnomalyGateNotice（闸点提示动作钮）──
export const ANOMALY_GATE_COPY = {
  VIEW_ACTION: "查看",
} as const;

// ── DerivedGraphRepairPanel（派生图修复四步流面板）──
export const ANOMALY_DERIVED_REPAIR_COPY = {
  TITLE: "派生图需要来源修复",
  NOTE: "请在待处理问题中修正 owner 来源（关系审核直接写回权威源），管道随后按权威源重建派生图，重建完成即生效。",
  STAT_UNAPPROVED_ARTICLES: "误入派生图的文章节点",
  STAT_MISSING_LINEAGE: "缺少可信来源链的关系",
  STAT_IMPACT: "当前影响",
  STAT_IMPACT_NOTE: "随版本进入正式消费（激活不检查）",
  STEPS_TITLE: "你需要完成的操作",
} as const;

/** 主按钮名（TERM.GRAPH_PUBLISH 插值——registry/anomalyActionTarget 同名句单源） */
export function derivedGraphPublishActionLabel(): string {
  return `打开${TERM.GRAPH_PUBLISH}`;
}

/** 四步流 ol aria 名（TERM.DERIVED_GRAPH_REPAIR_BATCH 插值） */
export function derivedRepairStepsAriaLabel(): string {
  return `${TERM.DERIVED_GRAPH_REPAIR_BATCH}流程`;
}

/** 四步流步骤（编号渲染时另拼） */
export const ANOMALY_DERIVED_REPAIR_STEPS: ReadonlyArray<{ title: string; description: string }> = [
  { title: "查看问题证据", description: "定位 owner 来源" },
  { title: "修正 owner 来源", description: "关系审核直接写回" },
  { title: "等待管道重建", description: "按权威源重建全部派生物" },
  { title: "发布新版本", description: "发布失败时沿用上一版本" },
];

// ── AnomalyEvidencePanel（来源证据卡）──
export const ANOMALY_EVIDENCE_COPY = {
  PANEL_ARIA: "来源证据",
  TITLE: "来源证据",
  /** Obsidian 打开源文档（EvidencePanel＋SourceTable 同句单源） */
  OBSIDIAN_OPEN_ARIA_PREFIX: "在 Obsidian 中打开来源文档：",
  OBSIDIAN_OPEN_TITLE: "在 Obsidian 中打开来源文档",
  AUDIT_DETAILS_TITLE: "审计详情",
} as const;

/** 过期原因行 */
export function evidenceStaleReasonText(reason: string): string {
  return `过期原因：${reason}`;
}

/** 执行失败行 */
export function evidenceExecutionErrorText(error: string): string {
  return `执行失败：${error}`;
}

/** 审计详情行标（行号／坐标） */
export function evidenceLineNumberText(lineNumber: number): string {
  return `第 ${lineNumber} 行`;
}
export function evidenceCoordinateText(coordinate: string): string {
  return `坐标：${coordinate}`;
}

// ── AnomalySourceTable（问题来源表，退役遗留件仍被测试与可能的回退面消费）──
export const ANOMALY_SOURCE_TABLE_COPY = {
  COL_SOURCE: "问题来源",
  COL_SOURCE_ASC: "来源 A-Z",
  COL_SOURCE_DESC: "来源 Z-A",
  COL_KIND: "问题类型",
  COL_KIND_ASC: "类型 A-Z",
  COL_KIND_DESC: "类型 Z-A",
  COL_STATUS: "处理状态",
  COL_STATUS_ASC: "状态 A-Z",
  COL_STATUS_DESC: "状态 Z-A",
  /** 来源列非文档回退名（系统诊断／文章） */
  FALLBACK_SYSTEM_DIAGNOSTIC: "系统诊断",
  FALLBACK_ARTICLE: "文章",
  HANDLING_BADGES_TITLE: "处理动作：",
  PANEL_ARIA: "问题来源待处理项",
  TABLE_ARIA: "问题来源表",
  EMPTY_NO_MATCH: "没有匹配的问题来源",
  SELECT_HEADER: "选择",
  SEARCH_SR: "搜索问题来源",
  SEARCH_PLACEHOLDER: "搜索路径或问题",
  FILTER_STATUS_ARIA: "筛选来源处理状态",
  FILTER_STATUS_TITLE: "来源处理状态",
  FILTER_ALL_SOURCES: "全部来源",
  STATUS_PENDING: "待处理",
  STATUS_BLOCKED: "已阻断",
  STATUS_DONE: "已完成",
  PAGINATION_ARIA: "问题来源分页",
} as const;

/** 组聚合状态正名（tone 比对与筛选选项同键——改值须与 aggregateStatus 判等两处同步；pending 判定沿用 isAnomalyPending 单源） */
export function sourceTableAggregateStatus(group: { issues: Array<{ status: AnomalyStatus }> }): string {
  if (group.issues.some((issue) => issue.status === "blocked")) return ANOMALY_SOURCE_TABLE_COPY.STATUS_BLOCKED;
  if (group.issues.some((issue) => isAnomalyPending(issue.status))) return ANOMALY_SOURCE_TABLE_COPY.STATUS_PENDING;
  return ANOMALY_SOURCE_TABLE_COPY.STATUS_DONE;
}

/** 行勾选 aria 名 */
export function sourceTableRowAriaLabel(displayName: string): string {
  return `选择文章：${displayName}`;
}

/** meta 计数串（visibleCount / total 条问题来源） */
export function sourceTableMetaText(visible: number, total: number): string {
  return `${visible} / ${total} 条问题来源`;
}

// ── RelationCandidateRejectForm（候选驳回理由表单）──
export const ANOMALY_REJECT_FORM_COPY = {
  ARIA: "架构师拒绝关系候选",
  NOTE: "仅架构师可以提交，身份由服务端操作者上下文校验。拒绝只写入 review_actions 审计与 reviewStatus，不写入正式关系或派生图。",
  REASON_ARIA: "拒绝原因",
  REASON_PLACEHOLDER: "拒绝原因（必填）",
  SUBMITTING_ACTION: "正在拒绝...",
  SUBMIT_ACTION: "提交拒绝",
} as const;
