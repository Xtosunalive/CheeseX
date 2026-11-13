// Component: Runtime-State-Store
// @responsible: SPEC-012 WP-A ③类运行时状态唯一持久层——runtime-state.db 的 store 接口（业务代码不见 SQL）。
//   真事务替代手搓原子性（tmp+rename 退役）；迁出 vault＝退出监听/洁净度范围。
// @inputs: persistence 句柄（sqlite-adapter）；各域记录
// @outputs: createRuntimeStateStore(db) → 分域 API；initRuntimeStateStore/getRuntimeStateStore（装配/取用两形态）
// @context: data/runtime-state.db（进程私有＋跨进程：Python 管线经 sqlite3 直写同库）
//
// 形态约定：
// - 整文档族（workflow/inference/expectations）：单行文档（id=1），事务内整体替换——并发读改写竞态由事务消解；
// - 键值族（approval/governance）：每主体一行，UPSERT；
// - 追加族（review）：自增 seq 追加，读侧按 seq 升序——替代「读全量→push→写回」；
// - 锁族（locks）：BEGIN IMMEDIATE 互斥＋owner 行（pid/started_at/host），pid 存活检查沿 stale-lock 语义。
// F2 耐久性钩点：每族写事务提交后可挂 journal sink（WP-I 落地——本波只留 seam，不建流水）。

"use strict";
const { assertRowShape } = require("./row-schema-guard.cjs"); // PR-111
const { parseJsonColumn } = require("./sqlite-adapter.cjs"); // 读侧 BLOB 容错（2026-10-29 事故）

