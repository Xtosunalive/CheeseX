import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { unwrapEnvelope } from "@/lib/api";
import { extractRepairBlockers } from "@/lib/domain/entity-repair-api";

// seq178（#1456 红灯证据工具）：实体修复写门拒绝（ENTITY_COMPLIANCE_BLOCKED）的字段级
// 规则明细（ruleId/field/message）后端已带回（entity-repair-service.cjs details.blockers，
// #1415），本测试钉住前端消费链路：unwrapEnvelope 保留结构化错误元数据 + 修复抽屉按
// 字段回显阻断明细。实现前本文件为红灯（断言失败），实现后转绿（行为级红灯证据，
// 规则 28 全环境层）。

const BLOCKERS = [
  { ruleId: "F02", field: "architecture-node-id", message: "架构组件身份是必填字段，不能留空" },
  { ruleId: "F16", field: "tags", message: "标签不能为空" },
];

describe("entity repair blocker details (seq178)", () => {
  it("unwrapEnvelope keeps structured errorCode and details for business consumption", async () => {
    const envelope = Promise.resolve({
      ok: false,
      data: null,
      error: "新建实体存在 2 项合规阻断，禁止写入\n排查编号：tr_seq178-12345678",
      errorCode: "ENTITY_COMPLIANCE_BLOCKED",
      details: { blockers: BLOCKERS },
      traceId: "tr_seq178-12345678",
      status: 422,
    });
    const error = await unwrapEnvelope(envelope, "fallback").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as { errorCode?: string }).errorCode).toBe("ENTITY_COMPLIANCE_BLOCKED");
    expect((error as { details?: { blockers: unknown[] } }).details?.blockers).toHaveLength(2);
  });

  it("extractRepairBlockers ignores non-write-gate errors and malformed payloads (boundary negatives)", () => {
    // 分类类负例：其他错误码/普通错误不得被误判为合规阻断
    expect(extractRepairBlockers(new Error("普通错误"))).toEqual([]);
    expect(extractRepairBlockers(Object.assign(new Error("冲突"), { errorCode: "CONFLICT", details: { blockers: BLOCKERS } }))).toEqual([]);
    expect(extractRepairBlockers(null)).toEqual([]);
    expect(extractRepairBlockers(undefined)).toEqual([]);
    // 输入类负例：details 形状畸形（缺失/非数组/元素残缺）→ 空数组或显式归一化，不抛异常
    expect(extractRepairBlockers(Object.assign(new Error("x"), { errorCode: "ENTITY_COMPLIANCE_BLOCKED", details: null }))).toEqual([]);
    expect(extractRepairBlockers(Object.assign(new Error("x"), { errorCode: "ENTITY_COMPLIANCE_BLOCKED", details: { blockers: "not-an-array" } }))).toEqual([]);
    expect(extractRepairBlockers(Object.assign(new Error("x"), { errorCode: "ENTITY_COMPLIANCE_BLOCKED", details: { blockers: [null, 42, { field: "tags" }] } }))).toEqual([
      { ruleId: "UNKNOWN", field: "", message: "不合规原因未提供" },
      { ruleId: "UNKNOWN", field: "", message: "不合规原因未提供" },
      { ruleId: "UNKNOWN", field: "tags", message: "不合规原因未提供" },
    ]);
    // 正常路径基线：合法 blockers 原样归一化
    expect(extractRepairBlockers(Object.assign(new Error("x"), { errorCode: "ENTITY_COMPLIANCE_BLOCKED", details: { blockers: BLOCKERS } }))).toEqual(BLOCKERS);
  });

  // PR-031（2026-11-03 直修）：jsdom 重渲染用例在本机负载下偶发撞 5000ms 默认超时（PR-029 定性负载相关抖动，
  // CI linux runner 不红）。按登记簿在册修法二选一取「加超时参数」——20s 对 11 例共享 environment（~12s）
  // 留两倍余量，只放宽时限不降断言；观测窗方案（连续 3 天零超时）因无逐日记录可证而放弃。
  it("repair drawer renders per-field blocker details when apply is rejected by the write gate", { timeout: 20000 }, async () => {
    const applyEntityRepair = vi.fn().mockRejectedValue(
      Object.assign(new Error("新建实体存在 2 项合规阻断，禁止写入"), {
        errorCode: "ENTITY_COMPLIANCE_BLOCKED",
        details: { blockers: BLOCKERS },
      }),
    );
    vi.doMock("@/features/entity-compliance/entity-compliance-api", () => ({
      applyEntityRepair,
    }));
    // 动态引入被测组件与 store，确保 doMock 生效
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");

    useStore.setState({
      selectedEntity: {
        sourceKey: "知识库/wiki/entities/demo.md",
        sourceType: "entity",
        title: "演示实体",
        fileName: "demo.md",
        groups: [],
      } as never,
      repairOpen: true,
      creatingEntity: true,
      repairStatus: "preview_ready",
      repairError: null,
      preview: {
        previewId: "preview-seq178",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        postCheck: { blockerCount: 2, warningCount: 0 },
      } as never,
    });

    render(<Drawer />);
    fireEvent.click(screen.getByRole("button", { name: "直接写回" }));

    await waitFor(() => {
      // 抽屉必须按字段回显写门阻断明细：字段中文名 + 原因（WP-035：规则编号不再上屏——人话信息足矣）
      expect(screen.getByTestId("repair-blocker-details")).toBeInTheDocument();
    });
    expect(screen.queryByText(/F\d{2}/)).not.toBeInTheDocument();
    expect(screen.getByText(/架构组件身份是必填字段，不能留空/)).toBeInTheDocument();
    expect(screen.getByText(/标签不能为空/)).toBeInTheDocument();
  });
});

