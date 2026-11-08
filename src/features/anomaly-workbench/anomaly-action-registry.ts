/**
 * 待处理问题动作 Registry — 单一真相源
 *
 * 根据 issueKind、proposedAction.type 和状态推导可执行动作，
 * UI 组件通过此模块获取动作列表，不再各自维护映射逻辑。
 *
 * 2026-10-06 动作路由表子契约（Master 18:24 报超集关系、18:27 裁「要」）：
 * issueKind 全集（13 种）与处理方式的对应关系登记于 ./action-routing.ts，
 * 本文件的跳转 hash 生成改为引用登记表（不再手拼字符串）；
 * 完备性/参数对账由 scripts/quality/check-action-routing.mjs 机器执法。
 */
import type { AnomalyIssue } from "./anomaly-workbench-types";
import { ACTION_ROUTING, buildHandoffHash } from "./action-routing";
import { ANOMALY_ACTION_LABELS } from "./anomaly-workbench-copy";

// ─── 动作类型 ────────────────────────────────────────────────────────────────

export type AnomalyActionKind =
  | "entity-repair"
  | "relation-repair"
  | "handoff-article-mapping"
  | "handoff-source-check"
  | "handoff-component-check"
  | "handoff-relation-review"
  | "handoff-graph-publish"
  | "handoff-tag-adjudicate"
  | "handoff-pending-adjudication";

export type AnomalyActionScope = "in-page" | "handoff" | "source-channel";

export type ProjectedAction = {
  kind: AnomalyActionKind;
  scope: AnomalyActionScope;
  label: string;
  /** 跳转目标 hash（仅 handoff 类型） */
  hash?: string;
  /** 关联的 issueId 列表 */
  issueIds: string[];
};

// ─── 优先级排序（固定顺序） ──────────────────────────────────────────────────

export const ANOMALY_ACTION_PRIORITY: readonly AnomalyActionKind[] = [
  "entity-repair",
  "relation-repair",
  "handoff-article-mapping",
  "handoff-source-check",
  "handoff-component-check",
  "handoff-relation-review",
  "handoff-graph-publish",
  "handoff-tag-adjudicate",
  "handoff-pending-adjudication",
] as const;

// 动作正名文案住 copy 闭集（WP-150 收编）；Record 形态与键序保留（键=AnomalyActionKind 单源 union）
const ACTION_LABELS: Record<AnomalyActionKind, string> = ANOMALY_ACTION_LABELS;

const ACTION_SCOPES: Record<AnomalyActionKind, AnomalyActionScope> = {
  "entity-repair": "in-page",
  "relation-repair": "in-page",
  "handoff-article-mapping": "handoff",
  "handoff-source-check": "handoff",
  "handoff-component-check": "handoff",
  "handoff-relation-review": "handoff",
  "handoff-graph-publish": "handoff",
  "handoff-tag-adjudicate": "handoff",
  "handoff-pending-adjudication": "in-page",
};

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function actionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ─── 核心投影函数 ────────────────────────────────────────────────────────────

/**
 * 根据单条 issue 推导可执行动作列表。
 * stale_source 为历史审计状态，不产生任何可执行动作。
 */
