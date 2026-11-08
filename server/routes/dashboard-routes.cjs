// @responsible: 注册全量与架构范围的仪表盘拓扑和缺口查询接口。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const mgs = require("../services/projection/master-graph-service.cjs");
const sas = require("../services/projection/semantic-architecture-service.cjs");
const { computeGaps } = require("../services/anomaly/gap-engine.cjs");
const { sha256Revision } = require("../shared/working-artifact-snapshot.cjs");

function buildNodesById(nodes) {
  var nodesById = {};
  for (var i = 0; i < (nodes || []).length; i++) {
    var n = nodes[i];
    var props = n.properties || {};
    nodesById[n.id] = {
      id: n.id,
      label: n.label || n.id,
      category: n.category || "未分类",
      labels: n.labels || [],
      filePath: props.file_path || null,
      // WP-031：文档级缺口豁免规则（gap-engine computeGaps 消费——同管道双粒度豁免）
      exemptRules: Array.isArray(props.exempt_rules) ? props.exempt_rules.map(String) : [],
    };
  }
  return nodesById;
}

function computeDashboardGaps(masterGraph, resolvedGapIds) {
  var gaps = [];
  var warnings = [];
  var exempted = [];

  try {
    const normalized = mgs.normalizeTopology(masterGraph);
    const filtered = mgs.filterTopologyEntities(normalized.nodes, normalized.edges);
    const validNodeIds = new Set(filtered.nodes.map(function (n) { return n.id; }));
    const keptEdges = filtered.edges;
    const allRawEdges = (masterGraph.connections || []).map(function (c) {
      return {
        source: c.from,
        target: c.to,
        type: c.relationType || c.type || "RELATES_TO",
        properties: c.properties || {},
      };
    });
    const allNodeIds = new Set((masterGraph.nodes || []).map(function (n) { return n.id; }));
    const nodesById = buildNodesById(masterGraph.nodes || []);
    var result = computeGaps(validNodeIds, keptEdges, allRawEdges, allNodeIds, nodesById, resolvedGapIds);
    gaps = result.gaps;
    warnings = result.warnings;
    exempted = result.exempted || [];

    if (warnings.length > 0) {
      logger.warn({ event: "gap-engine-warnings", count: warnings.length, warnings: warnings });
    }
    if (exempted.length > 0) {
      // WP-031：规则豁免可追溯——INFO 级流水（不静默消失）；计数面经响应透出
      logger.info({ event: "gap-engine-exempted", count: exempted.length });
    }
  } catch (e) {
    logger.error({ event: "gap-engine-failed", error: e.message });
  }

  return { gaps: gaps, warnings: warnings, exempted: exempted };
}

function buildFullDashboardResponse(masterGraph, relationSearchGraph, navigationGraph, resolvedGapIds, identity = {}) {
  const top = mgs.topNodesByDegree(masterGraph, 199);
  const taxonomyTree = mgs.buildTaxonomyTree(navigationGraph);
  const gapResult = computeDashboardGaps(masterGraph, resolvedGapIds);
  const knowledgeTopology = mgs.buildKnowledgeTopology(relationSearchGraph);
  var responseBody = {
    scope: "full",
    totalNodes: top.totalNodes,
    returnedNodes: top.returnedNodes,
    // WP-071：边与节点同口径（均经实体准入过滤），不再取未过滤的 masterGraph.connections
    totalEdges: top.totalEdges,
    returnedEdges: top.returnedEdges,
    truncationReason: top.totalNodes > top.returnedNodes ? "top-199 by degree" : undefined,
    topology: { nodes: top.nodes, edges: top.edges },
    knowledgeTopology: knowledgeTopology,
    taxonomyTree: taxonomyTree,
    category_counts: top.nodes.reduce(function (acc, n) { acc[n.category || "未分类"] = (acc[n.category || "未分类"] || 0) + 1; return acc; }, {}),
    hub_top15: top.nodes.slice(0, 15).map(function (n) { return { id: n.id, label: n.label, degree: n.degree }; }),
    gaps: gapResult.gaps,
    // WP-031：按文档豁免规则豁免的缺口（可追溯不静默——豁免计数面；明细经列表查询）
    gapsExempted: gapResult.exempted.length,
    gapsExemptedItems: gapResult.exempted,
    ...identity,
  };
  if (gapResult.warnings.length > 0) responseBody.warnings = gapResult.warnings;
  return responseBody;
}

