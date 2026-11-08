// TopologyStateGate 退役钉子——NOT_INITIALIZED 初始化面板已整体退役（PR-081 全量落地，
// Master 2026-10-26「空库就显示各项0就行了啊要什么指引」）。该分支曾与拓扑 404 互锁成
// 「诊断 succeeded↔未初始化」无限闪烁；本文件钉死两件事：任何 errorCode 都不得再唤出
// 自动初始化面板（错误只落手动重试卡）；有 stats 即渲染 children（空态由 children 显示零值）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopologyStateGate } from "@/components/topology-state-gate";
import { TERM } from "@/constants/term-const";

describe("TopologyStateGate（NOT_INITIALIZED 面板退役后）", () => {
  it("拓扑错误（含旧 NOT_INITIALIZED）只落通用错误卡：手动重试、无自动回调、无初始化面板", () => {
    const onLoad = vi.fn();
    render(
      <TopologyStateGate loading={false} error="知识图谱尚未生成" hasStats={false} onLoad={onLoad}>
        <div>should-not-render</div>
      </TopologyStateGate>,
    );
    expect(screen.getByText("知识图谱尚未生成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TERM.RETRY_ACTION })).toBeInTheDocument();
    expect(screen.queryByText("重建图谱")).not.toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("hasStats=true 渲染 children——空库零值载荷由此直达正常视图", () => {
    render(
      <TopologyStateGate loading={false} error={null} hasStats={true} onLoad={vi.fn()}>
        <div data-testid="zero-state">各项 0</div>
      </TopologyStateGate>,
    );
    expect(screen.getByTestId("zero-state")).toBeInTheDocument();
  });
});
