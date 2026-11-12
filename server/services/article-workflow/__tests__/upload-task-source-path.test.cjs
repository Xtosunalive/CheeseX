// upload-task-source-path — 投稿源路径归一化与删源判活（PR-300 回归）
// 层级：纯单元（normalizeDraftSourcePath 纯函数＋uploadTaskStatus/syncUploadTasks 真临时 vault 行为）。
// 回归先例：drafts 根本地草稿（非 投稿/ 子目录）删源后，归一化返回 null → draftSourceExists
// 视为存在 → 任务永停 awaiting_architect_processing；archive/本地草稿 lane 还原缺位 → 晋升后
// 任务↔候选匹配断链（2026-11-13 用户实录：cheeseh-单源收口直接换结构立案-2026-11-07.md）。
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
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/本地草稿/${H}-foo.md`), "知识库/raw/drafts/foo.md");
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/通用/${H}-foo.md`), "知识库/raw/drafts/投稿/foo.md", "通用为 Python 遗留分桶——沿用投稿/ 还原（存量行为不变）");
  assert.equal(normalizeDraftSourcePath(`知识库/raw/archive/本地草稿/${H}-${H}-foo.md`), "知识库/raw/drafts/foo.md", "多段哈希前缀全剥");
});

test("归一化：非 drafts/非归档路径与缺哈希归档件不认（null）", () => {
  assert.equal(normalizeDraftSourcePath("知识库/wiki/articles/foo.md"), null);
  assert.equal(normalizeDraftSourcePath("知识库/raw/precleaned/foo.md"), null);
  assert.equal(normalizeDraftSourcePath("知识库/raw/archive/投稿/foo.md"), null, "无哈希前缀非溯源锚");
  assert.equal(normalizeDraftSourcePath(""), null);
});

test("删源判活：drafts 根本地草稿删除后任务翻 source_deleted（PR-300 主回归）", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr300-vault-"));
  const noApproval = () => null;
  const task = { draftPath: "知识库/raw/drafts/foo.md", status: "awaiting_architect_processing", articleIds: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  // 文件不存在（已删）→ source_deleted，不再永停 awaiting
  assert.equal(uploadTaskStatus([], task, vault, noApproval), "source_deleted");
  // 文件在 → awaiting_architect_processing（原语义保持）
  const draftAbsolute = path.join(vault, "知识库", "raw", "drafts", "foo.md");
  fs.mkdirSync(path.dirname(draftAbsolute), { recursive: true });
  fs.writeFileSync(draftAbsolute, "x");
  assert.equal(uploadTaskStatus([], task, vault, noApproval), "awaiting_architect_processing");
  // 嵌套子目录草稿同权
  const nested = { ...task, draftPath: "知识库/raw/drafts/notes/foo.md" };
  assert.equal(uploadTaskStatus([], nested, vault, noApproval), "source_deleted");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("任务↔候选匹配：archive/本地草稿 lane 溯源还原后匹配 drafts 根任务（晋升后不断链）", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pr300-vault-"));
  const sourceByArticleId = new Map([["a1", normalizeDraftSourcePath(`知识库/raw/archive/本地草稿/${H}-foo.md`)]]);
  assert.equal(sourceByArticleId.get("a1"), "知识库/raw/drafts/foo.md");
  const task = { draftPath: "知识库/raw/drafts/foo.md", precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0, status: "awaiting_architect_processing", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  const article = { id: "a1", sourcePath: "知识库/raw/precleaned/foo.md", standardizationStatus: "standardized", updatedAt: "2026-01-02T00:00:00Z" };
  const { changed } = syncUploadTasks([task], [article], sourceByArticleId, vault, () => null);
  assert.equal(changed, true);
  assert.deepEqual(task.articleIds, ["a1"]);
  assert.equal(task.candidateCount, 1);
  assert.equal(task.status, "standardized", "匹配后跟候选走（不再永停 awaiting）");
  fs.rmSync(vault, { recursive: true, force: true });
});
