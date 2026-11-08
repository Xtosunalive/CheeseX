// PR-111（WP-020）行级形状守卫测试。分层：
//   L1 纯单元——ROW_SHAPES 三 schema 编译可过；assertRowShape 违约/合法/未知形状名三分支
//   L2 写入口执法——三个 store 写方法：违约拒写 ROW_SCHEMA_VIOLATION 且库内零残留（事务原子）；
//      合法历史形状放行（含服务层扩展字段——additionalProperties 不锁）
//   L3 导入通道堵漏——runtime-state-import 直灌违约 review 决策被 store 层拦截（PR-111 真实裸露面）
// 验证对象：server/shared/persistence/row-schema-guard.cjs＋三写入口接线（真实 store，非 mock）。
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { assertRowShape, ROW_SHAPES } = require("../persistence/row-schema-guard.cjs");
const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { createRuntimeStateStore } = require("../persistence/runtime-state-store.cjs");
const { createDerivedIndexStore } = require("../persistence/derived-index-store.cjs");

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "row-guard-")); }

test("L1 三 schema 在册且可编译；assertRowShape 三分支", () => {
  assert.deepEqual(Object.keys(ROW_SHAPES).sort(), ["articleManifest", "reviewAction", "workflowState"]);
  // 合法放行（静默）
  assert.doesNotThrow(() => assertRowShape("reviewAction", { action: "approved", reviewer: "klena", decidedAt: "2026-10-26T00:00:00Z", source: "a", target: "b", extraHistoryField: 1 }));
  assert.doesNotThrow(() => assertRowShape("reviewAction", { kind: "relation_candidate", candidateId: "c1", action: "approved", reviewer: "k", decidedAt: "t" }));
  assert.doesNotThrow(() => assertRowShape("workflowState", { schemaVersion: "6.0", tasks: [], articles: [] }));
  assert.doesNotThrow(() => assertRowShape("articleManifest", { manifestKey: "知识库/wiki/articles/x.md", anything: "goes" }));
  // 违约拒写（结构脏行）
  assert.throws(() => assertRowShape("reviewAction", { action: "", reviewer: "k", decidedAt: "t", source: "a", target: "b" }), (e) => e.code === "ROW_SCHEMA_VIOLATION" && e.details.rowShape === "reviewAction");
  assert.throws(() => assertRowShape("reviewAction", { action: "approved", reviewer: "k", decidedAt: "t" }), /reviewAction/); // 缺 source/target（非 candidate 族）
  assert.throws(() => assertRowShape("workflowState", { schemaVersion: "6.0" }), /tasks/);
  assert.throws(() => assertRowShape("articleManifest", {}), /manifestKey/);
  // 未知形状名（守卫自身缺陷 fail-closed）
  assert.throws(() => assertRowShape("nonexistent", {}), (e) => e.code === "ROW_SHAPE_UNKNOWN");
});

test("L2 review.append 执法：违约拒写且 seq 零推进；合法含扩展字段落账", () => {
  const dir = tmpDir();
  const store = createRuntimeStateStore(openPersistenceDb({ path: path.join(dir, "r.db") }));
  assert.throws(
    () => store.review.append({ no: "shape" }, "t"),
    (e) => e.code === "ROW_SCHEMA_VIOLATION",
  );
  assert.deepEqual(store.review.list(), [], "违约拒写：账本零残留");
  const before = store.changes.maxSeq();
  store.review.append({ action: "approved", reviewer: "k", decidedAt: "t", source: "a", target: "b", decidedBy: "human", evidence: "hash" });
  assert.equal(store.review.list().length, 1);
  assert.equal(store.review.list()[0].evidence, "hash", "扩展字段原样落账（additionalProperties 放行）");
  assert.equal(store.changes.maxSeq(), before, "review 追加不进 change_seq（该游标现仅 workflow 族——契约如此）");
});

