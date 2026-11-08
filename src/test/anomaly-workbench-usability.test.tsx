import { describe, expect, it, vi } from "vitest";

const repairApiMock = vi.hoisted(() => ({ previewEntityRepair: vi.fn() }));
vi.mock("@/lib/domain/entity-repair-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/domain/entity-repair-api")>()),
  previewEntityRepair: repairApiMock.previewEntityRepair,
}));
import { selectKeysWithinGroups } from "@/features/anomaly-workbench/anomaly-article-groups";
import { describeBlocker } from "@/lib/domain/entity-repair-api";

// #1798 待处理问题可用性批（用户验证反馈 4 项）红灯证据工具：
// ②一键补齐按钮消失（自动刷新清空勾选后不恢复）；①合规阻断明细英文不可懂（F02/F16）。

describe("#1797-A2 selectKeysWithinGroups · 勾选保留（修复按钮消失）", () => {
  it("分组为空（加载中/刷新瞬间）时保留既有勾选，不清空", () => {
    expect(selectKeysWithinGroups(["k1", "k2"], [])).toEqual(["k1", "k2"]);
  });

  it("分组恢复后只保留仍存在的 key（交集）", () => {
    const groups = [{ articleKey: "k1" }, { articleKey: "k3" }];
    expect(selectKeysWithinGroups(["k1", "k2"], groups)).toEqual(["k1"]);
  });
});

describe("#1797-A2 describeBlocker · 写门阻断中文化", () => {
  it("F02（架构身份必填）给出中文可读说明，且不再宣称小写格式（PR-229 批A 撤形状执法）", () => {
    const text = describeBlocker("F02", 'frontmatter.architecture-node-id must NOT have fewer than 1 characters ("architecture-node-id")');
    expect(text).toContain("必填");
    expect(text).not.toMatch(/小写|kebab/i);
  });

  it("F16（tags 缺失）给出中文可读说明（含标签）", () => {
    const text = describeBlocker("F16", 'frontmatter.tags is a missing required field ("tags")');
    expect(text).toContain("标签");
  });

  it("未知 ruleId 回退原始 message（不吞信息）", () => {
    expect(describeBlocker("X99", "原始英文消息")).toBe("原始英文消息");
  });

  it("原文已含中文（检查器直接产出人话）不二次包装", () => {
    expect(describeBlocker("F02", "架构组件身份（architecture-node-id）是必填字段，当前值：（未填写）")).toBe("架构组件身份（architecture-node-id）是必填字段，当前值：（未填写）");
  });
});

describe("#1798-B · 用户实浏览器复测回归（真凶修复）", () => {
  it("T7 操作条浮层标注选中数（整改5：原型 selbar「N selected」同构，「可执行动作：」前缀随空态退役）", async () => {
    const { AnomalyActionToolbar } = await import("@/features/anomaly-workbench/components");
    const groups = [{ articleKey: "k1", issues: [{ issueId: "i1", issueKind: "missing_entity", proposedAction: { type: "entity-repair", sourceKey: "s1" } }] } as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue];
    const { render: r, screen: s } = await import("@testing-library/react");
    r(<AnomalyActionToolbar groups={groups as never} selectedKeys={["k1"]} onSelectionChange={() => {}} onAction={() => {}} />);
    const bar = s.getByRole("toolbar", { name: "批量操作条" });
    expect(bar).toHaveTextContent("1 篇已选");
    expect(s.queryByText(/可执行动作：/)).not.toBeInTheDocument();
  });
});

// ── #1800 单一处理上下文（goal 拍板方案）红灯证据 ──
import { act, render as rtlRender, screen as sc, waitFor as w4 } from "@testing-library/react";
import { AnomalyWorkbenchView as View } from "@/features/anomaly-workbench/AnomalyWorkbenchView";
import { useAnomalyWorkbenchStore as useStore } from "@/features/anomaly-workbench/anomaly-workbench-store";
import { ApiError } from "@/lib/api";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";

