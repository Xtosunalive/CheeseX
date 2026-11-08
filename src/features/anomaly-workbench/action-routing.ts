/**
 * 动作路由表 — issueKind × 处理方式 的全集登记（navigation 域子契约）
 *
 * 背景（2026-10-06 18:24 Master 报超集关系）：后端 AnomalyIssue.issueKind 共 13 种，
 * 原先 anomaly-action-registry 只显式处理 9 种，standardization_warning /
 * release_publication_failure 静默无动作——超集缺口只能靠人工梳理发现。
 *
 * 本表是三重对账的单源：
 *   ① 完备性：每种子项必须登记（处理 / 有意豁免[须注明理由] / 待定）——缺行即红
 *   ② 跳转合法性：handoff 目标必须走 navigate() 语义（route + 子路由 + 参数白名单）
 *   ③ 参数对账：每条参数名必须在消费端登记（get("参数名") 所在文件）——死参数即红
 *
 * 执法：scripts/quality/check-action-routing.mjs（对账后端枚举 + 跳转合法性 + 参数消费）
 */
import type { NavRoute } from "@/lib/navigation";
// 豁免/待定理由声明串收编闭集（WP-150）——机器审计面非展示文案；理由单源是零 import 叶子
// action-routing-reasons.ts（不落 copy 模块：本表初始化期即读值，落 copy 会成双向依赖 TDZ 红）。
import { ANOMALY_ROUTING_REASONS } from "./action-routing-reasons";

// ─── 处理方式登记（13 种 issueKind 全集） ───────────────────────────────────

export type HandlingKind = "in-page" | "handoff" | "note" | "exempt" | "pending";

export interface HandlingSpec {
  /** in-page：页面内修复动作（entity-repair 等）；handoff：跳转交接；exempt：有意豁免；pending：待 Master 裁决 */
  handling: HandlingKind;
  /** handoff 时的跳转（route 必须是 navigation.ts NAV_ROUTES 成员——门禁对账；参数白名单在此声明） */
  handoff?: {
    route: NavRoute;
    sub?: string;
    /** 参数白名单：key 为 query 参数名，value 为来源字段（issue.proposedAction.xxx） */
    query?: Record<string, string>;
  };
  /** in-page 时的动作类型（对应 AnomalyActionKind） */
  inPageAction?: string;
  /** exempt/pending 的理由（必填——「有意不处理」与「漏处理」必须可区分） */
  reason?: string;
  /** 附加条件（如 actionType 匹配）——无则无条件生效 */
  requireActionType?: string[];
}

/** 静态参数声明式写法（value 以 @ 前缀表常量）
 *  注意：必须在 ACTION_ROUTING 之前声明——登记表在模块初始化期即调用
 *  STATIC()（TDZ：后置声明会 ReferenceError，vitest 已实证过一次）。 */
export const STATIC = (value: string) => `@${value}`;

