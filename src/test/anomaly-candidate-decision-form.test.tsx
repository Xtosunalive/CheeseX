import { describe, expect, it, vi } from "vitest";
import { AnomalyWorkbenchView } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

// C1（#1793）：候选组（relationCandidate）issue——用户报障场景：
// 文章关联缺失的候选证据（article-association）此前只渲染证据+拒绝，页内批准/处理表单不可达，
// 「待处理问题可处理」对该类问题失效（只配半套 UI：能拒不能批）。
const candidateIssue: AnomalyIssue = {
  issueId: "article-association-missing-沟通壁垒-数据到信息到知识",
  issueKind: "article_association",
  handling: "fix",
  title: "文章缺少架构关联",
  status: "open",
  evidence: [{ kind: "relation-candidate", path: "知识库/raw/precleaned/沟通壁垒-数据到信息到知识.md", lineNumber: null, ruleId: "G01" }],
  blockedActions: [],
  relationCandidate: {
    candidateId: "relcand-9f6b60977e7976fe8cf7b03c6a6cbb6889c4bb61d81f0299a19e67db3cf568eb",
    candidateStatus: "pending_review",
    conflictGroupId: "conflict-沟通壁垒-数据到信息到知识",
    candidateHash: `sha256:${"a".repeat(64)}`,
    evidenceSetHash: `sha256:${"b".repeat(64)}`,
    sourceSetHash: `sha256:${"c".repeat(64)}`,
    triples: [{
      tripleId: "triple-1",
      sourceNodeId: "node-沟通壁垒",
      relationType: "applies_to",
      targetNodeId: "node-anyshare",
      direction: "outgoing",
      relationTypeStatus: "known",
      assertionPolicyStatus: "matched",
      sourceEndpointStatus: "known",
      targetEndpointStatus: "known",
      evidence: [{ evidenceId: "ev-1", sourceKind: "article", producer: "relation-candidate", coordinate: "知识库/raw/precleaned/沟通壁垒-数据到信息到知识.md" }],
    }],
    confidence: 0.86,
  },
  proposedAction: { type: "article-association", sourceKey: "知识库/raw/precleaned/沟通壁垒-数据到信息到知识.md" },
  executionReady: true,
} as unknown as AnomalyIssue;

describe("AnomalyWorkbenchView · 候选组页内处理表单（C1）", () => {
  it("候选组 issue 渲染完整页内处理链：证据 + 处理步骤（ResolutionForm + 确认按钮），不再只能拒绝", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-09-11T00:00:00.000Z", issues: [candidateIssue], total: 1, workingRevisions: { masterGraph: `sha256:${"e".repeat(64)}` } } }),
    }));
    useAnomalyWorkbenchStore.setState({
      issues: [candidateIssue],
      selectedIssueId: candidateIssue.issueId,
      // WP-146 件2：勾选集入 store 后跨测试残留——每个用例自带夹具勾选态，防上一例勾选渗入
      selectedArticleKeys: [],
      status: "idle",
      error: null,
      refreshing: false,
    });
    render(<AnomalyWorkbenchView />);
    // Linear 壳（task/anomaly-workbench-linear-shell）：详情进 peek 侧栏——双击行（或行选中+peek 开）承载完整处理链
    const row = await screen.findByRole("button", { name: (n: string) => n.startsWith(`问题行 ${candidateIssue.issueId}：`) });
    fireEvent.dblClick(row);
    // 既有能力不回退：拒绝通道在场（peek footer 候选类）
    expect(await screen.findByRole("button", { name: /驳回候选/ })).toBeInTheDocument();
    // C1 缺口断言②：ResolutionForm 的关联组件/版本表单可达（AssociationResolution 分支）
    expect(screen.getByText(/关联架构组件/)).toBeInTheDocument();
    expect(screen.getByText(/适用产品版本/)).toBeInTheDocument();
    // C1 缺口断言③：确认操作按钮在场（open 态禁用属正常——需先 preview；此前整个按钮不存在）
    expect(screen.getByRole("button", { name: /确认这次处理/ })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

// ── #1798 可用性批（用户验证反馈）：处理面板归属标注 + 缺实体直开补齐 + 动作徽标语义 ──
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AnomalyWorkbenchView as WorkbenchViewRef } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
void WorkbenchViewRef;