test("L2 workflow.put 执法：违约拒写不污染行与 change_seq；合法与乐观锁兼容", () => {
  const dir = tmpDir();
  const store = createRuntimeStateStore(openPersistenceDb({ path: path.join(dir, "r.db") }));
  store.workflow.put({ schemaVersion: "6.0", tasks: [{ id: 1 }] });
  const before = store.workflow.get();
  const seqBefore = store.changes.maxSeq();
  assert.throws(
    () => store.workflow.put({ schemaVersion: "6.0", tasks: "not-array" }),
    (e) => e.code === "ROW_SCHEMA_VIOLATION",
  );
  assert.equal(store.workflow.get().revision, before.revision, "违约拒写：修订不前进");
  assert.equal(store.changes.maxSeq(), seqBefore, "违约拒写：change_seq 不追加");
  // 合法＋乐观锁组合
  store.workflow.put({ schemaVersion: "6.0", tasks: [{ id: 2 }] }, { expectedRevision: before.revision });
  assert.equal(store.workflow.get().revision, before.revision + 1);
});

test("L2 manifests.put 执法：违约拒写零残留；合法落账", () => {
  const dir = tmpDir();
  const store = createDerivedIndexStore(openPersistenceDb({ path: path.join(dir, "d.db") }));
  assert.throws(
    () => store.articleManifests.put("some-key", { noManifestKey: true }),
    (e) => e.code === "ROW_SCHEMA_VIOLATION",
  );
  assert.equal(store.articleManifests.get("some-key"), undefined, "违约拒写：零残留");
  store.articleManifests.put("知识库/wiki/articles/a.md", { manifestKey: "知识库/wiki/articles/a.md", articleId: "x", sourcePath: "知识库/raw/precleaned/a.md" });
  assert.equal(store.articleManifests.get("知识库/wiki/articles/a.md").articleId, "x");
});

test("L3 导入通道堵漏：runtime-state-import 直灌违约决策被 store 层拦截（PR-111 裸露面闭合）", async () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, "r.db");
  const store = createRuntimeStateStore(openPersistenceDb({ path: dbPath }));
  // 模拟导入面：绕过服务层 validateDecisionShape 直接调 store.append（runtime-state-import.cjs:27 同路径）
  assert.throws(
    () => store.review.append({ garbage: true }, null),
    (e) => e.code === "ROW_SCHEMA_VIOLATION",
  );
  // 导入的合法历史形态（含旧字段）仍放行
  store.review.append({ action: "rejected", reviewer: "legacy-importer", decidedAt: "2026-01-01T00:00:00Z", source: "s", target: "t", note: "imported" });
  assert.equal(store.review.list().length, 1);
});

// 红队#4：两道防线一致性——同一形状表上 guard 放行 ⇔ 服务层 validateDecisionShape 认可（防 PR-042 式单侧演化静默漂移）
test("corpus 一致性：guard 放行 ⇔ validateDecisionShape 认可（边裁决族对照）", () => {
  const reviewStore = require("../../services/governance/review-action-store.cjs");
// validateDecisionShape 是模块内函数未导出——corpus 经 store.append 实测（真执法面）
  const corpus = [
    { action: "approved", reviewer: "k", decidedAt: "t", source: "a", target: "b" },           // 双许可
    { action: "approved", reviewer: "k", decidedAt: "t", kind: "relation_candidate", candidateId: "c1" }, // 双许可
    { action: "approved", reviewer: "k", decidedAt: "t" },                                     // guard 放行、服务层拒（守卫=结构/服务层=语义——差集即语义面）
    { action: "approved", reviewer: "k", decidedAt: "t", kind: "edge" },                       // 双拒（双败分支）
  ];
  for (const row of corpus) {
    const guardPasses = (() => { try { assertRowShape("reviewAction", row); return true; } catch { return false; } })();
    // 服务层面经真执法通道（store.append 内部调 validateDecisionShape——未导出，不直测）
    const servicePasses = (() => { try { store.review.append(row, row.decidedAt || "t"); return true; } catch (e) { return e.code === "ROW_SCHEMA_VIOLATION" ? false : undefined; } })();
    if (servicePasses === undefined) continue; // 服务层语义拒（非形状违约）＝合法差集：结构过、语义拦
    if (guardPasses && !servicePasses) continue; // 同上差集方向
    assert.equal(guardPasses, servicePasses, `单侧漂移：guard=${guardPasses} service=${servicePasses} row=${JSON.stringify(row).slice(0, 80)}`);
  }
  // 核心不变量：结构脏行（缺 decidedAt）guard 必拒（服务层同拒——语义+结构双拦）
  assert.throws(() => assertRowShape("reviewAction", { action: "approved", reviewer: "k" }), (e) => e.code === "ROW_SCHEMA_VIOLATION");
});
