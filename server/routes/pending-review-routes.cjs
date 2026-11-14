// @responsible: 注册待复核关系查询并补充来源文件与修订信息。
const fs = require("node:fs");
const path = require("node:path");
const { sendJSON } = require("../shared/api-envelope.cjs");
const { buildPendingReviewSummary } = require("../services/projection/master-graph-service.cjs");
const { openBlockersForEdge } = require("../services/governance/review-blockers.cjs");
const { mergeReviewStatus, readReviewActionsFile } = require("../shared/review-status-projection.cjs");
const {
  readBytesArtifact,
  readMasterGraphArtifact,
  resolveVaultFile,
} = require("../shared/working-artifact-snapshot.cjs");

// 从边数据解析来源文件，三级回退（数据契约兼容，规则 1 读取方适配）：
// 1) 顶层 sourceFile；2) properties.inference_sources[].file；3) source 为 doc-article-* 节点时取节点 file_path
function resolveEdgeSourceFile(edge, nodePathById) {
  if (edge && typeof edge.sourceFile === "string" && edge.sourceFile.endsWith(".md")) return edge.sourceFile;
  const sources = edge?.properties?.inference_sources;
  if (Array.isArray(sources)) {
    const found = sources.find((item) => typeof item?.file === "string" && item.file.endsWith(".md"));
    if (found) return found.file;
  }
  if (nodePathById && typeof edge?.source === "string" && nodePathById.has(edge.source)) {
    const filePath = nodePathById.get(edge.source);
    if (typeof filePath === "string" && filePath.endsWith(".md")) return filePath;
  }
  return null;
}

function ownerSourceRevision(vaultPath, edge, ownerSnapshots, readOwner, nodePathById) {
  const sourceFile = resolveEdgeSourceFile(edge, nodePathById);
  if (!sourceFile) return edge;
  const resolved = resolveVaultFile(vaultPath, sourceFile);
  if (!resolved) return edge;
  if (!ownerSnapshots.has(resolved.relativePath)) {
    const snapshot = fs.existsSync(resolved.absolutePath) && fs.statSync(resolved.absolutePath).isFile()
      ? readOwner(resolved.absolutePath)
      : null;
    ownerSnapshots.set(resolved.relativePath, snapshot);
  }
  const sourceRevision = ownerSnapshots.get(resolved.relativePath)?.revision;
  // 写回解析出的 sourceFile（前端按钮门禁依赖它）+ sourceRevision
  if (!sourceRevision) return edge;
  return { ...edge, sourceFile, sourceRevision };
}

