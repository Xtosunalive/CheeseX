import { describe, expect, it } from "vitest";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import {
  projectActionsForIssue,
  projectActionsForIssues,
  ANOMALY_ACTION_PRIORITY,
  type AnomalyActionKind,
} from "@/features/anomaly-workbench/anomaly-action-registry";

function makeIssue(overrides: Partial<AnomalyIssue> & { issueKind: AnomalyIssue["issueKind"] }): AnomalyIssue {
  return {
    issueId: `test-${Math.random().toString(36).slice(2)}`,
    title: "测试问题",
    status: "open",
    evidence: [],
    expectedRevisions: {},
    blockedActions: [],
    proposedAction: null,
    ...overrides,
  } as AnomalyIssue;
}

describe("anomaly-action-registry: projectActionsForIssue", () => {
  it("missing_field → 页面内 entity-repair", () => {
    const issue = makeIssue({ issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "arch_layer", sourceKey: "a.md" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("entity-repair");
    const repairAction = actions.find((a) => a.kind === "entity-repair");
    expect(repairAction?.scope).toBe("in-page");
  });

  it("missing_entity → 一键补齐交接（11:0x 案3 改道：页内 entity-repair 退役）", () => {
    const issue = makeIssue({ issueKind: "missing_entity", proposedAction: { type: "entity-repair", sourceKey: "b.md", currentValue: "模块X" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("handoff-source-check");
    expect(actions.map((a) => a.kind)).not.toContain("entity-repair");
    const handoff = actions.find((a) => a.kind === "handoff-source-check");
    expect(handoff?.hash).toContain("create=1");
    expect(handoff?.hash).toContain("title=");
    expect(handoff?.hash).toContain(encodeURIComponent("模块X"));
  });

  it("version_scope → 页面内 entity-repair", () => {
    const issue = makeIssue({ issueKind: "version_scope", proposedAction: { type: "entity-repair", field: "arch_version_overrides", sourceKey: "c.md" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("entity-repair");
  });

  it("unrecognized_entity → 页面内 relation-repair", () => {
    const issue = makeIssue({ issueKind: "unrecognized_entity", proposedAction: { type: "entity-relation-repair", sourceKey: "d.md" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("relation-repair");
    const relationAction = actions.find((a) => a.kind === "relation-repair");
    expect(relationAction?.scope).toBe("in-page");
  });

  it("article_association → 专业页面交接 handoff-article-mapping", () => {
    const issue = makeIssue({ issueKind: "article_association", proposedAction: { type: "article-association-reload", articleId: "art-1" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("handoff-article-mapping");
    expect(actions.every((a) => a.scope === "handoff")).toBe(true);
  });

  it("relation_conflict → 专业页面交接 handoff-relation-review", () => {
    const issue = makeIssue({ issueKind: "relation_conflict", proposedAction: { type: "inference-review", conflictId: "c-9" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("handoff-relation-review");
    expect(actions.every((a) => a.scope === "handoff")).toBe(true);
  });

  it("pipeline_failure → 专业页面交接 handoff-component-check", () => {
    const issue = makeIssue({ issueKind: "pipeline_failure", title: "SA 零组件", proposedAction: { type: "diagnostic" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("handoff-component-check");
    expect(actions.every((a) => a.scope === "handoff")).toBe(true);
  });

  it("missing_lineage → 图谱修复轨道交接（11:0x 案4 收编：落点随发布页退役回落 #/article-workflow；裁决3幽灵摘除后由本类型承载）", () => {
    const issue = makeIssue({ issueKind: "missing_lineage", proposedAction: { type: "derived-graph-repair" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("handoff-graph-publish");
    expect(actions.every((a) => a.scope === "handoff")).toBe(true);
    // 审批与发布页退役（2026-10-15 收敛）——旧 #/publish 落点回落文章工作台（App.tsx getNavFromHash）
    expect(actions.find((a) => a.kind === "handoff-graph-publish")?.hash).toBe("#/article-workflow");
  });

  it("missing_lineage → 图谱修复轨道交接（11:0x 案4 收编：P3-I 不可达页内动作退役）", () => {
    const issue = makeIssue({ issueKind: "missing_lineage", proposedAction: { type: "derived-graph-repair" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).toContain("handoff-graph-publish");
    expect(actions.map((a) => a.kind)).not.toContain("derived-graph-preview");
  });

  it("stale_source → 无可执行动作（仅审计）", () => {
    const issue = makeIssue({ issueKind: "stale_source", proposedAction: { type: "article-association-reload" } });
    const actions = projectActionsForIssue(issue);
    expect(actions).toHaveLength(0);
  });

  it("有 Markdown sourcePath 时不产生重复的 Obsidian 动作", () => {
    const issue = makeIssue({ issueKind: "missing_field", evidence: [{ path: "知识库/wiki/entities/test.md" }], proposedAction: { type: "entity-repair", field: "module", sourceKey: "知识库/wiki/entities/test.md" } });
    const actions = projectActionsForIssue(issue);
    expect(actions.map((a) => a.kind)).not.toContain("open-obsidian");
  });
});

describe("anomaly-action-registry: projectActionsForIssues (去重)", () => {
  it("同一篇文章多个 issue 只产生去重后的动作 key", () => {
    const issues = [
      makeIssue({ issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "arch_layer", sourceKey: "x.md" } }),
      makeIssue({ issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "module", sourceKey: "x.md" } }),
      makeIssue({ issueKind: "unrecognized_entity", proposedAction: { type: "entity-relation-repair", sourceKey: "x.md" } }),
    ];
    const actions = projectActionsForIssues(issues);
    const kinds = actions.map((a) => a.kind);
    // entity-repair 只出现一次
    expect(kinds.filter((k) => k === "entity-repair")).toHaveLength(1);
    // relation-repair 出现一次
    expect(kinds.filter((k) => k === "relation-repair")).toHaveLength(1);
  });

  it("结果按 ANOMALY_ACTION_PRIORITY 排序", () => {
    const issues = [
      makeIssue({ issueKind: "relation_conflict", proposedAction: { type: "inference-review", conflictId: "c-1" } }),
      makeIssue({ issueKind: "missing_field", proposedAction: { type: "entity-repair", field: "title", sourceKey: "y.md" } }),
      makeIssue({ issueKind: "missing_lineage", proposedAction: { type: "derived-graph-repair" } }),
    ];
    const actions = projectActionsForIssues(issues);
    const indexes = actions.map((a) => ANOMALY_ACTION_PRIORITY.indexOf(a.kind));
    for (let i = 1; i < indexes.length; i++) {
      expect(indexes[i]).toBeGreaterThanOrEqual(indexes[i - 1]);
    }
  });

  it("空 issues 返回空数组", () => {
    expect(projectActionsForIssues([])).toEqual([]);
  });
});

describe("anomaly-action-registry: ANOMALY_ACTION_PRIORITY 完整性", () => {
  it("包含所有已定义的 AnomalyActionKind", () => {
    const allKinds: AnomalyActionKind[] = [
      "entity-repair",
      "relation-repair",
      // 2026-10-07 归一检验复跑补完 P3-I 退役：derived-graph-preview 随 handling 改
      // handoff 无投影分支，四处声明（类型/优先级/标签/作用域）一并清除（规则④死声明）。
      "handoff-article-mapping",
      "handoff-source-check",
      "handoff-component-check",
      "handoff-relation-review",
      "handoff-graph-publish",
      "handoff-tag-adjudicate",
      "handoff-pending-adjudication",
    ];
    for (const kind of allKinds) {
      expect(ANOMALY_ACTION_PRIORITY).toContain(kind);
    }
  });
});