// seq179（#1470 红灯证据工具）：写门阻断明细的展示时机前移——「查看修复结果」（preview）
// 响应的 postCheck.blockers（EG-1a 已契约定型 BlockerDetail）必须在预览阶段就按字段行内
// 回显（复用 seq178 的 blockerByField/errorText 机制），用户不点「直接写回」就能看到每个
// 字段为什么被阻断。实现前本组用例为红灯，实现后转绿。
describe("entity repair preview-stage blockers (seq179)", () => {
  const FINDINGS = [
    { ruleId: "F02", field: "architecture-node-id", editable: true, message: "架构组件身份缺失", value: "", allowedValues: [] },
    { ruleId: "F16", field: "tags", editable: true, message: "标签不能为空", value: "", allowedValues: [] },
  ];
  const ENTITY = {
    sourceKey: "知识库/wiki/entities/demo.md",
    sourceType: "entity",
    sourceRevision: "rev-1",
    title: "演示实体",
    fileName: "demo.md",
    groups: [{ name: "g", checks: FINDINGS }],
  };

  function mockPreviewApi() {
    const previewEntityRepair = vi.fn().mockResolvedValue({
      previewId: "preview-seq179",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      postCheck: { blockerCount: 2, warningCount: 0, blockers: BLOCKERS },
      findings: [],
    });
    const applyEntityRepair = vi.fn();
    vi.doMock("@/features/entity-compliance/entity-compliance-api", () => ({ previewEntityRepair, applyEntityRepair }));
    return { previewEntityRepair, applyEntityRepair };
  }

  async function loadDrawerWithPreview() {
    vi.resetModules(); // 同文件前序用例已动态 import 过组件/store——重置模块缓存确保本用例 doMock 生效
    const { previewEntityRepair, applyEntityRepair } = mockPreviewApi();
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    useStore.setState({
      selectedEntity: ENTITY as never,
      repairOpen: true,
      creatingEntity: false,
      repairStatus: "idle",
      repairError: null,
      repairChanges: { "architecture-node-id": "demo", tags: "x" },
      preview: null,
      applyResult: null,
      repairBlockers: [],
    });
    render(<Drawer />);
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => {
      expect(useStore.getState().repairStatus).toBe("preview_ready");
    });
    return { previewEntityRepair, applyEntityRepair };
  }

  it("preview-stage blockers render inline per field without clicking apply", async () => {
    const { applyEntityRepair } = await loadDrawerWithPreview();
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    // PR-026 池行式：行内回显在展开区——先展开首个可展开的阻断字段行（标签）。
    // WP-113 M2 随迁：架构组件身份行已入托管家族（不展开、无行内编辑器）——其 F02 阻断仍在底部明细区块回显，
    // 行内 errorText 通道的样本随之移交 tags。
    fireEvent.click(await screen.findByRole("button", { name: /标签.*当前值/ }));
    expect(await screen.findByText(/阻断原因：/)).toBeInTheDocument();
    // 同一 message 同时出现在底部明细区块（含不再可展开的托管字段行）→ getAllByText
    expect(screen.getAllByText(/架构组件身份是必填字段，不能留空/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/标签不能为空/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("repair-blocker-details")).toBeInTheDocument();
    expect(useStore.getState().repairBlockers).toHaveLength(2);
    // apply 未被点击（预览阶段纯展示）
    expect(applyEntityRepair).not.toHaveBeenCalled();
  });

  it("changing a field clears stale preview blockers (no residue from old preview)", async () => {
    await loadDrawerWithPreview();
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    // 旧预览明细在字段修改后必须清空（预览已失效，明细随之失效）
    // PR-026 池行式：先展开可编辑字段行再改值（WP-113 M2：身份行托管不可展开，样本改 tags）
    fireEvent.click(await screen.findByRole("button", { name: /标签.*当前值/ }));
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "demo-v2" } });
    // TokenInput 的真实提交姿势＝回车或失焦把整串作为一个标签入列（见 repair-field-config.ts 头注）：
    // 只 change 不提交，store 不会收到 setRepairField，明细也就不清——那是夹具姿势错，不是行为缺陷。
    fireEvent.keyDown(inputs[0], { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(useStore.getState().repairBlockers).toEqual([]);
    });
    expect(screen.queryByTestId("repair-blocker-details")).not.toBeInTheDocument();
  });

  it("布尔字段行也回显行内阻断原因（WP-113 M2 反证夹具：撤掉抽屉那段即红）", async () => {
    vi.resetModules();
    const { previewEntityRepair } = mockPreviewApi();
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    useStore.setState({
      selectedEntity: {
        sourceKey: "知识库/wiki/entities/bool.md", sourceType: "entity", sourceRevision: "rev-b",
        title: "布尔样本", fileName: "bool.md",
        groups: [{ name: "g", checks: [{ ruleId: "F13", field: "arch_component", label: "架构组件", severity: "error", passed: false, editable: true, value: false, message: "激活为架构组件必须显式设为 true" }] }],
        sourceValues: { arch_component: false },
      } as never,
      repairOpen: true, creatingEntity: false, repairStatus: "preview_ready", repairError: null,
      repairChanges: {}, relationPatch: null, preview: null, applyResult: null,
      repairBlockers: [{ ruleId: "F13", field: "arch_component", message: "激活为架构组件必须显式设为 true" }],
    });
    render(<Drawer />);
    fireEvent.click(await screen.findByRole("button", { name: /当前值/ }));
    expect(await screen.findByText(/^阻断原因：/)).toBeInTheDocument();
    expect(previewEntityRepair).toBeDefined();
  });

  it("extractPostCheckBlockers normalizes malformed postCheck shapes (boundary negatives)", async () => {
    const { extractPostCheckBlockers } = await import("@/lib/domain/entity-repair-api");
    expect(extractPostCheckBlockers(null)).toEqual([]);
    expect(extractPostCheckBlockers(undefined)).toEqual([]);
    expect(extractPostCheckBlockers({ blockerCount: 2 })).toEqual([]);
    expect(extractPostCheckBlockers({ blockers: "not-an-array" })).toEqual([]);
    expect(extractPostCheckBlockers({ blockers: [null, 42, { field: "tags" }] })).toEqual([
      { ruleId: "UNKNOWN", field: "", message: "不合规原因未提供" },
      { ruleId: "UNKNOWN", field: "", message: "不合规原因未提供" },
      { ruleId: "UNKNOWN", field: "tags", message: "不合规原因未提供" },
    ]);
    expect(extractPostCheckBlockers({ blockers: BLOCKERS })).toEqual(BLOCKERS);
  });
});

