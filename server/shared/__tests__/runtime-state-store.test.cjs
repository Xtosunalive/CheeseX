// @tests: server/shared/persistence/runtime-state-store.cjs（PR-104／WP-013：review_actions.issue_id 提列）
// 层级：纯单元＋Adapter 契约（内存库/临时目录真实文件库；node:sqlite 真实引擎非替身）。
// 验证对象：迁移 0004 升级路径（历史 NULL／新追加落列／索引在册／无 FK）、append 抽取、issueIds 读面。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { MIGRATIONS, createRuntimeStateStore } = require("../persistence/runtime-state-store.cjs");

const decision = (over) => ({ action: "rejected", kind: "relation_candidate", candidateId: "c1", reviewer: "r", decidedAt: "2026-10-25T00:00:00.000Z", ...over });

test("PR-104 0004 升级路径：0001-0003 旧库带裁决行打开即加 issue_id 列——历史 NULL、行数不变、新追加落列、索引在册、DDL 无 FOREIGN KEY", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-state-store-"));
  const dbPath = path.join(dir, "runtime-state.db");
  try {
    const legacy = openPersistenceDb({ path: dbPath });
    legacy.applyMigrations(MIGRATIONS.filter((m) => m.id < "0004-review-actions-issue-column"));
    legacy.prepare("INSERT INTO review_actions (action_json, decided_at) VALUES (?, ?)")
      .run(JSON.stringify(decision({ candidateId: "legacy" })), null);
    legacy.close();

    const db = openPersistenceDb({ path: dbPath });
    const store = createRuntimeStateStore(db);
    assert.equal(store.review.list().length, 1, "加列不动存量行");
    assert.deepEqual(store.review.issueIds(), [], "历史行 issue_id 为 NULL（不做猜测性回填）");
    store.review.append(decision({ issueId: "issue-7" }), null);
    store.review.append(decision({ issueId: "issue-7", candidateId: "c2" }), null);
    store.review.append(decision({ candidateId: "no-issue" }), null);
    assert.deepEqual(store.review.issueIds(), ["issue-7"], "去重、非空、升序");
    assert.equal(store.review.list().length, 4);

    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='review_actions'").get().sql;
    assert.ok(/issue_id/.test(ddl), "列在表");
    assert.ok(!/FOREIGN KEY/i.test(ddl), "不挂 FK——父表整表重写×子表 append-only（PR-104 规则）");
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_review_issue'").get();
    assert.ok(idx, "idx_review_issue 在册");
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PR-104 append 抽取：issueId 非空字符串才落列；非字符串/空串/缺省均为 NULL，JSON 原样保留", () => {
  const store = createRuntimeStateStore(openPersistenceDb());
  store.review.append(decision({ issueId: "ok-1" }), null);
  store.review.append(decision({ issueId: "" }), null);
  store.review.append(decision({ issueId: 42 }), null);
  store.review.append(decision({}), null);
  assert.deepEqual(store.review.issueIds(), ["ok-1"]);
  const rows = store.review.list();
  assert.equal(rows.length, 4);
  assert.equal(rows[2].issueId, 42, "JSON 原样保留——列只是显式键投影");
});