function buildArchitectureDashboardResponse(masterGraph, navigationGraph, readSemanticArchitecture, identity = {}, selection = {}) {
  // PR-084：SA 经读侧唯一咽喉取——无数据时咽喉返回注册表零值形状（components=[]），本函数不再自判空：
  // 空 seeds 自然产出零值载荷（returnedNodes 0／topology 空／seedCount 0／dataFreshness.reason=file_not_found），
  // 与 PR-081 裁定「没数据各组件显示 0，前端不感知产品概念」同输出——「无数据怎么办」只在咽喉实现一次。
  const sa = readSemanticArchitecture(selection);
  const components = Array.isArray(sa.components) ? sa.components : Array.isArray(sa.nodes) ? sa.nodes : [];

  const componentIds = [...new Set(components.map((component) => sas.normalizeComponentId(component.id || component)).filter(Boolean))];
  const updatedAt = sa._generated_at || sa.generatedAt || sa.generated_at || sa.updatedAt || sa.updated_at || null;
  const freshness = identity.releaseId
    ? { fresh: true, ageHours: 0, updatedAt, version: sa.version || "unknown" }
    : sas.validateFreshness(24);
  const subgraph = mgs.pruneToSubgraph(componentIds, 2, masterGraph);
  // WP-071：total* 取全量准入集合口径，与 returned*（子图）同属实体准入，仅范围不同
  const normalizedFull = mgs.normalizeTopology(masterGraph);
  const admittedFull = mgs.filterTopologyEntities(normalizedFull.nodes, normalizedFull.edges);

  return {
    body: {
      scope: "architecture",
      totalNodes: admittedFull.nodes.length,
      returnedNodes: subgraph.nodes.length,
      totalEdges: admittedFull.edges.length,
      returnedEdges: subgraph.edges.length,
      topology: { nodes: subgraph.nodes, edges: subgraph.edges },
      taxonomyTree: mgs.buildTaxonomyTree(navigationGraph),
      seedComponentIds: componentIds,
      seedCount: componentIds.length,
      implicitPaths: subgraph.implicitPaths || [],
      unresolvedPairs: subgraph.unresolvedPairs || [],
      missingSeeds: subgraph.missingSeeds || [],
      dataFreshness: freshness,
      ...identity,
    },
    freshness: freshness,
  };
}

function register(registerRoute, deps) {
  const { readMasterGraph, readSemanticArchitecture } = deps;
  const getResolvedGapIds = deps.getResolvedGapIds || function () { return new Set(); };

  // ADR067：页面数据源单一化——/api/dashboard/topology 恒走工作投影活读（Vault 现态），
  // 正式代次（release 快照）不再进入 dashboard 消费链（freshness 恒 null，横幅退役）。
  // 正式存档仍由 release-governance 维护并供 /api/releases/current/restore 与版本对照使用。
  function withSources(callback) {
    return callback({
      identity: { dataSource: "worktree", workingRevision: sha256Revision(Buffer.from(JSON.stringify(readMasterGraph()))) },
      getResolvedGapIds,
      readMasterGraph,
      readNavigationGraph: readMasterGraph,
      readRelationSearchGraph: readMasterGraph,
      readSemanticArchitecture,
    });
  }

  registerRoute("GET", "/api/dashboard/topology", (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const scope = u.searchParams.get("scope") || "full";

    if (scope !== "full" && scope !== "architecture") {
      return sendJSON(res, 400, { error_code: "VALIDATION_ERROR", message: `无效 scope: ${scope}，仅支持 full | architecture` });
    }

    return withSources((sources) => {
    // PR-081 全量范围落地（Master 2026-10-26「空库就显示各项0就行了啊要什么指引」）：空图是合法
    // 空态，零值形状自然产出全零载荷——与架构范围 PR-084 同构；NOT_INITIALIZED 404 编外码退役
    // （契约本只声明 200/400，error-code-exemptions 欠账同批清账）。图丢失不产生写增量、due 自动
    // 链路不触发，全量重建只走管道面板 force 维护通道（ADR-011 D2/D4）。
    const emptyGraph = { nodes: [], connections: [] };
    const asGraph = (g) => (g && Array.isArray(g.nodes) && g.nodes.length > 0 ? g : emptyGraph);
    const masterGraph = asGraph(sources.readMasterGraph());
    const navigationGraph = asGraph(sources.readNavigationGraph());
    const relationSearchGraph = asGraph(sources.readRelationSearchGraph());

    if (scope === "full") {
      return sendJSON(res, 200, buildFullDashboardResponse(masterGraph, relationSearchGraph, navigationGraph, sources.getResolvedGapIds(), sources.identity));
    }

    const architectureResult = buildArchitectureDashboardResponse(masterGraph, navigationGraph, sources.readSemanticArchitecture, sources.identity, {
      product: u.searchParams.get("product") || "",
      version: u.searchParams.get("version") || "",
    });
    // PR-084：SA 空态 404 分支退役——咽喉零值形状使 builder 永不返回空，无数据即 200 零值载荷（契约 200/400）。

    if (!architectureResult.freshness.fresh) res.header("X-Data-Staleness", "warn");
    return sendJSON(res, 200, architectureResult.body);
    });
  });
}

module.exports = { register };