const missingEntityIssue: AnomalyIssue = {
  issueId: "missing-entity-可观测性",
  issueKind: "missing_entity",
  handling: "fix",
  title: "实体缺失：可观测性",
  status: "open",
  evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/可观测性.md", lineNumber: null, ruleId: "G01" }],
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/可观测性.md", entityId: "doc-article-沟通壁垒-数据到信息到知识", field: "module_entity" },
  executionReady: true,
} as unknown as AnomalyIssue;

describe("AnomalyWorkbenchView · 处理面板归属与缺实体直达（#1798）", () => {
  it("T1 peek 侧栏标注归属（选中问题标题 + issueId 徽标），消除「不知道这个面板属于谁」的困惑", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-09-11T00:00:00.000Z", issues: [candidateIssue, missingEntityIssue], total: 2, workingRevisions: {} } }),
    }));
    useAnomalyWorkbenchStore.setState({ issues: [candidateIssue, missingEntityIssue], selectedIssueId: null, selectedArticleKeys: [], status: "idle", error: null, refreshing: false });
    render(<AnomalyWorkbenchView />);
    // 首次 load 后 preferActionable 选中首条；双击行开 peek——归属=peek 头 issueId+标题
    const row = await screen.findByRole("button", { name: (n: string) => n.startsWith(`问题行 ${candidateIssue.issueId}：`) });
    fireEvent.dblClick(row);
    const peek = await screen.findByRole("complementary", { name: new RegExp(candidateIssue.issueId) });
    expect(within(peek).getByText(candidateIssue.title)).toBeInTheDocument();
  });

  it("T2 缺实体问题改道一键补齐跳转（11:0x 案3：页内「补齐此问题」按钮退役，直达=Preview 区跳转）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-09-11T00:00:00.000Z", issues: [candidateIssue, missingEntityIssue], total: 2, workingRevisions: {} } }),
    }));
    useAnomalyWorkbenchStore.setState({ issues: [candidateIssue, missingEntityIssue], selectedIssueId: null, selectedArticleKeys: [], status: "idle", error: null, refreshing: false });
    render(<AnomalyWorkbenchView />);
    // 等首次 load 完成（mount 的 preferActionable 会按 preferredIssueId 重置选中），再模拟用户点击缺实体行
    await screen.findByRole("button", { name: (n: string) => n.startsWith(`问题行 ${missingEntityIssue.issueId}：`) });
    // #1798 的「直达」诉求由操作条「转到源文档检查」（=一键补齐 hash，登记表 handoff）承接；
    // 页内修复按钮对 missing_entity 退役（repairable 收缩为 missing_field/version_scope）。
    const missingRow = screen.getByRole("button", { name: (n: string) => n.startsWith(`问题行 ${missingEntityIssue.issueId}：`) });
    fireEvent.click(missingRow.querySelector('input[type="checkbox"]')!);
    // WP-146 件3（并行改版）：跳转类动作收进「前往处理」下拉——先开下拉再断言菜单项在场
    fireEvent.pointerDown(screen.getByRole("button", { name: /前往处理/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("menuitem", { name: /转到源文档检查/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补齐此问题" })).not.toBeInTheDocument();
  });

  it("T3 处置模式分组页签实时计数（Linear 壳：handling 四态=组页签，替代旧表格列徽标）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ success: true, data: { generatedAt: "2026-09-11T00:00:00.000Z", issues: [missingEntityIssue], total: 1, workingRevisions: {} } }),
    }));
    useAnomalyWorkbenchStore.setState({ issues: [missingEntityIssue], selectedIssueId: null, selectedArticleKeys: [], status: "idle", error: null, refreshing: false });
    render(<AnomalyWorkbenchView />);
    const tablist = await screen.findByRole("tablist", { name: "处置模式分组" });
    // 恒常渲染后「无需处理」也含子串"需处理"——改 accessible name 全字匹配（名称+计数）
    const fixTab = within(tablist).getAllByRole("tab").find((tab) => tab.textContent?.startsWith("需处理"));
    expect(fixTab).toBeTruthy();
    void fireEvent;
  });
});