const MIGRATIONS = [
  {
    id: "0001-runtime-core",
    sql: `
      CREATE TABLE IF NOT EXISTS approval_states (
        article_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS governance_actions (
        gap_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        note TEXT,
        resolved_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_actions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        action_json TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE TABLE IF NOT EXISTS inference_conflicts (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        envelope_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relation_expectations (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        expectations_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS locks (
        name TEXT PRIMARY KEY,
        owner_pid INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        host TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_migration (
        family TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL
      );
    `,
  },
  {
    // SPEC-012 WP-A 管线三件套（Python 经 sqlite3 跨进程读写同库——DDL 镜像于
    // scripts/vault-runtime/_runtime_state_db.py，双侧 schema 由 vault-runtime 测试对账）
    id: "0002-pipeline",
    sql: `
      CREATE TABLE IF NOT EXISTS pipeline_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_ts TEXT NOT NULL,
        run_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // SPEC-012 wave-2 首家族：anomaly 台账迁入（勘察实证为②③混合体——issueSnapshot 可重派生，
    // 操作状态机/previewId 令牌/rejection 审计/displaySeq 发号器不可重建→③类归宿 runtime-state）
    id: "0003-anomaly",
    sql: `
      CREATE TABLE IF NOT EXISTS anomaly_ledger (
        issue_id TEXT PRIMARY KEY,
        status TEXT,
        display_seq INTEGER,
        entry_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_anomaly_status ON anomaly_ledger (status);
    `,
  },
  {
    // PR-104/WP-013：人裁账显式键提列——候选级裁决的 issueId 落真实列（可索引可对账）。
    // 不挂 FK：anomaly_ledger 由 writeLedger→replaceAll 整表重写且为重放级操作，review_actions 为
    // append-only 审计——任一成立即不可物理化（CASCADE 连坐清审计／RESTRICT 卡死对账重放／SET NULL 提列白做）。
    // 完整性走写时校验（工作台拒绝前已持有 issue）＋读时对账 warn。历史行 NULL，不做猜测性回填。
    id: "0004-review-actions-issue-column",
    sql: `
      ALTER TABLE review_actions ADD COLUMN issue_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_review_issue ON review_actions (issue_id);
    `,
  },
  {
    // WP-018（PR-112 reopened）：多用户并发防护首切片——workflow 整文档行加单调修订号（乐观锁锚点，
    // 对齐 yaml 族 revision 样板）；change_seq＝各族变更的游标序列（轮询探针 GET /api/system/changes-since 消费）。
    // 存量行 revision 置 0 起跳（不猜历史修订）；SQLite ALTER ADD COLUMN 带默认值即可。
    id: "0005-runtime-changes",
    sql: `
      ALTER TABLE workflow_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS change_seq (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        family TEXT NOT NULL,
        entity TEXT,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // WP-172（SPEC-095 §3.5）：动作审批账本（追加族——事件流 requested/decided/used，
    // 读侧重放折叠当前态；并发追加由自增主键构造性消解——B3 同款方案）
    id: "0006-action-approvals",
    sql: `
      CREATE TABLE IF NOT EXISTS action_approvals (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approval_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_action_approvals_id ON action_approvals (approval_id);
    `,
  },
];

function createRuntimeStateStore(db, options) {
  // options.migrations＝测试缝（升级路径用例注入截断清单——data-dir options.dir 同族先例；生产缺省全量）
  db.applyMigrations((options && options.migrations) || MIGRATIONS);
  const now = () => new Date().toISOString();
  // F2 耐久性钩点（SPEC-012 §九 seam 的兑现）：各族写事务提交后追加流水——
  // journal 形如 { append(family, op, args) }（state-journal.cjs 产）；缺省不记（单测隔离用）。
  const journal = options && options.journal;
  const journaled = (family, op) => (...args) => {
    const result = api[family][op](...args);
    if (journal) journal.append(family, op, args);
    return result;
  };

  // ── approval（审批状态机账本；乐观锁与转移规则留在服务层）──
  const approval = {
    all() {
      const rows = db.prepare("SELECT article_id, record_json FROM approval_states").all();
      const out = {};
      for (const row of rows) out[row.article_id] = parseJsonColumn(row.record_json);
      return out;
    },
    get(articleId) {
      const row = db.prepare("SELECT record_json FROM approval_states WHERE article_id = ?").get(articleId);
      return row ? parseJsonColumn(row.record_json) : undefined;
    },
    put(articleId, record) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO approval_states (article_id, record_json, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(article_id) DO UPDATE SET record_json = excluded.record_json, updated_at = excluded.updated_at",
        ).run(articleId, JSON.stringify(record), now());
      });
    },
  };

  // ── workflow（投稿工作流整文档：tasks/articles）──
  const workflow = {
    // WP-018：返回形态 { state, revision }；调用方统一经 .state 解包（article-workflow-store＋各测试已适配）
    // B-2（红队）：与 yaml 族样板 0 值语义**有意偏离**——enums 真值判断（0 不锁），本族 0 参与锁：迁移后存量行 revision=0 必须可锁（否则升级库的并发防护永远无法启用）
    get() {
      const row = db.prepare("SELECT state_json, revision FROM workflow_state WHERE id = 1").get();
      if (!row) return undefined;
      return { state: parseJsonColumn(row.state_json), revision: row.revision };
    },
    // options.expectedRevision（可选）：乐观锁——不匹配抛 WORKFLOW_REVISION_CONFLICT（409，带 currentRevision），
    // 对齐 yaml 族样板（enums-write-service revision 语义）；缺省不锁＝存量调用零行为变化。
    put(state, options) {
      assertRowShape("workflowState", state); // PR-111：行级形状守卫
      // B-1（红队）：Number.isSafeInteger 收紧——NaN/小数恒 409 fail-closed，details 序列化不再与 null 形态撞车
      const expected = options && Number.isSafeInteger(options.expectedRevision) ? options.expectedRevision : null;
      return db.transaction(() => {
        const row = db.prepare("SELECT revision FROM workflow_state WHERE id = 1").get();
        if (expected !== null) {
          // WP-022 红队#1：空库首写语义对齐——读侧空库锚=0，写侧空行放行 expectedRevision=0 首写
          //（此前 !row 恒拒＝两层 0 语义不一致：空库带锚首写必 409 且文件已落盘成孤儿）；
          // 有行不匹配仍拒（row.revision !== expected——含 expected=0 而行已存在的过期情形）
          const mismatched = !row ? expected !== 0 : row.revision !== expected;
          if (mismatched) {
            const conflict = new Error("workflow 状态在他处已变更（修订号过期）——请重读后重试");
            conflict.code = "WORKFLOW_REVISION_CONFLICT";
            conflict.status = 409;
            conflict.details = { currentRevision: row ? row.revision : null, expectedRevision: expected };
            throw conflict;
          }
        }
        const nextRevision = (row ? row.revision : 0) + 1;
        db.prepare(
          "INSERT INTO workflow_state (id, state_json, updated_at, revision) VALUES (1, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at, revision = excluded.revision",
        ).run(JSON.stringify(state), now(), nextRevision);
        db.prepare("INSERT INTO change_seq (family, entity, updated_at) VALUES (?, ?, ?)").run("workflow", null, now());
        return nextRevision; // WP-022 红队#2：put 返回写后新修订——upload 响应 revision 锚依赖此返回（此前无 return＝undefined）
      });
    },
  };

  // WP-018：变更游标读面（轮询探针消费；id 即游标——单调，前端 lastCursor 续拉）
  const changes = {
    since(cursor, limit = 200) {
      return db.prepare(
        "SELECT id, family, entity, updated_at FROM change_seq WHERE id > ? ORDER BY id LIMIT ?"
      ).all(cursor, limit);
    },
    maxSeq() {
      const row = db.prepare("SELECT MAX(id) AS m FROM change_seq").get();
      return row && row.m ? row.m : 0;
    },
  };

  // ── governance（治理动作账本：同 gapId 更新不追加）──
  const governance = {
    list() {
      return db.prepare("SELECT gap_id, action, note, resolved_at FROM governance_actions ORDER BY resolved_at").all()
        .map((row) => ({ gapId: row.gap_id, action: row.action, note: row.note, resolvedAt: row.resolved_at }));
    },
    put(entry) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO governance_actions (gap_id, action, note, resolved_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(gap_id) DO UPDATE SET action = excluded.action, note = excluded.note, resolved_at = excluded.resolved_at",
        ).run(entry.gapId, entry.action, entry.note ?? null, entry.resolvedAt);
      });
    },
  };

  // ── review（人裁账本：追加族——并发追加由自增主键消解竞态）──
  const review = {
    list() {
      return db.prepare("SELECT action_json FROM review_actions ORDER BY seq").all()
        .map((row) => parseJsonColumn(row.action_json));
    },
    append(record, decidedAt) {
      assertRowShape("reviewAction", record); // PR-111：行级形状守卫（导入通道绕过服务层校验的裸露面在此堵）
      const issueId = record && typeof record.issueId === "string" && record.issueId ? record.issueId : null;
      db.transaction(() => {
        db.prepare("INSERT INTO review_actions (action_json, decided_at, issue_id) VALUES (?, ?, ?)")
          .run(JSON.stringify(record), decidedAt ?? null, issueId);
      });
    },
    /** 已入账的 issue 键（去重、非空；走 idx_review_issue）——对账读面（PR-104）。 */
    issueIds() {
      return db.prepare("SELECT DISTINCT issue_id FROM review_actions WHERE issue_id IS NOT NULL ORDER BY issue_id").all()
        .map((row) => row.issue_id);
    },
  };

  // ── action approvals（动作审批账本：追加族——WP-172/SPEC-095 §3.5。事件流 requested/decided/used，
  //    读侧重放折叠出当前态；并发追加由自增主键消解（B3 同款构造性方案））──
  const actionApprovals = {
    list() {
      return db.prepare("SELECT event_json FROM action_approvals ORDER BY seq").all()
        .map((row) => parseJsonColumn(row.event_json));
    },
    append(record) {
      assertRowShape("actionApprovalEvent", record);
      const approvalId = record && typeof record.approval_id === "string" && record.approval_id ? record.approval_id : null;
      db.transaction(() => {
        db.prepare("INSERT INTO action_approvals (event_json, created_at, approval_id) VALUES (?, ?, ?)")
          .run(JSON.stringify(record), now(), approvalId);
      });
    },
  };

  // ── inference（推理冲突账本：整文档；merge/review 语义留在服务层）──
  const inference = {
    getEnvelope() {
      const row = db.prepare("SELECT envelope_json FROM inference_conflicts WHERE id = 1").get();
      return row ? parseJsonColumn(row.envelope_json) : undefined;
    },
    putEnvelope(envelope) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO inference_conflicts (id, envelope_json, updated_at) VALUES (1, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET envelope_json = excluded.envelope_json, updated_at = excluded.updated_at",
        ).run(JSON.stringify(envelope), now());
      });
    },
  };

  // ── relation expectations（实体修复期望边：整文档）──
  const expectations = {
    get() {
      const row = db.prepare("SELECT expectations_json FROM relation_expectations WHERE id = 1").get();
      return row ? parseJsonColumn(row.expectations_json) : undefined;
    },
    put(expectations) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO relation_expectations (id, expectations_json, updated_at) VALUES (1, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET expectations_json = excluded.expectations_json, updated_at = excluded.updated_at",
        ).run(JSON.stringify(expectations), now());
      });
    },
  };

  // ── locks（跨请求互斥：BEGIN IMMEDIATE 即取写锁；stale 判定＝owner pid 已死可接管）──
  const locks = {
    /** 拿到返回 owner 记录；被持有返回 null；stale（pid 已死）自动接管。 */
    tryAcquire(name, { isPidAlive } = {}) {
      const alive = isPidAlive || ((pid) => {
        if (!Number.isInteger(pid) || pid <= 0) return false;
        try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
      });
      return db.transaction(() => {
        const row = db.prepare("SELECT owner_pid, started_at, host FROM locks WHERE name = ?").get(name);
        if (row && alive(row.owner_pid)) return null;
        const owner = { pid: process.pid, startedAt: now(), host: require("node:os").hostname() };
        db.prepare(
          "INSERT INTO locks (name, owner_pid, started_at, host) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET owner_pid = excluded.owner_pid, started_at = excluded.started_at, host = excluded.host",
        ).run(name, owner.pid, owner.startedAt, owner.host);
        return owner;
      });
    },
    release(name) {
      db.transaction(() => {
        db.prepare("DELETE FROM locks WHERE name = ?").run(name);
      });
    },
    owner(name) {
      const row = db.prepare("SELECT owner_pid, started_at, host FROM locks WHERE name = ?").get(name);
      return row ? { pid: row.owner_pid, startedAt: row.started_at, host: row.host } : null;
    },
  };

  // ── pipeline（管线三件套：Node pending_refresh / Python run_stage 各占其键——旧同文件互踩覆写构造性消失）──
  const pipeline = {
    stateGet(key) {
      const row = db.prepare("SELECT value_json FROM pipeline_state WHERE key = ?").get(key);
      return row ? parseJsonColumn(row.value_json) : undefined;
    },
    statePut(key, value) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO pipeline_state (key, value_json, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        ).run(key, JSON.stringify(value), now());
      });
    },
    stateDelete(key) {
      db.transaction(() => {
        db.prepare("DELETE FROM pipeline_state WHERE key = ?").run(key);
      });
    },
    /** 最新 run 摘要（新→旧序；无记录返回 null）。 */
    runsLatest() {
      const row = db.prepare("SELECT run_json FROM pipeline_runs ORDER BY seq DESC LIMIT 1").get();
      return row ? parseJsonColumn(row.run_json) : null;
    },
    /** 追加 run 摘要并保留最近 keep 条（默认 20，沿旧文件口径）。 */
    runsInsert(entry, keep = 20) {
      db.transaction(() => {
        db.prepare("INSERT INTO pipeline_runs (run_ts, run_json) VALUES (?, ?)")
          .run(String(entry.run_ts ?? ""), JSON.stringify(entry));
        db.prepare(
          "DELETE FROM pipeline_runs WHERE seq NOT IN (SELECT seq FROM pipeline_runs ORDER BY seq DESC LIMIT ?)",
        ).run(keep);
      });
    },
    versionGet() {
      const row = db.prepare("SELECT version_json FROM pipeline_version WHERE id = 1").get();
      return row ? parseJsonColumn(row.version_json) : undefined;
    },
    versionPut(version) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO pipeline_version (id, version_json, updated_at) VALUES (1, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET version_json = excluded.version_json, updated_at = excluded.updated_at",
        ).run(JSON.stringify(version), now());
      });
    },
  };

  // ── anomaly（工作台账：行级 upsert；writeLedger 全表替换语义由 replaceAll 承载）──
  const anomaly = {
    all() {
      const rows = db.prepare("SELECT issue_id, entry_json FROM anomaly_ledger").all();
      const out = {};
      for (const row of rows) {
        out[row.issue_id] = parseJsonColumn(row.entry_json);
      }
      return out;
    },
    get(issueId) {
      const row = db.prepare("SELECT entry_json FROM anomaly_ledger WHERE issue_id = ?").get(issueId);
      return row ? parseJsonColumn(row.entry_json) : undefined;
    },
    put(issueId, entry) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO anomaly_ledger (issue_id, status, display_seq, entry_json, updated_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(issue_id) DO UPDATE SET status = excluded.status, display_seq = excluded.display_seq, entry_json = excluded.entry_json, updated_at = excluded.updated_at",
        ).run(issueId, entry && entry.status ? String(entry.status) : null,
          entry && Number.isInteger(entry.displaySeq) ? entry.displaySeq : null,
          JSON.stringify(entry ?? null), now());
      });
    },
    /** 全表替换（单事务——旧 writeLedger 全量覆写语义的行级等价物）。 */
    replaceAll(ledger) {
      db.transaction(() => {
        db.prepare("DELETE FROM anomaly_ledger").run();
        const insert = db.prepare(
          "INSERT INTO anomaly_ledger (issue_id, status, display_seq, entry_json, updated_at) VALUES (?, ?, ?, ?, ?)");
        for (const [issueId, entry] of Object.entries(ledger || {})) {
          insert.run(issueId, entry && entry.status ? String(entry.status) : null,
            entry && Number.isInteger(entry.displaySeq) ? entry.displaySeq : null,
            JSON.stringify(entry ?? null), now());
        }
      });
    },
    delete(issueId) {
      db.transaction(() => {
        db.prepare("DELETE FROM anomaly_ledger WHERE issue_id = ?").run(issueId);
      });
    },
  };

  // ── 迁移记账（boot 一次性导入的幂等标记）──
  const migration = {
    imported(family) {
      return db.prepare("SELECT 1 AS x FROM runtime_migration WHERE family = ?").get(family) !== undefined;
    },
    markImported(family) {
      db.prepare("INSERT OR IGNORE INTO runtime_migration (family, imported_at) VALUES (?, ?)").run(family, now());
    },
    /** 水位读（F2 流水重放：imported_at 列存数值字符串；未登记返回 null）。 */
    getWatermark(family) {
      const row = db.prepare("SELECT imported_at FROM runtime_migration WHERE family = ?").get(family);
      return row ? row.imported_at : null;
    },
    /** 水位写（UPSERT）。 */
    markWatermark(family, value) {
      db.prepare(
        "INSERT INTO runtime_migration (family, imported_at) VALUES (?, ?) " +
        "ON CONFLICT(family) DO UPDATE SET imported_at = excluded.imported_at",
      ).run(family, String(value));
    },
  };

  const api = { approval, workflow, governance, review, actionApprovals, inference, expectations, locks, pipeline, anomaly, migration ,
    changes,
  };
  api.raw = api; // 裸句柄自指（journal 包装时经 .raw 取未包装面——重放专用，物理上不触发流水，SPEC-012 F2 修复批防回声）
  if (!journal) return api;
  // 包装可重放写方法（读方法与排除族直通）
  const wrapped = { ...api };
  // WP-052 T2：白名单单源——state-journal 导出（原两份手抄，假绿债根除）
  const REPLAYABLE_OPS = require("./state-journal.cjs").REPLAYABLE;
  for (const [family, ops] of Object.entries(REPLAYABLE_OPS)) {
    wrapped[family] = { ...api[family] };
    for (const op of ops) wrapped[family][op] = journaled(family, op);
  }
  return wrapped;
}

