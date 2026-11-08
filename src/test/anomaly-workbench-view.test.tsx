import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyActionPreview, AnomalyResolutionForm, AnomalyEvidencePanel, AnomalyIssueForm, AnomalySourceTable } from "@/features/anomaly-workbench/components";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { anomalyActionTarget } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { groupIssuesByArticle } from "@/features/anomaly-workbench/anomaly-article-groups";
import { AnomalyWorkbenchView } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";

const issue: AnomalyIssue = {
  issueId: "entity-check-1",
  issueKind: "unrecognized_entity",
  handling: "fix",
  title: "3 个目标无法解析",
  status: "previewed",
  evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/example.md", lineNumber: null, ruleId: "B02" }],
  expectedRevisions: { sourceRevision: "sha256:source", ruleRevision: "B02" },
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/example.md", field: "arch_subdomain", currentValue: null, expected: "填写有效子域", hint: "从规则配置选择子域" },
  actionPreview: {
    accepted: true,
    adapter: "entity-repair",
    token: { previewId: "write-preview-1" },
    summary: {
      sourceKey: "知识库/wiki/entities/example.md",
      changedFields: ["arch_subdomain"],
      beforeValues: { arch_subdomain: null },
      afterValues: { arch_subdomain: "architecture" },
      preCheck: { blockerCount: 1, warningCount: 3 },
      postCheck: { blockerCount: 0, warningCount: 2 },
    },
  },
  previewId: "preview-1",
  executionReady: true,
};

