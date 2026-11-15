// dashboard 页级文案单源（WP-152 散写销账第四批·收官批）——ADR-019 §二 展示面介质唯一出口（页级 copy 模块）。
// 本特性（类别/关系类型/审核状态分布＋图谱规则使用情况＋最近管道生成结果＋独立发布卡＋api 层兜底；
// 2026-11-15 MAIC 形态批：规模主视觉统计卡整块退役，文案同批删）的用户可见文案只在本文件声明：
// 按消费组件分段导出 const 对象，插值句用函数（学 review-copy 先例）。
// 类别分布排除集的类别名是数据值，按名引用 lib/domain/EntityCategory，不住本文件。
// 禁在其他 dashboard 文件内联同值中文（lint CJK 字面量族执法，本文件经闭集豁免块豁免）；改文案只改这里。
// 闭集清单登记：eslint.config.js 尾部闭集豁免块＋src/test/copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES
// 投影＋SPEC-091 §2.1（ADR-019 §三.4 闭集仪式）。

import { TERM } from "@/constants/term-const";

// ── 分布区段（类别／关系类型／审核状态；2026-11-15 MAIC 形态批：审核状态三数汇总行撤，
// >0 时降级为一条可点链接——待办依附动作容器，零待办零渲染）──
export const DASHBOARD_SECTION_COPY = {
  CATEGORY_DISTRIBUTION: `${TERM.CATEGORY}分布`,
  CATEGORY_EMPTY: `暂无${TERM.CATEGORY}数据`,
  RELATION_TYPE_DISTRIBUTION: `${TERM.RELATION}类型分布`,
  RELATION_TYPE_EMPTY: `暂无${TERM.RELATION}类型数据`,
  /** 待审关系链接行（仅 pending>0 渲染，点击去关系评审页） */
  REVIEW_PENDING_LINK: `${TERM.RELATION}${TERM.PENDING_REVIEW}`,
  /** 图谱规则使用情况折叠区 */
  RULE_USAGE: "图谱规则使用情况",
  RELATION_TYPE_LABEL: `${TERM.RELATION}类型`,
} as const;

/** 规则使用计数「(已用/总数 已使用)」 */
export function dashboardUsage(used: number, total: number): string {
  return `(${used}/${total} 已使用)`;
}

// ── SyncLogSection（最近管道生成结果）──
export const DASHBOARD_SYNC_COPY = {
  SECTION_TITLE: "最近管道生成结果",
  LAST_GENERATED_PREFIX: "最近生成 · ",
  VERSION_PREFIX: "版本 ",
  FRESHNESS_WARNING_PREFIX: "数据新鲜度警告：",
  UPDATED_AT_UNKNOWN: "上次更新时间未知",
} as const;

export function dashboardStaleHours(hours: string): string {
  return `${hours} 小时未更新`;
}

// ── PublishCard（独立发布入口）──
export const DASHBOARD_PUBLISH_COPY = {
  DESCRIPTION: "发布当前全库定版（正式消费面读取的版本）",
  PUBLISHING: "发布中…",
  PUBLISH: "发布",
  /** PR-321/WP-178＋Master 2026-11-15「文案收敛」：两段式确认只留动作——发布→确认发布/取消，不配解说词 */
  CONFIRM_YES: "确认发布",
  CONFIRM_NO: "取消",
} as const;

export function dashboardRequestIncomplete(status: number): string {
  return `请求未完成（HTTP ${status}）`;
}
export function dashboardPublished(artifactCount: number): string {
  return `已发布新版本，共 ${artifactCount} 件产物`;
}

// ── dashboard-api（拓扑总览请求兜底）──
export function dashboardTopologyRequestFailed(status: number): string {
  return `总览请求失败（HTTP ${status}）`;
}
