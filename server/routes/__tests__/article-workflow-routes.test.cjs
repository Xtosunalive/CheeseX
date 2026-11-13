const test = require("node:test");
const assert = require("node:assert/strict");
const routes = require("../article-workflow-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：五写端点已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "article-actions-")) });

function setup() {
  const h = createRouteHarness();
  const service = {
    upload(body) { return { taskId: "task-1", originalFileName: body.fileName, draftPath: "知识库/raw/drafts/投稿/" + body.fileName, precleanedPath: null, status: "awaiting_architect_processing" }; },
    getTask(taskId) { return { taskId, status: "awaiting_architect_processing" }; },
    listUploads(limit) { return { items: [{ taskId: "task-1", status: "awaiting_architect_processing" }], total: 1, limit }; },
    listPrecleaned() { return { items: [{ id: "article-1", standardizationStatus: "pending_standardization" }] }; },
    searchCandidates() { return { items: [{ title: "半成品" }], total: 1, limit: 50, offset: 0, generatedAt: "now" }; },
    getPrecleaned(id) { return { id, content: "body", standardizationStatus: "pending_standardization" }; },
    standardize(id, confirmed) {
      if (confirmed !== true) { const error = new Error("缺少显式确认"); error.code = "CONFIRMATION_REQUIRED"; error.status = 400; throw error; }
      if (id === "blocked-article") { const error = new Error("标准化阻断"); error.code = "ARTICLE_STANDARDIZATION_BLOCKED"; error.status = 409; error.details = { articleId: id, blockers: [{ ruleId: "A03-P" }] }; throw error; }
      return { id, standardizationStatus: "standardized", standardizationWarningCount: 1 };
    },
    validateDraft(filePath) { return { valid: true, status: "passed", errors: [], warnings: [], summary: "ok" }; },
    promoteDraft(filePath, confirmed) { assert.equal(confirmed, true); return { precleanedPath: "知识库/raw/precleaned/" + filePath.replace(/.*\//, ""), message: "promoted" }; },
    updateCandidateFields(id, fields) { return { id, fields }; },
  };
  routes.register(h.registerRoute, { articleWorkflowService: service, retireArticle: (input) => ({ dryRun: input.dryRun, plan: { basename: input.basename } }) });
  return h;
}

// 层级：HTTP 契约；真实退役实现＋独立临时文件，非假的退役服务。
test("WP-093 退役公开端点拒绝越界且合法预演/执行可用", async () => {
  const vaultPath = fs0.mkdtempSync(path0.join(os0.tmpdir(), "retire-http-"));
  const working = path0.join(vaultPath, "知识库/raw/precleaned");
  fs0.mkdirSync(working, { recursive: true });
  fs0.writeFileSync(path0.join(vaultPath, "victim.md"), "outside role");
  fs0.writeFileSync(path0.join(working, "valid.md"), "working");
  const { createArticleLifecycleReconciler } = require("../../services/article-workflow/article-lifecycle-reconciler.cjs");
  const r = createArticleLifecycleReconciler({ vaultPath });
  setupActionRuntime({ vaultPath }); // WP-172：本测试自装运行时（审批账本/注册表随本 vault——防进程单例残留指他库）
  const h = createRouteHarness();
  routes.register(h.registerRoute, { articleWorkflowService: {}, retireArticle: r.retireArticle });
  try {
    const badPreview = await h.call("POST /api/articles/retire", "/api/articles/retire?dryRun=1", { basename: "../../../victim.md" });
    assert.equal(badPreview.statusCode, 400);
    assert.equal(badPreview.body.error_code, "VALIDATION_ERROR");
    assert.equal(fs0.readFileSync(path0.join(vaultPath, "victim.md"), "utf8"), "outside role");
    const gated = await h.call("POST /api/articles/retire", "/api/articles/retire", { basename: "../../../victim.md" });
    assert.equal(gated.statusCode, 403);
    assert.equal(gated.body.error_code, "ACTION_APPROVAL_REQUIRED");
    assert.equal(fs0.readFileSync(path0.join(vaultPath, "victim.md"), "utf8"), "outside role");
    const preview = await h.call("POST /api/articles/retire", "/api/articles/retire?dryRun=1", { basename: "valid.md" });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.body.data.dryRun, true);
    assert.equal(fs0.existsSync(path0.join(working, "valid.md")), true);
    const { createActionApproval, decideActionApproval } = require("../../services/governance/action-approval-store.cjs");
    const approval = createActionApproval(vaultPath, { actionId: "articles.retire", input: { basename: "valid.md" }, requestedBy: "retire-http-test" });
    decideActionApproval(vaultPath, approval.approvalId, { decision: "approved", decidedBy: "retire-http-test" });
    const retire = await h.call("POST /api/articles/retire", undefined, { basename: "valid.md", approval_id: approval.approvalId });
    assert.equal(retire.statusCode, 200);
    assert.equal(retire.body.data.retired, true);
    assert.equal(fs0.existsSync(path0.join(working, "valid.md")), false);
  } finally { await h.close(); fs0.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("registers Article Proposal admission routes without retired batch production endpoints", async function () {
  const h = setup();
  // Q1（#1417）：守卫从「数量断言」升级为「精确路由清单枚举断言」——
  // 数量快照在加路由时必然漂移（#1391 加 2 端点后 11≠13 曾红），枚举集比对新旧端点都指名道姓。
  const expectedRoutes = [
    "POST /api/articles/upload",
    "GET /api/articles/status/:taskId",
    "GET /api/articles/uploads",
    "GET /api/articles/precleaned",
    "GET /api/articles/candidates/search",
    "GET /api/articles/precleaned/:id",
    "PUT /api/articles/precleaned/:id/approval",
    "PUT /api/articles/precleaned/approval",
    "POST /api/articles/precleaned/:id/standardization",
    "GET /api/articles/field-completion-options",
    "PATCH /api/articles/precleaned/:id/fields",
    "POST /api/articles/drafts/validate",
    "POST /api/articles/drafts/promote",
    "POST /api/articles/retire", // PR-065/SPEC-013 L2 文章退役（新枚举——精确清单语义本就该随新增指名更新）
  ].sort();
  assert.deepEqual([...h.routes.keys()].sort(), expectedRoutes);
  for (const retired of [
    "POST /api/articles/precleaned/run-approved", "POST /api/articles/graph-repair-batches", "POST /api/articles/graph-batches/:batchId/calculate",
    "POST /api/articles/graph-batches/:batchId/publish", "POST /api/articles/retirement/preview", "POST /api/articles/retirement-batches", "GET /api/articles/graph-batches/:batchId",
  ]) assert.equal(h.routes.has(retired), false, retired);

  const uploadResponse = await h.call("POST /api/articles/upload", undefined, { fileName: "raw.md", contentBase64: "IyByYXc=" });
  assert.equal(uploadResponse.statusCode, 201, JSON.stringify(uploadResponse.body));
  assert.equal(uploadResponse.body.data.status, "awaiting_architect_processing");

  const statusResponse = await h.request("GET /api/articles/status/:taskId", { params: { taskId: "task-1" } });
  assert.equal(statusResponse.body.data.status, "awaiting_architect_processing");

  const uploadsResponse = await h.call("GET /api/articles/uploads", "/api/articles/uploads?limit=25");
  assert.equal(uploadsResponse.body.data.items.length, 1);
  assert.equal(uploadsResponse.body.data.limit, 25);

  const listResponse = await h.call("GET /api/articles/precleaned");
  assert.equal(listResponse.body.data.items.length, 1);

  const candidateSearchResponse = await h.call("GET /api/articles/candidates/search", "/api/articles/candidates/search?keyword=" + encodeURIComponent("半成品"));
  assert.deepEqual(candidateSearchResponse.body.data.items, [{ title: "半成品" }]);

  const detailResponse = await h.request("GET /api/articles/precleaned/:id", { params: { id: "article-1" } });
  assert.equal(detailResponse.body.data.content, "body");

  // 410 墓碑：带 body 调用仍答 410（PR-085 tombstone 标记——退役信号不被契约「禁止 body」的 400 盖掉）
  const approvalResponse = await h.request("PUT /api/articles/precleaned/:id/approval", { params: { id: "article-1" }, body: { approved: true } });
  assert.equal(approvalResponse.statusCode, 410);
  assert.equal(approvalResponse.body.error_code, "LEGACY_ARTICLE_APPROVAL_GONE");

  const bulkApprovalResponse = await h.call("PUT /api/articles/precleaned/approval", undefined, { articleIds: ["article-1", "article-2"], approved: true });
  assert.equal(bulkApprovalResponse.statusCode, 410);
  assert.equal(bulkApprovalResponse.body.error_code, "LEGACY_ARTICLE_APPROVAL_GONE");

  const standardizationResponse = await h.request("POST /api/articles/precleaned/:id/standardization", { params: { id: "article-1" }, body: { confirmed: true } });
  assert.equal(standardizationResponse.statusCode, 200, JSON.stringify(standardizationResponse.body));
  assert.equal(standardizationResponse.body.data.standardizationStatus, "standardized");

  const standardizationMissingConfirm = await h.request("POST /api/articles/precleaned/:id/standardization", { params: { id: "article-1" }, body: {} });
  assert.equal(standardizationMissingConfirm.statusCode, 400);
  assert.ok(["CONFIRMATION_REQUIRED", "VALIDATION_ERROR"].includes(standardizationMissingConfirm.body.error_code), JSON.stringify(standardizationMissingConfirm.body));

  const standardizationBlocked = await h.request("POST /api/articles/precleaned/:id/standardization", { params: { id: "blocked-article" }, body: { confirmed: true } });
  assert.equal(standardizationBlocked.statusCode, 409);
  assert.equal(standardizationBlocked.body.error_code, "ARTICLE_STANDARDIZATION_BLOCKED");

  // E3'c：article 退役随 git-proposal 退役，retirement 端点已删除
  assert.equal(h.routes.has("POST /api/article-proposals/retirements"), false);
  assert.equal(h.routes.has("POST /api/article-proposals/:id/retirement-merge"), false);

  const validateResponse = await h.call("POST /api/articles/drafts/validate", undefined, { filePath: "知识库/raw/drafts/Token.md" });
  assert.equal(validateResponse.statusCode, 200, JSON.stringify(validateResponse.body));
  assert.equal(validateResponse.body.data.valid, true);
  assert.equal(validateResponse.body.data.status, "passed");

  const promoteResponse = await h.call("POST /api/articles/drafts/promote", undefined, { filePath: "知识库/raw/drafts/Token.md", confirmed: true });
  assert.ok(promoteResponse.body.data.precleanedPath.includes("precleaned"), JSON.stringify(promoteResponse.body));
});

test("PATCH /fields 触发写后对账钩子（PR-048），未注入钩子时零回归", async function () {
  const calls = [];
  const hook = (job) => calls.push(job);
  const service = { updateCandidateFields(id, fields) { return { id, fields, standardizationStatus: "pending_standardization" }; } };

  const withHookHarness = createRouteHarness();
  routes.register(withHookHarness.registerRoute, { articleWorkflowService: service, reconcileAnomalies: hook });
  const withHook = await withHookHarness.request("PATCH /api/articles/precleaned/:id/fields", { params: { id: "a1" }, body: { fields: { module: "文档系统" } } });
  assert.equal(withHook.statusCode, 200, JSON.stringify(withHook.body));
  assert.equal(withHook.body.data.id, "a1");
  assert.equal(calls.length, 1, "保存成功后钩子恰好调用一次");
  assert.equal(calls[0].purpose, "article_field_completion");

  const noHookHarness = createRouteHarness();
  routes.register(noHookHarness.registerRoute, { articleWorkflowService: service });
  const withoutHook = await noHookHarness.request("PATCH /api/articles/precleaned/:id/fields", { params: { id: "a1" }, body: { fields: { module: "文档系统" } } });
  assert.equal(withoutHook.statusCode, 200, "未注入钩子的旧装配（单测环境）不受影响");

  const badHookHarness = createRouteHarness();
  const serviceReject = { updateCandidateFields() { throw Object.assign(new Error("字段值非法"), { code: "FIELD_VALUE_INVALID", status: 400 }); } };
  routes.register(badHookHarness.registerRoute, { articleWorkflowService: serviceReject, reconcileAnomalies: (job) => calls.push(job) });
  const rejected = await badHookHarness.request("PATCH /api/articles/precleaned/:id/fields", { params: { id: "a1" }, body: { fields: { module: "x" } } });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.error_code, "FIELD_VALUE_INVALID");
  assert.equal(calls.length, 1, "写入失败时钩子不触发（销账只跟成功写）");
});

// PR-083：通道写前冲突拒绝的 HTTP 映射——服务层 CONTENT_REVISION_CONFLICT（409+凭据明细）直达客户端
test("PATCH fields 并发冲突 → 409 CONTENT_REVISION_CONFLICT（写前拒绝，非事后取证）", async function () {
  const h = createRouteHarness();
  const serviceConflict = {
    updateCandidateFields() {
      throw Object.assign(new Error("文章内容已被并发修改，请刷新后重试"), {
        code: "CONTENT_REVISION_CONFLICT", status: 409,
        details: { expected: "sha256:aa", actual: "sha256:bb" },
      });
    },
  };
  routes.register(h.registerRoute, { articleWorkflowService: serviceConflict });
  const conflicted = await h.request("PATCH /api/articles/precleaned/:id/fields", { params: { id: "a1" }, body: { fields: { module: "文档系统" } } });
  assert.equal(conflicted.statusCode, 409);
  assert.equal(conflicted.body.error_code, "CONTENT_REVISION_CONFLICT");
  assert.deepEqual(conflicted.body.details, { expected: "sha256:aa", actual: "sha256:bb" }, "冲突凭据明细透传——客户端可判定重读重试");
});
