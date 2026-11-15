"use strict";

const DK = require("../../shared/document-keys.cjs");

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

function hasRequiredRole(roles, requiredRoles) {
  if (!Array.isArray(requiredRoles) || requiredRoles.length === 0) return true;
  if (!Array.isArray(roles)) return false;
  return requiredRoles.some(role => roles.includes(role));
}

function resolveArticleStatus(input) {
  const now = Date.now();
  const userRoles = Array.isArray(input.roles) ? input.roles : [];
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

  if (!input.articleId) {
    status.next_actions.push(action("upload_draft", "POST", "/api/articles/upload", [], userRoles));
    return status;
  }

  // 严格stale检测：无绑定哈希或哈希不一致都算过期
  if (input.currentContentHash) {
    if (!input.approvedContentHash || input.currentContentHash !== input.approvedContentHash) {
      status.stale.push("source_changed");
    }
  }
  if (input.approvalStatus === "snapshot") {
    if (input.currentContentHash && (!input.releaseContentHash || input.currentContentHash !== input.releaseContentHash)) {
      status.stale.push("release_outdated");
    }
  }

  if (Array.isArray(input.complianceBlockers) && input.complianceBlockers.length > 0) {
    status.stage = STAGE.NEEDS_ATTENTION;
    for (const b of input.complianceBlockers.slice(0, 10)) {
      status.blockers.push({ code: b.ruleId || "compliance", waiting_for: WAITING_FOR.OWNER, count: 1 });
    }
    status.next_actions.push(action("fix_issues", "GET", "/api/anomaly-workbench", [], userRoles));
    status.next_actions.push(action("restandardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, ["review"], userRoles, { body: { confirmed: true } }));
    return status;
  }

  const approval = input.approvalStatus || "draft";
  const standardized = input.standardizationStatus === "standardized";

  if (approval === "snapshot") {
    if (status.stale.includes("source_changed") || status.stale.includes("release_outdated")) {
      status.stage = STAGE.NEEDS_ATTENTION;
      status.blockers.push({ code: "stale_release", waiting_for: WAITING_FOR.OWNER, count: 1 });
      status.next_actions.push(action("restandardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, ["review"], userRoles, { body: { confirmed: true } }));
      return status;
    }
    status.stage = STAGE.PUBLISHED;
    status.links.detail = `/api/articles/precleaned/${encodeURIComponent(input.articleId)}`;
    return status;
  }

  if (approval === "approved") {
    status.stage = STAGE.CONFIRMED;
    status.next_actions.push(action("publish", "POST", `/api/approval/${encodeURIComponent(input.articleId)}/transition`, ["review"], userRoles, { body: { operation: "publish" } }));
    return status;
  }

  if (approval === "pending" && standardized) {
    status.stage = STAGE.READY_TO_CONFIRM;
    status.next_actions.push(action("confirm", "POST", `/api/approval/${encodeURIComponent(input.articleId)}/transition`, ["review"], userRoles, { body: { operation: "confirm" } }));
    return status;
  }

  if (approval === "pending") {
    status.stage = STAGE.CHECKING;
    status.next_actions.push(action("wait", null, null, [], userRoles, { retry_after_s: 5 }));
    return status;
  }

  if (approval === "rejected") {
    status.stage = STAGE.NEEDS_ATTENTION;
    status.blockers.push({ code: "rejected", waiting_for: WAITING_FOR.OWNER, count: 1 });
    status.next_actions.push(action("restandardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, ["review"], userRoles, { body: { confirmed: true } }));
    return status;
  }

  status.stage = STAGE.DRAFTING;
  status.next_actions.push(action("standardize", "POST", `/api/articles/precleaned/${encodeURIComponent(input.articleId)}/standardization`, ["review"], userRoles, { body: { confirmed: true } }));
  return status;
}

function action(name, method, path, requiredRoles, userRoles, extra = {}) {
  const allowed = hasRequiredRole(userRoles, requiredRoles);
  return {
    action: name,
    method,
    path,
    allowed,
    reason: allowed ? undefined : "insufficient_permissions",
    body: extra.body || undefined,
    retry_after_s: extra.retry_after_s || undefined
  };
}

module.exports = { STAGE, WAITING_FOR, resolveArticleStatus, hasRequiredRole };
