"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { STAGE, resolveArticleStatus } = require(path.join(__dirname, "..", "article-status-resolver.cjs"));

const base = {
  articleId: "test-article",
  standardizationStatus: "standardized",
  approvalStatus: "pending",
  currentContentHash: "abc",
  approvedContentHash: "abc",
  complianceBlockers: [],
  hasCurrentRelease: false,
  releaseContentHash: null,
  roles: ["review"],
};

test("七态全矩阵：每个 stage 的触发条件与 next_actions", () => {
  const nd = resolveArticleStatus({ articleId: null, roles: [] });
  assert.equal(nd.stage, STAGE.NO_DRAFT);
  assert.ok(nd.next_actions.some((a) => a.action === "upload_draft"));

  const dr = resolveArticleStatus({ ...base, approvalStatus: "draft" });
  assert.equal(dr.stage, STAGE.DRAFTING);
  assert.ok(dr.next_actions.some((a) => a.action === "standardize"));

  const ck = resolveArticleStatus({ ...base, approvalStatus: "pending", standardizationStatus: "pending_standardization" });
  assert.equal(ck.stage, STAGE.CHECKING);
  assert.ok(ck.next_actions.some((a) => a.action === "wait"));

  const rt = resolveArticleStatus({ ...base });
  assert.equal(rt.stage, STAGE.READY_TO_CONFIRM);
  assert.ok(rt.next_actions.some((a) => a.action === "confirm" && a.allowed));

  const cf = resolveArticleStatus({ ...base, approvalStatus: "approved" });
  assert.equal(cf.stage, STAGE.CONFIRMED);
  assert.ok(cf.next_actions.some((a) => a.action === "publish"));

  const pb = resolveArticleStatus({ ...base, approvalStatus: "snapshot", hasCurrentRelease: true, releaseContentHash: "abc" });
  assert.equal(pb.stage, STAGE.PUBLISHED);

  const na = resolveArticleStatus({ ...base, complianceBlockers: [{ ruleId: "F01", field: "title", message: "必填" }] });
  assert.equal(na.stage, STAGE.NEEDS_ATTENTION);
  assert.ok(na.blockers.length >= 1 && na.blockers[0].waiting_for === "owner");
  assert.ok(na.next_actions.some((a) => a.action === "fix_issues"));
});

test("Stale 标记：源文件变化与 Release 过期", () => {
  const sc = resolveArticleStatus({ ...base, approvalStatus: "approved", currentContentHash: "new", approvedContentHash: "old" });
  assert.ok(sc.stale.includes("source_changed"));

  const ro = resolveArticleStatus({ ...base, approvalStatus: "snapshot", hasCurrentRelease: true, releaseContentHash: "old", currentContentHash: "new" });
  assert.ok(ro.stale.includes("release_outdated"));
  assert.equal(ro.stage, STAGE.NEEDS_ATTENTION);

  const ok = resolveArticleStatus({ ...base, approvalStatus: "snapshot", hasCurrentRelease: true, releaseContentHash: "abc" });
  assert.equal(ok.stale.length, 0);

  // 无审批哈希必须标记过期
  const noHash = resolveArticleStatus({ ...base, approvedContentHash: null });
  assert.ok(noHash.stale.includes("source_changed"));
});

test("权限反例：空角色无权限，消灭假绿", () => {
  const noRole = resolveArticleStatus({ ...base, roles: [] });
  const confirmAction = noRole.next_actions.find(a => a.action === "confirm");
  assert.equal(confirmAction.allowed, false);
  assert.equal(confirmAction.reason, "insufficient_permissions");
});

test("rejected 审批 → needs_attention", () => {
  const rj = resolveArticleStatus({ ...base, approvalStatus: "rejected" });
  assert.equal(rj.stage, STAGE.NEEDS_ATTENTION);
  assert.ok(rj.blockers.some((b) => b.code === "rejected"));
});

test("computed_at 存在且为毫秒时间戳", () => {
  const s = resolveArticleStatus(base);
  assert.equal(typeof s.computed_at, "number");
  assert.ok(s.computed_at > 1700000000000);
});
