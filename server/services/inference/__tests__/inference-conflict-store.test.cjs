const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInferenceConflictStore } = require("../inference-conflict-store.cjs");

const NOW = "2026-07-13T04:30:00.000Z";

function conflict(overrides = {}) {
  return {
    conflictId: "abc123",
    code: "RULES_CONFLICT",
    subjectNodeId: "svc-a",
    conclusionKey: "requires-change",
    sourceRevision: "sha256:source",
    ruleIds: ["r1", "r2"],
    conclusions: [
      { ruleId: "r1", subjectNodeId: "svc-a", conclusionKey: "requires-change", effect: "ASSERT", evidence: ["edge-a"] },
      { ruleId: "r2", subjectNodeId: "svc-a", conclusionKey: "requires-change", effect: "WAIVE", evidence: ["policy-a"] },
    ],
    status: "unresolved",
    ...overrides,
  };
}

function withVault(fn) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "inference-conflicts-"));
  try { return fn(vaultPath); } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
}

test("missing conflict file starts empty and upsert reloads without duplicates", () => withVault((vaultPath) => {
  const store = createInferenceConflictStore({ vaultPath, now: () => NOW });
  assert.deepEqual(store.list(), []);
  store.upsertDetected([conflict()]);
  store.upsertDetected([conflict({ conclusions: conflict().conclusions.map((item) => ({ ...item, evidence: [...item.evidence, "new"] })) })]);
  const reloaded = createInferenceConflictStore({ vaultPath, now: () => NOW }).list();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].conflictId, "abc123");
  assert.ok(reloaded[0].conclusions[0].evidence.includes("new"));
}));

test("preserves a human resolution across later detection and supports reopen", () => withVault((vaultPath) => {
  const store = createInferenceConflictStore({ vaultPath, now: () => NOW });
  store.upsertDetected([conflict()]);
  store.review("abc123", { action: "resolve", resolution: "waive", reviewer: "alice", reason: "approved exception" });
  store.upsertDetected([conflict()]);
  const resolved = store.list()[0];
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedBy, "alice");
  store.review("abc123", { action: "reopen", reviewer: "bob", reason: "new evidence" });
  assert.equal(createInferenceConflictStore({ vaultPath }).list()[0].status, "unresolved");
}));

test("persists structured decisions separately from legacy audit text", () => withVault((vaultPath) => {
  const store = createInferenceConflictStore({ vaultPath, now: () => NOW });
  store.upsertDetected([conflict()]);
  const decision = { decision: "select_effect", selectedEffect: "BLOCK", selectedRuleIds: ["r1", "r2"], reasonCode: "SOURCE_NOT_FRESH", sourceRevision: "sha256:source" };
  const result = store.review("abc123", { action: "resolve", decision, reviewer: "local-architect", reason: "来源变化" });
  assert.deepEqual(result.decision, decision);
  assert.equal(result.operatorId, "local-architect");
  assert.equal(result.resolution, undefined);
}));

test("rejects a structured decision when conflict evidence has changed", () => withVault((vaultPath) => {
  const store = createInferenceConflictStore({ vaultPath, now: () => NOW });
  store.upsertDetected([conflict()]);
  assert.throws(() => store.review("abc123", {
    action: "resolve",
    reviewer: "local-architect",
    reason: "采用当前证据",
    decision: { decision: "select_effect", selectedEffect: "BLOCK", sourceRevision: "sha256:stale" },
  }), (error) => error.code === "CONFLICT_SOURCE_CHANGED");
  assert.equal(store.list()[0].status, "unresolved");
}));

// 存储损坏子句已随 SPEC-012 WP-A 迁移退役：账本物理形态为 runtime-state.db 事务行，
// 无可变共享 json 文件可损坏（损坏面移交 sqlite 事务层）。保留对输入校验的子句。
test("rejects literal artifacts, invalid status and review input", () => withVault((vaultPath) => {
  const store = createInferenceConflictStore({ vaultPath });
  assert.throws(() => store.upsertDetected([conflict({ subjectNodeId: "['svc-a']" })]), /literal artifact/);
  assert.throws(() => store.upsertDetected([conflict({ status: "pending" })]), /status/);
  store.upsertDetected([conflict()]);
  assert.throws(() => store.review("abc123", { action: "resolve", reviewer: "", reason: "" }), /reviewer/);
  assert.throws(() => store.review("missing", { action: "reopen", reviewer: "bob" }), /not found/);
}));

// 旧「atomic rename failure」测试已退役：tmp+rename 语义随 SPEC-012 WP-A 整体退役（整文档事务替换）。
// 替代锚定：upsertDetected 校验失败抛错且既有 envelope 不变（失败不污染已持久化状态）。
test("upsertDetected validation failure leaves the persisted envelope untouched", () => withVault((vaultPath) => {
  const store = createInferenceConflictStore({ vaultPath, now: () => NOW });
  store.upsertDetected([conflict()]);
  const before = store.list();
  assert.equal(before.length, 1);
  assert.throws(() => store.upsertDetected(conflict({ subjectNodeId: "['svc-a']" })), (error) => error.code === "INVALID_CONFLICT");
  assert.deepEqual(store.list(), before);
  assert.equal(store.list().length, 1);
}));