const missingEntity: import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue = {
  issueId: "me-1",
  issueKind: "missing_entity",
  handling: "fix",
  title: "实体缺失：可观测性",
  status: "open",
  evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/可观测性.md", lineNumber: null, ruleId: "G01" }],
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/可观测性.md", entityId: "doc-1", field: "module_entity" },
  executionReady: true,
} as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;

const candidate: import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue = {
  issueId: "cand-1",
  issueKind: "article_association",
  handling: "adjudicate",
  title: "文章尚未关联架构组件",
  status: "open",
  evidence: [{ kind: "relation-candidate", path: "知识库/raw/precleaned/c.md", lineNumber: null, ruleId: "G01" }],
  blockedActions: [],
  relationCandidate: {
    candidateId: "rc-1", candidateStatus: "pending_review", conflictGroupId: "cg-1",
    candidateHash: `sha256:${"a".repeat(64)}`, evidenceSetHash: `sha256:${"b".repeat(64)}`, sourceSetHash: `sha256:${"c".repeat(64)}`,
    triples: [], confidence: 0.9,
  },
  proposedAction: { type: "article-association", sourceKey: "知识库/raw/precleaned/c.md" },
  executionReady: true,
} as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;

function stubIssues(issues: import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ success: true, data: { generatedAt: "2026-09-11T00:00:00.000Z", issues, total: issues.length, workingRevisions: {} } }),
  }));
}

describe("#1800 · 勾选联动面板选中（问题③设计修正）", () => {
  it("T10 勾选单行（缺实体组）→ selectedIssueId 联动为该组首条（Linear 壳：行勾选=文章组粒度）", async () => {
    stubIssues([candidate, missingEntity]);
    useStore.setState({ issues: [candidate, missingEntity], selectedIssueId: null, status: "idle", error: null, refreshing: false });
    rtlRender(<View />);
    const row = await sc.findByRole("button", { name: (n: string) => n.startsWith(`问题行 ${missingEntity.issueId}：`) });
    const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => { checkbox.click(); });
    await w4(() => expect(useStore.getState().selectedIssueId).toBe("me-1"));
  });

  it("T9 边界负例：勾选多行不联动面板选中（批量语义保持）", async () => {
    stubIssues([candidate, missingEntity]);
    useStore.setState({ issues: [candidate, missingEntity], selectedIssueId: null, status: "idle", error: null, refreshing: false });
    rtlRender(<View />);
    await sc.findByRole("button", { name: (n: string) => n.startsWith(`问题行 ${candidate.issueId}：`) });
    expect(useStore.getState().selectedIssueId).not.toBe("me-1");
  });

  it("T13 WP-146 件2：行选→组勾选亮起（store.select 并入所属文章组键，两视图单向源）", async () => {
    stubIssues([candidate, missingEntity]);
    useStore.setState({ issues: [candidate, missingEntity], selectedIssueId: null, selectedArticleKeys: [], status: "idle", error: null, refreshing: false });
    rtlRender(<View />);
    const row = await sc.findByRole("button", { name: (n: string) => n.startsWith(`问题行 ${missingEntity.issueId}：`) });
    act(() => { row.click(); });
    // 行选即同步勾选其所属文章组（键=groupIssuesByArticle 同源 canonical 组键）
    await w4(() => expect(useStore.getState().selectedArticleKeys).toEqual(["知识库/wiki/entities/可观测性.md"]));
    expect(useStore.getState().selectedIssueId).toBe("me-1");
    // 组勾选亮起→批量操作条出现并计 1 篇
    expect(sc.getByRole("toolbar", { name: "批量操作条" })).toHaveTextContent("1 篇已选");
  });
});

