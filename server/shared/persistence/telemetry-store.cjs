// Component: Telemetry-Store
// @responsible: SPEC-012 WP-B ④类观测痕迹唯一持久层——telemetry.db（尽力而为遥测，迁出被观测域）。
//   观测痕迹写不再落 vault .ledger/health/（PR-055 观测自指的构造性解）。
// @inputs: 各观测写入方（watcher frontmatter 校验 / reconcile 漂移与心跳 / enums 形态痕迹）
// @outputs: createTelemetryStore(db)；initTelemetryStore/getTelemetryStore（装配/取用，同 runtime-state 两形态）
// @context: data/telemetry.db（可丢弃——④类从①派生面看齐：痕迹是遥测非事实源，删库只失历史痕迹）
//
// 语义（SPEC §二/§四.4）：
// - recordTrace 尽力而为：写失败只返回 false 不抛（遥测不得阻断主链路）；
// - reconcile 每轮记 heartbeat（reconcile-run），/api/health 从库读 lastReconcileAt，
//   超 2×周期未更新 → reconcileStale（SPEC-011 WP4 语义在库形态下的兑现）。

"use strict";

const MIGRATIONS = [
  {
    id: "0001-telemetry",
    sql: `
      CREATE TABLE IF NOT EXISTS telemetry_traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_kind_time ON telemetry_traces (kind, id DESC);
    `,
  },
];

// 已登记痕迹种类（新种类在此登记；readers: /api/health、状态页）
const TRACE_KINDS = {
  FRONTMATTER_CHECK: "frontmatter-check",
  VAULT_DRIFT: "vault-drift",
  ENUMS_NORMALIZATION: "enums-normalization",
  RECONCILE_RUN: "reconcile-run",
  // SPEC-025 C2（W1b）：管线触发与执行事件——readers=/api/health、状态页
  PIPELINE_DUE: "pipeline-due",
  PIPELINE_RUN: "pipeline-run",
  // PR-109 缺口①：TheSchema 校验器 boot 自检——readers=latestTrace（自检结论含活性/数据违例计数）
  SCHEMA_SELFCHECK: "schema-selfcheck-run",
  // WP-027（PR-142）：schema 图输入写→图谱自动跟随调度事件（notified/skip-fresh/run-triggered/run-failed）——readers=/api/health 同族
  SCHEMA_GRAPH_REFRESH: "schema-graph-refresh",
  // WP-097（PR-234）：图谱抽取质量 eval 评分摘要——测量仪痕迹（只测不拦），readers=eval 报告
  GRAPH_EVAL: "graph-eval-run",
};

function createTelemetryStore(db) {
  db.applyMigrations(MIGRATIONS);

  /**
   * 记一笔观测痕迹（尽力而为——失败返回 false，不抛、不阻断主链路）。
   * @returns {boolean} 是否落库成功
   */
  function recordTrace(kind, payload) {
    try {
      db.prepare("INSERT INTO telemetry_traces (kind, payload_json, recorded_at) VALUES (?, ?, ?)")
        .run(kind, JSON.stringify(payload ?? null), new Date().toISOString());
      return true;
    } catch {
      return false; // 遥测写失败静默降级（SPEC §二 fail-open 对④类）
    }
  }

  /** 某类最新一笔（无则 null）。 */
  function latestTrace(kind) {
    const row = db.prepare("SELECT payload_json, recorded_at FROM telemetry_traces WHERE kind = ? ORDER BY id DESC LIMIT 1").get(kind);
    if (!row) return null;
    return { payload: JSON.parse(row.payload_json), recordedAt: row.recorded_at };
  }

  /** 某类最近 limit 笔（新→旧）。 */
  function listTraces(kind, limit = 20) {
    return db.prepare("SELECT payload_json, recorded_at FROM telemetry_traces WHERE kind = ? ORDER BY id DESC LIMIT ?")
      .all(kind, limit)
      .map((row) => ({ payload: JSON.parse(row.payload_json), recordedAt: row.recorded_at }));
  }

  return { recordTrace, latestTrace, listTraces };
}

// ── 装配/取用两形态（与 runtime-state-store 同款：boot init；node:test 懒建内存库按作用域隔离）──
let defaultStore = null;
const scopedStores = new Map();

function initTelemetryStore(db) {
  defaultStore = createTelemetryStore(db);
  return defaultStore;
}

function getTelemetryStore(scopeKey) {
  if (defaultStore) return defaultStore;
  if (process.env.NODE_TEST_CONTEXT) {
    const key = typeof scopeKey === "string" && scopeKey ? scopeKey : "__global__";
    if (!scopedStores.has(key)) {
      const { openPersistenceDb } = require("./sqlite-adapter.cjs");
      scopedStores.set(key, createTelemetryStore(openPersistenceDb()));
    }
    return scopedStores.get(key);
  }
  throw Object.assign(
    new Error("telemetry store 未初始化——生产装配必须先 initTelemetryStore（main.cjs boot）"),
    { code: "TELEMETRY_NOT_INITIALIZED" },
  );
}

module.exports = { MIGRATIONS, TRACE_KINDS, createTelemetryStore, initTelemetryStore, getTelemetryStore };
