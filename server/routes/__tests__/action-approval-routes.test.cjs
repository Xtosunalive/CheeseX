"use strict";

// WP-172（SPEC-095 §3.5 首批）：动作审批全链矩阵——账本折叠/工厂核验六分支/retire 实绑/dryRun 旁路/幂等
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const approvalRoutes = require("../action-approval-routes.cjs");
const articleRoutes = require("../article-workflow-routes.cjs");
const { createRouteHarness, setupActionRuntime, mergeW1aActionTypes } = require("./helpers/route-harness.cjs");
const { createArticleLifecycleReconciler } = require("../../services/article-workflow/article-lifecycle-reconciler.cjs");
const {
  createActionApproval, decideActionApproval, foldActionApprovals, stableInputHash, stableStringify,
} = require("../../services/governance/action-approval-store.cjs");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp172-approval-"));
  const working = path.join(vaultPath, "知识库/raw/precleaned");
  fs.mkdirSync(working, { recursive: true });
  fs.writeFileSync(path.join(working, "doomed.md"), "将退役");
  mergeW1aActionTypes(path.join(vaultPath, "知识库/TheSchema/ontology.yaml"));
  setupActionRuntime({ vaultPath });
  const reconciler = createArticleLifecycleReconciler({ vaultPath });
  const h = createRouteHarness();
  articleRoutes.register(h.registerRoute, { articleWorkflowService: {}, retireArticle: reconciler.retireArticle });
  approvalRoutes.register(h.registerRoute, { vaultPath });
  const retire = (body, query) => h.call("POST /api/articles/retire", `/api/articles/retire${query || ""}`, body);
  const approveInput = (input) => {
    const approval = createActionApproval(vaultPath, { actionId: "articles.retire", input, requestedBy: "matrix" });
    decideActionApproval(vaultPath, approval.approvalId, { decision: "approved", decidedBy: "approver" });
    return approval.approvalId;
  };
  return { vaultPath, working, h, retire, approveInput };
}

