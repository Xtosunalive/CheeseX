// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// Component: Review-Routes
// @responsible: 关系直接审批——POST /api/kg/review（写 review_actions 审计 + 更新 master_graph reviewStatus，立即生效）
// @inputs: edgeId + action(approved|rejected) + reason
// @outputs: 更新后的边状态 + 审计记录
// @context: Vault
// 设计（ADR043 R2）：替代 graph-fact Proposal 路径（INVALID_SOURCE_PATH 不匹配）；复用 review-action-store.appendReviewAction + 原子写（temp+rename）
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { sendJSON } = require("../shared/api-envelope.cjs");
const { readReviewActions, appendReviewAction } = require("../services/governance/review-action-store.cjs");
// R7 残余（红队二轮）：confidenceBandAudit 内层按契约校验（五字段全字符串）——违形丢弃不落账
function isValidBandAudit(a) {
  return !!a && typeof a === "object" && ["source", "target", "type", "relationsPath", "revision"].every((k) => typeof a[k] === "string" && a[k].length > 0);
}

const { bindErrorFactory } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-B：kg/review 经统一执行工厂——原 handler 逻辑原样迁入登记执行器。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const reviewError = bindErrorFactory({ status: 400 });
// PR-045：阻断器提为治理域共享模块——写门 409 与读侧 pending-review 列表同源（防第二套 blocker 查询漂移）
const { openBlockersForEdge } = require("../services/governance/review-blockers.cjs");

// F3（seq156，ADR054 D2）：writeMasterGraph 已删除——裁决不再改写派生图（合并读取见 review-status-projection）

function register(registerRoute, deps) {
  const vaultPath = path.resolve(deps.vaultPath);
  const readMasterGraph = deps.readMasterGraph;
  const listOpenIssues = typeof deps.listOpenIssues === "function" ? deps.listOpenIssues : () => [];

  // ── WP-048 W1-B 执行器：既有 handler 逻辑原样迁入（S8 blocker 闸、审计账本、错误回退逐条保留） ──
  const __exec_review_kg_review = function (ctx) {
    const payload = ctx.body;
    const edgeId = (payload.edgeId || "").trim();
    const action = (payload.action || "").trim();
    const reason = (payload.reason || "").trim();
    if (!edgeId) throw reviewError("VALIDATION_ERROR", "edgeId 必填", 400);
    if (action !== "approved" && action !== "rejected") {
      throw reviewError("VALIDATION_ERROR", "action 必须是 approved | rejected", 400);
    }
    const graph = readMasterGraph();
    if (!graph) throw reviewError("GRAPH_UNAVAILABLE", "master_graph 不可用", 503);
    const connections = Array.isArray(graph.connections) ? graph.connections : [];
    const target = connections.find((conn) => conn.edgeId === edgeId);
    if (!target) throw reviewError("EDGE_NOT_FOUND", `关系不存在: ${edgeId}`, 404, { edgeId });

    // S8（场景⑫）：批准前检查边两端节点是否关联 open 的缺实体/未知实体 blocker。
    if (action === "approved") {
      const blockers = openBlockersForEdge(listOpenIssues(), target);
      if (blockers.length > 0) {
        throw reviewError("RELATION_REVIEW_BLOCKED", "边端点存在未解决的缺实体/未知实体问题，关系不得批准", 409, { blockers });
      }
    }

    const reviewer = payload.reviewer || "local-architect";
    const decidedAt = new Date().toISOString();

    // F3（seq156，ADR054 D2）：裁决只写账本——master_graph 不再被改写；消费端经 review-status-projection 合并读取。
    const decision = {
      edgeId,
      source: target.from || target.source,
      target: target.to || target.target,
      relationType: target.relationType,
      sourceFile: target.sourceFile || "",
      lineNumber: target.lineNumber || "",
      evidenceHash: target.evidenceHash || "",
      action,
      reviewer,
      reason: reason || (action === "approved" ? "架构评审确认" : "架构评审驳回"),
      ...(isValidBandAudit(payload.confidenceBandAudit) ? { confidenceBandAudit: payload.confidenceBandAudit } : {}),
      decidedAt,
      // K-P1-2（2026-09-10）：人工身份由服务端落盘——actorType 硬编码 "human"（该路由是人工操作入口）。
      assertedBy: { actorId: reviewer, actorType: "human" },
    };
    appendReviewAction(vaultPath, decision);

    return { success: true, edgeId, action, reviewStatus: action, decidedAt: decision.decidedAt, auditCount: readReviewActions(vaultPath).length };
  };
  registerActionExecutor("review.kg-review", __exec_review_kg_review);;

  // WP-048 W1-B 动作化：kg.review（角色 review 由动作定义供源）
  registerRoute("POST", "/api/kg/review", (req, res) => {
    return executeAction({ actionId: "kg.review", executor: __exec_review_kg_review, request: req, reply: res });
  });
}

module.exports = { register, openBlockersForEdge };
