import { describe, expect, it } from "vitest";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { groupIssuesByArticle } from "@/features/anomaly-workbench/anomaly-article-groups";

function makeIssue(overrides: Partial<AnomalyIssue> & { issueId: string; issueKind: AnomalyIssue["issueKind"] }): AnomalyIssue {
  return {
    title: "测试问题",
    status: "open",
    evidence: [],
    expectedRevisions: {},
    blockedActions: [],
    proposedAction: null,
    ...overrides,
  } as AnomalyIssue;
}

describe("groupIssuesByArticle", () => {
  it("相同 sourcePath 的多个 issue 聚合成一篇文章", () => {
    const issues: AnomalyIssue[] = [
      makeIssue({ issueId: "i-1", issueKind: "missing_field", evidence: [{ path: "知识库/wiki/entities/alpha.md" }], proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/alpha.md", field: "arch_layer" } }),
      makeIssue({ issueId: "i-2", issueKind: "missing_field", evidence: [{ path: "知识库/wiki/entities/alpha.md" }], proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/alpha.md", field: "module" } }),
      makeIssue({ issueId: "i-3", issueKind: "unrecognized_entity", evidence: [{ path: "知识库/wiki/entities/alpha.md" }], proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/alpha.md" } }),
    ];
    const groups = groupIssuesByArticle(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0].issues).toHaveLength(3);
    expect(groups[0].articleKey).toBe("知识库/wiki/entities/alpha.md");
  });

  it("文章显示标题、来源路径、问题类型摘要和待处理数量", () => {
    const issues: AnomalyIssue[] = [
      makeIssue({ issueId: "i-1", issueKind: "missing_field", title: "补充架构分层", status: "open", evidence: [{ path: "wiki/beta.md" }], proposedAction: { type: "entity-repair", sourceKey: "wiki/beta.md", field: "arch_layer" } }),
      makeIssue({ issueId: "i-2", issueKind: "relation_conflict", title: "规则冲突", status: "verified", evidence: [{ path: "wiki/beta.md" }], proposedAction: { type: "inference-review", conflictId: "c-1" } }),
    ];
    const groups = groupIssuesByArticle(issues);
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.sourcePath).toBe("wiki/beta.md");
    expect(group.issueKindSummary).toContain("missing_field");
    expect(group.issueKindSummary).toContain("relation_conflict");
    expect(group.pendingCount).toBe(1); // 只有 open 那条是待处理
    expect(group.totalCount).toBe(2);
  });

  it("没有来源路径的系统诊断按稳定 issue 分组，不伪造文章", () => {
    const issues: AnomalyIssue[] = [
      makeIssue({ issueId: "sys-1", issueKind: "missing_lineage", title: "正式图血缘缺失", evidence: [{ path: ".ledger/master_graph.json" }], proposedAction: { type: "derived-graph-repair" } }),
      makeIssue({ issueId: "sys-2", issueKind: "pipeline_failure", title: "SA 零组件", evidence: [], proposedAction: { type: "diagnostic" } }),
    ];
    const groups = groupIssuesByArticle(issues);
    // 两个不同来源的系统诊断不应合并成一篇"文章"
    expect(groups.length).toBeGreaterThanOrEqual(2);
    // 系统诊断的 articleKey 不应是伪造的文章路径
    for (const group of groups) {
      expect(group.isSystemDiagnostic).toBe(true);
    }
  });

  it("选中状态按文章 key 保持，不因刷新 issue 顺序变化而丢失", () => {
    const issuesA: AnomalyIssue[] = [
      makeIssue({ issueId: "i-1", issueKind: "missing_field", evidence: [{ path: "wiki/gamma.md" }], proposedAction: { type: "entity-repair", sourceKey: "wiki/gamma.md", field: "title" } }),
      makeIssue({ issueId: "i-2", issueKind: "missing_field", evidence: [{ path: "wiki/delta.md" }], proposedAction: { type: "entity-repair", sourceKey: "wiki/delta.md", field: "module" } }),
    ];
    // 刷新后顺序反转
    const issuesB: AnomalyIssue[] = [issuesA[1], issuesA[0]];
    const groupsA = groupIssuesByArticle(issuesA);
    const groupsB = groupIssuesByArticle(issuesB);
    // 相同文章产生相同 key
    expect(groupsA.map((g) => g.articleKey).sort()).toEqual(groupsB.map((g) => g.articleKey).sort());
  });

  it("空 issues 返回空数组", () => {
    expect(groupIssuesByArticle([])).toEqual([]);
  });

  it("articleId 优先作为 key（当 sourcePath 不可用时）", () => {
    const issues: AnomalyIssue[] = [
      makeIssue({ issueId: "i-1", issueKind: "article_association", evidence: [], proposedAction: { type: "article-association-reload", articleId: "art-99" } }),
    ];
    const groups = groupIssuesByArticle(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0].articleKey).toContain("art-99");
  });
});