// ── 装配/取用两形态（沿 vault-io 先例：boot 显式 init；node:test 环境懒建内存库，生产缺 init 即 throw）──
let defaultStore = null;
const scopedStores = new Map(); // node:test 专用：scopeKey（vaultPath）→ 内存库——沿旧「每 tmp vault 一份文件」的隔离语义

function initRuntimeStateStore(db, options) {
  defaultStore = createRuntimeStateStore(db, options);
  return defaultStore;
}

/**
 * 取运行时状态 store。
 * @param {string} [scopeKey] 作用域键（vaultPath）——仅测试懒建形态生效：同键共享一库（＝旧同 vault 共享
 *   一文件），异键隔离（＝旧每 tmp vault 一文件）。生产装配后（initRuntimeStateStore）恒返全局实例，键被忽略。
 */
function getRuntimeStateStore(scopeKey) {
  if (defaultStore) return defaultStore;
  if (process.env.NODE_TEST_CONTEXT) {
    const key = typeof scopeKey === "string" && scopeKey ? scopeKey : "__global__";
    if (!scopedStores.has(key)) {
      const { openPersistenceDb } = require("./sqlite-adapter.cjs");
      scopedStores.set(key, createRuntimeStateStore(openPersistenceDb()));
    }
    return scopedStores.get(key);
  }
  throw Object.assign(
    new Error("runtime-state store 未初始化——生产装配必须先 initRuntimeStateStore（main.cjs boot）"),
    { code: "RUNTIME_STATE_NOT_INITIALIZED" },
  );
}

module.exports = {
  MIGRATIONS,
  createRuntimeStateStore,
  initRuntimeStateStore,
  getRuntimeStateStore,
};