describe("#1800 · apply 422 阻断明细贯通（问题①接线）", () => {
  it("T11 抽屉收到结构化 ApiError → 渲染逐条中文阻断明细（身份必填说明，无形状说法）", () => {
    const err = new ApiError("新建实体存在 1 项合规阻断，禁止写入\n排查编号：tr_x", {
      errorCode: "ENTITY_COMPLIANCE_BLOCKED",
      details: { blockers: [{ ruleId: "F02", field: "architecture-node-id", message: 'frontmatter.architecture-node-id must NOT have fewer than 1 characters ("architecture-node-id")' }] },
    });
    rtlRender(<AnomalyEntityRepairDrawer issue={missingEntity} relatedIssues={[missingEntity]} error={null} apiError={err} onPreview={vi.fn()} onConfirm={vi.fn()} onBatchApplied={vi.fn()} onClose={vi.fn()} />);
    expect(sc.getByText(/必填/)).toBeInTheDocument();
    expect(sc.queryByText(/小写|kebab/i)).not.toBeInTheDocument();
    expect(sc.getByText(/F02/)).toBeInTheDocument();
  });
});

vi.mock("@/features/entity-compliance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/entity-compliance")>()),
  fetchEntityCompliance: vi.fn().mockRejectedValue(new Error("无合规对象")),
}));
vi.mock("@/features/schema-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/schema-manager")>()),
  fetchEnums: vi.fn().mockResolvedValue({ revision: "r", layers: [], categories: [], subdomains: {}, lifecycle_status: ["有效"], modules: {}, tags: {} }),
  fetchVersionRegistry: vi.fn().mockResolvedValue({
    schema_version: 1, revision: "rv", sourceFile: "versions.yaml", summary: {},
    products: { AnyShare: { versions: [{ id: "7.0.6.7", label: "As 7.0.6.7", status: "draft", release_date: null, aliases: [], snapshot: null }, { id: "7.0.6.8", label: "As 7.0.6.8", status: "draft", release_date: null, aliases: [], snapshot: null }] } },
    diagnostics: [],
  }),
}));

