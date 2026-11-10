const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFormalEditService } = require("../formal-edit-service.cjs");

test("正式文件外部编辑进入待审，重复事件和重启对账不重复重检", (t) => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "formal-edit-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const file = path.join(vaultPath, "知识库/wiki/articles/运维/架构说明.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const oldRaw = "---\narticle_id: article-1\ntitle: 架构说明\n---\n旧正文";
  const newRaw = oldRaw.replace("旧正文", "新正文");
  fs.writeFileSync(file, newRaw);
  const oldHash = crypto.createHash("sha256").update(oldRaw).digest("hex");
  const state = { status: "snapshot", revision: `sha256:${oldHash}`, approval: { contentHash: oldHash }, decisions: ["old-approved"] };
  let checks = 0;
  const workflow = {
    standardize: () => { checks += 1; },
    getPrecleaned: () => ({ formalContentHash: crypto.createHash("sha256").update(newRaw).digest("hex"), sourcePath: "知识库/raw/precleaned/article-1-formal-edit.md" }),
    readPublishedContent: () => oldRaw,
  };
  const approval = {
    readRecord: () => state,
    recordExternalEdit: (_id, hash, sourceHash, changeSummary) => {
      state.status = "pending"; state.revision = `sha256:${hash}`; state.externalSourceHash = sourceHash; state.approval = null; state.changeSummary = changeSummary;
      return { changed: true, status: "pending" };
    },
  };
  const service = createFormalEditService({ vaultPath, articleWorkflowService: workflow, approvalStateMachine: approval });
  assert.equal(service.handle([file])[0].status, "pending");
  assert.equal(checks, 1);
  assert.equal(state.changeSummary.bodyChanged, true);
  assert.equal(state.changeSummary.beforeExcerpt, "旧正文");
  assert.equal(state.changeSummary.afterExcerpt, "新正文");
  assert.equal(fs.readFileSync(path.join(vaultPath, "知识库/raw/precleaned/article-1-formal-edit.md"), "utf8"), newRaw);
  assert.equal(service.handle([file])[0].changed, false);
  service.reconcile();
  assert.equal(checks, 1);
  assert.deepEqual(state.decisions, ["old-approved"]);
});

test("同时移动文件并删除 article_id 时，原发布身份进入待审", (t) => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "formal-moved-"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const file = path.join(vaultPath, "知识库/wiki/articles/ops/新位置.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "---\ntitle: 新位置\n---\n新正文");
  const state = { status: "snapshot", approval: { contentHash: "a".repeat(64) } };
  const workflow = { listPublishedVersions: () => [{ articleId: "old-id", snapshotPath: "知识库/wiki/articles/ops/旧位置.md" }] };
  const approval = { readRecord: (id) => id === "old-id" ? state : null, recordExternalEdit: (id) => { assert.equal(id, "old-id"); state.status = "pending"; return { changed: true }; } };
  const service = createFormalEditService({ vaultPath, articleWorkflowService: workflow, approvalStateMachine: approval });
  assert.equal(service.handle([file]).some((entry) => entry.articleId === "old-id"), true);
  assert.equal(state.status, "pending");
});
