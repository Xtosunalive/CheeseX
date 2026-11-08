// 方案 2（2026-10-15 Master 裁「2」）：投稿任务 digested 终态——退役消化（digestUploadTasks）
// ＋读时聚合不回改（uploadTaskStatus 稳态保持）＋面板默认只投活跃（前端另测）。层级：纯单元。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createArticleWorkflowService } = require("../article-workflow-service.cjs");
const { uploadTaskStatus } = require("../article-upload-status.cjs");

function makeVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "digest-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  return vaultPath;
}

function task(draftPath, status, extra = {}) {
  const base = path.basename(draftPath);
  return { taskId: "t-" + Math.random().toString(36).slice(2, 8), originalFileName: base, sizeBytes: 100, draftPath, precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0, status, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", ...extra };
}

test("digestUploadTasks：按草稿名置 digested＋幂等＋无关任务不动", () => {
  const vaultPath = makeVault();
  try {
    const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, warn() {}, error() {} } });
    // 直接经 store 落两条任务（upload 会写盘建草稿——这里只测 digest 逻辑，用 store 接口）
    const { readWorkflowState, writeWorkflowState } = require("../article-workflow-store.cjs");
    const state = readWorkflowState(vaultPath);
    state.tasks.push(task("知识库/raw/drafts/投稿/gone.md", "completed", { candidateCount: 1, precleanedPaths: ["知识库/raw/precleaned/gone.md"] }));
    state.tasks.push(task("知识库/raw/drafts/投稿/stay.md", "awaiting_architect_processing"));
    writeWorkflowState(vaultPath, state);

    const digested = service.digestUploadTasks("gone.md");
    assert.equal(digested, 1, "同名任务消化");
    const after = readWorkflowState(vaultPath);
    assert.equal(after.tasks.find((t) => t.draftPath.endsWith("gone.md")).status, "digested");
    assert.equal(after.tasks.find((t) => t.draftPath.endsWith("stay.md")).status, "awaiting_architect_processing", "无关任务不动");
    assert.equal(service.digestUploadTasks("gone.md"), 0, "幂等");
    assert.equal(service.digestUploadTasks("stay.md"), 1, "未完成任务同样可消化（退役沿链）");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("digested 稳态：读时聚合（uploadTaskStatus）不回改——终态只由退役动作显式置位", () => {
  const t = { status: "digested", draftPath: "知识库/raw/drafts/投稿/x.md", candidateCount: 1, precleanedPaths: ["知识库/raw/precleaned/x.md"] };
  assert.equal(uploadTaskStatus([], t, "/nonexistent"), "digested", "即使源/产物全不在也不降级为 source_deleted");
});