test("WP-172 账本：立单→裁决→折叠；重复裁决409；未知单404；键序无关稳定哈希", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "wp172-store-"));
  try {
    const a = createActionApproval(vaultPath, { actionId: "x.y", input: { b: 1, a: [2, { z: 3 }] }, requestedBy: "t" });
    const a2 = createActionApproval(vaultPath, { actionId: "x.y", input: { a: [2, { z: 3 }], b: 1 }, requestedBy: "t" });
    assert.equal(a.inputHash, a2.inputHash, "键序无关（稳定序列化）");
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
    let folded = foldActionApprovals(vaultPath).get(a.approvalId);
    assert.equal(folded.status, "pending");
    decideActionApproval(vaultPath, a.approvalId, { decision: "rejected", decidedBy: "r" });
    folded = foldActionApprovals(vaultPath).get(a.approvalId);
    assert.equal(folded.status, "rejected");
    assert.throws(() => decideActionApproval(vaultPath, a.approvalId, { decision: "approved", decidedBy: "r2" }),
      (e) => e.code === "APPROVAL_ALREADY_DECIDED" && e.status === 409, "重复裁决409");
    assert.throws(() => decideActionApproval(vaultPath, "no-such", { decision: "approved", decidedBy: "r" }),
      (e) => e.code === "APPROVAL_NOT_FOUND" && e.status === 404, "未知单404");
    assert.throws(() => createActionApproval(vaultPath, { actionId: "", input: {}, requestedBy: "t" }),
      (e) => e.code === "VALIDATION_ERROR", "立单校验");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP-172 全链矩阵：retire 绑 approve 档——六分支＋dryRun旁路＋单次有效", async () => {
  const { vaultPath, working, h, retire, approveInput } = fixture();
  try {
    // ① 无单 → 403
    const gated = await retire({ basename: "doomed.md" });
    assert.equal(gated.statusCode, 403);
    assert.equal(gated.body.error_code, "ACTION_APPROVAL_REQUIRED");
    assert.ok(fs.existsSync(path.join(working, "doomed.md")), "闸内文件不动");

    // ② dryRun 预览旁路（执行器预演不写）
    const preview = await retire({ basename: "doomed.md" }, "?dryRun=1");
    assert.equal(preview.statusCode, 200);
    assert.ok(fs.existsSync(path.join(working, "doomed.md")));

    // ③ 错动作审批单 → 403 approval_action_mismatch
    const otherAction = createActionApproval(vaultPath, { actionId: "articles.upload", input: { basename: "doomed.md" }, requestedBy: "m" });
    decideActionApproval(vaultPath, otherAction.approvalId, { decision: "approved", decidedBy: "a" });
    const mismatch = await retire({ basename: "doomed.md", approval_id: otherAction.approvalId });
    assert.equal(mismatch.statusCode, 403);
    assert.equal(mismatch.body.details && mismatch.body.details.reason, "approval_action_mismatch");

    // ④ 输入哈希防偷换 → 403 approval_hash_mismatch
    const stolen = approveInput({ basename: "innocent.md" });
    const theft = await retire({ basename: "doomed.md", approval_id: stolen });
    assert.equal(theft.statusCode, 403);
    assert.equal(theft.body.details && theft.body.details.reason, "approval_hash_mismatch");

    // ⑤ 已拒单 → 403 approval_rejected
    const rejected = createActionApproval(vaultPath, { actionId: "articles.retire", input: { basename: "doomed.md" }, requestedBy: "m" });
    decideActionApproval(vaultPath, rejected.approvalId, { decision: "rejected", decidedBy: "a" });
    const withRejected = await retire({ basename: "doomed.md", approval_id: rejected.approvalId });
    assert.equal(withRejected.statusCode, 403);
    assert.equal(withRejected.body.details && withRejected.body.details.reason, "approval_rejected");

    // ⑥ 有效单 → 200 执行＋文件退役＋账本核销；复用已用单 → 403 approval_reused
    const valid = approveInput({ basename: "doomed.md" });
    const done = await retire({ basename: "doomed.md", approval_id: valid });
    assert.equal(done.statusCode, 200, JSON.stringify(done.body).slice(0, 300));
    assert.equal(fs.existsSync(path.join(working, "doomed.md")), false, "真删生效");
    const replay = await retire({ basename: "doomed.md", approval_id: valid });
    assert.equal(replay.statusCode, 403);
    assert.equal(replay.body.details && replay.body.details.reason, "approval_reused", "单次有效");

    // ⑦ 审批端点自身（动作化）：立单/裁决/清单经工厂
    const created = await h.call("POST /api/action-approvals", "/api/action-approvals", { action_id: "articles.retire", input: { basename: "zz.md" }, requested_by: "http-matrix" });
    assert.equal(created.statusCode, 200, JSON.stringify(created.body).slice(0, 300));
    assert.equal(created.body.data.status, "pending");
    const decided = await h.call("POST /api/action-approvals/:id/decision", `/api/action-approvals/${created.body.data.approvalId}/decision`, { decision: "approved", decided_by: "http-matrix" });
    assert.equal(decided.statusCode, 200);
    assert.equal(decided.body.data.status, "approved");
    const list = await h.call("GET /api/action-approvals", "/api/action-approvals");
    assert.equal(list.statusCode, 200);
    assert.ok(list.body.data.total >= 2, "清单折叠可见");
    const redecide = await h.call("POST /api/action-approvals/:id/decision", `/api/action-approvals/${created.body.data.approvalId}/decision`, { decision: "rejected", decided_by: "x" });
    assert.equal(redecide.statusCode, 409, "HTTP 面重复裁决409");
  } finally { await h.close(); fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("WP-172 稳定哈希单源：工厂核验与立单共用（嵌套键序递归稳定）", () => {
  assert.equal(stableInputHash({ x: { b: 1, a: 2 }, y: [3, { q: 4, p: 5 }] }),
    stableInputHash({ y: [3, { p: 5, q: 4 }], x: { a: 2, b: 1 } }));
  assert.notEqual(stableInputHash({ a: 1 }), stableInputHash({ a: 2 }));
});