describe("#1800 · 批量链 apply 422 阻断明细（问题① B1 分流路径）", () => {
  it("T11b 存量修复走 B1 批量链被写门拒绝（ENTITY_COMPLIANCE_BLOCKED）→ 明细区逐条渲染", async () => {
    const { render: r2, screen: s2, waitFor: w2, fireEvent } = await import("@testing-library/react");
    const { AnomalyEntityRepairDrawer: Drawer } = await import("@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer");
    const gateError = new ApiError("新建实体存在 2 项阻断，禁止写入\n排查编号：tr_b", {
      errorCode: "ENTITY_COMPLIANCE_BLOCKED",
      details: { blockers: [
        { ruleId: "F02", field: "architecture-node-id", message: "frontmatter.architecture-node-id does not match pattern" },
        { ruleId: "F16", field: "tags", message: "missing required property tags" },
      ] },
    });
    repairApiMock.previewEntityRepair.mockRejectedValueOnce(gateError);
    // 存量修复场景（isMissingEntity=false：跳过新建全量必填拦截）；改非动作字段 title → 单字段≠action.field → B1 批量分流
    const issue = {
      issueId: "mf-9", issueKind: "missing_field", handling: "fix", title: "字段缺失：状态", status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/x.md", ruleId: "G01" }],
      blockedActions: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/x.md", field: "status" },
    } as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;
    r2(<Drawer issue={issue} relatedIssues={[issue]} error={null} apiError={null} onPreview={vi.fn()} onConfirm={vi.fn()} onBatchApplied={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await s2.findByLabelText("实体名称");
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!native) throw new Error("value setter unavailable");
    native.call(titleInput, "可观测性-v2");
    fireEvent.input(titleInput, { target: { value: "可观测性-v2" } });
    fireEvent.click(s2.getByRole("button", { name: /查看修复结果/ }));
    await w2(() => {
      expect(s2.getByText(/保存被以下规则阻断/)).toBeInTheDocument();
      expect(s2.getByText(/F02/)).toBeInTheDocument();
      expect(s2.getByText(/F16/)).toBeInTheDocument();
    });
  });
});

describe("#1804 · 写门明细字段名中文化（用户看懂哪个字段填错）", () => {
  it("T11e fieldLabel 复合键 + 明细文本不含裸 arch_since", async () => {
    const { fieldLabel, humanizeFieldTerms } = await import("@/components/entity-repair/entity-repair-field-model");
    expect(fieldLabel("arch_since/arch_until")).toBe("组件有效期起点 / 组件有效期终点");
    expect(humanizeFieldTerms("arch_since 必须小于 arch_until")).toBe("组件有效期起点 必须小于 组件有效期终点");
    // 原始信息里的技术路径不替换（排障信息保真）
    expect(humanizeFieldTerms("frontmatter.tags is a missing required property")).toBe("frontmatter.tags is a missing required property");
    expect(humanizeFieldTerms("frontmatter.arch_since 必须小于 arch_until")).toBe("frontmatter.arch_since 必须小于 组件有效期终点");
  });

  it("T11f F09 阻断明细渲染后用户可读（含中文标签与当前值，无裸字段名）", async () => {
    const { render: r2, screen: s2, waitFor: w2, fireEvent } = await import("@testing-library/react");
    const { AnomalyEntityRepairDrawer: Drawer } = await import("@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer");
    const regressionError = new ApiError("修复会新增受守护规则的阻断: F09\n排查编号：tr_f09", {
      errorCode: "POST_CHECK_REGRESSION",
      details: { newViolations: [
        { ruleId: "F09", field: "arch_since/arch_until", severity: "error", passed: false, currentValue: "7.0.6.8 → 7.0.6.7", message: "arch_since 必须小于 arch_until" },
      ] },
    });
    repairApiMock.previewEntityRepair.mockRejectedValueOnce(regressionError);
    const issue = {
      issueId: "mf-c", issueKind: "missing_field", handling: "fix", title: "字段缺失：状态", status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/x.md", ruleId: "G01" }],
      blockedActions: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/x.md", field: "status" },
    } as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;
    r2(<Drawer issue={issue} relatedIssues={[issue]} error={null} apiError={null} onPreview={vi.fn()} onConfirm={vi.fn()} onBatchApplied={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await s2.findByLabelText("实体名称");
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!native) throw new Error("value setter unavailable");
    native.call(titleInput, "可观测性-v3");
    fireEvent.input(titleInput, { target: { value: "可观测性-v3" } });
    fireEvent.click(s2.getByRole("button", { name: /查看修复结果/ }));
    const detail = await s2.findByText(/保存被以下规则阻断/);
    await w2(() => {
      const region = detail.closest("div")?.textContent ?? "";
      expect(region).toContain("组件有效期起点");
      expect(region).toContain("7.0.6.8");
      expect(region).not.toMatch(/arch_since/);
    });
  });
});

describe("#1803 · 预览重试成功后错误明细必须消失", () => {
  it("T11d 预览失败(F09) → 修正重试成功 → F09 明细区卸载", async () => {
    const { render: r2, screen: s2, waitFor: w2, fireEvent } = await import("@testing-library/react");
    const { AnomalyEntityRepairDrawer: Drawer } = await import("@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer");
    const regressionError = new ApiError("修复会新增受守护规则的阻断: F09\n排查编号：tr_f09", {
      errorCode: "POST_CHECK_REGRESSION",
      details: { newViolations: [{ ruleId: "F09", field: "arch_since/arch_until", severity: "error", passed: false, currentValue: "7.0.6.8 → 7.0.6.7", message: "arch_since 必须小于 arch_until" }] },
    });
    const okPreview = { previewId: "pv-ok", changedFields: ["arch_since"], postCheck: { blockerCount: 0, warningCount: 0, blockers: [] } };
    repairApiMock.previewEntityRepair.mockRejectedValueOnce(regressionError).mockResolvedValueOnce(okPreview);
    const issue = {
      issueId: "mf-b", issueKind: "missing_field", handling: "fix", title: "字段缺失：状态", status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/x.md", ruleId: "G01" }],
      blockedActions: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/x.md", field: "status" },
    } as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;
    r2(<Drawer issue={issue} relatedIssues={[issue]} error={null} apiError={null} onPreview={vi.fn()} onConfirm={vi.fn()} onBatchApplied={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await s2.findByLabelText("实体名称");
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!native) throw new Error("value setter unavailable");
    native.call(titleInput, "可观测性-v3");
    fireEvent.input(titleInput, { target: { value: "可观测性-v3" } });
    // 第一次预览：失败（F09 明细出现）
    fireEvent.click(s2.getByRole("button", { name: /查看修复结果/ }));
    await w2(() => { expect(s2.getByText(/保存被以下规则阻断/)).toBeInTheDocument(); });
    // 重试：成功 → 明细必须消失
    fireEvent.click(s2.getByRole("button", { name: /查看修复结果/ }));
    await w2(() => { expect(s2.queryByText(/保存被以下规则阻断/)).not.toBeInTheDocument(); });
    expect(s2.getByText(/写回后 0 个阻断问题/)).toBeInTheDocument();
  });
});

describe("#1801 · POST_CHECK_REGRESSION 预览拒绝路径明细（F09 实案）", () => {
  it("T11c preview 阶段 POST_CHECK_REGRESSION + details.newViolations → F09 中文明细含当前值", async () => {
    const { render: r2, screen: s2, waitFor: w2, fireEvent } = await import("@testing-library/react");
    const { AnomalyEntityRepairDrawer: Drawer } = await import("@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer");
    const regressionError = new ApiError("修复会新增受守护规则的阻断: F09\n排查编号：tr_f09", {
      errorCode: "POST_CHECK_REGRESSION",
      details: { newViolations: [
        { ruleId: "F09", field: "arch_since/arch_until", severity: "error", passed: false, currentValue: "7.0.6.8 → 7.0.6.7", message: "arch_since 必须小于 arch_until" },
      ] },
    });
    repairApiMock.previewEntityRepair.mockRejectedValueOnce(regressionError);
    const issue = {
      issueId: "mf-a", issueKind: "missing_field", handling: "fix", title: "字段缺失：状态", status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/x.md", ruleId: "G01" }],
      blockedActions: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/x.md", field: "status" },
    } as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;
    r2(<Drawer issue={issue} relatedIssues={[issue]} error={null} apiError={null} onPreview={vi.fn()} onConfirm={vi.fn()} onBatchApplied={vi.fn()} onClose={vi.fn()} />);
    const titleInput = await s2.findByLabelText("实体名称");
    const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (!native) throw new Error("value setter unavailable");
    native.call(titleInput, "可观测性-v3");
    fireEvent.input(titleInput, { target: { value: "可观测性-v3" } });
    fireEvent.click(s2.getByRole("button", { name: /查看修复结果/ }));
    await w2(() => {
      const alerts = s2.getAllByRole("alert").map((el) => el.textContent);
      expect(alerts.join("|")).toMatch(/小于/);
    });
    expect(s2.getByText(/当前值：7\.0\.6\.8/)).toBeInTheDocument();
  });
});

describe("#1800 · 有效期字段版本下拉（问题②接线）", () => {
  it("T12 实体分支加载版本注册表后 arch_since/arch_until 升级为下拉", async () => {
    const { render: r2, screen: s2, waitFor: w2 } = await import("@testing-library/react");
    const { AnomalyEntityRepairDrawer: Drawer } = await import("@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer");
    const issue = {
      issueId: "me-2", issueKind: "missing_entity", handling: "fix", title: "实体缺失", status: "open",
      evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/x.md", ruleId: "G01" }],
      blockedActions: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/x.md", field: "status" },
    } as unknown as import("@/features/anomaly-workbench/anomaly-workbench-types").AnomalyIssue;
    r2(<Drawer issue={issue} relatedIssues={[issue]} error={null} apiError={null} onPreview={vi.fn()} onConfirm={vi.fn()} onBatchApplied={vi.fn()} onClose={vi.fn()} />);
    await w2(() => {
      expect(s2.getByRole("button", { name: "组件有效期起点 选项" })).toBeInTheDocument();
      expect(s2.getByRole("button", { name: "组件有效期终点 选项" })).toBeInTheDocument();
    });
  });
});
