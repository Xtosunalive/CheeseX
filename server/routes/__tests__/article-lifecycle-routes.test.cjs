// Component: Article-Lifecycle-Routes 测试（Wave3 走查缺口①阶段二）
// @responsible: 验证四条生命周期端点注册（action-coverage 哨兵口径）＋执行器委托既有单源服务
//               （promote=validate→promoteDraft 链、publish=审批机 transition、archive=归档随迁、
//               retire=retireArticle）＋confirmed 闸（403 防误触）。
// @inputs: mocked articleWorkflowService/approvalStateMachine/lifecycleReconciler + route harness
// @outputs: node:test 断言
// @context: SPEC-030 §十一批3＋Master 2026-11-17 裁（promote/publish 通用、archive 独立、retire 纳入）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lifecycleRoutes = require("../article-lifecycle-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs");

function setup(calls) {
  setupActionRuntime({ vaultPath: fs.mkdtempSync(path.join(os.tmpdir(), "lifecycle-routes-")) });
  const h = createRouteHarness();
  const service = {
    validateDraft(filePath) { calls.validate.push(filePath); return { valid: true }; },
    promoteDraft(filePath, confirmed) { calls.promote.push([filePath, confirmed]); return { precleanedPath: filePath, message: "promoted" }; },
    archiveDraft(filePath, confirmed) { calls.archive.push([filePath, confirmed]); return { archivePath: "知识库/raw/archive/x", removed: true }; },
  };
  lifecycleRoutes.register(h.registerRoute, {
    articleWorkflowService: service,
    approvalStateMachine: { transition: (articleId, operation) => { calls.publish.push([articleId, operation]); return { status: "snapshot" }; } },
    lifecycleReconciler: { retireArticle: (input) => { calls.retire.push(input); return { done: true, basename: input.basename }; } },
    logger: { info() {}, warn() {}, error() {} },
  });
  return h;
}

test("四条生命周期端点按 OpenMAIC/Strapi 标准形态注册（每动作专用，路径字面量在册）", () => {
  const calls = { validate: [], promote: [], archive: [], publish: [], retire: [] };
  const h = setup(calls);
  for (const action of ["promote", "publish", "archive", "retire"]) {
    assert.ok(h.routes.has(`POST /api/articles/lifecycle/:articleId/${action}`), `${action} 端点在册`);
  }
});

test("promote/archive 委托 validate→promoteDraft 链与归档随迁；confirmed 闸 403", async () => {
  const calls = { validate: [], promote: [], archive: [], publish: [], retire: [] };
  const h = setup(calls);
  const promoteUrl = "/api/articles/lifecycle/a1/promote";
  const r1 = await h.call("POST /api/articles/lifecycle/:articleId/promote", promoteUrl, { articleId: "a1", draftPath: "知识库/raw/drafts/x.md", confirmed: true });
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
  assert.deepEqual(calls.validate, ["知识库/raw/drafts/x.md"]);
  assert.deepEqual(calls.promote[0], ["知识库/raw/drafts/x.md", true]);

  const archiveUrl = "/api/articles/lifecycle/a1/archive";
  const r2 = await h.call("POST /api/articles/lifecycle/:articleId/archive", archiveUrl, { articleId: "a1", draftPath: "知识库/raw/drafts/x.md", confirmed: true });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.deepEqual(calls.archive[0], ["知识库/raw/drafts/x.md", true]);

  // confirmed 闸：缺显式确认 → 执行器拒绝（promoteDraft 契约 confirmed 必须 true）
  const r3 = await h.call("POST /api/articles/lifecycle/:articleId/promote", promoteUrl, { articleId: "a1", draftPath: "知识库/raw/drafts/x.md" });
  assert.equal(r3.statusCode >= 400, true, "无 confirmed 必须被拒");
});

test("publish 委托审批状态机 transition（单驱动）；retire 委托退役管理流", async () => {
  const calls = { validate: [], promote: [], archive: [], publish: [], retire: [] };
  const h = setup(calls);
  const publishUrl = "/api/articles/lifecycle/a1/publish";
  const r1 = await h.call("POST /api/articles/lifecycle/:articleId/publish", publishUrl, { articleId: "a1", confirmed: true });
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
  assert.deepEqual(calls.publish[0], ["a1", "publish"], "publish 单驱动＝审批机 transition");

  const retireUrl = "/api/articles/lifecycle/a1/retire";
  const r2 = await h.call("POST /api/articles/lifecycle/:articleId/retire", retireUrl, { articleId: "a1", confirmed: true });
  assert.equal(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.equal(calls.retire[0].basename, "a1.md");
});
