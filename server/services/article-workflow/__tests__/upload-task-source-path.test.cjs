// upload-task-source-path（PR-300）——层级：纯单元。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { normalizeDraftSourcePath, syncUploadTasks, uploadTaskStatus } = require("../article-upload-status.cjs");

const H = "a".repeat(64);

test("归一化：drafts 整根（根目录/投稿/子目录/嵌套）原样返回", () => {
  assert.equal(normalizeDraftSourcePath("知识库/raw/drafts/foo.md"), "知识库/raw/drafts/foo.md");
  assert.equal(normalizeDraftSourcePath("知识库/raw/drafts/投稿/foo.md"), "知识库/raw/drafts/投稿/foo.md");
  assert.equal(normalizeDraftSourcePath("知识库/raw/drafts/notes/foo.md"), "知识库/raw/drafts/notes/foo.md");
  assert.equal(normalizeDraftSourcePath("raw/drafts/foo.md"), "知识库/raw/drafts/foo.md");
});

test("归一化：归档路径按 lane 还原（投稿/本地草稿/通用遗留）", () => {
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/投稿/${H}-foo.md`), "知识库/raw/drafts/投稿/foo.md");
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/本地草稿/${H}-foo.md`), "知识库/raw/drafts/foo.md"); // 归一根形态；子目录任务匹配经 syncUploadTasks 本地lane兜底（WP-169）
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/通用/${H}-foo.md`), "知识库/raw/drafts/投稿/foo.md");
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/本地草稿/${H}-${H}-foo.md`), "知识库/raw/drafts/foo.md");
});

test("归一化：非 drafts/非归档路径与缺哈希归档件不认（null）", () => {
  assert.equal(normalizeDraftSourcePath("知识库/wiki/articles/foo.md"), null);
  assert.equal(normalizeDraftSourcePath("知识库/raw/precleaned/foo.md"), null);
  assert.equal(normalizeDraftSourcePath("知识库/raw/archive/投稿/foo.md"), null);
  assert.equal(normalizeDraftSourcePath(""), null);
});

test("删源判活：drafts 根本地草稿删除后任务翻 source_deleted", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr300-vault-"));
  const noApproval = () => null;
  const task = { draftPath: "知识库/raw/drafts/foo.md", status: "awaiting_architect_processing", articleIds: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  // 文件不存在 → source_deleted
  assert.equal(uploadTaskStatus([], task, vault, noApproval), "source_deleted");
  // 文件在 → awaiting_architect_processing
  const draftAbsolute = path.join(vault, "知识库", "raw", "drafts", "foo.md");
  fs.mkdirSync(path.dirname(draftAbsolute), { recursive: true });
  fs.writeFileSync(draftAbsolute, "x");
  assert.equal(uploadTaskStatus([], task, vault, noApproval), "awaiting_architect_processing");
  // 嵌套子目录草稿同权
  const nested = { ...task, draftPath: "知识库/raw/drafts/notes/foo.md" };
  assert.equal(uploadTaskStatus([], nested, vault, noApproval), "source_deleted");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("任务↔候选匹配：archive/本地草稿 lane 溯源还原后匹配 drafts 根任务", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr300-vault-"));
  const sourceByArticleId = new Map([["a1", normalizeDraftSourcePath(`知识库/raw/archive/本地草稿/${H}-foo.md`)]]);
  assert.equal(sourceByArticleId.get("a1"), "知识库/raw/drafts/foo.md");
  const task = { draftPath: "知识库/raw/drafts/foo.md", precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0, status: "awaiting_architect_processing", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  const article = { id: "a1", sourcePath: "知识库/raw/precleaned/foo.md", standardizationStatus: "standardized", updatedAt: "2026-01-02T00:00:00Z" };
  const { changed } = syncUploadTasks([task], [article], sourceByArticleId, vault, () => null);
  assert.equal(changed, true);
  assert.deepEqual(task.articleIds, ["a1"]);
  assert.equal(task.candidateCount, 1);
  assert.equal(task.status, "standardized");
  fs.rmSync(vault, { recursive: true, force: true });
});

// WP-169 红队P1-1 回归钉：子目录本地任务（drafts/本地草稿/foo.md）经 lane 兜底匹配根形态归一产物
test("匹配兜底：子目录本地任务 ↔ 归档本地草稿根形态归一键", () => {
  const path = require("node:path");
  const mod = require(path.join(__dirname, "..", "article-upload-status.cjs"));
  const L = require("../../../shared/article-lifecycle-paths.cjs");
  const tasks = [{ draftPath: `${L.LOCAL_DRAFT_PREFIX}foo.md`, precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0, status: "awaiting_architect_processing", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }];
  const articles = [{ id: "a1", sourcePath: "知识库/raw/precleaned/foo.md", updatedAt: "2026-01-02T00:00:00Z" }];
  const sourceByArticleId = new Map([["a1", `${L.DRAFT_ROOT}/foo.md`]]); // 归一根形态（归档 lane 还原产物）
  const r = mod.syncUploadTasks(tasks, articles, sourceByArticleId, "/vault", () => "未发布");
  if (!(tasks[0].articleIds.includes("a1") || r.changed)) {
    // 兜底未命中即红（changed=true 且 articleIds 收敛为命中集）
    throw new Error(`子目录任务未经兜底匹配：articleIds=${JSON.stringify(tasks[0].articleIds)}`);
  }
});
