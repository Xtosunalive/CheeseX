// graph-sync-plan.test.ts — 增量同步纯函数回归钉（2026-11-20「一大一小跳变」收口批）。
// 断言对象：computeGraphSyncPlan 的最小操作集语义——下一份图数据落到常驻 G6 实例时，
// 哪些节点/边增、删、改；结构增删才轻推布局，纯属性变化只 draw（视口与节点位置不动）。
// 层级：纯单元（无 DOM、无 G6——LocalGraph 组件级行为见 local-graph-incremental.test.tsx）。
import { describe, expect, it } from "vitest";
import { buildEdgePayload, buildNodePayload, computeGraphSyncPlan, type LiveGraphSnapshot } from "@/features/data-dashboard/components/local-graph/graph-sync";
import type { TopoEdge, TopoNode } from "@/lib/topology-types";

const node = (id: string, label = id, degree = 0): TopoNode =>
  ({ id, label, category: "文档", degree, labels: ["Document"], properties: {} }) as TopoNode;
const edge = (id: string, source: string, target: string): TopoEdge =>
  ({ edgeId: id, source, target, type: "REFERENCES", reviewStatus: "approved" }) as unknown as TopoEdge;

const payloadOf = (n: TopoNode) => buildNodePayload(n, n.degree, undefined);
const edgePayloadOf = (e: TopoEdge) => buildEdgePayload(e);

describe("computeGraphSyncPlan——最小操作集", () => {
  it("全新实例（live 空）：全部节点边进 add，结构变化", () => {
    const plan = computeGraphSyncPlan({ nodes: [], edges: [] }, [payloadOf(node("a")), payloadOf(node("b"))], [edgePayloadOf(edge("e1", "a", "b"))]);
    expect(plan.addNodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(plan.addEdges.map((e) => e.id)).toEqual(["e1"]);
    expect(plan.removeNodeIds).toEqual([]);
    expect(plan.removeEdgeIds).toEqual([]);
    expect(plan.updateNodes).toEqual([]);
    expect(plan.structureChanged).toBe(true);
  });

  it("数据不变：空操作集，不轻推布局", () => {
    const nextNodes = [payloadOf(node("a")), payloadOf(node("b"))];
    const nextEdges = [edgePayloadOf(edge("e1", "a", "b"))];
    const live: LiveGraphSnapshot = { nodes: nextNodes, edges: nextEdges };
    const plan = computeGraphSyncPlan(live, nextNodes, nextEdges);
    expect(plan.addNodes).toEqual([]);
    expect(plan.updateNodes).toEqual([]);
    expect(plan.removeNodeIds).toEqual([]);
    expect(plan.addEdges).toEqual([]);
    expect(plan.removeEdgeIds).toEqual([]);
    expect(plan.structureChanged).toBe(false);
  });

  it("仅度数/标签变化：只 updateNodes（结构不变＝只 draw 不 layout，位置不动）", () => {
    const live: LiveGraphSnapshot = { nodes: [payloadOf(node("a", "旧名", 0))], edges: [] };
    const plan = computeGraphSyncPlan(live, [payloadOf(node("a", "新名", 3))], []);
    expect(plan.updateNodes).toEqual([{ id: "a", data: { label: "新名", degree: 3, catFill: undefined } }]);
    expect(plan.addNodes).toEqual([]);
    expect(plan.removeNodeIds).toEqual([]);
    expect(plan.structureChanged).toBe(false);
  });

  it("节点消失：进 removeNodeIds；其相连边因下一份不含连带进 removeEdgeIds", () => {
    const live: LiveGraphSnapshot = {
      nodes: [payloadOf(node("a")), payloadOf(node("b"))],
      edges: [edgePayloadOf(edge("e1", "a", "b"))],
    };
    const plan = computeGraphSyncPlan(live, [payloadOf(node("a"))], []);
    expect(plan.removeNodeIds).toEqual(["b"]);
    expect(plan.removeEdgeIds).toEqual(["e1"]);
    expect(plan.structureChanged).toBe(true);
  });

  it("新增边（两端既有）：只 addEdges，结构变化＝轻推布局", () => {
    const live: LiveGraphSnapshot = { nodes: [payloadOf(node("a")), payloadOf(node("b"))], edges: [] };
    const plan = computeGraphSyncPlan(live, [payloadOf(node("a")), payloadOf(node("b"))], [edgePayloadOf(edge("e1", "a", "b"))]);
    expect(plan.addEdges.map((e) => e.id)).toEqual(["e1"]);
    expect(plan.addNodes).toEqual([]);
    expect(plan.structureChanged).toBe(true);
  });

  it("位置种子进 addNodes（首建重挂载经位置缓存），既有节点的更新负载不含 style", () => {
    const seeded = buildNodePayload(node("a"), 0, undefined, { x: 120, y: 80 });
    const plan = computeGraphSyncPlan({ nodes: [], edges: [] }, [seeded], []);
    expect(plan.addNodes[0].style).toEqual({ x: 120, y: 80 });
    const updated = computeGraphSyncPlan(
      { nodes: [payloadOf(node("a", "旧", 0))], edges: [] },
      [buildNodePayload(node("a"), 1, undefined)],
      [],
    );
    expect(updated.updateNodes[0]).not.toHaveProperty("style");
  });
});
