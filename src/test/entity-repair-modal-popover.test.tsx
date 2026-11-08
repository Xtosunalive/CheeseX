import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PoolShell } from "@/components/pool-panel";
import { FilterSelect } from "@/components/filter-select";
import { AnomalyEntityRepairDrawer } from "@/features/anomaly-workbench/components/AnomalyEntityRepairDrawer";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

function mockEnums(categories: string[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { layers: [{ id: "service" }], categories, subdomains: {}, modules: { MySQL: {} } } }),
  }));
}

describe("entity repair modal popover layering", () => {
  it("opens a FilterSelect dropdown above the pool panel", () => {
    render(
      <PoolShell title="补齐字段" sourceKey="知识库/wiki/entities/demo.md" onMinimize={vi.fn()} onClose={vi.fn()}>
        <FilterSelect ariaLabel="实体类别 选项" title="选择实体类别" value="" onValueChange={vi.fn()} options={[{ value: "middleware", label: "middleware", group: "Schema 可用值" }]} />
      </PoolShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "实体类别 选项" }));
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    // Popover 通过 Portal 渲染，z-index 必须高于池面板（z-popover 80 > z-chrome 35），否则被遮挡
    expect(listbox.parentElement).toHaveClass("z-popover");
  });

  it("renders real categories enum from the Schema API and updates the field on selection", async () => {
    mockEnums(["middleware", "database", "gateway"]);
    const issue = {
      issueId: "missing-arch-category",
      issueKind: "missing_field",
      title: "实体类别缺失",
      status: "open",
      evidence: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/demo.md", field: "arch_category" },
      executionReady: true,
    } as unknown as AnomalyIssue;
    render(<AnomalyEntityRepairDrawer issue={issue} error={null} onPreview={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);

    // ADR-006 修订A（WP-043）：实体类别＝可选可立生长字段（Input+datalist）——枚举作为建议呈现。
    // 等待枚举加载并注入 datalist 建议（直接 DOM 断言——角色查询受抽屉异步分层影响不稳）
    const input = await waitFor(() => {
      const el = document.querySelector('input[list="entity-category-growth-options"]') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    await waitFor(() => {
      const datalist = document.getElementById("entity-category-growth-options") as HTMLDataListElement;
      const options = Array.from(datalist.options).map((o) => o.value);
      expect(options).toEqual(expect.arrayContaining(["middleware", "database", "gateway"]));
    });

    // 直接输入（新值即生长值；已见值同路）→ 字段值更新
    fireEvent.change(input, { target: { value: "middleware" } });
    expect(input).toHaveValue("middleware");
    vi.unstubAllGlobals();
  });

  it("enum 加载失败时错误显性告警，select 字段降级为可写文本（#1792 C3：失败可见但字段不死锁）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("网络异常")));
    const issue = {
      issueId: "missing-arch-layer",
      issueKind: "missing_field",
      title: "架构分层缺失",
      status: "open",
      evidence: [],
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/demo.md", field: "arch_layer" },
      executionReady: true,
    } as unknown as AnomalyIssue;
    render(<AnomalyEntityRepairDrawer issue={issue} error={null} onPreview={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);

    // ① 失败必须显性（保留原契约的「不得静默」意图）：告警条可见
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Schema 枚举加载失败");
    // ② 降级兜底（#1792 C3 政策更新）：枚举字段渲染为可写文本而非禁用死下拉——
    // 旧契约「停用」恰是用户报障的字段不可写死锁形态；写入合法性仍由后端枚举校验 fail-closed 把关
    const layerText = screen.getByRole("textbox", { name: "架构分层" });
    expect(layerText).toBeEnabled();
    vi.unstubAllGlobals();
  });
});