export function projectActionsForIssue(issue: AnomalyIssue): ProjectedAction[] {
  // stale_source 仅审计，无可执行动作
  if (issue.issueKind === "stale_source") return [];

  const action = actionRecord(issue.proposedAction);
  const actionType = String(action.type || "");
  const actions: ProjectedAction[] = [];

  const push = (kind: AnomalyActionKind, hash?: string) => {
    actions.push({ kind, scope: ACTION_SCOPES[kind], label: ACTION_LABELS[kind], hash, issueIds: [issue.issueId] });
  };

  // 页面内动作推导（对应关系登记：./action-routing.ts ACTION_ROUTING）
  // 11:0x 案3b：missing_entity 改道「打开一键补齐」跳转（登记表 handoff）——页内
  // entity-repair 抽屉分支对它退役，收缩为字段族两类。
  if (["missing_field", "version_scope"].includes(issue.issueKind) && actionType === "entity-repair") {
    push("entity-repair");
    const sourceKey = typeof action.sourceKey === "string" ? action.sourceKey.trim() : "";
    if (sourceKey) push("handoff-source-check", buildHandoffHash(ACTION_ROUTING[issue.issueKind]!, { sourceKey }));
  } else if (issue.issueKind === "missing_entity") {
    const sourceKey = typeof action.sourceKey === "string" ? action.sourceKey.trim() : "";
    if (sourceKey) push("handoff-source-check", buildHandoffHash(ACTION_ROUTING.missing_entity, action));
  } else if (issue.issueKind === "unrecognized_entity" && actionType === "entity-relation-repair") {
    push("relation-repair");
  }

  // 专业页面交接推导（目标与参数经登记表——超集缺口由门禁看守）
  // 11:0x 案4 收编：图谱修复轨道（DerivedGraphRepairPanel 四步流）的主跳转
  // #/publish 由 copy.ts 手拼改经登记表；P3-I 不可达的 derived-graph-preview 退役。
  if (issue.issueKind === "article_association") {
    push("handoff-article-mapping", buildHandoffHash(ACTION_ROUTING.article_association, action));
  }
  if (issue.issueKind === "relation_conflict") {
    push("handoff-relation-review", buildHandoffHash(ACTION_ROUTING.relation_conflict, action));
  }
  if (issue.issueKind === "pipeline_failure") {
    push("handoff-component-check", buildHandoffHash(ACTION_ROUTING.pipeline_failure, action));
  }
  if (["missing_lineage"].includes(issue.issueKind)) {
    push("handoff-graph-publish", buildHandoffHash(ACTION_ROUTING[issue.issueKind]!, action));
  }
  // G1'（#1840）：野生标签 → 跳配置页「未收录值」裁定（升为正式/归为别名）
  // P0-A 修复连带：tab=discovery 已由登记表 STATIC 声明，调用方传真实 action 即可
  // （原 {tab: STATIC("discovery")} 是无效 workaround——buildHandoffHash 按 payload
  // 字段名 "discovery" 查找，假 payload 的 tab 键根本不会被读）
  if (issue.issueKind === "wild_tag" && actionType === "schema-tag-adjudicate") {
    push("handoff-tag-adjudicate", buildHandoffHash(ACTION_ROUTING.wild_tag, action));
  }

  // pending 登记（超集缺口的显性化）：待裁决的 kind 显示「待裁决」占位动作——
  // 不再静默无按钮（Master 18:24 发现的超集关系，先可见再裁决）
  const routing = ACTION_ROUTING[issue.issueKind];
  if (routing?.handling === "pending") {
    push("handoff-pending-adjudication");
  }

  return actions;
}

/**
 * 对一组 issue（通常属于同一篇文章）推导去重后的动作列表，
 * 结果按 ANOMALY_ACTION_PRIORITY 排序。
 */
export function projectActionsForIssues(issues: AnomalyIssue[]): ProjectedAction[] {
  const merged = new Map<AnomalyActionKind, ProjectedAction>();

  for (const issue of issues) {
    for (const projected of projectActionsForIssue(issue)) {
      const existing = merged.get(projected.kind);
      if (existing) {
        // 合并 issueIds，保留第一个 hash
        for (const id of projected.issueIds) {
          if (!existing.issueIds.includes(id)) existing.issueIds.push(id);
        }
        if (!existing.hash && projected.hash) existing.hash = projected.hash;
      } else {
        merged.set(projected.kind, { ...projected });
      }
    }
  }

  return [...merged.values()].sort(
    (a, b) => ANOMALY_ACTION_PRIORITY.indexOf(a.kind) - ANOMALY_ACTION_PRIORITY.indexOf(b.kind),
  );
}

// 选中键 → 议题列表（唯一定义，AnomalyActionToolbar 消费（AnomalyHandoffMenu 已随 WP-035 删除——注释同步））
export function selectIssuesForKeys(
  groups: Array<{ articleKey: string; issues: AnomalyIssue[] }>,
  selectedKeys: string[],
): AnomalyIssue[] {
  return groups.filter((g) => selectedKeys.includes(g.articleKey)).flatMap((g) => g.issues);
}
