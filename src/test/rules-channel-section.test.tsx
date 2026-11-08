// Component: RulesChannelSection Tests（SPEC-008 §3.3 前端层）
// @responsible: 信号卡渲染/立规动作分发/台账只读（存量 sealed 无切换入口）/退役入口。
// @inputs: RulesChannelSection + vitest mocks（api 层 mock）
// @outputs: vitest 断言
// @context: SPEC-008 §3.3；先例=vocabulary-profile-section.test.tsx。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RulesChannelSection } from "@/features/schema-manager/RulesChannelSection";

const api = vi.hoisted(() => ({ envelope: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetchEnvelope: api.envelope }));

const signals = [
  { key: "missing_entity::document-module-entity", issueKind: "missing_entity", ruleId: "document-module-entity", count: 10, sampleIssueIds: ["a", "b"], sampleTitle: "来源文档缺少生成架构图所需的结构化属性" },
  { key: "wild_tag::wild-tag-discovery", issueKind: "wild_tag", ruleId: "wild-tag-discovery", count: 4, sampleIssueIds: ["c"], sampleTitle: "文档中出现不在受控词表内的自由标签" },
];
const ledger = {
  rules: [
    { id: "F06", severity: "error" as const, gates: ["entity-repair.apply-create"], field: "arch_subdomain", check: "enum-ref", message: "架构子域不在注册表子域名单中", sealed: true, indexed: true },
    { id: "F18", severity: "warn" as const, gates: [], field: "module", check: null, message: null, sealed: false, indexed: true },
    { id: "B04", severity: "error" as const, gates: ["pipeline.stage-0-5"], field: null, check: "known-labels", message: "wikilink 类型必须是注册表内合法类型", sealed: true, indexed: true },
  ],
  revision: "sha256:ledger",
};

