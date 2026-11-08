import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnomalyWorkbenchView } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
import { groupIssuesByArticle } from "@/features/anomaly-workbench/anomaly-article-groups";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const candidateIssue: AnomalyIssue = {
  issueId: "relation-candidate-1",
  issueKind: "relation_conflict",
  handling: "adjudicate",
  title: "MySQL 与 Gateway 的关系需要架构师裁决",
  status: "open",
  evidence: [],
  expectedRevisions: { sourceRevision: "sha256:source" },
  blockedActions: ["publish_graph"],
  proposedAction: { type: "relation-candidate-review" },
  relationCandidate: {
    candidateId: "candidate-1",
    candidateHash: "sha256:candidate",
    conflictGroupId: "conflict-mysql-gateway",
    candidateStatus: "open",
    evidenceSetHash: "sha256:evidence-set",
    sourceSetHash: "sha256:source-set",
    triples: [
      {
        tripleId: "triple-depends",
        sourceNodeId: "mysql",
        relationType: "DEPENDS_ON",
        targetNodeId: "gateway",
        direction: "outgoing",
        relationTypeStatus: "known",
        assertionPolicyStatus: "matched",
        sourceEndpointStatus: "known",
        targetEndpointStatus: "known",
        evidence: [
          {
            evidenceId: "evidence-wikilink",
            sourceKind: "typed_wikilink",
            producer: "entity-compliance.body-relations",
            coordinate: "line:18",
            sourcePath: "知识库/wiki/entities/MySQL.md",
            snippet: "依赖::[[Gateway]]",
            contentHash: "sha256:wikilink",
            sourceRevision: "sha256:mysql-source",
            ruleRevision: "B01",
            modelRevision: null,
            policyRevision: "policy-1",
          },
          {
            evidenceId: "evidence-article",
            sourceKind: "article_association",
            producer: "article-association-service",
            coordinate: "article:mysql-ha",
            sourcePath: "知识库/raw/precleaned/MySQL高可用.md",
            snippet: "Gateway 依赖 MySQL",
            contentHash: "sha256:article",
            sourceRevision: "sha256:article-source",
            ruleRevision: null,
            modelRevision: null,
            policyRevision: null,
          },
        ],
      },
      {
        tripleId: "triple-unknown",
        sourceNodeId: "gateway",
        relationType: "CUSTOM_LINK",
        targetNodeId: "mysql",
        direction: "incoming",
        relationTypeStatus: "unknown",
        assertionPolicyStatus: "unregistered",
        sourceEndpointStatus: "known",
        targetEndpointStatus: "unknown",
        evidence: [
          {
            evidenceId: "evidence-inference",
            sourceKind: "derived",
            producer: "extract_graph.derived_mentions",
            coordinate: "rule:R-7:evidence:0",
            sourcePath: null,
            snippet: "inferred reverse dependency",
            contentHash: "sha256:inference",
            sourceRevision: "sha256:model-source",
            ruleRevision: "R-7",
            modelRevision: "model-3",
            policyRevision: "policy-2",
          },
        ],
      },
    ],
    rejection: null,
  },
};

