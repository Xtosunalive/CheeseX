"use strict";

const DK = require("../../shared/document-keys.cjs"); // 键名单点（结构位禁手抄——document-keys 哨兵执法）

// Component: Article-Status-Resolver（WP-173 / SPEC-095 §3.6 收窄版）
// @responsible: 文章计算状态投影层——从五个内部状态机读时现算出用户级单值 stage
//   ＋ blockers + next_actions + stale + computed_at。OpenBKN 模式（参照
//   github.com/openbkn-ai/bkn-foundry adp/bkn/bkn-project/server/logics/draft/status.go），
//   结构原样移植（Go→JS），决策树按本仓状态源重写。
// @inputs: 标准化状态/审批状态/任务状态/准入状态/内容哈希/审批哈希/合规阻断列表
// @outputs: resolveArticleStatus(input) → ProjectStatus
// @context: 纯函数——不读文件不查库，输入由调用方（路由）从现有服务取；不存储。
// 红线（合同 non_goals）：不改五状态机、不建新表、不做时间线。

const STAGE = Object.freeze({
  NO_DRAFT: "no_draft",
  DRAFTING: "drafting",
  CHECKING: "checking",
  NEEDS_ATTENTION: "needs_attention",
  READY_TO_CONFIRM: "ready_to_confirm",
  CONFIRMED: "confirmed",
  PUBLISHED: "published",
});

const WAITING_FOR = Object.freeze({
  OWNER: "owner",
  EDITOR: "editor",
  SYSTEM: "system",
});

/**
 * 计算文章状态（纯函数）。
 *
 * @param {object} input — 从现有服务读出的状态快照
 * @param {string|null} input.standardizationStatus — 标准化机（pending_standardization/standardized/blocked）
 * @param {string|null} input.approvalStatus — 审批机（draft/pending/approved/rejected/snapshot）
 * @param {string|null} input.articleId — 文章 ID（不存在＝null）
 * @param {string|null} input.currentContentHash — 候选当前内容哈希
 * @param {string|null} input.approvedContentHash — 审批绑定的内容哈希
 * @param {Array} input.complianceBlockers — 合规阻断列表 [{ruleId, field, message}]
 * @param {boolean} input.hasCurrentRelease — 是否有 current Release
 * @param {string|null} input.releaseContentHash — current Release 的内容哈希
 * @returns {object} ProjectStatus（OpenBKN 同构）
 */
function resolveArticleStatus(input) {
  const now = Date.now();
  const status = {
    article_id: input[DK.ARTICLE.articleId] || null,
    stage: STAGE.NO_DRAFT,
    blockers: [],
    hints: [],
    stale: [],
    next_actions: [],
    links: {},
    computed_at: now,
  };

  // ── 不存在 ──
  if (!input.articleId) {
    status.next_actions.push(action("upload_draft", "POST", "/api/articles/upload"));
    return status;
  }

  // ── Stale 检测（SPEC-094 哈希失配复用） ──
  if (input.currentContentHash && input.approvedContentHash && input.currentContentHash !== input.approvedContentHash) {
    status.stale.push("source_changed");
  }
  if (input.approvalStatus === "snapshot" && input.currentContentHash && input.releaseContentHash
    && input.currentContentHash !== input.releaseContentHash) {
    status.stale.push("release_outdated");
  }

  // ── 合规阻断（优先级最高——有阻断就标记 needs_attention） ──
  if (Array.isArray(input.complianceBlockers) && input.complianceBlockers.length > 0) {
    status.stage = STAGE.NEEDS_ATTENTION;
    for (const b of input.complianceBlockers.slice(0, 10)) {
      status.blockers.push({ code: b.ruleId || "compliance", waiting_for: WAITING_FOR.OWNER, count: 1 });
    }
    status.next_actions.push(action("fix_issues", "GET", "/api/anomaly-workbench", { allowed: true }));
    status.next_actions.push(action("restandardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, { allowed: true, body: { confirmed: true } }));
    return status;
  }

  // ── 按审批机决策树（从终态往回推） ──
  const approval = input.approvalStatus || "draft";
  const standardized = input.standardizationStatus === "standardized";

  if (approval === "snapshot") {
    // 已发布——检查哈希一致
    if (status.stale.includes("source_changed") || status.stale.includes("release_outdated")) {
      // 已发布但内容/Release 变化 → 回到待处理
      status.stage = STAGE.NEEDS_ATTENTION;
      status.blockers.push({ code: "stale_release", waiting_for: WAITING_FOR.OWNER, count: 1 });
      status.next_actions.push(action("restandardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, { allowed: true, body: { confirmed: true } }));
      return status;
    }
    status.stage = STAGE.PUBLISHED;
    status.links.detail = `/api/articles/precleaned/${encodeURIComponent(input.articleId)}`;
    return status;
  }

  if (approval === "approved") {
    status.stage = STAGE.CONFIRMED;
    status.next_actions.push(action("publish", "POST", `/api/approval/${encodeURIComponent(input.articleId)}/transition`, {
      allowed: true, body: { operation: "publish" },
    }));
    return status;
  }

  if (approval === "pending" && standardized) {
    status.stage = STAGE.READY_TO_CONFIRM;
    status.next_actions.push(action("confirm", "POST", `/api/approval/${encodeURIComponent(input.articleId)}/transition`, {
      allowed: true, body: { operation: "confirm" },
    }));
    return status;
  }

  if (approval === "pending") {
    status.stage = STAGE.CHECKING;
    status.next_actions.push(action("wait", null, null, { retry_after_s: 5 }));
    return status;
  }

  if (approval === "rejected") {
    status.stage = STAGE.NEEDS_ATTENTION;
    status.blockers.push({ code: "rejected", waiting_for: WAITING_FOR.OWNER, count: 1 });
    status.next_actions.push(action("restandardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, { allowed: true, body: { confirmed: true } }));
    return status;
  }

  // draft 或 null → 草稿中
  status.stage = STAGE.DRAFTING;
  status.next_actions.push(action("standardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, {
    allowed: true, body: { confirmed: true },
  }));
  return status;
}

function action(name, method, path, extra = {}) {
  return { action: name, method, path, allowed: extra.allowed !== false, reason: extra.reason || undefined,
    body: extra.body || undefined, retry_after_s: extra.retry_after_s || undefined };
}

module.exports = { STAGE, WAITING_FOR, resolveArticleStatus };