export const ACTION_ROUTING: Record<string, HandlingSpec> = {
  // ── 页面内修复类 ──
  missing_field: {
    handling: "in-page",
    inPageAction: "entity-repair",
    requireActionType: ["entity-repair"],
    // 带可选交接：源文档检查（sourceKey 存在时）
    handoff: { route: "entity-compliance", query: { sourceKey: "sourceKey" } },
  },
  missing_entity: {
    handling: "in-page",
    inPageAction: "entity-repair",
    requireActionType: ["entity-repair"],
    // 11:0x 裁决落地（考古收编）：原散装路由 anomalyActionTarget(copy.ts:186-190) 的
    // 「打开一键补齐」轨道收编进登记表——分派唯一性（一个动作一个出生地）。
    // create 为静态参数、title 消费端缺省「新实体」（View:64）；title 值源=payload
    // currentValue（collector :265 对 missing_entity 恒产出，与 expected 同值——散装
    // 代码的 || expected 兜底为冗余，收编时不保留）。
    handoff: {
      route: "entity-compliance",
      query: { sourceKey: "sourceKey", create: STATIC("1"), title: "currentValue" },
    },
  },
  version_scope: {
    handling: "in-page",
    inPageAction: "entity-repair",
    requireActionType: ["entity-repair"],
    handoff: { route: "entity-compliance", query: { sourceKey: "sourceKey" } },
  },
  unrecognized_entity: {
    handling: "in-page",
    inPageAction: "relation-repair",
    requireActionType: ["entity-relation-repair"],
  },
  // 11:0x 裁决落地（考古收编）：DerivedGraphRepairPanel 主按钮跳 #/publish 原为
  // copy.ts:199 手拼 hash 绕过登记表——收编。handling 由 in-page 改 handoff 对齐真实
  // 形态（P3-I「derived-graph-preview 不可达」随之消解——不再声明不可达的页内动作）。
  missing_lineage: {
    handling: "handoff",
    handoff: { route: "article-workflow" },
    reason: ANOMALY_ROUTING_REASONS.missing_lineage,
  },

  // ── 跳转交接类 ──
  article_association: {
    handling: "handoff",
    handoff: { route: "article-associations", query: { articleId: "articleId" } },
  },
  relation_conflict: {
    handling: "handoff",
    handoff: { route: "review", sub: "conflicts", query: { conflictId: "conflictId" } },
  },
  pipeline_failure: { handling: "handoff", handoff: { route: "property", sub: "checks" } },
  wild_tag: {
    handling: "handoff",
    // P0-A（2026-10-07 修复）：tab 值必须 STATIC("discovery")——裸字符串按契约=payload
    // 字段名，会被 buildHandoffHash 当 proposedAction["discovery"] 查找而静默丢弃
    // （修复前实跑 #/schema 无 ?tab=discovery；golden-hash 门禁为本类问题的常设防线）
    handoff: { route: "schema", query: { tab: STATIC("discovery") } },
    requireActionType: ["schema-tag-adjudicate"],
  },

  // ── 有意豁免（审计类，不可处理） ──
  stale_source: { handling: "exempt", reason: ANOMALY_ROUTING_REASONS.stale_source },

  // ── 无需处理（后端 handling=note：提示类，不阻断） ──
  // 2026-10-06 Master 裁决：anomaly-workbench-copy.ts:133 的权威说明「标准化校验发现需要
  // 需后续完善的内容；该提醒不阻断文章成为标准文章或进入检索阅读」，且 issueImpactText
  // 对本类返回 null（无影响）——它是提示不是待处理问题，故 note 而非 in-page，且不产生按钮。
  standardization_warning: {
    handling: "note",
    reason: ANOMALY_ROUTING_REASONS.standardization_warning,
  },

  // ── 页面内处理 · 持久 Issue 专用面板 ──
  // 2026-10-06 Master 裁决：AnomalyDecisionPanel.tsx:22-46 有专属 UI（标题「持久 Issue」+
  // 故障消息 + 关闭/重开两按钮 + 三态说明），不走标准处理流也不跳转。
  release_publication_failure: {
    handling: "in-page",
    reason: ANOMALY_ROUTING_REASONS.release_publication_failure,
  },
};

/**
 * 由登记表生成 handoff hash —— **纯函数**（不碰 window，registry 可在 node 环境测试）。
 * 调用方（UI 组件）拿到 hash 后走 safeNavigateHash() 执行跳转（navigation 域执法）。
 */
export function buildHandoffHash(
  spec: HandlingSpec,
  proposedAction: Record<string, unknown>,
): string | undefined {
  // 守卫只看 handoff 块是否存在（2026-10-07 修：原「handling!=="handoff" 即弃」过严——
  // in-page 类带可选交接（missing_field 源文档检查/missing_entity 一键补齐）是接口文档
  // 载明的合法形态，原守卫使这类 hash 恒 undefined，工具栏按钮点击不跳转——P0-A 同族
  // 潜伏 bug，vitest 适配时实证抓出）。
  if (!spec.handoff) return undefined;
  const qs = new URLSearchParams();
  for (const [param, raw] of Object.entries(spec.handoff.query ?? {})) {
    const value = raw.startsWith("@")
      ? raw.slice(1)                                   // STATIC 常量参数（tab=discovery）
      : proposedAction[raw];                           // 后端 payload 字段（sourceKey/articleId/conflictId）
    if (typeof value === "string" && value.trim()) qs.set(param, value);
  }
  const subPart = spec.handoff.sub ? `/${spec.handoff.sub}` : "";
  const qPart = qs.size > 0 ? `?${qs.toString()}` : "";
  return `#/${spec.handoff.route}${subPart}${qPart}`;
}
