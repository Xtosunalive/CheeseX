import "@testing-library/jest-dom/vitest";

import { vi } from "vitest";

// G6 画布在 jsdom 无法真渲染（无 canvas 包）——异步初始化与测试收尾竞态产生
// 未处理拒绝（"Cannot read properties of null (reading 'clearRect')" /
// "reading 'data'"，vitest 记 Errors 致 pre-commit 前端门禁红；基线 main 同红
// 实证＝批15「LocalGraph 重塑为 Obsidian 全图」带入的存量竞态）。
// 单测层统一以数据记忆桩替换 @antv/g6：断言面=组件 DOM/数据流（LocalGraph
// 测试自注「canvas 点击不可测」，canvas 交互由冒烟/e2e 层覆盖）。
// 2026-11-20 增量同步批：桩升级为有数据记忆的形态（构造吸收 config.data、数据 API
// 操作内存列表、实例计数器/注册表可断言）——测试面新增「数据变化不新建实例」
// （Obsidian 式常驻实例的回归钉，跳变根因=整图销毁重建）。
vi.mock("@antv/g6", () => {
  class GraphStub {
    static created = 0;
    static instances: GraphStub[] = [];
    static reset(): void {
      GraphStub.created = 0;
      GraphStub.instances = [];
    }
    nodes: Array<Record<string, unknown>> = [];
    edges: Array<Record<string, unknown>> = [];
    destroyed = false;
    constructor(config: { data?: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> } }) {
      GraphStub.created += 1;
      GraphStub.instances.push(this);
      this.nodes = [...(config?.data?.nodes ?? [])];
      this.edges = [...(config?.data?.edges ?? [])];
    }
    getNodeData(): Array<Record<string, unknown>> {
      return this.nodes;
    }
    getEdgeData(): Array<Record<string, unknown>> {
      return this.edges;
    }
    addData(data: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }): void {
      this.nodes.push(...(data.nodes ?? []));
      this.edges.push(...(data.edges ?? []));
    }
    updateData(data: { nodes?: Array<{ id: unknown } & Record<string, unknown>> }): void {
      for (const n of data.nodes ?? []) {
        const idx = this.nodes.findIndex((x) => x.id === n.id);
        if (idx >= 0) this.nodes[idx] = { ...this.nodes[idx], ...n };
      }
    }
    removeData(ids: { nodes?: unknown[]; edges?: unknown[] }): void {
      const nIds = new Set((ids.nodes ?? []).map(String));
      const eIds = new Set((ids.edges ?? []).map(String));
      this.nodes = this.nodes.filter((x) => !nIds.has(String(x.id)));
      this.edges = this.edges.filter((x) => !eIds.has(String(x.id)));
    }
    async render(): Promise<void> {}
    async draw(): Promise<void> {}
    async layout(): Promise<void> {}
    on(_event: string, _handler: unknown): this {
      return this;
    }
    async destroy(): Promise<void> {
      this.destroyed = true;
    }
    async fitView(): Promise<void> {}
    getZoom(): number {
      return 1;
    }
    async zoomTo(_zoom: number): Promise<void> {}
    setElementState(_id: string, _states: string[]): void {}
  }
  return { Graph: GraphStub };
});