// seq181（红灯证据工具）：preview 请求被拒（VALIDATION_ERROR 族字段级校验）的错误归因——
// 错填 arch_until 点「查看修复结果」时，后端 validateChanges 在 postCheck 之前拒绝整个请求，
// 此通道的错误此前只进抽屉底部全局条（repairError），message 是英文技术术语且不归因字段。
// 目标态：字段级校验错误按字段行内回显（复用 seq178 repairBlockers 槽+行内 errorText 机制），
// 中文标签走 FIELD_LABELS 单源；全局条不吞字段错误。实现前本组用例为红灯，实现后转绿。
describe("entity repair preview-rejected field attribution (seq181)", () => {
  const ENTITY_ARCH_UNTIL = {
    sourceKey: "知识库/wiki/entities/demo.md",
    sourceType: "entity",
    sourceRevision: "rev-1",
    title: "演示实体",
    fileName: "demo.md",
    groups: [{ name: "g", checks: [{ ruleId: "F30", field: "arch_until", editable: true, message: "", value: "", allowedValues: [] }] }],
  };

  async function loadDrawerWithRejectedPreview() {
    vi.resetModules();
    const previewEntityRepair = vi.fn().mockRejectedValue(
      Object.assign(new Error("arch_until 必须是 semver"), {
        errorCode: "VALIDATION_ERROR",
        details: { field: "arch_until", rule: "semver" },
      })
    );
    vi.doMock("@/features/entity-compliance/entity-compliance-api", () => ({ previewEntityRepair, applyEntityRepair: vi.fn() }));
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    useStore.setState({
      selectedEntity: ENTITY_ARCH_UNTIL as never,
      repairOpen: true,
      creatingEntity: false,
      repairStatus: "idle",
      repairError: null,
      repairChanges: { arch_until: "not-a-version" },
      preview: null,
      applyResult: null,
      repairBlockers: [],
    });
    render(<Drawer />);
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    return { useStore };
  }

  it("routes field-level validation error to inline blocker with Chinese label, not the global banner", async () => {
    const { useStore } = await loadDrawerWithRejectedPreview();
    await waitFor(() => {
      expect(useStore.getState().repairBlockers).toEqual([
        { ruleId: "VALIDATION_ERROR", field: "arch_until", message: "组件有效期终点 必须是 semver" },
      ]);
    });
    expect(useStore.getState().repairError).toBeNull();
    expect(screen.getAllByText(/组件有效期终点 必须是 semver/).length).toBeGreaterThanOrEqual(1);
  });

  it("non-field errors keep the global banner (boundary negative)", async () => {
    vi.resetModules();
    const previewEntityRepair = vi.fn().mockRejectedValue(
      Object.assign(new Error("sourceKey 必须是 Vault 相对路径"), { errorCode: "VALIDATION_ERROR", details: undefined })
    );
    vi.doMock("@/features/entity-compliance/entity-compliance-api", () => ({ previewEntityRepair, applyEntityRepair: vi.fn() }));
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    useStore.setState({
      selectedEntity: ENTITY_ARCH_UNTIL as never,
      repairOpen: true,
      creatingEntity: false,
      repairStatus: "idle",
      repairError: null,
      repairChanges: { arch_until: "1.0.0" },
      preview: null,
      applyResult: null,
      repairBlockers: [],
    });
    render(<Drawer />);
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => {
      expect(useStore.getState().repairError).toBe("sourceKey 必须是 Vault 相对路径");
    });
    expect(useStore.getState().repairBlockers).toEqual([]);
  });

  it("extractFieldBlocker normalizes malformed error shapes (boundary negatives)", async () => {
    vi.resetModules();
    const { extractFieldBlocker } = await import("@/lib/domain/entity-repair-api");
    expect(extractFieldBlocker(null)).toBeNull();
    expect(extractFieldBlocker(new Error("no shape"))).toBeNull();
    expect(extractFieldBlocker(Object.assign(new Error("x"), { errorCode: "VALIDATION_ERROR", details: { rule: "semver" } }))).toBeNull();
    expect(extractFieldBlocker(Object.assign(new Error("x"), { errorCode: "VALIDATION_ERROR", details: "not-an-object" }))).toBeNull();
    expect(
      extractFieldBlocker(Object.assign(new Error("arch_until 必须是 semver"), { errorCode: "VALIDATION_ERROR", details: { field: "arch_until", rule: "semver" } }))
    ).toEqual({ ruleId: "VALIDATION_ERROR", field: "arch_until", message: "组件有效期终点 必须是 semver" });
  });
});

