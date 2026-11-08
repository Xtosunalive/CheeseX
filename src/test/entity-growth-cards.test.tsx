// Component: EntityGrowthCards Tests（SPEC-005 A2 前端层）
// @responsible: 候选卡呈现（次数/样例/按钮）+ 裁定动作分发（create/link-existing）+
//               A5 卫生只读（无操作按钮）；空态不渲染。
// @inputs: EntityGrowthCards + vitest mocks
// @outputs: vitest 断言
// @context: SPEC-005 §3.2；先例=schema-manager-view.test.tsx（mock store 形态）
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityGrowthCards } from "@/features/schema-manager/EntityGrowthCards";

const base = {
  absorbingValue: null,
  onGrow: vi.fn(),
  entityNames: ["可观测性"],
};

const candidates = [
  {
    name: "消息队列",
    mentionCount: 2,
    samples: [{ file: "知识库/wiki/articles/b.md", coordinate: "col:42", snippet: "提到 [[消息队列]] 两次" }],
  },
];

describe("EntityGrowthCards（ADR-007 A2/A5）", () => {
  it("候选卡：呈现名称/次数/来源样例，[建实体] 触发 create（带 sources）", () => {
    render(<EntityGrowthCards {...base} candidates={candidates} orphans={[]} />);
    expect(screen.getByText("消息队列")).toBeTruthy();
    expect(screen.getByText(/2 次提及/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "建实体" }));
    expect(base.onGrow).toHaveBeenCalledWith({
      field: "entity", value: "消息队列", assignMode: "create",
      sources: ["知识库/wiki/articles/b.md col:42"],
    });
  });

  it("挂载通道存在：entityNames 非空时渲染 FilterSelect（挂到已有入口）", () => {
    const { container } = render(<EntityGrowthCards {...base} candidates={candidates} orphans={[]} />);
    // FilterSelect trigger 以 aria-label 暴露（挂载目标入口）——断言入口存在即契约达成
    const trigger = container.querySelector('[aria-label="消息队列 挂载目标"]');
    expect(trigger).not.toBeNull();
  });

  it("无已有实体时不渲染挂载入口（只有建实体）", () => {
    const { container } = render(<EntityGrowthCards {...base} entityNames={[]} candidates={candidates} orphans={[]} />);
    expect(container.querySelector('[aria-label="消息队列 挂载目标"]')).toBeNull();
    expect(screen.getByRole("button", { name: "建实体" })).toBeTruthy();
  });

  it("A5 卫生：零提及实体只读呈现，无任何操作按钮", () => {
    render(<EntityGrowthCards {...base} candidates={[]} orphans={[{ name: "孤儿实体" }]} />);
    expect(screen.getByText("孤儿实体")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("空候选+空孤儿 → 不渲染", () => {
    const { container } = render(<EntityGrowthCards {...base} candidates={[]} orphans={[]} />);
    expect(container.textContent).toBe("");
  });

  it("提交中禁用（absorbingValue 匹配）", () => {
    render(<EntityGrowthCards {...base} absorbingValue="消息队列" candidates={candidates} orphans={[]} />);
    const btn = screen.getByRole("button", { name: "提交中..." });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
