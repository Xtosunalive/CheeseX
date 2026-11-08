/**
 * 应用壳层共享导航类型 — NAV_GROUPS 配置的形状定义。
 *
 * 结构数据只定义在 App.tsx（单一来源）。应用栏、常驻左侧导航只消费该配置，
 * 禁止复制导航数组形成第二份配置。
 * （说明文案链 nav-copy.ts 已于 #1756 整链退役：零渲染端点 + 投影漂移，见 ADR053）
 */
import type React from "react";

/** 全部页面路由 ID —— 与历史 hash 路由保持向后兼容 */
export type NavId =
  | "dashboard"
  | "data-dashboard"
  | "entity-compliance"
  | "admission"
  | "impact-analysis"
  | "architecture-version"
  | "review"
  | "gaps"
  | "property"
  | "schema"
  | "article-associations"
  | "document-inventory"
  | "article-workflow"
  | "anomalies"
  /** DEV-only 主题预览（PR-025 阶段 4）：不进 NAV_GROUPS，仅 hash 直达 */
  | "theme";

export interface NavItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children?: { id: string; label: string }[];
}

export interface NavGroup {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  items: NavItem[];
}