// seq181 用户验收追问复现：arch_version_overrides（JSON 字段）输入 1 → 点查看修复 →
// 后端拒「必须是数组」→ 期望行内「阻断原因：版本属性覆盖 必须是数组」出现。
describe("seq181 follow-up: json field input 1 rejection attribution", () => {
  it("json field scalar input routes array-rule rejection inline", async () => {
    vi.resetModules();
    const previewEntityRepair = vi.fn().mockRejectedValue(
      Object.assign(new Error("arch_version_overrides 必须是数组"), {
        errorCode: "VALIDATION_ERROR",
        details: { field: "arch_version_overrides", rule: "array" },
      })
    );
    vi.doMock("@/features/entity-compliance/entity-compliance-api", () => ({ previewEntityRepair, applyEntityRepair: vi.fn() }));
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    useStore.setState({
      selectedEntity: {
        sourceKey: "知识库/wiki/entities/demo.md", sourceType: "entity", sourceRevision: "rev-1",
        title: "演示实体", fileName: "demo.md",
        groups: [{ name: "g", checks: [{ ruleId: "F40", field: "arch_version_overrides", editable: true, message: "arch_version_overrides 尚未填写", reason: "missing", value: null, allowedValues: [] }] }],
      } as never,
      repairOpen: true, creatingEntity: false, repairStatus: "idle", repairError: null,
      repairChanges: {}, preview: null, applyResult: null, repairBlockers: [],
    });
    render(<Drawer />);
    // PR-026 池行式：展开版本属性覆盖行后 JSON 编辑区挂载
    fireEvent.click(screen.getByRole("button", { name: /版本属性覆盖.*当前值/ }));
    const input = screen.getByLabelText(/版本属性覆盖 JSON/);
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "查看修复结果" }));
    await waitFor(() => {
      expect(useStore.getState().repairBlockers).toEqual([
        { ruleId: "VALIDATION_ERROR", field: "arch_version_overrides", message: "版本属性覆盖 必须是数组" },
      ]);
    });
    expect(useStore.getState().repairError).toBeNull();
    expect(screen.getAllByText(/阻断原因：版本属性覆盖 必须是数组/).length).toBeGreaterThanOrEqual(1);
  });
});

