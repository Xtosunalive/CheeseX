// Component: KG-Routes — serves /api/kg/query from semantic_architecture.json
// @responsible: 提供知识图谱查询、审核历史与治理决策 HTTP 路由。
// @inputs: master_graph、semantic_architecture 与治理请求
// @outputs: KG 查询响应、审核历史与治理决策记录
// @context: Canvas
// + POST /api/governance/resolve — 治理缺口 resolve/ignore 决策
const { sendJSON } = require("../shared/api-envelope.cjs");
const { createError } = require("../shared/error-factory.cjs");
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs"); // WP-048 Wave 1
const { logger } = require("../shared/json-logger.cjs");
const { getArchitectureProduct } = require("../shared/schema-config.cjs");
const { readReviewActions } = require("../services/governance/review-action-store.cjs");
const { sha256Revision, readMasterGraphArtifact } = require("../shared/working-artifact-snapshot.cjs");
const { createFreshnessGate, checkFreshness } = require("../shared/release-freshness-gate.cjs");
const { displayAvailability } = require("../shared/availability-view.cjs"); // WP-070 §3.3（展示类）：空结果附「缺什么/去哪配」指引，200 不当错误
const { MULTI_FACETS } = require("../services/projection/document-inventory-service.cjs"); // seq194：多值参数词表单源（审计族 W 收敛，字面量第二份退役）
// WP-030/PR-145：图准入单源（源文档判定键序 file_path→sourcePath→source_path）——
// canvas-admission 的 missing_source_article 判定从本契约取键，消除前后端口径漂移的根。
var GRAPH_ADMISSION = { sourceArticleKeys: ["file_path", "sourcePath", "source_path"] };
try { GRAPH_ADMISSION = require("../../contracts/graph-admission.json"); } catch (_e) { /* 契约缺失回退内置缺省 */ }
let _vaultPath = null;
function setVaultPath(p) { _vaultPath = p; }

function fallbackDataSource() {
  try {
    if (!_vaultPath) return { dataSource: "worktree" };
    const artifact = readMasterGraphArtifact(_vaultPath);
    return { dataSource: "worktree", workingRevision: artifact.revision || sha256Revision(artifact.bytes || Buffer.from("")) };
  } catch (_error) {
    return { dataSource: "worktree" };
  }
}

