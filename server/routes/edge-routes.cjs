// Component: Edge-Routes — EDGE-RELATION-GOV-001 阶段 3 统一读入口（ADR-012 决策二／SPEC-026 §十一）
// @responsible: /api/edges 出链/反链、/api/edges/neighborhood 有向邻域、/api/edges/{edge_id} 单边读取。
// @inputs: edgeQuery（④类查询模块）、formalConsumer（锁版正式读——门禁三答①②，立案 §6.5）
// @outputs: JSON envelope（freshness 标注随响应；stale 分流同 kg/query）
// @context: 门禁不可旁路——fresh（锁版 Release）路径经 context.readMasterGraph("relation_search")
//   （formal-knowledge-consumer 内部 selectFormalRelations 按断言政策过滤 approved_only＋formal_consumers
//   白名单）；stale 回落工作态投影（null context，全量带 review_status）；邻域恒走工作态（runtime_view 现算）。
"use strict";

const { sendJSON } = require("../shared/api-envelope.cjs");
const { createFreshnessGate } = require("../shared/release-freshness-gate.cjs");
const { normalizeTopology } = require("../services/projection/master-graph-service.cjs");
const { topoToRows } = require("../services/projection/edge-projection-service.cjs");

let _vaultPath = null;
function setVaultPath(p) { _vaultPath = p; }

const DIRECTIONS = new Set(["out", "in", "both"]);

function parseListParams(url, defaults = {}) {
  const q = url.searchParams;
  const node = q.get("node") || "";
  const direction = q.get("direction") || defaults.direction || "both";
  const relationType = q.get("relationType") || null;
  const limit = parseInt(q.get("limit") || String(defaults.limit || 100), 10);
  if (!node) return { error: "node 参数必填" };
  if (!DIRECTIONS.has(direction)) return { error: "direction 只允许 out|in|both" };
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return { error: "limit 须为 1..500 整数" };
  return { node, direction, relationType, limit };
}

function filterRows(rows, { node, direction, relationType, limit }) {
  let out = rows;
  if (relationType) out = out.filter((e) => e.relationType === relationType);
  if (direction === "out") out = out.filter((e) => e.sourceId === node);
  else if (direction === "in") out = out.filter((e) => e.targetId === node);
  else out = out.filter((e) => e.sourceId === node || e.targetId === node);
  return out.sort((a, b) => (a.edgeId < b.edgeId ? -1 : 1)).slice(0, limit);
}

function register(registerRoute, deps) {
  const edgeQuery = deps.edgeQuery;
  const formalConsumer = deps.formalConsumer || null;
  const suggestionService = deps.suggestionService || null;
  // SPEC-027 C4/C5：行→建议服务适配（行 camelCase ↔ 服务入参），仅附只读四字段
  function annotateRows(rows) {
    if (!suggestionService) return rows;
    return rows.map((row) => {
      const props = row.properties && typeof row.properties === "object" ? row.properties : {};
      const a = suggestionService.annotateEdge({ source: row.sourceId, target: row.targetId, type: row.relationType, confidence: props.confidence, properties: props });
      const out = { ...row, confidenceSource: a.confidenceSource };
      if (a.effectiveConfidence !== undefined) out.effectiveConfidence = a.effectiveConfidence;
      if (a.suggestedConfidence !== undefined) { out.suggestedConfidence = a.suggestedConfidence; out.suggestedConfidenceBand = a.suggestedConfidenceBand; out.suggestedConfidenceEvidence = a.suggestedConfidenceEvidence; } // WP-142 批⓪：预填档位随建议同行下发（服务端换算，阈值零手抄）
      return out;
    });
  }
  const freshnessGate = createFreshnessGate({ formalConsumer, vaultPath: _vaultPath });

  // 门禁三答①：正式路径消费方身份复用 relation_search（与 /api/kg/query 读依赖同语义，不新造 token）
  const CONSUMER = "relation_search";

  function formalEdges(context) {
    // context.readMasterGraph(CONSUMER) 已按断言政策过滤（approved_only＋formal_consumers 白名单）；
    // 形态归一复用 normalizeTopology＋topoToRows（单一映射源，不抄第二份转换）
    const graph = context.readMasterGraph(CONSUMER) || {};
    return topoToRows(normalizeTopology(graph)).edges;
  }

  registerRoute("GET", "/api/edges", (req, res) => {
    const url = new URL(req.url || "/api/edges", "http://127.0.0.1");
    const params = parseListParams(url);
    if (params.error) {
      return sendJSON(res, 400, { error_code: "INVALID_QUERY", message: params.error });
    }
    return freshnessGate.withFreshness((context, freshness) => {
      let edges;
      if (context) {
        edges = filterRows(formalEdges(context), params);
      } else {
        edges = edgeQuery.edgesForNode(params.node, params);
      }
      const annotated = annotateRows(edges);
      return sendJSON(res, 200, {
        edges: annotated,
        count: annotated.length,
        freshness,
        ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : { dataSource: "working-projection" }),
      });
    }).catch((error) => {
      const status = error?.code === "INVALID_QUERY" ? 400 : error?.status || 500;
      sendJSON(res, status, { error_code: error?.code || "INTERNAL_ERROR", message: error?.message || "edge 查询失败" });
    });
  });

  registerRoute("GET", "/api/edges/neighborhood", (req, res) => {
    const url = new URL(req.url || "/api/edges/neighborhood", "http://127.0.0.1");
    const node = url.searchParams.get("node") || "";
    const relationType = url.searchParams.get("relationType") || null;
    const hops = parseInt(url.searchParams.get("hops") || "1", 10);
    if (!node) return sendJSON(res, 400, { error_code: "INVALID_QUERY", message: "node 参数必填" });
    if (!Number.isInteger(hops) || hops < 1 || hops > 3) {
      return sendJSON(res, 400, { error_code: "INVALID_QUERY", message: "hops 须为 1..3 整数" });
    }
    try {
      // 邻域＝runtime_view 现算（立案 §6.1），恒走工作态投影；中心不存在→真实零值 200（PR-084 口径）
      // Obsidian 口径：邻域＝同一张图的局部视图——边注记与 /api/edges 完全一致，不特殊化
      const nb = edgeQuery.neighborhood(node, { hops, relationType });
      return sendJSON(res, 200, { ...nb, edges: annotateRows(nb.edges) });
    } catch (error) {
      return sendJSON(res, 500, { error_code: "INTERNAL_ERROR", message: error?.message || "邻域查询失败" });
    }
  });

  registerRoute("GET", "/api/edges/:edgeId", (req, res) => {
    const edgeId = (req.params && req.params.edgeId) || "";
    if (!edgeId) return sendJSON(res, 400, { error_code: "INVALID_QUERY", message: "edgeId 必填" });
    const edge = edgeQuery.getEdge(edgeId);
    if (!edge) {
      // 复用既有 EDGE_NOT_FOUND 错误码与 allOf 目录单元（review-routes 同源；单点定义 $ref 引用）
      return sendJSON(res, 404, { error_code: "EDGE_NOT_FOUND", message: `关系边不存在: ${edgeId}`, details: { edgeId } });
    }
    return sendJSON(res, 200, { edge: annotateRows([edge])[0] });
  });
}

module.exports = { register, setVaultPath };
