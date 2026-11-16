// workbench-copy.ts — 工作台页级文案单源（2026-11-17 第 2 批；ADR-019 §二 介质唯一出口）
import { TERM } from "@/constants/term-const";

export const WORKBENCH_VIEW_COPY = {
  PAGE_DESC: "跨域待办一屏聚合：先处理影响面最大的",
  STAT_PENDING_REVIEW: `待审核${TERM.RELATION}`,
  STAT_PENDING_REVIEW_HINT: "管道产出、等待裁决的关系数（详见关系审核）",
  STAT_GAPS: "待处理拓扑缺口",
  STAT_GAPS_HINT: `数据质量缺口数（详见${TERM.TOPOLOGY_GAP_REVIEW}）`,
  STAT_ANOMALIES: TERM.PENDING_ISSUES,
  STAT_ANOMALIES_HINT: "待处理问题数（详见待处理问题工作台）",
  STAT_MANIFEST: `${TERM.ARTICLE_GRAPH_MAPPING}待处理`,
  STAT_MANIFEST_HINT: `${TERM.ARTICLE_GRAPH_MAPPING}过期与未生成合计（详见${TERM.ARTICLE_AND_COMPONENTS}·人工映射校正）`,
} as const;