// seq181 收口补强：诊断说明行渲染与否的直接 DOM 断言——
// 抑制判据是结构化字段 finding.reason === "missing"（后端随缺失字段下发），与 message 文案形状无关：
// 前两条 fixture 一条用带字段前缀的文案、一条用裸串（两种历史文案形状），均带 reason → 抑制；
// 第三条文案既非裸串也非前缀串（旧文案判据下会渲染），仍带 reason → 同样抑制，说明抑制由 reason 决定；
// 第四条文案同样是建议填写类但无 reason → 照常渲染，说明判据没有越过 reason 去按文案抑制。
describe("seq181: boilerplate state echo never renders in form (direct negative)", () => {
  it("suppresses messages on findings flagged reason=missing only", async () => {
    vi.resetModules();
    const previewEntityRepair = vi.fn().mockResolvedValue({ previewId: "p", expiresAt: new Date(Date.now() + 60_000).toISOString(), postCheck: { blockerCount: 0, warningCount: 0, blockers: [] }, findings: [] });
    vi.doMock("@/features/entity-compliance/entity-compliance-api", () => ({ previewEntityRepair, applyEntityRepair: vi.fn() }));
    const { EntityRepairDrawer: Drawer } = await import("@/features/entity-compliance/EntityRepairDrawer");
    const { useEntityComplianceStore: useStore } = await import("@/features/entity-compliance/entity-compliance-store");
    useStore.setState({
      selectedEntity: {
        sourceKey: "知识库/wiki/entities/demo.md", sourceType: "entity", sourceRevision: "rev-1",
        title: "演示实体", fileName: "demo.md",
        groups: [{ name: "g", checks: [
          { ruleId: "CREATE-1", field: "arch_layer", editable: true, message: "arch_layer 尚未填写", reason: "missing", value: null, allowedValues: [] },
          { ruleId: "F41", field: "status", editable: true, message: "尚未填写", reason: "missing", value: null, allowedValues: [] },
          { ruleId: "F42", field: "arch_category", editable: true, message: "建议填写架构分类（arch_category）", reason: "missing", value: null, allowedValues: [] },
          { ruleId: "F43", field: "arch_subdomain", editable: true, message: "建议填写子域（arch_subdomain）", value: null, allowedValues: [] },
        ] }],
      } as never,
      repairOpen: true, creatingEntity: false, repairStatus: "idle", repairError: null,
      repairChanges: {}, preview: null, applyResult: null, repairBlockers: [],
    });
    render(<Drawer />);
    expect(screen.queryByText(/尚未填写/)).not.toBeInTheDocument();
    expect(screen.queryByText(/建议填写架构分类/)).not.toBeInTheDocument();
    expect(screen.getByText("架构分层")).toBeInTheDocument();
    expect(screen.getByText("状态")).toBeInTheDocument();
    // PR-026 池行式：非 missing 的说明行在展开区——展开子域行验证渲染（missing 行展开后也不渲染说明）
    fireEvent.click(screen.getByRole("button", { name: /子域.*当前值/ }));
    expect(screen.getByText(/建议填写子域/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /架构分层.*当前值/ }));
    expect(screen.queryByText(/arch_layer 尚未填写/)).not.toBeInTheDocument();
  });
});
