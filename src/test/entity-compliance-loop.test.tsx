import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntityComplianceView } from "@/features/entity-compliance/EntityComplianceView";
import { EntityRepairDrawer } from "@/features/entity-compliance/EntityRepairDrawer";
import { EntityComplianceCard } from "@/features/entity-compliance/EntityComplianceCard";
import { useEntityComplianceStore } from "@/features/entity-compliance/entity-compliance-store";
import * as api from "@/features/entity-compliance/entity-compliance-api";
import type { EntityComplianceResult } from "@/features/entity-compliance/entity-compliance-types";

vi.mock("@/features/entity-compliance/entity-compliance-api", () => ({
  fetchEntityCompliance: vi.fn(), previewEntityRepair: vi.fn(), applyEntityRepair: vi.fn(),
}));

describe("entity check to repair loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEntityComplianceStore.setState({ data: null, selectedEntity: null, repairOpen: false, creatingEntity: false, status: "idle", error: null, repairStatus: "idle", repairError: null });
    const readiness = { ready: false, totalArchComponents: 1, blockerEntities: 1, blockerCount: 1, warningCount: 1, warningDetails: [{ entityId: "svc", title: "Service", sourceKey: "知识库/wiki/entities/svc.md", ruleId: "F06", field: "arch_subdomain", message: "建议填写 arch_subdomain", hint: "填写组件所属子域" }], blockingSourceKeys: ["知识库/wiki/entities/svc.md"] };
    vi.mocked(api.fetchEntityCompliance).mockResolvedValue({ generatedAt: "2026-07-24T00:00:00.000Z", readiness, summary: { totalEntities: 1, blockerEntityCount: 1, blockerCount: 1 }, total: 1, limit: 50, offset: 0, items: [{
      entityId: "svc", title: "Service", fileName: "svc.md", sourceKey: "知识库/wiki/entities/svc.md",
      sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:x" }, blockerCount: 1, warningCount: 0, infoCount: 0, score: 50,
      groups: [{ id: "spatial", label: "空间", checks: [{ ruleId: "F03", field: "arch_layer", label: "层级", severity: "error", passed: false, message: "缺少层级", editable: true, allowedValues: ["service"] }] }],
    }] });
  });

  it("P5 守卫：受检 0 时不渲染零值统计堆，资格横幅恒不渲染（Master 2026-10-29 横幅全撤）", async () => {
    vi.mocked(api.fetchEntityCompliance).mockResolvedValue({ generatedAt: "2026-10-29T00:00:00.000Z", readiness: { ready: true, totalArchComponents: 0, blockerEntities: 0, blockerCount: 0, warningCount: 0, warningDetails: [], blockingSourceKeys: [] }, summary: { totalEntities: 0, healthyCount: 0, blockerEntityCount: 0, warningEntityCount: 0, infoEntityCount: 0, averageScore: 0 }, total: 0, limit: 50, offset: 0, items: [] } as never);
    useEntityComplianceStore.setState({ data: { generatedAt: "2026-10-29T00:00:00.000Z", readiness: { ready: true, totalArchComponents: 0, blockerEntities: 0, blockerCount: 0, warningCount: 0, warningDetails: [], blockingSourceKeys: [] }, summary: { totalEntities: 0, healthyCount: 0, blockerEntityCount: 0, warningEntityCount: 0, infoEntityCount: 0, averageScore: 0 }, total: 0, limit: 50, offset: 0, items: [] } as never, status: "success" as never, error: null });
    render(<EntityComplianceView />);
    await screen.findByText(/未发现匹配/);
    expect(screen.queryByTestId("compliance-summary")).not.toBeInTheDocument(); // 零值堆不渲染
    expect(screen.queryByText(/入图资格/)).not.toBeInTheDocument(); // 横幅撤
  });

  it("opens repair only from an editable finding", async () => {
    render(<><EntityComplianceView /><EntityRepairDrawer /></>);
    const refresh = screen.getByRole("button", { name: "重新检查源文档" });
    expect(refresh).toBeInTheDocument();
    expect(screen.getByTestId("entity-compliance-toolbar")).toHaveClass("rounded-lg", "bg-surface-root", "ring-border-thin");
    expect(await screen.findByTestId("compliance-summary")).toBeInTheDocument(); // 页题已裁删——通过率主卡为就绪锚
    expect(screen.getByRole("textbox", { name: "搜索源文档检查结果" })).toHaveClass("h-8", "text-xs", "bg-transparent");
    expect(screen.getByRole("button", { name: "筛选源文档检查结论" })).toHaveAttribute("data-select-variant", "filter");
    expect(screen.getByRole("button", { name: "清除源文档检查筛选" })).toBeDisabled();
    // 资格横幅已按 Master 2026-10-29「横幅都不要了」撤——结论随统计卡（阻断数）呈现
    expect(await screen.findByText("存在阻断")).toBeInTheDocument();
    // 横幅警告来源汇总随横幅撤（Master 2026-10-29）——问题明细走逐实体卡片（下方 Obsidian/修复断言即卡片侧）
    expect(screen.getByRole("button", { name: "在 Obsidian 中打开 Service" })).toBeInTheDocument();
    const repair = await screen.findByRole("button", { name: /修复 \d+ 字段/ });
    expect(screen.getByRole("button", { name: "收起 Service" })).not.toContainElement(repair);
    fireEvent.click(repair);
    expect(screen.getByText("修复 Service")).toBeInTheDocument();
    // PR-026 池行式：字段说明随行展开出现（折叠态只见字段名+当前值）；
    // showLabel=false 的池行展开区不重复 label 前缀，message 独立成行
    fireEvent.click(screen.getByRole("button", { name: /架构分层.*当前值/ }));
    expect(screen.getAllByText("缺少层级").length).toBeGreaterThan(0);
    await waitFor(() => expect(api.fetchEntityCompliance).toHaveBeenCalledOnce());
    fireEvent.click(refresh);
    await waitFor(() => expect(api.fetchEntityCompliance).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("检查结果无变化，当前 1 项阻断", { exact: false })).toBeInTheDocument();
  });

  it("offers an empty frontmatter skeleton before the user fills semantic values", async () => {
    const entity = {
      entityId: "svc", title: "Service", fileName: "svc.md", sourceKey: "知识库/wiki/entities/svc.md",
      sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:x" }, blockerCount: 0, warningCount: 2, infoCount: 1, score: 80,
    };
    const incompleteEntity: EntityComplianceResult = {
      ...entity,
      groups: [{ id: "identity", label: "身份", checks: [
        { ruleId: "F01", field: "title", label: "标题", severity: "error", passed: false, value: null, message: "title 是必填字段", editable: true },
        { ruleId: "F02", field: "architecture-node-id", label: "架构组件身份", severity: "error", passed: false, value: null, message: "architecture-node-id 是必填字段", editable: true },
        { ruleId: "F03", field: "arch_component", label: "架构组件标记", severity: "error", passed: false, value: null, message: "arch_component 必须为 true", editable: true },
      ] }, { id: "spatial", label: "空间", checks: [
        { ruleId: "F04", field: "arch_layer", label: "分层", severity: "error", passed: false, value: null, message: "arch_layer 是必填字段", editable: true, allowedValues: ["service"] },
        { ruleId: "F05", field: "arch_category", label: "类别", severity: "error", passed: false, value: null, message: "arch_category 是必填字段", editable: true, allowedValues: ["服务"] },
        { ruleId: "F06", field: "arch_subdomain", label: "子域", severity: "warn", passed: false, value: null, message: "建议填写 arch_subdomain", editable: true },
      ] }, { id: "version", label: "版本", checks: [
        { ruleId: "F07", field: "arch_since", label: "起点", severity: "warn", passed: false, value: null, message: "建议填写 arch_since", editable: true },
        { ruleId: "F08", field: "arch_until", label: "终点", severity: "info", passed: true, value: null, message: "通过", editable: true },
        { ruleId: "F10", field: "arch_version_overrides", label: "版本覆盖", severity: "info", passed: true, value: null, message: "通过", editable: true },
      ] }, { id: "organization", label: "组织", checks: [
        { ruleId: "F11", field: "module", label: "模块", severity: "warn", passed: false, value: null, message: "建议填写 module", editable: true },
      ] }, { id: "temporal", label: "时效", checks: [
        { ruleId: "F12", field: "date", label: "创建日期", severity: "error", passed: false, value: null, message: "date 是必填字段", editable: true },
        { ruleId: "F13", field: "updated", label: "更新时间", severity: "warn", passed: false, value: null, message: "建议填写 updated", editable: true },
        { ruleId: "F15", field: "status", label: "状态", severity: "error", passed: false, value: null, message: "status 是必填字段", editable: true },
      ] }, { id: "content", label: "内容", checks: [
        { ruleId: "F16", field: "tags", label: "标签", severity: "error", passed: false, value: null, message: "tags 是必填字段", editable: true },
      ] }],
    };
    useEntityComplianceStore.setState({ selectedEntity: incompleteEntity, repairOpen: true });
    render(<EntityRepairDrawer />);
    // PR-026：横幅与「本次候选」卡退役，生成空字段=底部操作条淡紫钮（行为不变，位置迁移）
    expect(screen.queryByText("发现缺失字段")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成空字段" }));
    expect(useEntityComplianceStore.getState().repairChanges).toMatchObject({
      title: "", arch_component: false, arch_layer: "", arch_category: "", arch_subdomain: "",
      arch_version_overrides: [], module: [], status: "", date: "", updated: "",
      tags: [], arch_since: "", arch_until: "",
    });
  });

  it("preserves every module value in the existing multiple-value repair control", () => {
    const entity: EntityComplianceResult = {
      entityId: "svc", title: "Service", fileName: "svc.md", sourceKey: "知识库/wiki/entities/svc.md",
      sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:x" }, blockerCount: 0, warningCount: 0, infoCount: 1, score: 100,
      sourceValues: { module: ["Ceph", "MySQL"] },
      groups: [{ id: "organization", label: "组织", checks: [
        { ruleId: "F11", field: "module", label: "模块", severity: "info", passed: true, value: null, message: "通过", editable: true, allowedValues: ["Ceph", "MySQL", "Kubernetes"] },
      ] }],
    };
    useEntityComplianceStore.setState({ selectedEntity: entity, repairOpen: true, repairChanges: {} });
    render(<EntityRepairDrawer />);

    // PR-026 池行式：点行展开后控件挂载
    fireEvent.click(screen.getByRole("button", { name: /产品模块.*当前值/ }));
    const trigger = screen.getByRole("button", { name: "产品模块 选项" });
    expect(trigger).toHaveTextContent("选择产品模块 (2)");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitemcheckbox", { name: "Ceph" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "MySQL" })).toHaveAttribute("aria-checked", "true");
  });

  it("opens one-click field completion for a missing entity deep link", async () => {
    window.location.hash = "#/entity-compliance?sourceKey=%E7%9F%A5%E8%AF%86%E5%BA%93%2Fwiki%2Fentities%2FMySQL.md&create=1&title=MySQL";
    vi.mocked(api.fetchEntityCompliance).mockResolvedValue({
      generatedAt: "2026-07-24T00:00:00.000Z",
      readiness: { ready: false, totalArchComponents: 0, blockerEntities: 0, blockerCount: 1, warningCount: 0, warningDetails: [], blockingSourceKeys: [] },
      summary: { totalEntities: 1, blockerEntityCount: 1, blockerCount: 1 }, total: 1, limit: 50, offset: 0, items: [{
      entityId: "", title: "MySQL", fileName: "MySQL.md", sourceKey: "知识库/wiki/entities/MySQL.md", sourceExists: false,
      architectureIntent: "active", blockerCount: 1, warningCount: 0, infoCount: 0, score: 0,
      groups: [{ id: "identity", label: "缺失实体模板", checks: [{ ruleId: "CREATE-1", field: "title", label: "标题", severity: "error", passed: false, value: null, message: "title 尚未填写", reason: "missing", editable: true }] }],
    }] });
    render(<><EntityComplianceView /><EntityRepairDrawer /></>);
    expect(await screen.findByText("创建并补齐 MySQL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建并补齐" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "在 Obsidian 中打开 MySQL" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成空字段" })).toBeInTheDocument();
    expect(useEntityComplianceStore.getState().creatingEntity).toBe(true);
  });

  it("minimizes and resumes a global repair task without losing draft fields", () => {
    const entity: EntityComplianceResult = {
      entityId: "", title: "MySQL", fileName: "MySQL.md", sourceKey: "知识库/wiki/entities/MySQL.md", sourceExists: false,
      blockerCount: 2, warningCount: 0, infoCount: 0, score: 0,
      groups: [{ id: "identity", label: "身份", checks: [
        { ruleId: "F01", field: "title", label: "标题", severity: "error", passed: false, value: null, message: "title 尚未填写", reason: "missing", editable: true },
        // WP-113 M2：草稿承载字段从身份号改为 title——身份号已入托管家族（readonly-system），抽屉不再给写入口
        { ruleId: "F02", field: "architecture-node-id", label: "架构组件身份", severity: "error", passed: false, value: null, message: "architecture-node-id 尚未填写", reason: "missing", editable: true, hint: "组件身份由系统在创建时铸造，全库唯一，创建后不可修改" },
      ] }],
    };
    useEntityComplianceStore.getState().openCreate(entity);
    render(<EntityRepairDrawer />);

    // PR-026 池行式：点行展开后编辑
    fireEvent.click(screen.getByRole("button", { name: /实体名称.*当前值/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /实体名称/ }), { target: { value: "MySQL 主库" } });
    fireEvent.click(screen.getByRole("button", { name: "最小化补齐面板" }));
    expect(screen.queryByText("创建并补齐 MySQL")).not.toBeInTheDocument();
    expect(useEntityComplianceStore.getState()).toMatchObject({ repairOpen: false, selectedEntity: entity, repairChanges: { title: "MySQL 主库" } });

    act(() => useEntityComplianceStore.getState().resumeRepair());
    // PR-026 池行式：面板状态（含展开行）跨最小化保留——resume 后控件原位，直接验值
    expect(screen.getByRole("textbox", { name: /实体名称/ })).toHaveValue("MySQL 主库");
    fireEvent.click(screen.getByRole("button", { name: "结束补齐任务" }));
    expect(useEntityComplianceStore.getState()).toMatchObject({ repairOpen: false, selectedEntity: null, repairChanges: {} });
  });

  it("offers one-click field completion for standard articles", () => {
    const article: EntityComplianceResult = {
      entityId: "article:path", title: "MySQL 强制入主操作流程", fileName: "强制入主.md",
      sourceKey: "知识库/raw/precleaned/强制入主.md", sourceExists: true, sourceType: "standard-article",
      sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:article" },
      architectureIntent: "ordinary", score: 90, totalChecks: 10, blockerCount: 1, warningCount: 0, infoCount: 0,
      module: "MySQL", groups: [{ id: "article_identity", label: "文章身份", checks: [
        { ruleId: "A02", field: "article_id", label: "文章身份", severity: "error", passed: false, value: null, message: "article_id 是标准文章稳定身份", editable: true, hint: "例如 mysql-force-primary" },
      ] }],
    };
    render(<><EntityComplianceCard entity={article} /><EntityRepairDrawer /></>);

    expect(screen.getByText("标准文章")).toBeInTheDocument();
    expect(screen.getByText("强制入主.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /补齐字段 \d+/ }));
    // hint 与 placeholder 同文时不得在同一张卡片上出现两份（hint 优先、placeholder 让位）：
    // input 不再重复该示例，示例由同一卡片内的 hint 行单独承载。
    fireEvent.click(screen.getByRole("button", { name: /文章标识.*当前值/ }));
    const articleIdInput = screen.getByRole("textbox", { name: /文章标识/ });
    expect(articleIdInput).not.toHaveAttribute("placeholder");
    expect(articleIdInput.parentElement).toHaveTextContent("例如 mysql-force-primary");
    fireEvent.change(screen.getByRole("textbox", { name: /文章标识/ }), { target: { value: "mysql-force-primary" } });
    expect(useEntityComplianceStore.getState().repairChanges).toEqual({ article_id: "mysql-force-primary" });
    expect(screen.getByRole("button", { name: "在 Obsidian 中打开 MySQL 强制入主操作流程" })).toBeInTheDocument();
  });

  it("uses managed product, version and knowledge-domain options for articles", () => {
    const article: EntityComplianceResult = {
      entityId: "mysql-force-primary", title: "MySQL 强制入主操作流程", fileName: "强制入主.md",
      sourceKey: "知识库/raw/precleaned/强制入主.md", sourceExists: true, sourceType: "standard-article",
      architectureIntent: "ordinary", score: 100, totalChecks: 3, blockerCount: 0, warningCount: 0, infoCount: 0,
      sourceValues: { product: "AnyShare", version: "7.0.6.7", "category-path": "ops:deploy:maintain" },
      groups: [{ id: "article_identity", label: "文章身份", checks: [
        { ruleId: "A03", field: "product", label: "产品", severity: "error", passed: true, value: null, message: "通过", editable: true, allowedValues: ["AnyShare", "OtherProduct"] },
        { ruleId: "A04", field: "version", label: "产品版本", severity: "error", passed: true, value: null, message: "通过", editable: true, allowedValues: ["7.0.6.7"], allowedValuesByProduct: { AnyShare: ["7.0.6.7", "7.0.6.8"], OtherProduct: ["1.0.0"] } },
        { ruleId: "A08", field: "category-path", label: "知识域目录", severity: "error", passed: true, value: null, message: "通过", editable: true, allowedValues: ["ops:deploy:maintain", "ops:deploy:nginx-502"] },
      ] }],
    };
    useEntityComplianceStore.setState({ selectedEntity: article, repairOpen: true });
    render(<EntityRepairDrawer />);

    // PR-050：文章受管字段收敛到单源控件——product/version 渲染为原生 select（不再是
    // FilterSelect 按钮弹层），category-path 为文本框+datalist。断言改按 combobox/option 语义。
    fireEvent.click(screen.getByRole("button", { name: /产品，当前值/ }));
    const productSelect = screen.getByRole("combobox", { name: "产品" }) as HTMLSelectElement;
    expect(productSelect).toHaveValue("AnyShare");
    fireEvent.click(screen.getByRole("button", { name: /产品版本，当前值/ }));
    const versionSelect = screen.getByRole("combobox", { name: "产品版本" }) as HTMLSelectElement;
    expect(versionSelect).toHaveValue("7.0.6.7");
    // PR-063（Master 裁定）：category-path 是聚合衍生物——修复行渲染为 domain/subdomain 下拉＋topic 派生，
    // 用户不手填整值。allowedValues（域:子域组合）供两段下拉。
    fireEvent.click(screen.getByRole("button", { name: /知识域目录，当前值/ }));
    const domainSelect = screen.getByRole("combobox", { name: "知识域目录 域" }) as HTMLSelectElement;
    expect(domainSelect).toHaveValue("ops");
    const subdomainSelect = screen.getByRole("combobox", { name: "知识域目录 子域" }) as HTMLSelectElement;
    expect(subdomainSelect).toHaveValue("deploy");

    // 换产品 OtherProduct → 版本选项随 allowedValuesByProduct 联动（1.0.0 入列，7.0.6.8 出列）。
    // 至多一行展开：category-path 行展开后 product 行已收起，须先重开 product 行再 change。
    fireEvent.click(screen.getByRole("button", { name: /产品，当前值/ }));
    const productSelectReopened = screen.getByRole("combobox", { name: "产品" }) as HTMLSelectElement;
    fireEvent.change(productSelectReopened, { target: { value: "OtherProduct" } });
    fireEvent.click(screen.getByRole("button", { name: /产品版本，当前值/ }));
    const versionSelectAfter = screen.getByRole("combobox", { name: "产品版本" }) as HTMLSelectElement;
    expect([...versionSelectAfter.options].map((o) => o.value)).toContain("1.0.0");
    expect([...versionSelectAfter.options].map((o) => o.value)).not.toContain("7.0.6.8");
  });

  // D-1a（WP-110）：服务端能力位 editable=false 的身份字段，抽屉必须渲染成「只读但仍可见」的行。
  // 此前 repairableFieldIssues 把 !check.editable 当成「不渲染」判据——能力位一置 false，整行消失，
  // immutableLocked 分支永不可达（D-1 的前端半边是死代码，820 绿只证明零回归）。
  // 判据分离：可见性＝字段 ∈ EDITABLE 白名单；可改性＝check.editable。
  it("D-1a 锁定态只读渲染：行不展开、无输入框、无采纳建议，正对照字段照常可编辑", () => {
    const locked: EntityComplianceResult = {
      entityId: "svc", title: "Service", fileName: "svc.md",
      sourceKey: "知识库/wiki/entities/svc.md", sourceExists: true, sourceType: "entity",
      sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:x" },
      architectureIntent: "active", score: 100, totalChecks: 2, blockerCount: 0, warningCount: 0, infoCount: 0,
      sourceValues: { "architecture-node-id": "mysql-primary", title: "Service" },
      groups: [{ id: "identity", label: "身份", checks: [
        { ruleId: "F02", field: "architecture-node-id", label: "架构组件身份", severity: "error", passed: true, value: null, message: "通过", editable: false },
        { ruleId: "F01", field: "title", label: "实体名称", severity: "error", passed: true, value: null, message: "通过", editable: true },
      ] as never }],
    };
    useEntityComplianceStore.getState().openRepair(locked);
    render(<EntityRepairDrawer />);

    // WP-113 M2 随迁：实体侧身份号加入托管家族——同一条「行不展开、无写入口」的锁定语义，
    // 文案短路为「系统托管」（托管短路先于 immutable 文案，与 article_id 的 D-1b 同形异词）。
    const lockedRow = screen.getByRole("button", { name: /架构组件身份，当前值 mysql-primary（系统托管，只读）/ });
    expect(lockedRow).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("系统托管")).toBeInTheDocument();
    // 点行不得展开：不出现该字段的输入框，也不出现「采用系统建议」
    fireEvent.click(lockedRow);
    expect(lockedRow).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: /架构组件身份/ })).toBeNull();
    expect(screen.queryByTestId("adopt-suggestion")).toBeNull();

    // 正对照：同卡片可编辑字段点行即出控件（证明不是整抽屉被禁）
    fireEvent.click(screen.getByRole("button", { name: /实体名称，当前值 Service/ }));
    expect(screen.getByRole("textbox", { name: /实体名称/ })).toHaveValue("Service");
  });

  it("D-1b 文章标识锁定态与实体侧同读能力位（声明驱动，抽屉不再给必被 422 的输入框）", () => {
    const article: EntityComplianceResult = {
      entityId: "article:mysql-primary", title: "MySQL 强制入主", fileName: "force.md",
      sourceKey: "知识库/raw/precleaned/force.md", sourceExists: true, sourceType: "standard-article",
      sourceRevision: { mtimeMs: 1, size: 10, contentHash: "sha256:a" },
      architectureIntent: "ordinary", score: 100, totalChecks: 2, blockerCount: 0, warningCount: 0, infoCount: 0,
      sourceValues: { article_id: "mysql-primary", product: "AnyShare" },
      groups: [{ id: "article_identity", label: "文章身份", checks: [
        { ruleId: "A02", field: "article_id", label: "文章标识", severity: "error", passed: true, value: null, message: "通过", editable: false },
        { ruleId: "A03", field: "product", label: "产品", severity: "error", passed: true, value: null, message: "通过", editable: true },
      ] as never }],
    };
    useEntityComplianceStore.getState().openRepair(article);
    render(<EntityRepairDrawer />);

    const lockedRow = screen.getByRole("button", { name: /文章标识，当前值 mysql-primary（创建后不可修改，只读）/ });
    expect(lockedRow).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(lockedRow);
    expect(screen.queryByRole("textbox", { name: /文章标识/ })).toBeNull();
    // 正对照：未声明 immutable 的文章字段照常可编辑（锁的不是整张抽屉）
    fireEvent.click(screen.getByRole("button", { name: /产品，当前值 AnyShare/ }));
    expect(screen.getByRole("combobox", { name: "产品" })).toBeInTheDocument();
  });

  it("WP-113 M2 新建态：组件身份系统托管只读——不存在输入框、文案「由系统生成」，正对照可编辑字段照常出控件（不是整表单被禁）", () => {
    const entity: EntityComplianceResult = {
      entityId: "", title: "MySQL", fileName: "MySQL.md", sourceKey: "知识库/wiki/entities/MySQL.md", sourceExists: false,
      architectureIntent: "active", score: 0, totalChecks: 2, blockerCount: 2, warningCount: 0, infoCount: 0,
      groups: [{ id: "identity", label: "身份", checks: [
        { ruleId: "F01", field: "title", label: "实体名称", severity: "error", passed: false, value: null, message: "title 尚未填写", reason: "missing", editable: true },
        { ruleId: "F02", field: "architecture-node-id", label: "架构组件身份", severity: "error", passed: false, value: null, message: "architecture-node-id 尚未填写", reason: "missing", editable: true, hint: "组件身份由系统在创建时铸造，全库唯一，创建后不可修改" },
      ] as never }],
    };
    useEntityComplianceStore.getState().openCreate(entity);
    render(<EntityRepairDrawer />);

    const idRow = screen.getByRole("button", { name: /架构组件身份.*（系统托管，只读）/ });
    fireEvent.click(idRow);
    expect(idRow).toHaveAttribute("aria-expanded", "false"); // 点行不展开：系统铸造字段不给用户写入口
    expect(screen.queryByRole("textbox", { name: /架构组件身份/ })).toBeNull();
    expect(screen.getByText("由系统生成，创建后不可修改")).toBeInTheDocument(); // 文案随母版 placeholder 派生，不留第二份
    // 「生成空字段」骨架提交面不得夹带自带身份（带了即被写门 system-minted 400 拒——后端 T1 同批）
    fireEvent.click(screen.getByRole("button", { name: "生成空字段" }));
    expect(useEntityComplianceStore.getState().repairChanges).not.toHaveProperty("architecture-node-id");

    // 正对照：新建态可编辑字段点行即出控件——证明不是整表单被禁
    fireEvent.click(screen.getByRole("button", { name: /实体名称.*当前值/ }));
    expect(screen.getByRole("textbox", { name: /实体名称/ })).toBeInTheDocument();
  });
});