describe("anomaly workbench presentation", () => {
  it("待处理·加载态：拉取中显示加载提示", () => {
    useAnomalyWorkbenchStore.setState({ issues: [], selectedIssueId: null, status: "loading", error: null, refreshing: false });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AnomalyWorkbenchView />);
    expect(screen.getByText("正在加载待处理问题…")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it("待处理·无数据态：空态即结构——工作台结构在、引导卡不在（Master 2026-10-29）", async () => {
    useAnomalyWorkbenchStore.setState({ issues: [], selectedIssueId: null, status: "idle", error: null, refreshing: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { generatedAt: "2026-07-20T00:00:00.000Z", issues: [], total: 0, workingRevisions: { masterGraph: `sha256:${"e".repeat(64)}` } } }) }));
    render(<AnomalyWorkbenchView />);
    expect(await screen.findByText("来源文章（0）")).toBeInTheDocument();
    // 工作副本诊断状态行已退役（Master 裁）——页头不再展示 revision 口径
    expect(screen.queryByTestId("anomaly-working-revisions")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it("待处理·后端失败态：加载失败显示重试", async () => {
    useAnomalyWorkbenchStore.setState({ issues: [], selectedIssueId: null, status: "idle", error: null, refreshing: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("加载失败")));
    render(<AnomalyWorkbenchView />);
    expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it("跨页导航·inference-review：无 conflictId（冲突已销账/不存在）时不提供跳转", () => {
    const gone = { ...issue, issueId: "conflict-gone", issueKind: "relation_conflict", proposedAction: { type: "inference-review" } } as AnomalyIssue;
    expect(anomalyActionTarget(gone)).toBeNull();
    const present = { ...issue, issueId: "conflict-live", issueKind: "relation_conflict", proposedAction: { type: "inference-review", conflictId: "c-1" } } as AnomalyIssue;
    expect(anomalyActionTarget(present)?.hash).toContain("conflictId=c-1");
  });
  it("switches the pending-item detail when another source file is selected", async () => {
    const articleIssue = {
      ...issue,
      issueId: "article-a02",
      issueKind: "missing_field",
      status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/raw/precleaned/强制入主.md", lineNumber: null, ruleId: "A02" }],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/raw/precleaned/强制入主.md", field: "article_id", group: "文章身份", hint: "例如 mysql-force-primary" },
    } as AnomalyIssue;
    useAnomalyWorkbenchStore.setState({ issues: [issue, articleIssue], selectedIssueId: issue.issueId, status: "success", error: null, refreshing: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { generatedAt: "2026-07-20T00:00:00.000Z", issues: [issue, articleIssue], total: 2 } }) }));
    render(<AnomalyWorkbenchView />);

    // Linear 壳（task/anomaly-workbench-linear-shell）：问题列表=行列表 region，行内含来源文件名
    const issueList = await screen.findByRole("region", { name: "问题列表" });
    await waitFor(() => expect(issueList).toHaveTextContent("字段缺失"));
    expect(within(issueList).queryByText("文章标识（article_id）")).not.toBeInTheDocument();
    expect(within(issueList).getAllByText("字段缺失").length).toBeGreaterThan(0);
    // 整改2：来源 basename 已从行内退役（侧栏+peek 承载）——改断言行 aria-label 含 issueId（行在场且可定位）
    expect(within(issueList).getAllByRole("button", { name: (n: string) => n.startsWith("问题行 article-a02：") }).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it("待处理表格只显示规定列：选择/问题来源/问题类型/处理状态", () => {
    render(<AnomalySourceTable groups={groupIssuesByArticle([issue])} selectedIssueId={issue.issueId} onSelect={vi.fn()} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(4);
    expect(screen.getByRole("columnheader", { name: "选择" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "问题来源" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "问题类型" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /处理状态/ })).toBeInTheDocument();
  });

  it("shows business terms and source facts instead of internal JSON", () => {
    render(<><AnomalyEvidencePanel issue={issue} /><AnomalyActionPreview issue={issue} /></>);

    // 类型 chip 随「问题来源」行退役（2026-10-16 冗余清理批）——业务术语断言由解说行承载（下方）
    expect(screen.getByText("检查并补充子域")).toBeInTheDocument();
    expect(screen.getAllByText("知识库/wiki/entities/example.md")).toHaveLength(1);
    expect(screen.getByText("检查并补充子域")).toBeInTheDocument();
    expect(screen.getByText("来源版本检查")).toBeInTheDocument();
    expect(screen.getByText("安全规则")).toBeInTheDocument();
    expect(screen.getByText("业务预览已生成")).toBeInTheDocument();
    expect(screen.getByText("将更新：子域")).toBeInTheDocument();
    expect(screen.getByText("architecture")).toBeInTheDocument();
    expect(screen.getByText("阻断问题 1 → 0；提醒 3 → 2")).toBeInTheDocument();
    expect(screen.queryByText(/unrecognized_entity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sourceKey/)).not.toBeInTheDocument();
  });

  it("shows a standardization warning as a nonblocking pending issue", () => {
    const warning = {
      ...issue,
      issueId: "standardization-warning-1",
      issueKind: "standardization_warning",
      title: "标准化警告",
      status: "open",
      blockedActions: [],
      proposedAction: null,
      evidence: [{ kind: "standardization-warning", path: "知识库/raw/precleaned/warn.md", ruleId: "W01" }],
    } as AnomalyIssue;
    render(<AnomalyEvidencePanel issue={warning} />);
    // 类型 chip 已退役（冗余清理批）——解说行为业务术语载体
    expect(screen.getByText(/不阻断文章成为标准文章/)).toBeInTheDocument();
    expect(screen.queryByText(/影响：/)).not.toBeInTheDocument(); // 警告=显式弃置：影响行不渲染（#1405）
  });

  // 「makes the next workflow action explicit」随 AnomalyDecisionPanel 退役（四步流程已删，Master 2026-10-16）

  it("submits one human-entered field value to the preview operation", () => {
    const onOperate = vi.fn();
    const openIssue = { ...issue, status: "open", previewId: undefined, proposedAction: { ...issue.proposedAction, allowedValues: ["architecture", "storage"] } } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={openIssue} onPreview={onOperate} />);

    // entity-repair 已统一到工具栏弹窗，DecisionPanel 显示提示
    expect(screen.getByText(/勾选问题后，用右下角悬浮操作条的「补齐字段」/)).toBeInTheDocument();
  });

  it("prefills the selected issue with its existing field value", () => {
    const openIssue = {
      ...issue,
      status: "open",
      previewId: undefined,
      proposedAction: { ...issue.proposedAction, currentValue: "storage", allowedValues: ["architecture", "storage"] },
    } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={openIssue} onPreview={vi.fn()} />);
    // entity-repair 已统一到工具栏弹窗
    expect(screen.getByText(/勾选问题后，用右下角悬浮操作条的「补齐字段」/)).toBeInTheDocument();
  });

  it("keeps the preview container on the standard neutral border", () => {
    render(<AnomalyActionPreview issue={issue} />);
    const previewRegion = screen.getByRole("region", { name: "处理预览" });
    expect(previewRegion).toHaveClass("ring-1", "ring-border-thin", "bg-surface-card", "rounded-xl");
  });

  it("keeps previewed fields editable and prefills the latest preview value", () => {
    const onOperate = vi.fn();
    const previewedIssue = {
      ...issue,
      actionPreview: {
        ...issue.actionPreview,
        summary: { ...issue.actionPreview?.summary, afterValues: { arch_subdomain: "storage" } },
      },
      proposedAction: { ...issue.proposedAction, allowedValues: ["architecture", "storage"] },
    } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={previewedIssue} onPreview={onOperate} />);
    // entity-repair 已统一到工具栏弹窗
    expect(screen.getByText(/勾选问题后，用右下角悬浮操作条的「补齐字段」/)).toBeInTheDocument();
  });

  it("lets a blocked active issue edit and generate a recovery preview", () => {
    const onOperate = vi.fn();
    const blockedIssue = {
      ...issue,
      status: "blocked",
      proposedAction: { ...issue.proposedAction, currentValue: "storage", allowedValues: ["architecture", "storage"] },
    } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={blockedIssue} onPreview={onOperate} />);
    // entity-repair 已统一到工具栏弹窗，但阻断提示仍显示
    expect(screen.getByText(/上一轮处理已停止/)).toBeInTheDocument();
    expect(screen.getByText(/勾选问题后，用右下角悬浮操作条的「补齐字段」/)).toBeInTheDocument();
  });

  it("retargets one unresolved link instead of adding a new relation", () => {
    const onOperate = vi.fn();
    const relationIssue = {
      ...issue,
      status: "open",
      previewId: undefined,
      proposedAction: {
        type: "entity-relation-repair",
        sourceKey: "知识库/wiki/entities/example.md",
        unresolvedTargets: ["ghost-service"],
        relationTargetOptions: [{ id: "auth-service", label: "认证服务" }],
      },
    } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={relationIssue} onPreview={onOperate} />);

    fireEvent.change(screen.getByRole("combobox", { name: "需要修正的旧链接" }), { target: { value: "ghost-service" } });
    fireEvent.change(screen.getByRole("combobox", { name: "替换为已有实体" }), { target: { value: "auth-service" } });
    fireEvent.click(screen.getByRole("button", { name: "预览替换为实体" }));
    expect(onOperate).toHaveBeenCalledWith({ relationPatch: { operation: "retarget", originalTarget: "ghost-service", targetId: "auth-service" } });
    expect(screen.getByText(/可将旧链接替换为已通过身份检查的实体/)).toBeInTheDocument();
  });

  it("guides the user to Obsidian when no replacement entity exists", () => {
    render(<AnomalyResolutionForm issue={{ ...issue, status: "open", previewId: undefined, proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/example.md", unresolvedTargets: ["ghost-service"], unmanagedCandidates: [{ target: "ghost-service", sourcePath: "ghost-service.md" }], governedEntityDirectory: "知识库/wiki/entities/", relationTargetOptions: [] } } as AnomalyIssue} onPreview={vi.fn()} />);
    expect(screen.getByRole("button", { name: "在 Obsidian 中创建实体或修正链接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览移除旧链接" })).toBeDisabled();
    expect(screen.getByText("发现已创建但尚未进入实体目录的页面")).toBeInTheDocument();
    expect(screen.getByText("ghost-service：ghost-service.md")).toBeInTheDocument();
    expect(screen.getByText(/请将页面移动到 知识库\/wiki\/entities\//)).toBeInTheDocument();
  });

  it("does not describe an article candidate as a writable entity target", () => {
    const onOperate = vi.fn();
    render(<AnomalyResolutionForm issue={{ ...issue, status: "open", previewId: undefined, proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/MySQL.md", unresolvedTargets: ["强制入主"], unmanagedCandidates: [{ target: "强制入主", sourcePath: "知识库/raw/precleaned/强制入主.md" }], governedEntityDirectory: "知识库/wiki/entities/", relationTargetOptions: [] } } as AnomalyIssue} onPreview={onOperate} />);
    expect(screen.getByText("发现同名文章或文章候选，但它不是架构实体")).toBeInTheDocument();
    expect(screen.getByText(/文章应在“文章与组件”中挂载/)).toBeInTheDocument();
    expect(screen.queryByText(/请将页面移动到/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "需要修正的旧链接" }), { target: { value: "强制入主" } });
    const removeButton = screen.getByRole("button", { name: "预览移除旧链接" });
    expect(removeButton).toBeEnabled();
    expect(removeButton).toHaveAttribute("data-risk", "high");
    expect(removeButton).toHaveAttribute("data-action-id", "anomaly-relation-remove-preview");
    expect(removeButton).toHaveAttribute("data-channel", "POST /api/anomalies/:issueId/preview");
    fireEvent.click(removeButton);
    expect(onOperate).toHaveBeenCalledWith({ relationPatch: { operation: "remove-target", originalTarget: "强制入主" } });
  });

  it("does not show an unfillable retarget form for a missing typed relation", () => {
    const typedRelationIssue = {
      ...issue,
      issueId: "mysql-b01",
      issueKind: "unrecognized_entity",
      title: "未声明类型化架构关系",
      executionReady: false,
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/MySQL.md", lineNumber: null, ruleId: "B01" }],
      proposedAction: {
        type: "entity-relation-repair",
        sourceKey: "知识库/wiki/entities/MySQL.md",
        currentValue: "关系类型为空：test-pipeline-verification",
        unresolvedTargets: [],
        relationTargetOptions: [{ id: "pipeline", label: "管线端到端验证节点" }],
        hint: "普通 [[target]] 仅表示 Obsidian 引用；架构关系请使用如 依赖::[[target]]",
      },
    } as AnomalyIssue;

    render(<AnomalyResolutionForm issue={typedRelationIssue} onPreview={vi.fn()} />);

    expect(screen.queryByRole("combobox", { name: "需要修正的旧链接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "替换为已有实体" })).not.toBeInTheDocument();
    expect(screen.getByText("检测到关系目标，但双冒号前缺少关系类型。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "在 Obsidian 中声明类型化关系" })).toBeInTheDocument();

    render(<AnomalyIssueForm issues={[typedRelationIssue]} selectedIssueId={typedRelationIssue.issueId} onSelect={vi.fn()} />);
    expect(screen.getByText("关系类型为空：test-pipeline-verification")).toBeInTheDocument();
  });

  it("shows a source-file checklist with current and expected values", () => {
    render(<AnomalyIssueForm issues={[issue]} selectedIssueId={issue.issueId} onSelect={vi.fn()} />);

    expect(screen.getByText("待处理项")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "问题来源" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "问题类型" })).toBeInTheDocument();
    expect(screen.getByText("子域")).toBeInTheDocument();
    expect(screen.getByText("知识库/wiki/entities/example.md")).toBeInTheDocument();
    expect(screen.getByText("未识别实体")).toBeInTheDocument();
    expect(screen.getByText("未填写")).toBeInTheDocument();
    expect(screen.getByText("填写有效子域")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索待处理项" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清除待处理项筛选" })).toBeDisabled();
    expect(screen.getByLabelText("待处理项分页")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /排序$/ })).toHaveLength(6);
  });

  it("groups issues by source path while keeping each issue independently selectable", () => {
    const sibling = {
      ...issue,
      issueId: "entity-check-2",
      proposedAction: { ...issue.proposedAction, field: "version", expected: "填写版本" },
    } as AnomalyIssue;
    const onSelect = vi.fn();
    render(<AnomalyIssueForm issues={[sibling, issue]} selectedIssueId={null} onSelect={onSelect} />);

    expect(screen.getAllByText("知识库/wiki/entities/example.md")).toHaveLength(1);
    expect(screen.getByText("2 项问题")).toBeInTheDocument();
    expect(screen.getByRole<HTMLTableCellElement>("columnheader", { name: "问题来源" }).cellIndex).toBe(0);
    fireEvent.click(screen.getByText("填写版本").closest("tr")!);
    expect(onSelect).toHaveBeenCalledWith("entity-check-2");
  });

  it("opens a grouped source path in Obsidian without changing the selected issue", async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, data: { opened: true, sourcePath: "知识库/wiki/entities/example.md", vaultName: "Test" }, error: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AnomalyIssueForm issues={[issue]} selectedIssueId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "在 Obsidian 中打开来源文档：知识库/wiki/entities/example.md" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/system/open-obsidian", expect.objectContaining({ method: "POST" })));
    expect(onSelect).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows formal graph evidence as a read-only inspection target", () => {
    const graphIssue = { ...issue, issueId: "graph-lineage", issueKind: "missing_lineage", evidence: [{ kind: "derived-graph-diagnostic", path: ".ledger/master_graph.json" }], proposedAction: { type: "derived-graph-repair" } } as AnomalyIssue;
    render(<><AnomalySourceTable groups={groupIssuesByArticle([graphIssue])} selectedIssueId={graphIssue.issueId} onSelect={vi.fn()} /><AnomalyIssueForm issues={[graphIssue]} selectedIssueId={graphIssue.issueId} onSelect={vi.fn()} /><AnomalyEvidencePanel issue={graphIssue} /></>);
    expect(screen.getAllByText("图谱检查结果").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(".ledger/master_graph.json")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Obsidian.*master_graph/ })).not.toBeInTheDocument();
  });

  it("reuses table filters, sorting, result count, and clear behavior", () => {
    const alpha = {
      ...issue,
      issueId: "alpha-1",
      issueKind: "missing_field",
      status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/MySQL.md", lineNumber: null, ruleId: "F01" }],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/MySQL.md", field: "alpha_field", expected: "Alpha rule" },
    } as AnomalyIssue;
    const zeta = {
      ...issue,
      issueId: "zeta-1",
      issueKind: "relation_conflict",
      status: "verified",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/Redis.md", lineNumber: null, ruleId: "B02" }],
      proposedAction: { type: "inference-review", sourceKey: "知识库/wiki/entities/Redis.md", field: "zeta_field", expected: "Zeta rule" },
    } as AnomalyIssue;
    render(<AnomalyIssueForm issues={[zeta, alpha]} selectedIssueId={null} onSelect={vi.fn()} />);

    const issueTable = screen.getByRole("region", { name: "问题来源待处理项" });
    fireEvent.pointerDown(within(issueTable).getByRole("button", { name: "待处理字段或关系排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText("字段 A-Z"));
    expect(within(issueTable).getAllByRole("row")[1]).toHaveTextContent("alpha_field");

    fireEvent.click(within(issueTable).getByRole("button", { name: "筛选待处理问题来源" }));
    fireEvent.click(screen.getByRole("option", { name: "知识库/wiki/entities/Redis.md" }));
    expect(within(issueTable).getByText("1 / 2 条待处理项")).toBeInTheDocument();
    expect(within(issueTable).getByText("zeta_field")).toBeInTheDocument();
    expect(within(issueTable).queryByText("alpha_field")).not.toBeInTheDocument();

    const clearButton = within(issueTable).getByRole("button", { name: "清除待处理项筛选" });
    expect(clearButton).toBeEnabled();
    fireEvent.click(clearButton);
    expect(within(issueTable).getByText("2 / 2 条待处理项")).toBeInTheDocument();
    expect(clearButton).toBeDisabled();

    fireEvent.click(within(issueTable).getByRole("button", { name: "筛选待处理问题类型" }));
    fireEvent.click(screen.getByRole("option", { name: "字段缺失" }));
    expect(within(issueTable).getByText("alpha_field")).toBeInTheDocument();
    expect(within(issueTable).queryByText("zeta_field")).not.toBeInTheDocument();

    fireEvent.click(clearButton);
    fireEvent.click(within(issueTable).getByRole("button", { name: "筛选待处理状态" }));
    fireEvent.click(screen.getByRole("option", { name: "已复核" }));
    expect(within(issueTable).getByText("zeta_field")).toBeInTheDocument();
    expect(within(issueTable).queryByText("alpha_field")).not.toBeInTheDocument();

    fireEvent.click(clearButton);
    fireEvent.change(within(issueTable).getByRole("textbox", { name: "搜索待处理项" }), { target: { value: "Alpha rule" } });
    expect(within(issueTable).getByText("alpha_field")).toBeInTheDocument();
    expect(within(issueTable).queryByText("zeta_field")).not.toBeInTheDocument();
  });

  it("filters the source table by path and processing status", () => {
    const blocked = { ...issue, issueId: "blocked-1", status: "blocked", evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/MySQL.md", lineNumber: null, ruleId: "F01" }] } as AnomalyIssue;
    const verified = { ...issue, issueId: "verified-1", status: "verified", evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/Redis.md", lineNumber: null, ruleId: "F01" }] } as AnomalyIssue;
    const onSelect = vi.fn();
    render(<AnomalySourceTable groups={groupIssuesByArticle([blocked, verified])} selectedIssueId={null} onSelect={onSelect} />);

    fireEvent.change(screen.getByRole("textbox", { name: "搜索问题来源" }), { target: { value: "MySQL" } });
    expect(screen.getByText("知识库/wiki/entities/MySQL.md")).toBeInTheDocument();
    expect(screen.queryByText("知识库/wiki/entities/Redis.md")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("未识别实体"));
    expect(onSelect).toHaveBeenCalledWith("blocked-1");

    fireEvent.change(screen.getByRole("textbox", { name: "搜索问题来源" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选来源处理状态" }));
    fireEvent.click(screen.getByRole("option", { name: "已完成" }));
    expect(screen.queryByText("知识库/wiki/entities/MySQL.md")).not.toBeInTheDocument();
    expect(screen.getByText("知识库/wiki/entities/Redis.md")).toBeInTheDocument();
  });

  it("reuses source-table sorting and pagination while keeping status visible", () => {
    const manyIssues = Array.from({ length: 21 }, (_, index) => ({
      ...issue,
      issueId: `source-${index}`,
      status: "open",
      evidence: [{ kind: "entity-compliance", path: `知识库/wiki/entities/Source-${String(index).padStart(2, "0")}.md`, lineNumber: null, ruleId: "B02" }],
    })) as AnomalyIssue[];
    render(<AnomalySourceTable groups={groupIssuesByArticle(manyIssues)} selectedIssueId={null} onSelect={vi.fn()} />);

    const sourceTable = screen.getByRole("region", { name: "问题来源待处理项" });
    expect(within(sourceTable).getByRole("columnheader", { name: /处理状态/ })).toBeInTheDocument();
    expect(within(sourceTable).getByTestId("table-pagination")).toHaveTextContent("1–20 / 共 21");
    expect(within(sourceTable).getAllByText("待处理").length).toBeGreaterThan(0);

    fireEvent.pointerDown(within(sourceTable).getByRole("button", { name: "问题来源排序" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText("来源 Z-A"));
    expect(within(sourceTable).getAllByRole("row")[1]).toHaveTextContent("Source-20.md");

    fireEvent.click(within(sourceTable).getByRole("button", { name: "问题来源分页 下一页" }));
    expect(within(sourceTable).getByTestId("table-pagination")).toHaveTextContent("21–21 / 共 21");
    expect(within(sourceTable).getByText("知识库/wiki/entities/Source-00.md")).toBeInTheDocument();
  });

  it("reveals a newly detected source instead of keeping stale filters", async () => {
    const mysql = { ...issue, issueId: "mysql-1", evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/MySQL.md", lineNumber: null, ruleId: "B01" }] } as AnomalyIssue;
    const article = { ...issue, issueId: "article-1", evidence: [{ kind: "entity-compliance", path: "知识库/raw/precleaned/强制入主.md", lineNumber: null, ruleId: "A02" }] } as AnomalyIssue;
    const { rerender } = render(<AnomalySourceTable groups={groupIssuesByArticle([mysql])} selectedIssueId={mysql.issueId} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "搜索问题来源" }), { target: { value: "MySQL" } });
    rerender(<AnomalySourceTable groups={groupIssuesByArticle([mysql, article])} selectedIssueId={mysql.issueId} onSelect={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "搜索问题来源" })).toHaveValue(""));
    expect(screen.getByText("知识库/raw/precleaned/强制入主.md")).toBeInTheDocument();
  });

  it("shows issues from every source in the pending item table", async () => {
    const mysql = { ...issue, issueId: "mysql-b01", status: "open", title: "未声明类型化架构关系", evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/MySQL.md", lineNumber: null, ruleId: "B01" }], proposedAction: { type: "entity-relation-repair", sourceKey: "知识库/wiki/entities/MySQL.md", group: "Body 关系" } } as AnomalyIssue;
    const article = { ...issue, issueId: "article-a02", status: "open", issueKind: "missing_field", title: "article_id 缺失", evidence: [{ kind: "entity-compliance", path: "知识库/raw/precleaned/强制入主.md", lineNumber: null, ruleId: "A02" }], proposedAction: { type: "entity-repair", sourceKey: "知识库/raw/precleaned/强制入主.md", field: "article_id", group: "文章身份" } } as AnomalyIssue;
    useAnomalyWorkbenchStore.setState({ issues: [mysql, article], selectedIssueId: article.issueId, status: "success" });
    render(<AnomalyWorkbenchView />);

    // 页内主标题已删（mode-skin PR③）+ Linear 壳：列表 region=「问题列表」（旧「问题来源待处理项」随 SourceTable 退役）
    await waitFor(() => expect(screen.getByRole("region", { name: "问题列表" })).toBeInTheDocument());
    expect(screen.queryByText("文章标识（article_id）")).not.toBeInTheDocument();
    expect(screen.getAllByText("未识别实体").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MySQL.md").length).toBeGreaterThan(0);
    const issueList = screen.getByRole("region", { name: "问题列表" });
    fireEvent.click(within(issueList).getAllByText("未识别实体")[0]);
    expect(useAnomalyWorkbenchStore.getState().selectedIssueId).toBe("mysql-b01");
  });

  it("整改7：依次点击三类问题行 peek 逐次正确切换（无缓存驻留）", async () => {
    const conflict = { ...issue, issueId: "rc-1", issueKind: "relation_conflict", handling: "adjudicate", title: "两处来源结论冲突", proposedAction: { type: "inference-review", conflictId: "CF-1" } } as AnomalyIssue;
    const wildTag = { ...issue, issueId: "wt-1", issueKind: "wild_tag", handling: "fix", title: "野生标签：灰度发布", proposedAction: { type: "schema-tag-adjudicate", value: "灰度发布" } } as AnomalyIssue;
    const pipeline = { ...issue, issueId: "pf-1", issueKind: "pipeline_failure", handling: "operate", title: "管道诊断失败：extract", proposedAction: null } as AnomalyIssue;
    useAnomalyWorkbenchStore.setState({ issues: [conflict, wildTag, pipeline], selectedIssueId: null, status: "success", error: null, refreshing: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { generatedAt: "2026-10-07T00:00:00.000Z", issues: [conflict, wildTag, pipeline], total: 3 } }) }));
    render(<AnomalyWorkbenchView />);
    // 整改五轮：peek 默认常驻展开——无需点开按钮，直接逐次点击三类行
    await screen.findByRole("complementary", { name: "问题详情" });
    for (const [issueId, expectTitle] of [["rc-1", "两处来源结论冲突"], ["wt-1", "野生标签：灰度发布"], ["pf-1", "管道诊断失败：extract"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: (n: string) => n.startsWith(`问题行 ${issueId}：`) }));
      const peek = screen.getByRole("complementary");
      await waitFor(() => expect(within(peek).getByText(expectTitle)).toBeInTheDocument());
    }
    vi.unstubAllGlobals();
  });

  it("keeps source rows visible when the workbench also renders the decision panels", () => {
    const mysql = { ...issue, issueId: "mysql-layout", evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/MySQL.md", lineNumber: null, ruleId: "B01" }] } as AnomalyIssue;
    const token = { ...issue, issueId: "token-layout", issueKind: "pipeline_failure", title: "Token 管道失败", evidence: [{ kind: "pipeline-runner", path: "知识库/raw/precleaned/Token.md", lineNumber: null, ruleId: "pipeline.global-diagnostic" }] } as AnomalyIssue;
    render(<AnomalySourceTable groups={groupIssuesByArticle([mysql, token])} selectedIssueId={mysql.issueId} onSelect={vi.fn()} />);

    const sourceTable = screen.getByRole("region", { name: "问题来源待处理项" });
    expect(sourceTable).toHaveClass("shrink-0");
    expect(within(sourceTable).getByText("知识库/wiki/entities/MySQL.md")).toBeVisible();
    expect(within(sourceTable).getByText("知识库/raw/precleaned/Token.md")).toBeVisible();
  });

});