describe("relation candidate frontend contract", () => {
  beforeEach(() => {
    useAnomalyWorkbenchStore.setState({
      issues: [],
      selectedIssueId: null,
      status: "idle",
      error: null,
      refreshing: false,
      lastCheckedAt: null,
      refreshSummary: null,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("groups an evidence-complete candidate by candidate identity, not the first evidence path", () => {
    const [group] = groupIssuesByArticle([candidateIssue]);

    expect(group.articleKey).toBe("candidate:candidate-1");
    expect(group.sourcePath).toBe("");
    expect(group.displayTitle).toBe(candidateIssue.title);
  });

  // （PR-030 移除）「shows every triple, evidence record, and candidate state without exposing approval」——
  // 原断言钉在 AnomalyEvidencePanel 全量候选证据块上，该块自整改4轮紧凑化起在生产视图不可达
  // （候选证据由 peek「采信依据」折叠卡承载），PR-030 随驳回归位一并清理死 UI。
  // 其契约由本文件后两支真实视图测试承接：证据版本分组（三元组/哈希/不暴露批准）＋拒绝流（动作区直出）。

  it("shows every evidence version grouped under the same stable candidate identity", async () => {
    const revisedIssue = {
      ...candidateIssue,
      issueId: "relation-candidate-2",
      relationCandidate: {
        ...candidateIssue.relationCandidate!,
        candidateHash: "sha256:candidate-revised",
        evidenceSetHash: "sha256:evidence-set-revised",
        triples: [{
          ...candidateIssue.relationCandidate!.triples[0],
          evidence: [{
            ...candidateIssue.relationCandidate!.triples[0].evidence[0],
            evidenceId: "evidence-wikilink-revised",
            contentHash: "sha256:wikilink-revised",
          }],
        }],
      },
    } as AnomalyIssue;
    const issues = [candidateIssue, revisedIssue];
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-08-09T08:00:00.000Z", issues, total: issues.length } }),
    })));
    useAnomalyWorkbenchStore.setState({ issues, selectedIssueId: candidateIssue.issueId, status: "success" });

    render(<AnomalyWorkbenchView />);

    // 整改4轮·项2：采信依据默认收起——先展开再断言证据版本分组可见
    fireEvent.click(screen.getByText(/采信依据/));
    expect(await screen.findByText("候选证据版本 1 / 2")).toBeInTheDocument();
    expect(screen.getByText("候选证据版本 2 / 2")).toBeInTheDocument();
    // 哈希在二级「校验信息」子折叠（截断显示+title全文）——展开后按 title 断言
    fireEvent.click(screen.getAllByText(/校验信息/)[0]);
    expect(document.querySelectorAll('[title="sha256:candidate"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[title="sha256:candidate-revised"]').length).toBeGreaterThan(0);
    // evidenceId 在二级校验信息以截断 label 呈现——用修订版独有 contentHash 的 title 断言在场
    expect(document.querySelectorAll('[title="sha256:wikilink-revised"]').length).toBeGreaterThan(0);
    // PR-030：折叠卡只承载证据核对——卡内不再有驳回动作区（「关系候选证据」区随 compact 移除）
    expect(screen.queryByRole("region", { name: "关系候选证据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /批准|确认(?!.*映射)/ })).not.toBeInTheDocument();
  });

  it("mounts the architect-only rejection flow in the real workbench and updates candidate state", async () => {
    const rejectedIssue = {
      ...candidateIssue,
      relationCandidate: {
        ...candidateIssue.relationCandidate!,
        candidateStatus: "rejected" as const,
        rejection: {
          candidateId: "candidate-1",
          candidateHash: "sha256:candidate",
          evidenceSetHash: "sha256:evidence-set",
          sourceSetHash: "sha256:source-set",
          actor: "local-architect",
          reason: "证据不足以证明该关系",
          rejectedAt: "2026-08-09T08:00:00.000Z",
        },
      },
    } as AnomalyIssue;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.endsWith("/reject")
        ? rejectedIssue
        : { generatedAt: "2026-08-09T08:00:00.000Z", issues: [candidateIssue], total: 1 };
      return { ok: true, status: 200, json: async () => ({ success: true, data }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    useAnomalyWorkbenchStore.setState({ issues: [candidateIssue], selectedIssueId: candidateIssue.issueId, status: "success" });

    render(<AnomalyWorkbenchView />);
    // PR-030：驳回入口归位 footer 动作区——不展开「采信依据」折叠卡即可达（≤1 次点击验收）
    expect(await screen.findByRole("button", { name: "驳回候选" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认这次处理" })).not.toBeInTheDocument();
    // 折叠卡保留（证据核对职责）且全局面板仅此一个驳回入口——卡内不再重复挂驳回动作
    expect(screen.getByText(/采信依据/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "驳回候选" })).toHaveLength(1);

    // 点 footer 按钮 → 理由必填表单展开 → 提交
    fireEvent.click(screen.getByRole("button", { name: "驳回候选" }));
    fireEvent.change(screen.getByRole("textbox", { name: "拒绝原因" }), { target: { value: "证据不足以证明该关系" } });
    fireEvent.click(screen.getByRole("button", { name: "提交拒绝" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/anomalies/relation-candidate-1/reject",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "证据不足以证明该关系" }),
      }),
    ));
    // 拒绝后动作区转终态：footer 注记＋折叠卡内审计注记同文（getAllByText 取在场即可）
    expect((await screen.findAllByText(/已拒绝/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, element) => Boolean(element?.textContent?.includes("证据不足以证明该关系"))).length).toBeGreaterThan(0);
  });
});
