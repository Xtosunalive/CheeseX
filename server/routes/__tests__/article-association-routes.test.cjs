const assert = require("assert");
const test = require("node:test");
const routes = require("../article-association-routes.cjs");
const { createRouteHarness, setupActionRuntime } = require("./helpers/route-harness.cjs"); // WP-048 W1-B：save/remove 已动作化
const fs0 = require("node:fs"); const os0 = require("node:os"); const path0 = require("node:path");
setupActionRuntime({ vaultPath: fs0.mkdtempSync(path0.join(os0.tmpdir(), "assoc-actions-")) });

const ARTICLE_REVISION = `sha256:${"a".repeat(64)}`;

function setup(fileRevision = ARTICLE_REVISION) {
  const h = createRouteHarness();
  const calls = [];
  const articleAssociationService = {
    list: () => { calls.push(["list"]); return { revision: "sha256:audit", articles: [] }; },
    preview: (payload) => { calls.push(["preview", payload]); return { article: { articleId: payload.articleId, title: "Guide", sourcePath: "知识库/raw/precleaned/guide.md" }, fileRevision }; },
    save: (expectedRevision, payload) => { calls.push(["save", expectedRevision, payload]); return { success: true, revision: "sha256:new" }; },
  };
  routes.register(h.registerRoute, { articleAssociationService });
  return { h, calls };
}

test("registers GET and preview plus Proposal creation without a direct writer", () => {
  const { h } = setup();
  assert.deepStrictEqual([...h.routes.keys()], ["GET /api/article-associations", "POST /api/article-associations/preview", "POST /api/article-associations/save", "POST /api/article-associations/remove"]); // remove=引用随源流转（2026-10-15）stale 行移除出口
  assert.equal(h.routes.has("PUT /api/article-associations"), false);
});

test("keeps GET and preview behavior", async () => {
  const { h, calls } = setup();
  const listed = await h.call("GET /api/article-associations");
  const previewed = await h.call("POST /api/article-associations/preview", undefined, { revision: ARTICLE_REVISION, articleId: "ART-1", action: "replace", componentIds: [], versionIds: [] }); // 契约 requestBody 必填 revision（前端类型同源，PR-085 测试载荷对齐契约）
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.revision, "sha256:audit");
  assert.equal(previewed.status, 200);
  assert.equal(previewed.body.data.article.articleId, "ART-1");
  assert.deepStrictEqual(calls.map(([operation]) => operation), ["list", "preview"]);
});

test("AA1：POST /api/article-associations/save 直接写回（调 service.save）", async () => {
  const { h, calls } = setup();
  const saved = await h.call("POST /api/article-associations/save", undefined, { revision: ARTICLE_REVISION, articleId: "ART-1", action: "replace", componentIds: ["gateway"], versionIds: [] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.success, true);
  assert.deepStrictEqual(calls.map(([operation]) => operation), ["save"]);
  assert.equal(calls[0][1], ARTICLE_REVISION);
  assert.equal(calls[0][2].articleId, "ART-1");
});

test("AA1：save 端点不传 revision → 400 VALIDATION_ERROR", async () => {
  const { h } = setup();
  const saved = await h.call("POST /api/article-associations/save", undefined, { articleId: "ART-1", action: "replace", componentIds: [], versionIds: [] });
  assert.equal(saved.status, 400);
  assert.equal(saved.body.error_code, "VALIDATION_ERROR");
});
