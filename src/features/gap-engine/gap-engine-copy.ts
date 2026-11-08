// gap-engine 页级文案单源（WP-151 散写销账第三批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（GapEngineView 拓扑缺口检查页＋GovernanceTodoTab 缺口清单＋gap-types 缺口标签/引导表）
// 的用户可见文案只在本文件声明：按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 缺口标签/引导/快捷补充表随文案迁入本文件，gap-types.ts 原名再导出（EntityHubDrawer 等既有消费点零改动）；
// 本文件对 gap-types 只取类型（import type，编译期擦除，无运行时双向依赖）。
// 禁在其他 gap-engine 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；
// 改文案只改这里。闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts
// CLOSED_SET_FILES 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";
import type { GapType } from "./gap-types";

// ── gap-types 缺口标签/引导表（gap-types.ts 原名再导出）──
export const GAP_TYPE_LABEL: Record<GapType, string> = {
  dangling_dependency: "悬空依赖",
  isolated_entity: "孤立实体",
  low_confidence: "低置信关系",
  missing_document_ref: "缺少文档引用",
  cross_domain_ref: "跨域引用",
};

/** 缺口引导静态文案表（low_confidence 带阈值时由 gapLowConfidenceGuidance 出句，见 gap-types gapGuidance） */
export const GAP_GUIDANCE: Record<GapType, string> = {
  dangling_dependency:
    "关系引用的目标实体在知识库中不存在，图谱管道无法生成有效关系。请修正或删除源文档中的错误依赖声明后重新运行管道。",
  isolated_entity:
    "该实体在正式拓扑视图中没有任何关系。请检查源文档是否缺少依赖声明，或将其登记为允许独立存在的架构实体。",
  low_confidence:
    "该依赖关系置信度低于阈值。请人工复核该依赖是否真实存在。",
  cross_domain_ref:
    "目标实体是管道自动生成的子域实体，没有对应源文档。请将其改为分类归属关系，或调整子域实体生成规则后重新运行管道。",
  missing_document_ref:
    // seq211：这句让用户去改的是**文档正文**，权威叫法是「图谱引用文档」，不是「实体源文档」
    `该实体缺少 REFERENCES 文档引用关系。请在${TERM.GRAPH_SOURCE_DOCUMENT}正文中添加“文档::[[目标文档]]”，然后重新运行图谱管道。`,
};

/** low_confidence 带阈值引导句（阈值取后端下发的 gap.threshold，此处不得硬编码阈值） */
export function gapLowConfidenceGuidance(threshold: number): string {
  return `该依赖关系置信度低于 ${threshold}。请人工复核该依赖是否真实存在。`;
}

/** 缺口卡快捷补充语法提示 */
export const GAP_QUICK_ACTION: Partial<Record<GapType, { text: string; injectSyntax: string }>> = {
  missing_document_ref: {
    text: "补充文档引用语句",
    injectSyntax: "文档::[[相关架构设计书]]",
  },
};

/** 严重度分组标题文案（配色样式留在 gap-types GROUP_LABEL，本处只管文案） */
export const GAP_GROUP_COPY = {
  blocker: { title: "管道阻断问题", severityLabel: TERM.BLOCKER, subtitle: "会导致图谱管道失败或生成无效数据，必须先修复。" },
  warning: { title: "拓扑质量警告", severityLabel: TERM.WARNING, subtitle: "不阻断拓扑显示，但需要补充源文档、确认关系或调整规则。" },
} as const;

// ── GapEngineView（拓扑缺口检查页主视觉）──
export const GAP_ENGINE_VIEW_COPY = {
  UNRESOLVED_STAT_LABEL: "未解决拓扑缺口",
  UNRESOLVED_STAT_HINT: "已准入拓扑中尚未解决的缺口总数",
} as const;

// ── GovernanceTodoTab（缺口清单＋两步登记例外）──
export const GOVERNANCE_TODO_COPY = {
  EMPTY_TITLE: "暂无待处理数据质量问题",
  /** 缺口类型缺登记回落 */
  UNREGISTERED_GAP_TYPE: "未登记的缺口类型",
  QUICK_ACTION_PREFIX: "建议补充：",
  /** 两步登记例外面板 */
  EXEMPT_PANEL_TITLE: "登记为例外前，请先在 Obsidian 中记录依据",
  /** 说明段（JSX 原文跨行处折为一个空格——渲染结果逐字不变） */
  EXEMPT_INTRO_LEAD: "此操作表示你确认该缺口",
  EXEMPT_INTRO_NOT_DEFECT: "不是缺陷",
  EXEMPT_INTRO_MIDDLE: "，而是已知的合法架构决策。 为了保留",
  EXEMPT_INTRO_TRACEABLE: "可追溯依据",
  EXEMPT_INTRO_TAIL: "，请在 Obsidian 中完成以下操作后再点确认：",
  EXEMPT_STEP_OPEN: "① 打开源文件",
  EXEMPT_NO_SOURCE_FILE: "（此缺口无对应源文件）",
  EXEMPT_STEP_DECLARE: "② 在文档元数据中添加豁免声明",
  /** YAML 元数据区说明（夹 <code> 片段，首尾空格保留） */
  EXEMPT_YAML_LEAD: "加在文档顶部的 YAML 元数据区（",
  EXEMPT_YAML_BETWEEN: " 之间）。",
  EXEMPT_EXISTING_LEAD: "如果已有 ",
  EXEMPT_EXISTING_APPEND: " 字段，追加值即可：",
  EXEMPT_STEP_SAVE: "③ 保存文件后回来点确认",
  EXEMPT_CONFIRM_ACTION: "已记录依据，登记为例外",
  /** 卡片操作条 */
  PROCESSING: "处理中...",
  FIX_IN_OBSIDIAN: "在 Obsidian 中修复",
  EXEMPT_ACTION: "登记为例外",
  IGNORE_ACTION: "忽略并不再提示",
} as const;

/** 清单为空时的说明句 */
export function governanceTodoEmptyDescription(): string {
  return `当前已准入${TERM.ENTITY}与${TERM.RELATION}未发现${TERM.BLOCKER}或${TERM.WARNING}。`;
}

/** 空态下的豁免计数句 */
export function governanceTodoExemptedShort(count: number): string {
  return `${count} 项已按文档豁免规则豁免（规则写在源文档的 exempt_rules 字段）`;
}

/** 清单上方的豁免计数句 */
export function governanceTodoExemptedNotice(count: number): string {
  return `${count} 项已按文档豁免规则豁免，不在下方清单（规则写在源文档的 exempt_rules 字段，删掉规则即恢复提示）`;
}