function register(registerRoute, deps) {
  const vaultPath = path.resolve(deps.vaultPath);
  // SPEC-012 wave-2 图族：主图改从 derived-index.db 原文行读（workingRevision=库原文 sha256，
  // 与旧文件字节同口径）；readGraphArtifact 为测试注入缝（计读次数）
  const readGraphArtifact = deps.readGraphArtifact || readMasterGraphArtifact;
  const readOwner = deps.readBytesArtifact || readBytesArtifact;
  // PR-045：阻断原因前置——读侧列表直接携带 blockers（与写门 409 同一 openBlockersForEdge），
  // 用户不必点批准吃 409 才知道被拦；listOpenIssues 缺省空集（无异常服务上下文时零阻断）
  const listOpenIssues = typeof deps.listOpenIssues === "function" ? deps.listOpenIssues : () => [];
  // SPEC-027 C4/C5：审核工作台建议值注记（getter 晚绑定；服务缺失直通——fail-safe）
  const getSuggestionService = typeof deps.getSuggestionService === "function" ? deps.getSuggestionService : () => null;
  registerRoute("GET", "/api/kg/pending-review", (_req, res) => {
    const graph = readGraphArtifact(vaultPath);
      if (!graph.exists) return sendJSON(res, 404, { error_code: "NOT_FOUND", message: "master_graph.json 不存在" });
      // PR-011（#1860）：裸读工作树字节绕过了 readMasterGraph 的账本合并出口——本路由为绑
      // workingRevision 保留裸读，但摘要前补同款 mergeReviewStatus（F3/seq156 读侧合并，
      // ADR054 D2 账本优先；账本缺记录回退图内 pending——fail-closed 同 K-P1-1 语义）。
      let graphData = graph.data;
      try { graphData = mergeReviewStatus(graph.data, readReviewActionsFile(vaultPath)); }
      catch (_ledgerError) { /* 账本不可读时回退图内状态，与 readMasterGraph 出口同款兜底 */ }
      const summary = buildPendingReviewSummary(graphData);
      const ownerSnapshots = new Map();
      const nodePathById = new Map((graphData.nodes || []).map((n) => [n.id, n.properties?.file_path || n.file_path]).filter(([, p]) => typeof p === "string"));
      // 阻断问题清单一次读取，逐边判定（与写门同函数；读侧只呈现不执法——批准仍由写门裁决）
      let openIssues = [];
      try { openIssues = listOpenIssues() || []; } catch (_issueError) { /* 异常清单不可得时不阻断呈现 */ }
      const suggestionService = getSuggestionService();
      // WP-175：边数据加 article_stage（计算状态——按 source 路径反查文章）
      const { resolveArticleStatus } = require("../services/article-workflow/article-status-resolver.cjs");
      const stageBySource = new Map();
      const getStage = (sourcePath) => {
        if (!stageBySource.has(sourcePath)) {
          try {
            const articleId = sourcePath ? decodeURIComponent(sourcePath.split("/").pop() || "").replace(/\.md$/, "") : null;
            const item = deps.listPrecleaned?.().items?.find((c) => c.id === articleId);
            const approvalStatus = deps.getApprovalStatus?.(articleId) || "draft";
            const status = resolveArticleStatus({
              articleId: articleId || null,
              standardizationStatus: item?.standardizationStatus || "pending_standardization",
              approvalStatus,
              currentContentHash: item?.formalContentHash || null,
              approvedContentHash: null,
              complianceBlockers: [],
              hasCurrentRelease: Boolean(item?.published),
              releaseContentHash: item?.formalContentHash || null,
            });
            stageBySource.set(sourcePath, status.stage);
          } catch { stageBySource.set(sourcePath, undefined); }
        }
        return stageBySource.get(sourcePath);
      };
      const edges = summary.edges.map((edge) => {
        const withSource = ownerSourceRevision(vaultPath, edge, ownerSnapshots, readOwner, nodePathById);
        const article_stage = getStage(edge.source); // WP-175：来源文章计算状态
        let annotated = withSource;
        try {
          if (suggestionService) {
            const a = suggestionService.annotateEdge({ source: edge.source, target: edge.target, type: edge.type, confidence: edge.properties && edge.properties.confidence, properties: edge.properties || {} });
            annotated = { ...annotated, confidenceSource: a.confidenceSource };
            if (a.effectiveConfidence !== undefined) annotated.effectiveConfidence = a.effectiveConfidence;
            if (a.suggestedConfidence !== undefined) { annotated.suggestedConfidence = a.suggestedConfidence; annotated.suggestedConfidenceBand = a.suggestedConfidenceBand; annotated.suggestedConfidenceEvidence = a.suggestedConfidenceEvidence; } // WP-142 批⓪：预填档位随建议同行下发（服务端换算，阈值零手抄）
          }
        } catch (_suggestError) { /* 建议失败不阻断评审列表 */ }
        annotated.article_stage = article_stage; // WP-175：来源文章计算状态（if 外统一附加）
        return { ...annotated, blockers: openBlockersForEdge(openIssues, annotated) };
      });
      return sendJSON(res, 200, { ...summary, edges, workingRevision: graph.revision, dataSource: "worktree" });
  });
}

module.exports = { ownerSourceRevision, register };
