// graph-sync — LocalGraph 增量同步纯函数（Obsidian 式常驻实例的数据落图方式）。
// 背景（Master 2026-11-20「一大一小跳变为什么自己造轮子」）：渲染物理早已是 Obsidian 同款
// d3-force，但数据更新走「整图销毁重建」——每次重挂载/数据变化都从中心炸开＋fitView 重适配，
// 即用户看到的图面跳变。Obsidian 的实际做法是图谱视图常驻一个力仿真实例，文件变化只把
// 增量并入仿真、节点原位轻推。本模块把「下一份图数据 → 对现有实例的最小数据操作」收成
// 纯函数（可单测钉死），G6 调用面（addData/updateData/removeData/draw/layout）在组件内。
// G6 v5.1.1 API 勘探（node_modules/@antv/g6/lib/runtime/graph.d.ts）：render()=数据+绘制+布局；
// draw()=仅绘制不布局；layout()=执行布局（d3-force 从元素现位起步）；数据 API 不自动绘制。

import type { TopoEdge, TopoNode } from "@/lib/topology-types";

/** 图实例当前数据快照（getNodeData/getEdgeData 的最小投影） */
export interface LiveGraphSnapshot {
  nodes: Array<{ id: string; data?: { label?: string; degree?: number; catFill?: string }; style?: { x?: number; y?: number } }>;
  edges: Array<{ id: string }>;
}

/** 节点负载（与组件内首建 payload 同形——label/degree/catFill 走样式回调读取） */
export interface SyncNodePayload {
  id: string;
  data: { label: string; degree: number; catFill: string | undefined };
  style?: { x?: number; y?: number };
}

export interface SyncEdgePayload {
  id: string;
  source: string;
  target: string;
}

export interface GraphSyncPlan {
  addNodes: SyncNodePayload[];
  /** 仅 data 变化的既有节点（updateData 增量负载，不含 style——既有节点位置不动） */
  updateNodes: Array<{ id: string; data: { label: string; degree: number; catFill: string | undefined } }>;
  removeNodeIds: string[];
  addEdges: SyncEdgePayload[];
  removeEdgeIds: string[];
  /** 结构增删＝需要轻推布局（d3-force 从现位重入仿真）；纯属性变化只 draw 不 layout */
  structureChanged: boolean;
}

const payloadKey = (n: { data: { label: string; degree: number; catFill: string | undefined } }): string =>
  JSON.stringify([n.data.label, n.data.degree, n.data.catFill]);

/**
 * 计算现有实例 → 下一份图数据的最小操作集。
 * @param live  图实例当前数据（getNodeData/getEdgeData）
 * @param nextNodes 下一份可见节点与负载（style=种子位置：跨重挂载位置缓存或新节点邻接散点）
 * @param nextEdges 下一份可见边与负载
 */
export function computeGraphSyncPlan(
  live: LiveGraphSnapshot,
  nextNodes: SyncNodePayload[],
  nextEdges: SyncEdgePayload[],
): GraphSyncPlan {
  const liveNodeById = new Map(live.nodes.map((n) => [String(n.id), n]));
  const liveEdgeIds = new Set(live.edges.map((e) => String(e.id)));

  const nextNodeById = new Map(nextNodes.map((n) => [String(n.id), n]));
  const nextEdgeIds = new Set(nextEdges.map((e) => String(e.id)));

  const addNodes = nextNodes.filter((n) => !liveNodeById.has(String(n.id)));
  const updateNodes = nextNodes
    .filter((n) => {
      const cur = liveNodeById.get(String(n.id));
      return cur && payloadKey(cur as SyncNodePayload) !== payloadKey(n);
    })
    .map((n) => ({ id: n.id, data: n.data }));
  const removeNodeIds = [...liveNodeById.keys()].filter((id) => !nextNodeById.has(id));

  const addEdges = nextEdges.filter((e) => !liveEdgeIds.has(String(e.id)));
  // 边移除＝下一份里没有（含端点节点消失连带失效的边）
  const removeEdgeIds = [...liveEdgeIds].filter((id) => !nextEdgeIds.has(id));

  const structureChanged =
    addNodes.length > 0 || removeNodeIds.length > 0 || addEdges.length > 0 || removeEdgeIds.length > 0;

  return { addNodes, updateNodes, removeNodeIds, addEdges, removeEdgeIds, structureChanged };
}

/** 从拓扑节点与度数表构建节点负载（组件首建与增量共用一份形状，禁两处抄写） */
export function buildNodePayload(
  n: TopoNode,
  degree: number,
  catFill: string | undefined,
  seed?: { x: number; y: number },
): SyncNodePayload {
  return {
    id: n.id,
    data: { label: n.label, degree, catFill },
    style: seed ? { x: seed.x, y: seed.y } : undefined,
  };
}

export function buildEdgePayload(e: TopoEdge): SyncEdgePayload {
  return { id: e.edgeId, source: e.source, target: e.target };
}
