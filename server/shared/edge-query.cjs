// Component: Edge-Query — EDGE-RELATION-GOV-001 阶段 3（ADR-012 决策二／SPEC-026 §十一）
// @responsible: ④类纯查询模块——出链/反链/有向邻域的组合逻辑。SQL 全部经 derived-index-store 网关
//   （本模块零 SQL、零连接点——check:domain-registry catalog 面口径）；邻域为 runtime_view 查询时现算不持久化。
// @inputs: store（derived-index-store.graphProjection 家族）
// @outputs: createEdgeQuery({ store }) → { edgesForNode, getEdge, neighborhood }
// @context: 有向语义修正立案 §3.3（旧 graph-neighborhood.cjs 无向 BFS 丢失方向与类型——本模块在新行级
//   数据上保留每条边的真实方向，扩展可沿出/入两个方向走，但结果边集带 source/target 可区分 A→B 与 B→A）。
"use strict";

function createEdgeQuery({ store }) {
  const gp = store && store.graphProjection;
  if (!gp || typeof gp.edgesFrom !== "function" || typeof gp.edgesTo !== "function" || typeof gp.getNode !== "function") {
    throw new Error("edge-query: store.graphProjection（edgesFrom/edgesTo/getNode）required");
  }

  /** 出链/反链/双向（both＝并集去重，按 edgeId 升序）。 */
  function edgesForNode(nodeId, { direction = "both", relationType = null, limit = 100 } = {}) {
    if (direction === "out") return gp.edgesFrom(nodeId, { relationType, limit });
    if (direction === "in") return gp.edgesTo(nodeId, { relationType, limit });
    const merged = new Map();
    for (const e of gp.edgesFrom(nodeId, { relationType, limit })) merged.set(e.edgeId, e);
    for (const e of gp.edgesTo(nodeId, { relationType, limit })) merged.set(e.edgeId, e);
    return [...merged.values()].sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1)).slice(0, limit);
  }

  /** 有向邻域：从 centerId 沿出边与入边分层扩展（中心不存在→真实零值，PR-084 口径不 404）。 */
  function neighborhood(centerId, { hops = 1, relationType = null, maxNodes = 200, maxEdges = 400 } = {}) {
    const center = gp.getNode(centerId);
    if (!center) {
      return { centerId, hops, directed: true, nodes: [], edges: [], centerFound: false, truncated: false, hopsByNodeId: {} };
    }
    const hopsByNodeId = new Map([[centerId, 0]]);
    const nodeRows = new Map([[centerId, center]]);
    const edgeRows = new Map();
    let truncated = false;
    let frontier = [centerId];
    for (let d = 0; d < hops && !truncated; d += 1) {
      const next = [];
      for (const nodeId of frontier) {
        // 每个已入域节点收边：出边+入边各取 maxEdges 余量（relationType 过滤下推到索引查询）
        const remainingEdges = maxEdges - edgeRows.size;
        if (remainingEdges <= 0) { truncated = true; break; }
        const outgoing = gp.edgesFrom(nodeId, { relationType, limit: remainingEdges });
        const incoming = gp.edgesTo(nodeId, { relationType, limit: remainingEdges });
        for (const e of [...outgoing, ...incoming]) {
          edgeRows.set(e.edgeId, e);
          if (edgeRows.size >= maxEdges) { truncated = true; break; }
          for (const endpoint of [e.sourceId, e.targetId]) {
            if (!hopsByNodeId.has(endpoint)) {
              if (nodeRows.size >= maxNodes) { truncated = true; break; }
              const node = gp.getNode(endpoint);
              if (!node) continue; // 悬挂端点（投影与节点表理论上同源同批，防御性跳过）
              hopsByNodeId.set(endpoint, d + 1);
              nodeRows.set(endpoint, node);
              next.push(endpoint);
            }
          }
          if (truncated) break;
        }
        if (truncated) break;
      }
      frontier = next;
    }
    return {
      centerId,
      hops,
      directed: true,
      nodes: [...nodeRows.values()].sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1)),
      edges: [...edgeRows.values()].sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1)),
      centerFound: true,
      truncated,
      hopsByNodeId: Object.fromEntries(hopsByNodeId),
    };
  }

  return { edgesForNode, getEdge: (edgeId) => gp.getEdge(edgeId), neighborhood };
}

module.exports = { createEdgeQuery };
