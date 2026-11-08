import "@testing-library/jest-dom/vitest";

import { vi } from "vitest";

// G6 画布在 jsdom 无法真渲染（无 canvas 包）——异步初始化与测试收尾竞态产生
// 未处理拒绝（"Cannot read properties of null (reading 'clearRect')" /
// "reading 'data'"，vitest 记 Errors 致 pre-commit 前端门禁红；基线 main 同红
// 实证＝批15「LocalGraph 重塑为 Obsidian 全图」带入的存量竞态）。
// 单测层统一以 no-op Graph 桩替换 @antv/g6：断言面=组件 DOM/数据流（LocalGraph
// 测试自注「canvas 点击不可测」，canvas 交互由冒烟/e2e 层覆盖）。
vi.mock("@antv/g6", () => {
  class GraphStub {
    constructor(_config: unknown) {}
    async render(): Promise<void> {}
    on(_event: string, _handler: unknown): this {
      return this;
    }
    async destroy(): Promise<void> {}
    async fitView(): Promise<void> {}
    getZoom(): number {
      return 1;
    }
    async zoomTo(_zoom: number): Promise<void> {}
  }
  return { Graph: GraphStub };
});
