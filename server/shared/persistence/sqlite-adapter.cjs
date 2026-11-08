// Component: Sqlite-Adapter
// @responsible: SPEC-012 持久层 SQLite 适配器——node:sqlite（DatabaseSync）的唯一取用点。
//   业务代码只见 store 接口不见 SQL；换引擎只动本层（分层契约「载体藏在 adapter 后，可换」的落点）。
// @inputs: 库文件路径（或 ":memory:"）＋迁移清单 [{ id, sql }]
// @outputs: openPersistenceDb() → { exec, prepare, transaction, applyMigrations, close, path }
// @context: data/ 目录（KB_DATA_DIR）
//
// 设计决策（SPEC-012 §二）：
// - 驱动＝Node 内置 node:sqlite（v24 实测；engines >=22.13），零新依赖零原生编译；
// - DatabaseSync 为同步 API——本机嵌入式调用，不属 PR-056 同步子进程禁令（管 child_process）；
// - WAL＋busy_timeout=5000＋synchronous=NORMAL：读写并发不互斥，跨进程（Node/Python）写安全；
// - 版本表 persistence_migrations 带 checksum（OpenMAIC pg-migrations 思想）：
//   已应用条目 checksum 与代码不一致→拒绝继续（防改动历史迁移）；代码缺已应用条目（旧代码读新格式）→拒绝继续；
// - transaction(fn)：BEGIN IMMEDIATE 立即取写锁（③类互斥的语义承载），异常 ROLLBACK 重抛，禁止嵌套。

"use strict";

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS persistence_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

function checksumOf(sql) {
  return "sha256:" + crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

/**
 * 打开持久层库。
 * @param {{ path?: string, migrations?: Array<{ id: string, sql: string }> }} [options]
 *   path 缺省 ":memory:"（单测）；migrations 按 id 升序幂等应用。
 * @returns 持久层句柄
 */
function openPersistenceDb(options) {
  const opts = options || {};
  const dbPath = opts.path || ":memory:";
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  db.exec(MIGRATIONS_TABLE_SQL);

  let inTransaction = false;

  /**
   * 事务包裹（BEGIN IMMEDIATE——立即持有写锁，阻塞期受 busy_timeout 约束）。
   * @template T
   * @param {() => T} fn 事务体（同步）
   * @returns {T} fn 返回值
   */
  function transaction(fn) {
    if (inTransaction) throw new Error("sqlite-adapter: 事务禁止嵌套（把复合操作放进同一事务体）");
    inTransaction = true;
    let started = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      started = true;
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (started) {
        try { db.exec("ROLLBACK"); } catch { /* 已回滚/连接失效——best-effort */ }
      }
      throw error;
    } finally {
      inTransaction = false;
    }
  }

  /**
   * 幂等应用迁移清单（带 checksum 守门）。
   * @throws {Error} code=PERSISTENCE_MIGRATION_CHECKSUM_MISMATCH（历史迁移被改）
   * @throws {Error} code=PERSISTENCE_MIGRATION_AHEAD（库内存在代码不认识的条目——旧代码读新格式）
   */
  function applyMigrations(migrations) {
    const list = [...(migrations || [])].sort((a, b) => a.id.localeCompare(b.id));
    const applied = new Map(db.prepare("SELECT id, checksum FROM persistence_migrations").all().map((row) => [row.id, row.checksum]));

    for (const migration of list) {
      const recorded = applied.get(migration.id);
      if (recorded !== undefined) {
        if (recorded !== checksumOf(migration.sql)) {
          throw Object.assign(
            new Error(`迁移 ${migration.id} 的 checksum 与已应用记录不一致——历史迁移不可修改（新增变更请追加新迁移）`),
            { code: "PERSISTENCE_MIGRATION_CHECKSUM_MISMATCH", id: migration.id },
          );
        }
        continue;
      }
      transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO persistence_migrations (id, checksum, applied_at) VALUES (?, ?, ?)")
          .run(migration.id, checksumOf(migration.sql), new Date().toISOString());
      });
    }

    // 版本超前守门：库里有代码不认识的条目＝旧代码读新格式
    const known = new Set(list.map((m) => m.id));
    const unknownExisting = [...applied.keys()].filter((id) => !known.has(id));
    if (unknownExisting.length > 0) {
      throw Object.assign(
        new Error(`库版本超前：存在代码不认识的迁移条目 [${unknownExisting.join(", ")}]——先升级代码再打开此库`),
        { code: "PERSISTENCE_MIGRATION_AHEAD", ids: unknownExisting },
      );
    }
  }

  return {
    path: dbPath,
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    transaction,
    applyMigrations,
    close: () => db.close(),
  };
}

// 跨进程同库（Python 管线直写）可能以 BLOB 绑定写 JSON 文本（2026-10-29 生产事故：
// workflow_state.state_json 被写成 BLOB——内容合法但存储类型错，读侧 JSON.parse(Uint8Array)
// 强转成 "123,34,…" 字节值逗号串，position 3 炸 500 全线文章工作流不可用）。
// 各 store 读侧统一走本助手：BLOB/Buffer 按 UTF-8 解码后再 parse；字符串直通。
function parseJsonColumn(value) {
  const text = value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : value;
  return JSON.parse(text);
}

module.exports = { openPersistenceDb, parseJsonColumn };