beforeEach(() => {
  api.envelope.mockReset();
  // 按路径分流（2026-10-27 补批）：台账走 lifecycle、计数走 anomalies
  api.envelope.mockImplementation(async (path: string) => {
    if (path === "/api/anomalies") return { ok: true, data: { issues: [
      { evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/a.md", lineNumber: null, ruleId: "B04" }] },
      { evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/b.md", lineNumber: null, ruleId: "B04" }] },
      { evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/c.md", lineNumber: null, ruleId: "F09" }] },
    ], total: 3 } };
    return { ok: true, data: ledger };
  });
});

describe("RulesChannelSection（ADR-007 波3）", () => {
  it("信号卡：ruleId/issueKind/count 呈现 + 「立为规则」分发 POST propose（携 revision）", async () => {
    api.envelope.mockResolvedValueOnce({ ok: true, data: ledger }); // GET
    render(<RulesChannelSection candidates={{ signals, totalIssues: 30, clusteredIssues: 20, unclusteredIssues: 10, minCount: 2 }} onMinCountChange={vi.fn()} />);
    expect(await screen.findByText("来源文档缺少生成架构图所需的结构化属性")).toBeTruthy();
    expect(screen.getByText(/规则 document-module-entity/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "立为规则" })[0]);
    await waitFor(() => {
      expect(api.envelope).toHaveBeenCalledWith("/api/rules/lifecycle", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"propose"'),
      }));
    });
  });

  it("波3b：信号门槛旋钮变更触发 onMinCountChange（页面配置项——Master 02:57 令）", async () => {
    api.envelope.mockResolvedValueOnce({ ok: true, data: ledger });
    const onMin = vi.fn();
    render(<RulesChannelSection candidates={{ signals, totalIssues: 30, clusteredIssues: 20, unclusteredIssues: 10, minCount: 2 }} onMinCountChange={onMin} />);
    await screen.findByText("来源文档缺少生成架构图所需的结构化属性");
    expect(screen.getByText(/规则 document-module-entity/)).toBeTruthy();
    const input = screen.getByTestId("rule-min-count-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    expect(onMin).toHaveBeenCalledWith(3);
    // 非法值（0/越界）不触发
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "100" } });
    expect(onMin).toHaveBeenCalledTimes(1);
  });

  it("台账：存量规则显示「强度封存」且无退役入口（治理红线 UI 执法——只约束 sealed 行）", async () => {
    render(<RulesChannelSection candidates={undefined} onMinCountChange={vi.fn()} />);
    await screen.findByText("F06");
    expect(screen.getAllByText("强度封存").length).toBeGreaterThan(0); // F06/B04 均 sealed
    // F06 行内不得有动作按钮：以容器维度断言（F18 的退役钮属下一用例）
    const f06Row = screen.getByText("F06").closest("div");
    expect(f06Row?.querySelector("button")).toBeNull();
  });

  it("违规计数（2026-10-27 补批）：按 evidence[0].ruleId 聚合渲染，可点击跳问题台账", async () => {
    render(<RulesChannelSection candidates={undefined} onMinCountChange={vi.fn()} />);
    const count = await screen.findByRole("button", { name: /当前违规 2/ }); // B04 计 2
    expect(count).toBeTruthy();
    expect(screen.queryByText(/当前违规 1/)).toBeNull(); // F09 不在台账（已迁代码内声明）不渲染计数钮
    fireEvent.click(count);
    expect(window.location.hash).toBe("#/anomalies");
    expect(screen.getAllByText("无当前违规").length).toBeGreaterThan(0); // 零计数规则显式呈现（F06/F18 多卡同名）
  });

  it("人话卡（2026-10-27 降档批）：违规文案/检查类型中文/挂点人话/零挂点警示全渲染", async () => {
    render(<RulesChannelSection candidates={undefined} onMinCountChange={vi.fn()} />);
    // B04 带挂点 → 卡片显示 message 全文 + 检查类型中文 + 挂点人话
    await screen.findByText("wikilink 类型必须是注册表内合法类型");
    expect(screen.getByText("检查：引用校验（值必须在册）")).toBeTruthy(); // F06 enum-ref
    expect(screen.getByText("挂点：管线入图资格")).toBeTruthy(); // B04 pipeline.stage-0-5
    expect(screen.getByText("wikilink 类型必须是注册表内合法类型")).toBeTruthy(); // B04 message 全文
  });

  it("台账：新立规则（非 sealed）有退役入口且分发 retire", async () => {
    render(<RulesChannelSection candidates={undefined} onMinCountChange={vi.fn()} />);
    const retireBtn = await screen.findByRole("button", { name: "退役" });
    fireEvent.click(retireBtn);
    await waitFor(() => {
      expect(api.envelope).toHaveBeenCalledWith("/api/rules/lifecycle", expect.objectContaining({
        body: expect.stringContaining('"action":"retire"'),
      }));
    });
  });

  it("空信号（candidates 缺省）不渲染候选区，台账照常", async () => {
    render(<RulesChannelSection candidates={undefined} onMinCountChange={vi.fn()} />);
    await screen.findByText("F18");
    expect(screen.queryByTestId("rule-candidates")).toBeNull();
    expect(screen.getByTestId("rules-ledger")).toBeTruthy();
  });

  it("03:40 报障回归：门槛调高全滤（signals=0 但 candidates 在）——区块+旋钮仍在，不死锁", () => {
    render(<RulesChannelSection candidates={{ signals: [], totalIssues: 11, clusteredIssues: 11, unclusteredIssues: 0, minCount: 3 }} onMinCountChange={vi.fn()} />);
    expect(screen.getByTestId("rule-candidates")).toBeTruthy();
    expect(screen.getByTestId("rule-min-count-input")).toBeTruthy(); // 旋钮必须还在（能调回来）
    expect(screen.getByTestId("rule-candidates-empty")).toBeTruthy(); // 空态提示
    // 旋钮值随响应回显（value 受控——不是 defaultValue 死值）
    expect((screen.getByTestId("rule-min-count-input") as HTMLInputElement).value).toBe("3");
  });
});

// 族分组（2026-10-09 Master「规则台账按类别分一下，族名写全」）
it("台账按规则族分组渲染（全名+计数+未识别兜底）", async () => {
  api.envelope.mockResolvedValueOnce({
    ok: true, data: {
      rules: [
        { id: "F04", severity: "error" as const, gates: ["x"], field: "arch_layer", sealed: true, indexed: true },
        { id: "F17", severity: "warn" as const, gates: [], field: "aliases", sealed: false, indexed: true },
        { id: "B01", severity: "error" as const, gates: ["y"], field: null, sealed: true, indexed: true },
        { id: "ZZ9", severity: "info" as const, gates: [], field: null, sealed: false, indexed: false },
      ],
      revision: "r1",
    },
  });
  render(<RulesChannelSection candidates={undefined} onMinCountChange={() => {}} />);
  await waitFor(() => {
    expect(screen.getByText(/实体元数据族（Frontmatter）（2）/)).toBeTruthy();
    expect(screen.getByText(/正文关系族（Body）（1）/)).toBeTruthy();
    expect(screen.getByText(/未识别族（1）/)).toBeTruthy();
    expect(screen.queryByText(/文章源检查族/)).toBeNull(); // 无 A 族规则不渲染空组
  });
});
