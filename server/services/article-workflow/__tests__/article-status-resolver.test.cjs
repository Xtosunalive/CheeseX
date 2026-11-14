"use strict";

// WP-173（SPEC-095 §3.6 收窄版）：计算状态七态全矩阵＋阻断/失配交叉
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
};

test("七态全矩阵：每个 stage 的触发条件与 next_actions", () => {
  // no_draft
  const nd = resolveArticleStatus({ articleId: null });
  assert.equal(nd.stage, STAGE.NO_DRAFT);
  assert.ok(nd.next_actions.some((a) => a.action === "upload_draft"));

  // drafting（审批=draft）
  const dr = resolveArticleStatus({ ...base, approvalStatus: "draft" });
  assert.equal(dr.stage, STAGE.DRAFTING);
  assert.ok(dr.next_actions.some((a) => a.action === "standardize"));

  // checking（审批=pending 且未标准化）
  const ck = resolveArticleStatus({ ...base, approvalStatus: "pending", standardizationStatus: "pending_standardization" });
  assert.equal(ck.stage, STAGE.CHECKING);
  assert.ok(ck.next_actions.some((a) => a.action === "wait"));

  // ready_to_confirm（审批=pending 且已标准化）
  const rt = resolveArticleStatus({ ...base });
  assert.equal(rt.stage, STAGE.READY_TO_CONFIRM);
  assert.ok(rt.next_actions.some((a) => a.action === "confirm" && a.allowed));

  // confirmed（审批=approved）
  const cf = resolveArticleStatus({ ...base, approvalStatus: "approved" });
  assert.equal(cf.stage, STAGE.CONFIRMED);
  assert.ok(cf.next_actions.some((a) => a.action === "publish"));

  // published（审批=snapshot 且哈希一致）
  const pb = resolveArticleStatus({ ...base, approvalStatus: "snapshot", hasCurrentRelease: true, releaseContentHash: "abc" });
  assert.equal(pb.stage, STAGE.PUBLISHED);

  // needs_attention（合规阻断非空）
  const na = resolveArticleStatus({ ...base, complianceBlockers: [{ ruleId: "F01", field: "title", message: "必填" }] });
  assert.equal(na.stage, STAGE.NEEDS_ATTENTION);
  assert.ok(na.blockers.length >= 1 && na.blockers[0].waiting_for === "owner");
  assert.ok(na.next_actions.some((a) => a.action === "fix_issues"));
});

test("Stale 标记：源文件变化与 Release 过期", () => {
  // 源变了（current ≠ approved）
  const sc = resolveArticleStatus({ ...base, approvalStatus: "approved", currentContentHash: "new", approvedContentHash: "old" });
  assert.ok(sc.stale.includes("source_changed"));

  // Release 过期（已发布但哈希不匹配）
  const ro = resolveArticleStatus({ ...base, approvalStatus: "snapshot", hasCurrentRelease: true, releaseContentHash: "old", currentContentHash: "new" });
  assert.ok(ro.stale.includes("release_outdated"));
  // 已发布＋Release 过期 → needs_attention
  assert.equal(ro.stage, STAGE.NEEDS_ATTENTION);

  // 已发布且一致 → 无 stale
  const ok = resolveArticleStatus({ ...base, approvalStatus: "snapshot", hasCurrentRelease: true, releaseContentHash: "abc" });
  assert.equal(ok.stale.length, 0);
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