function register(registerRoute, deps) {
  const { readSemanticArchitecture, readMasterGraph } = deps;
  const documentInventoryService = deps.documentInventoryService || null;
  const impactAnalysisService = deps.impactAnalysisService || null;
  const formalConsumer = deps.formalConsumer || null;
  const impactAnalysisFactory = deps.impactAnalysisFactory || null;
  const addGovernanceAction = deps.addGovernanceAction;
  // 图族刷新收敛（2026-10-15）：图服务读路径顺带做漂移检测（节流；漂移→后台去抖自动重算，绝不阻塞读）
  const graphDriftCheck = typeof deps.graphDriftCheck === "function" ? deps.graphDriftCheck : null;

  function withFormal(callback) {
    return formalConsumer ? formalConsumer.withPinnedRelease(callback) : callback(null);
  }

  // ADR064 正式代次新鲜度门：Release 落后于活 Vault HEAD 时分流到各路由既有 null-context 活读分支，
  // 并在响应携带 freshness 标注；fresh/unknown（git 不可用）维持原 release 读法。仅用于操作/视图面端点；
  // 文档检索（release-pinned 索引语义）不经过本门。
  const freshnessGate = createFreshnessGate({ formalConsumer, vaultPath: _vaultPath });

  function inventoryFor(context) { return context?.documentInventory || documentInventoryService; }

  function inventoryError(res, error) {
    const code = error && error.code ? error.code : "INTERNAL_ERROR";
    const status = code === "INVALID_QUERY" ? 400
      : code === "NODE_NOT_FOUND" || code === "DOCUMENT_NOT_FOUND" ? 404
        : code === "DUPLICATE_DOCUMENT_ID" ? 409
        : code === "INDEX_REBUILD_IN_PROGRESS" ? 409
          : code === "DOCUMENT_INDEX_UNAVAILABLE" ? 503 : error?.status || 500;
    return sendJSON(res, status, { error_code: code, message: error && error.message ? error.message : "文档检索失败" });
  }

  function parseBooleanParam(value, name) {
    if (value === null) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    const error = new Error(`${name} 必须是 true 或 false`);
    error.code = "INVALID_QUERY";
    throw error;
  }

  function parseInventoryQuery(req) {
    const url = new URL(req.url || "/api/kg/search-documents", "http://127.0.0.1");
    const params = {};
    const scalar = ["status", "module", "keyword", "wikilinkTarget", "nodeId", "documentId", "product", "version", "articleType", "docType"];
    for (const key of MULTI_FACETS) {
      const values = url.searchParams.getAll(key).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
      if (values.length) params[key] = values;
    }
    for (const key of scalar) {
      const value = url.searchParams.get(key);
      if (value !== null && value.trim()) params[key] = value.trim();
    }
    for (const key of ["arch_component", "includeRelations", "includeDocuments"]) {
      const value = parseBooleanParam(url.searchParams.get(key), key);
      if (value !== undefined) params[key] = value;
    }
    for (const key of ["limit", "offset"]) {
      const raw = url.searchParams.get(key);
      if (raw !== null) {
        const value = Number(raw);
        if (!Number.isInteger(value) || (key === "limit" && (value < 1 || value > 200)) || (key === "offset" && value < 0)) {
          const error = new Error("limit 必须为 1..200 的整数，offset 必须为非负整数"); error.code = "INVALID_QUERY"; throw error;
        }
        params[key] = value;
      }
    }
    return params;
  }

  registerRoute("GET", "/api/documents/search", (req, res) => {
    try {
      const search = (context, absentKinds) => {
        const inventory = inventoryFor(context);
        if (!inventory) throw Object.assign(new Error("文档索引服务未初始化"), { code: "DOCUMENT_INDEX_UNAVAILABLE" });
        const result = inventory.searchDocuments(parseInventoryQuery(req));
        // WP-070 展示类：零发布→no-formal-release；有发布但空→formal-release-empty；指引经契约单源
        const kinds = absentKinds || ((result.documents || []).length === 0 ? ["formal-release-empty"] : []);
        const availability = displayAvailability(kinds);
        return context ? { ...result, availability } : { ...result, ...fallbackDataSource(), availability };
      };
      let payload;
      try {
        payload = withFormal((context) => search(context, null));
      } catch (error) {
        // 零发布态（release-reader NO_CURRENT_RELEASE 404）：展示类不当错误——走既有工作树活读分支（E3 同构）＋指引
        if (!error || error.code !== "NO_CURRENT_RELEASE") throw error;
        payload = search(null, ["no-formal-release"]);
      }
      sendJSON(res, 200, payload);
    } catch (error) { inventoryError(res, error); }
  });

  registerRoute("GET", "/api/documents/:documentId", (req, res) => {
    try {
      sendJSON(res, 200, withFormal((context) => {
        const inventory = inventoryFor(context);
        if (!inventory) throw Object.assign(new Error("文档索引服务未初始化"), { code: "DOCUMENT_INDEX_UNAVAILABLE" });
        const result = inventory.getDocument(req.params && req.params.documentId ? req.params.documentId : "");
        return context ? result : { ...result, ...fallbackDataSource() };
      }));
    } catch (error) { inventoryError(res, error); }
  });

  registerRoute("POST", "/api/documents/index/rebuild", async (_req, res) => {
    try {
      if (formalConsumer) throw Object.assign(new Error("不可变 Release 文档索引不能原地重建"), { code: "RELEASE_INDEX_IMMUTABLE", status: 409 });
      if (!documentInventoryService) throw Object.assign(new Error("文档索引服务未初始化"), { code: "DOCUMENT_INDEX_UNAVAILABLE" });
      sendJSON(res, 200, await documentInventoryService.rebuild());
    } catch (error) { inventoryError(res, error); }
  });

  // ADR064 修订（Master 2026-10-15 裁「2 选 A」）：检索面（release-pinned 索引语义）纳入新鲜度
  // **标注**——与操作/视图面的分流语义不同：数据仍读 pinned Release（保索引稳定），响应带
  // freshness 字段（stale 时前端黄条提示「正式快照落后于活库，已删内容仍可见」）。
  // TALOS 同构：冻结历史默认不进读路径——至少让读者知道自己在读冻结历史。
  async function withPinnedAnnotated(callback) {
    if (!formalConsumer || typeof formalConsumer.withPinnedRelease !== "function") return callback(null, null);
    return formalConsumer.withPinnedRelease(async (context) => {
      const freshness = await checkFreshness(context, _vaultPath);
      return callback(context, freshness);
    });
  }

  registerRoute("GET", "/api/kg/search-documents", (req, res) => {
    return withPinnedAnnotated((context, freshness) => { // PR-085：handler 须 return Promise，由传输层等待（原 void 发后不管在框架下会被判「未产生响应」）
      try {
        const inventory = inventoryFor(context);
        if (!inventory) throw Object.assign(new Error("文档索引服务未初始化"), { code: "DOCUMENT_INDEX_UNAVAILABLE" });
        const result = inventory.search(parseInventoryQuery(req));
        return context ? { ...result, freshness } : { ...result, ...fallbackDataSource(), freshness };
      } catch (error) { inventoryError(res, error); return undefined; }
    }).then((payload) => { if (payload !== undefined) sendJSON(res, 200, payload); })
      .catch((error) => inventoryError(res, error));
  });

  registerRoute("GET", "/api/kg/node-documents", (req, res) => {
    return withPinnedAnnotated((context, freshness) => { // PR-085：handler 须 return Promise，由传输层等待（原 void 发后不管在框架下会被判「未产生响应」）
      try {
        const inventory = inventoryFor(context);
        if (!inventory) throw Object.assign(new Error("文档索引服务未初始化"), { code: "DOCUMENT_INDEX_UNAVAILABLE" });
        const params = parseInventoryQuery(req);
        if (!params.nodeId) throw Object.assign(new Error("nodeId 不能为空"), { code: "INVALID_QUERY" });
        const result = inventory.getNodeDocuments(params.nodeId);
        return context ? { ...result, freshness } : { ...result, ...fallbackDataSource(), freshness };
      } catch (error) { inventoryError(res, error); return undefined; }
    }).then((payload) => { if (payload !== undefined) sendJSON(res, 200, payload); })
      .catch((error) => inventoryError(res, error));
  });

  registerRoute("POST", "/api/kg/rebuild-index", async (_req, res) => {
    try {
      if (formalConsumer) throw Object.assign(new Error("不可变 Release 文档索引不能原地重建"), { code: "RELEASE_INDEX_IMMUTABLE", status: 409 });
      if (!documentInventoryService) throw Object.assign(new Error("文档索引服务未初始化"), { code: "DOCUMENT_INDEX_UNAVAILABLE" });
      sendJSON(res, 200, await documentInventoryService.rebuild());
    } catch (error) { inventoryError(res, error); }
  });

  registerRoute("POST", "/api/kg/impact-analysis", (req, res) => {
    try {
      const payload = req.body;
      sendJSON(res, 200, withFormal((context) => {
        const service = context && impactAnalysisFactory ? impactAnalysisFactory(context) : impactAnalysisService;
        if (!service) throw Object.assign(new Error("影响面分析服务未初始化"), { code: "GRAPH_UNAVAILABLE" });
        const result = service.analyze(payload);
        return context ? { ...result, releaseId: context.releaseId, sourceCommit: context.sourceCommit } : { ...result, ...fallbackDataSource() };
      }));
    } catch (error) {
      const code = error && error.code ? error.code : "INTERNAL_ERROR";
      const status = code === "INVALID_QUERY" ? 400 : code === "SEED_NOT_FOUND" ? 404 : code === "GRAPH_UNAVAILABLE" ? 503 : code === "INFERENCE_UNAVAILABLE" ? 503 : error?.status || 500;
      sendJSON(res, status, { error_code: code, message: error && error.message ? error.message : "影响面分析失败" });
    }
  });

  registerRoute("GET", "/api/kg/query", (req, res) => {
    if (graphDriftCheck) { try { graphDriftCheck(); } catch (_e) { /* 漂移检测静默失败不阻塞图查询 */ } }
    // PR-139：清单/检索面空库降级——无 current Release 时 null-context 活读（空清单/空态），
    // 不上抛 404（classification 等正式投影面保持发布前 404 产品语义——WP-017 头条证明依赖）
    return freshnessGate.withFreshness((context, freshness) => {
    const url = new URL(req.url || "/api/kg/query", "http://127.0.0.1");
    const queryType = url.searchParams.get("type") || "all";

    // Article-manifests: delegate to article-manifest service
    if (queryType === "article-manifests") {
      const ams = context ? { queryArticleManifests: context.queryArticleManifests } : deps.articleManifestService;
      if (!ams) {
        return sendJSON(res, 503, { error_code: "SERVICE_UNAVAILABLE", message: "article-manifest service 未初始化" });
      }
      const filter = url.searchParams.get("filter") || "all";
      const q = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const result = ams.queryArticleManifests({ filter, q, limit, offset });
      // ADR064 stale 分流后 context=null 不经 addIdentity——本分支必须自带身份/freshness（契约 KGQueryData oneOf），否则 enforce 拦截（#1776）
      return sendJSON(res, 200, {
        ...result,
        ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : fallbackDataSource()),
        freshness,
      });
    }

    const projectionSelection = {
      product: url.searchParams.get("product") || "",
      version: url.searchParams.get("version") || "",
    };
    // PR-084：工作态 SA 经读侧唯一咽喉取——无数据＝注册表零值形状（合法数据态，200 空集合渲染），
    // 「不存在→404」判空在路由层退役（契约本只登记 200/500，404 属编外码）；release 态照旧由 context 自有语义。
    const sa = context ? context.readSemanticArchitecture({ ...projectionSelection, consumer: "relation_search" }) : readSemanticArchitecture();
    let product;
    try {
      product = sa.product || (context ? "" : getArchitectureProduct(_vaultPath));
    } catch (err) {
      return sendJSON(res, 500, { error_code: "SCHEMA_CONFIG_ERROR", message: err.message });
    }

    const dependencies = context
      ? context.readMasterGraph("relation_search").connections.map((edge) => ({
        ...edge,
        source: edge.from || edge.source || "",
        target: edge.to || edge.target || "",
        type: edge.relationType || edge.type || "",
      }))
      : sa.dependencies || [];
    sendJSON(res, 200, {
      version: sa.version || "0.0.0",
      updatedAt: sa.updatedAt || "",
      product,
      components: (sa.components || []).map(function (c) {
        return {
          id: c.id || "",
          label: c.label || "",
          arch_layer: c.arch_layer || c.layer || "",
          layer: c.layer || "",
          arch_category: c.arch_category || c.category || "",
          sourcePath: c.sourcePath || "",
        };
      }),
      layers: (sa.layers || []).map(function (l) {
        return { id: l.id || "", label: l.label || "", rank: l.rank };
      }),
      dependencies,
      crosscutting: sa.crosscutting || [],
      gaps: (sa.gaps || []).map(function (g) {
        return {
          id: g.id || "",
          componentId: g.componentId || g.component_id || "",
          title: g.title || "",
          label: g.label || "",
          detail: g.detail || "",
          severity: g.severity || "",
          missing: g.missing || [],
          hasGraphNode: g.hasGraphNode !== false,
          hasWikiPage: g.hasWikiPage !== false,
          hasContent: g.hasContent !== false,
          relationCount: g.relationCount || g.relation_count || 0,
          wikiPath: g.wikiPath || g.wiki_path || "",
          layer: g.layer || "",
        };
      }),
      candidates: sa.candidates || [],
      coverage: sa.coverage || null,
      audit: sa.audit || null,
      layout: sa.layout || null,
      ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : fallbackDataSource()),
      freshness,
    });
    }, { onEmptyRelease: "degrade" });
  });

  registerRoute("GET", "/api/kg/canvas-admission", (_req, res) => {
    return freshnessGate.withFreshness((context, freshness) => {
    var graph = context ? context.readMasterGraph("topology") : readMasterGraph ? readMasterGraph() : null;
    var nodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
    var components = nodes.map(function (n) {
      var props = n.properties || {};
      var blockedReasons = [];
      if (!n.id) blockedReasons.push("missing_id");
      var hasSourceArticle = GRAPH_ADMISSION.sourceArticleKeys.some(function (k) { return !!props[k]; });
      if (!hasSourceArticle) blockedReasons.push("missing_source_article");
      // PR-156 刀三：节点种类显形（entity/document/taxonomy）——注册表混装分类学节点是
      // 「24 待准入实体」假数的根（分类学结构节点无准入语义却被计为待准入实体）。
      var labels = n.labels || [];
      var kind = "taxonomy";
      if (labels.indexOf("ArchitectureComponent") >= 0 || labels.indexOf("Module") >= 0) kind = "entity";
      else if (labels.indexOf("Document") >= 0) kind = "document";
      return {
        id: n.id || "",
        label: n.label || n.id || "",
        layer: props.arch_layer || n.category || "",
        kind: kind,
        admitted: blockedReasons.length === 0,
        blockedReasons: blockedReasons,
      };
    });
    var admitted = components.filter(function (c) { return c.admitted; }).length;
    // 分类汇总（准入语义只对 entity/document 成立；taxonomy 为结构节点不计数）
    var admittedByKind = { entity: 0, document: 0, taxonomy: 0 };
    var totalByKind = { entity: 0, document: 0, taxonomy: 0 };
    components.forEach(function (c) {
      if (totalByKind[c.kind] !== undefined) totalByKind[c.kind] += 1;
      if (c.admitted && admittedByKind[c.kind] !== undefined) admittedByKind[c.kind] += 1;
    });
    sendJSON(res, 200, {
      total: components.length,
      admitted: admitted,
      blocked: components.length - admitted,
      admittedByKind: admittedByKind,
      // WP-136 a：被减数随分子同管道产出——前端「待准入＝总数−已准入」自此直读两侧同集合的
      // 后端字段，本地那份按 components 重数的 kindTotals 退役（无 id 的 missing_id 条目天然在内）。
      totalByKind: totalByKind,
      components: components,
      ...(context ? { releaseId: context.releaseId, sourceCommit: context.sourceCommit } : fallbackDataSource()),
      freshness,
    });
    });
  });

  registerRoute("GET", "/api/kg/classification/list", (_req, res) => {
    return freshnessGate.withFreshness((context, freshness) => {
    // WP-070 §3.3（展示类）：消费服务层对未挂载身份保持 409 fail-closed（第三类不变）；本路由是清单
    // 展示站点（第二类）——在此接住定义码 PROJECTION_IDENTITY_UNMOUNTED 转 200＋空列表＋指引。
    // 供应 ADR-009 D5 的消费面语义不动，仅展示面按 Master 2026-11-02 三类裁决落位。
    var absent = [];
    var sa = null;
    try {
      sa = context ? context.readSemanticArchitecture({
        product: new URL(_req.url || "/api/kg/classification/list", "http://127.0.0.1").searchParams.get("product") || "",
        version: new URL(_req.url || "/api/kg/classification/list", "http://127.0.0.1").searchParams.get("version") || "",
        consumer: "topology",
      }) : readSemanticArchitecture();
    } catch (error) {
      // 展示类三分（各指各的去处）：未挂载身份／投影缺席（无冻结版本）；其他错误照常抛出
      if (error && error.code === "PROJECTION_IDENTITY_UNMOUNTED") absent.push("product-identity-unmounted");
      else if (error && error.code === "SEMANTIC_PROJECTION_NOT_FOUND") absent.push("semantic-architecture-empty");
      else throw error;
    }
    var components = sa && Array.isArray(sa.components) ? sa.components : [];
    var items = components.map(function (c) {
      return {
        entity_id: c.id || c.entity_id || "",
        module: c.module || c.moduleName || c.arch_module || "",
      };
    }).filter(function (item) { return item.entity_id || item.module; });
    // 投影在场但零组件＝还没有已准入实体（2026-11-02 实库探针：已冻结仍被指去冻结即此处粒度不足）
    if (!absent.length && items.length === 0) absent.push("architecture-entities-empty");
    var availability = displayAvailability(absent);
    sendJSON(res, 200, context ? { items, releaseId: context.releaseId, sourceCommit: context.sourceCommit, freshness, availability } : { items, ...fallbackDataSource(), freshness, availability });
    });
  });

  registerRoute("GET", "/api/kg/review-history", (_req, res) => {
    const graph = readMasterGraph ? readMasterGraph() : null;
    const nodeLabels = new Map(
      (graph && Array.isArray(graph.nodes) ? graph.nodes : []).map((node) => [
        node.id,
        typeof node.label === "string" && node.label.trim() ? node.label.trim() : "未命名实体",
      ]),
    );
    // PR-042（路线 A 读侧分流）：账本有两种合法形态——边级裁决（有 source/target）与
    // 候选级裁决（kind=relation_candidate，只有 candidateId+证据哈希，本就无确定的边两端）。
    // 旧实现把全量记录无差别套进边级形态，一条候选记录即可让 enforce 一票否决整个接口
    // （真库实测 500）。按事件溯源"按类型分流投影"的业界标准，候选记录单独成列表返回，
    // 不回填造假字段（篡改历史账本是反模式）。
    const edgeRecords = [];
    const candidateRecords = [];
    for (const record of readReviewActions(_vaultPath)) {
      if (record && typeof record === "object" && record.kind === "relation_candidate") {
        candidateRecords.push({
          kind: record.kind,
          action: record.action,
          candidateId: record.candidateId,
          candidateHash: record.candidateHash,
          evidenceSetHash: record.evidenceSetHash,
          sourceSetHash: record.sourceSetHash,
          reviewer: record.reviewer,
          reason: record.reason,
          decidedAt: record.decidedAt,
        });
      } else {
        edgeRecords.push({
          ...record,
          sourceLabel: nodeLabels.get(record.source) || "未命名实体",
          targetLabel: nodeLabels.get(record.target) || "未命名实体",
        });
      }
    }
    const sorter = (left, right) => new Date(right.decidedAt) - new Date(left.decidedAt);
    edgeRecords.sort(sorter);
    candidateRecords.sort(sorter);
    sendJSON(res, 200, {
      total: edgeRecords.length + candidateRecords.length,
      records: edgeRecords,
      candidateRecords,
      ...fallbackDataSource(),
    });
  });

  // ── POST /api/governance/resolve — 治理缺口 resolve/ignore 决策 ──
  // WP-048 W1-A：治理决策写账动作化（governance.resolve）——原 handler 逻辑原样迁入执行器 governance.resolve
  const __exec_governance_resolve = function (ctx) {
    const payload = ctx.body;

    var gapId = (payload.gapId || "").trim();
    if (!gapId) {
      throw createError("VALIDATION_ERROR", "gapId 为必填项", 400);
    }

    var action = (payload.action || "").trim();
    if (action !== "resolved" && action !== "ignored" && action !== "exempted") {
      throw createError("VALIDATION_ERROR", "action 必须是 resolved | ignored | exempted", 400);
    }

    var note = (payload.note || "").trim();

    var entry = {
      gapId: gapId,
      action: action,
      note: note,
      resolvedAt: new Date().toISOString(),
    };

    if (typeof addGovernanceAction !== "function") throw createError("INTERNAL_ERROR", "写入治理决策失败", 500);
    var existing;
    try {
      existing = addGovernanceAction(entry);
      logger.info({ event: "governance-resolved", gapId: gapId, action: action });
    } catch (e) {
      logger.error({ event: "governance-write-failed", error: e.message });
      throw createError("INTERNAL_ERROR", "写入治理决策失败", 500);
    }

    return { success: true, total: existing ? existing.length : 1 };
  };
  registerActionExecutor("governance.resolve", __exec_governance_resolve);;

  registerRoute("POST", "/api/governance/resolve", (req, res) => {
    return executeAction({ actionId: "governance.resolve", executor: __exec_governance_resolve, request: req, reply: res });
  });
}

module.exports = { register, setVaultPath };
