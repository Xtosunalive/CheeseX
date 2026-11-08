// Component: Derived-Index-Store
// @responsible: SPEC-012 wave-2 ②类派生索引唯一持久层——derived-index.db 的 store 接口与迁移属主。
//   库级版本表单一属主：enums_projection/sync_state（WP-C 骨架）与 article_manifests（wave-2 首家族）
//   的迁移集中于此，业务/同步器代码各带迁移清单会触发 PERSISTENCE_MIGRATION_AHEAD。
// @inputs: persistence 句柄（sqlite-adapter）
// @outputs: createDerivedIndexStore(db) → 分域 API；initDerivedIndexStore/getDerivedIndexStore（装配/取用两形态）
// @context: data/derived-index.db（②类可丢弃——删库零损失，boot 重建/manifest rebuild 即恢复）

"use strict";
const { assertRowShape } = require("./row-schema-guard.cjs"); // PR-111
const { parseJsonColumn } = require("./sqlite-adapter.cjs"); // 读侧 BLOB 容错（2026-10-29 事故）

const { createHash } = require("node:crypto");

// 迁移 0001 自 derived-index-synchronizer.cjs 逐字拷贝（checksum 守门：已应用库不许差一字节）
const MIGRATIONS = [
  {
    id: "0001-enums-projection",
    sql: `
      CREATE TABLE enums_projection (
        section TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        content_hash TEXT,
        detail TEXT
      );
    `,
  },
  {
    // SPEC-012 wave-2 首家族：article-manifests 目录树迁行级投影（key=去「知识库/」前缀的归一化源路径）
    id: "0002-article-manifests",
    sql: `
      CREATE TABLE IF NOT EXISTS article_manifests (
        manifest_key TEXT PRIMARY KEY,
        manifest_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // SPEC-012 wave-2 图族：master_graph/extract_manifest 原文行（字节精确——管线指纹 sha256 口径不变；
    // Python 侧写 data/staging，Node boot/管线完成钩摄取入库）
    id: "0003-graph-family",
    sql: `
      CREATE TABLE IF NOT EXISTS derived_artifacts (
        name TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // 图漂移自动刷新（2026-10-15 Master 裁「图族刷新收敛」）：源指纹基线等小 kv——
    // 派生层自治状态，随库可丢弃（丢失→下次基线重立，不损数据）
    id: "0004-derived-kv",
    sql: `
      CREATE TABLE IF NOT EXISTS derived_kv (
        kv_key TEXT PRIMARY KEY,
        kv_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
  },
  {
    // EDGE-RELATION-GOV-001（SPEC-026 §四）图族行级投影：master_graph blob 经 normalizeTopology
    // 投影为行级两表——source/target × relation_type 双向索引（出链/反链），可重建、删库零损失
    id: "0005-graph-projection",
    sql: `
      CREATE TABLE IF NOT EXISTS graph_nodes (
        node_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        category TEXT NOT NULL,
        labels_json TEXT NOT NULL,
        degree INTEGER NOT NULL DEFAULT 0,
        properties_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_category ON graph_nodes(category);

      CREATE TABLE IF NOT EXISTS edges (
        edge_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        source_file TEXT,
        line_number INTEGER,
        evidence_hash TEXT,
        review_status TEXT,
        properties_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);
    `,
  },
  {
    // PR-100/WP-008：edges 表外键落地——开库既有 PRAGMA foreign_keys=ON（sqlite-adapter.cjs:44）
    // 首次获得可执法约束。重建式迁移（SQLite 无 ALTER TABLE ADD CONSTRAINT）：先清存量悬空行
    // （②类派生可重建，清除零损失）→ 新表双 FK ON DELETE CASCADE → 搬运 → 换名 → 重建索引。
    // 投影层配单边跳过过滤（edge-projection-service，relations-source fail-open 先例），FK 为物理兜底。
    id: "0006-edges-foreign-keys",
    sql: `
      DELETE FROM edges WHERE source_id NOT IN (SELECT node_id FROM graph_nodes)
                       OR target_id NOT IN (SELECT node_id FROM graph_nodes);
      CREATE TABLE edges_fk (
        edge_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        source_file TEXT,
        line_number INTEGER,
        evidence_hash TEXT,
        review_status TEXT,
        properties_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES graph_nodes(node_id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES graph_nodes(node_id) ON DELETE CASCADE
      );
      INSERT INTO edges_fk (edge_id, source_id, target_id, relation_type, source_file, line_number, evidence_hash, review_status, properties_json, updated_at)
        SELECT edge_id, source_id, target_id, relation_type, source_file, line_number, evidence_hash, review_status, properties_json, updated_at FROM edges;
      DROP TABLE edges;
      ALTER TABLE edges_fk RENAME TO edges;
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation_type);
    `,
  },
  {
    // PR-104/WP-013（吸取清单①）：图族原文行字节锚——槽名主键之外落 sha256（与管线指纹同口径），
    // 写时由 artifacts.put 网关统一计算（所有写者免改）；存量行 NULL，随下次 boot 摄取覆写自然回填。
    id: "0007-derived-artifacts-content-hash",
    sql: `
      ALTER TABLE derived_artifacts ADD COLUMN content_hash TEXT;
    `,
  },
];

function createDerivedIndexStore(db) {
  db.applyMigrations(MIGRATIONS);
  const now = () => new Date().toISOString();

  // ── enums 投影（WP-C 试点家族：enums.yaml 各顶层节——synchronizer 三源管线经此读写）──
  const enumsProjection = {
    /** 全量替换（单事务；sections = { 顶层节: payload }）。 */
    replaceAll(sections) {
      db.transaction(() => {
        db.prepare("DELETE FROM enums_projection").run();
        const insert = db.prepare("INSERT INTO enums_projection (section, payload_json, updated_at) VALUES (?, ?, ?)");
        const ts = now();
        for (const [section, payload] of Object.entries(sections || {})) {
          insert.run(section, JSON.stringify(payload), ts);
        }
      });
    },
    list() {
      const rows = db.prepare("SELECT section, payload_json FROM enums_projection").all();
      const out = {};
      for (const row of rows) out[row.section] = parseJsonColumn(row.payload_json);
      return out;
    },
  };

  // ── sync_state（同步账：重建/增量每次一行；recordSyncRow 按 synchronizer 现用法给最小面）──
  const syncState = {
    recordSyncRow({ kind, status, startedAt, finishedAt, durationMs, contentHash = null, detail = null }) {
      db.prepare(
        "INSERT INTO sync_state (kind, status, started_at, finished_at, duration_ms, content_hash, detail) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(kind, status, startedAt, finishedAt, durationMs, contentHash, detail);
    },
    lastSync() {
      return db.prepare(
        "SELECT kind, status, started_at, finished_at, duration_ms, content_hash FROM sync_state ORDER BY id DESC LIMIT 1",
      ).get() || null;
    },
  };

  // ── article manifests（②类行级投影：manifest 整对象一行，key 穿越校验在 buildArticleManifestKey）──
  const articleManifests = {
    get(key) {
      const row = db.prepare("SELECT manifest_json FROM article_manifests WHERE manifest_key = ?").get(key);
      return row ? parseJsonColumn(row.manifest_json) : undefined;
    },
    put(key, manifest) {
      assertRowShape("articleManifest", manifest); // PR-111：行级形状守卫
      // 红队建议#8：key 参数与对象内 manifestKey 一致性（导入通道按文件名作 key、内容作对象，可分歧入库）
      if (manifest && manifest.manifestKey && manifest.manifestKey !== key) {
        const error = new Error(`manifestKey 不一致：参数 key=${key}，对象内=${manifest.manifestKey}`);
        error.code = "ROW_SCHEMA_VIOLATION"; error.status = 500;
        error.details = { rowShape: "articleManifest", instancePath: "/manifestKey", message: "key 参数与对象内 manifestKey 必须一致" };
        throw error;
      }
      db.transaction(() => {
        db.prepare(
          "INSERT INTO article_manifests (manifest_key, manifest_json, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(manifest_key) DO UPDATE SET manifest_json = excluded.manifest_json, updated_at = excluded.updated_at",
        ).run(key, JSON.stringify(manifest), now());
      });
    },
    delete(key) {
      db.transaction(() => {
        db.prepare("DELETE FROM article_manifests WHERE manifest_key = ?").run(key);
      });
    },
    /** 行集（key 升序；Release 物化/孤儿对账的读面）。 */
    list() {
      return db.prepare("SELECT manifest_key, manifest_json FROM article_manifests ORDER BY manifest_key").all()
        .map((row) => ({ key: row.manifest_key, manifest: parseJsonColumn(row.manifest_json) }));
    },
    count() {
      return db.prepare("SELECT COUNT(*) AS n FROM article_manifests").get().n;
    },
  };

  // ── 图族原文行（master_graph/extract_manifest——字节精确，sha256 与管线指纹同口径）──
  const artifacts = {
    get(name) {
      const row = db.prepare("SELECT content FROM derived_artifacts WHERE name = ?").get(name);
      return row ? row.content : undefined;
    },
    put(name, content) {
      const text = String(content);
      const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
      db.transaction(() => {
        db.prepare(
          "INSERT INTO derived_artifacts (name, content, content_hash, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(name) DO UPDATE SET content = excluded.content, content_hash = excluded.content_hash, updated_at = excluded.updated_at",
        ).run(name, text, contentHash, new Date().toISOString());
      });
    },
    /** 字节锚读面（PR-104）：sha256 hex；存量未覆写行为 null。 */
    hashOf(name) {
      const row = db.prepare("SELECT content_hash FROM derived_artifacts WHERE name = ?").get(name);
      return row ? (row.content_hash ?? null) : undefined;
    },
  };

  // ── 小 kv（图漂移刷新等派生层自治状态；非业务事实源，随库可丢弃重建）──
  const kv = {
    get(key) {
      const row = db.prepare("SELECT kv_value FROM derived_kv WHERE kv_key = ?").get(key);
      return row ? row.kv_value : null;
    },
    put(key, value) {
      db.prepare(
        "INSERT INTO derived_kv (kv_key, kv_value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(kv_key) DO UPDATE SET kv_value = excluded.kv_value, updated_at = excluded.updated_at",
      ).run(key, String(value), now());
    },
  };

  // ── graph projection（EDGE-RELATION-GOV-001 ②类行级投影：normalizeTopology 输出的持久化落位。
  //    store 被动无业务——「生成」在 edge-projection-service；④类查询逻辑（邻域 BFS 等）在 shared/edge-query，
  //    store 只提供行级读写面〔阶段 3 扩：方向查询走双向索引〕）──
  const EDGE_COLUMNS = "edge_id, source_id, target_id, relation_type, source_file, line_number, evidence_hash, review_status, properties_json";
  const mapEdgeRow = (row) => row && {
    edgeId: row.edge_id, sourceId: row.source_id, targetId: row.target_id, relationType: row.relation_type,
    sourceFile: row.source_file, lineNumber: row.line_number, evidenceHash: row.evidence_hash,
    reviewStatus: row.review_status, properties: parseJsonColumn(row.properties_json),
  };
  const graphProjection = {
    /** 全量替换（单事务；入参＝行形态，与 list 输出对称。normalizeTopology 拓扑形态→行形态的映射归
     *  edge-projection-service（topoToRows，立案 §6.4）——store 被动无业务，只认行级）。 */
    replaceAll(nodes, edges) {
      db.transaction(() => {
        // PR-100：先删子表（edges）后删父表（graph_nodes）——显式删序不依赖 FK 级联语义
        db.prepare("DELETE FROM edges").run();
        db.prepare("DELETE FROM graph_nodes").run();
        const ts = now();
        const insertNode = db.prepare(
          "INSERT INTO graph_nodes (node_id, label, category, labels_json, degree, properties_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );
        for (const n of nodes || []) {
          insertNode.run(n.nodeId, n.label, n.category, JSON.stringify(n.labels || []), n.degree ?? 0, JSON.stringify(n.properties || {}), ts);
        }
        const insertEdge = db.prepare(
          "INSERT INTO edges (edge_id, source_id, target_id, relation_type, source_file, line_number, evidence_hash, review_status, properties_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const e of edges || []) {
          insertEdge.run(e.edgeId, e.sourceId, e.targetId, e.relationType, e.sourceFile ?? null, e.lineNumber ?? null, e.evidenceHash ?? null, e.reviewStatus ?? null, JSON.stringify(e.properties || {}), ts);
        }
      });
    },
    listNodes() {
      return db.prepare("SELECT node_id, label, category, labels_json, degree, properties_json FROM graph_nodes ORDER BY node_id").all()
        .map((row) => ({ nodeId: row.node_id, label: row.label, category: row.category, labels: parseJsonColumn(row.labels_json), degree: row.degree, properties: parseJsonColumn(row.properties_json) }));
    },
    /** 节点 id 投影（PR-102）：装配方直接取 id 列表，不在调用点手工映射行字段名。 */
    listNodeIds() {
      return db.prepare("SELECT node_id FROM graph_nodes ORDER BY node_id").all().map((row) => row.node_id);
    },
    listEdges() {
      return db.prepare(`SELECT ${EDGE_COLUMNS} FROM edges ORDER BY edge_id`).all().map(mapEdgeRow);
    },
    getEdge(edgeId) {
      return mapEdgeRow(db.prepare(`SELECT ${EDGE_COLUMNS} FROM edges WHERE edge_id = ?`).get(edgeId)) ?? undefined;
    },
    getNode(nodeId) {
      const row = db.prepare("SELECT node_id, label, category, labels_json, degree, properties_json FROM graph_nodes WHERE node_id = ?").get(nodeId);
      return row ? { nodeId: row.node_id, label: row.label, category: row.category, labels: parseJsonColumn(row.labels_json), degree: row.degree, properties: parseJsonColumn(row.properties_json) } : undefined;
    },
    /** 出链（走 idx_edges_source；relationType 可选过滤）。 */
    edgesFrom(nodeId, { relationType = null, limit = 100 } = {}) {
      const sql = relationType === null
        ? `SELECT ${EDGE_COLUMNS} FROM edges WHERE source_id = ? ORDER BY edge_id LIMIT ?`
        : `SELECT ${EDGE_COLUMNS} FROM edges WHERE source_id = ? AND relation_type = ? ORDER BY edge_id LIMIT ?`;
      const args = relationType === null ? [nodeId, limit] : [nodeId, relationType, limit];
      return db.prepare(sql).all(...args).map(mapEdgeRow);
    },
    /** 反链（走 idx_edges_target；relationType 可选过滤）。 */
    edgesTo(nodeId, { relationType = null, limit = 100 } = {}) {
      const sql = relationType === null
        ? `SELECT ${EDGE_COLUMNS} FROM edges WHERE target_id = ? ORDER BY edge_id LIMIT ?`
        : `SELECT ${EDGE_COLUMNS} FROM edges WHERE target_id = ? AND relation_type = ? ORDER BY edge_id LIMIT ?`;
      const args = relationType === null ? [nodeId, limit] : [nodeId, relationType, limit];
      return db.prepare(sql).all(...args).map(mapEdgeRow);
    },
    countNodes() {
      return db.prepare("SELECT COUNT(*) AS n FROM graph_nodes").get().n;
    },
    countEdges() {
      return db.prepare("SELECT COUNT(*) AS n FROM edges").get().n;
    },
  };

  return { enumsProjection, syncState, articleManifests, artifacts, kv, graphProjection };
}

// ── 装配/取用两形态（沿 runtime-state-store 先例：boot 显式 init；node:test 环境按 scopeKey
//   懒建内存库——同键共享一库＝旧同 vault 一棵目录树，异键隔离＝旧每 tmp vault 一棵树；生产缺 init 即 throw）──
let defaultStore = null;
const scopedStores = new Map();

function initDerivedIndexStore(db) {
  defaultStore = createDerivedIndexStore(db);
  return defaultStore;
}

/**
 * 取派生索引 store。
 * @param {string} [scopeKey] 作用域键（vaultPath/快照 root）——仅测试懒建形态生效。生产装配后
 *   （initDerivedIndexStore）恒返全局实例，键被忽略（Release 物化点传快照 root 同此语义）。
 */
function getDerivedIndexStore(scopeKey) {
  if (defaultStore) return defaultStore;
  if (process.env.NODE_TEST_CONTEXT) {
    const key = typeof scopeKey === "string" && scopeKey ? scopeKey : "__global__";
    if (!scopedStores.has(key)) {
      const { openPersistenceDb } = require("./sqlite-adapter.cjs");
      scopedStores.set(key, createDerivedIndexStore(openPersistenceDb()));
    }
    return scopedStores.get(key);
  }
  throw Object.assign(
    new Error("derived-index store 未初始化——生产装配必须先 initDerivedIndexStore（main.cjs boot）"),
    { code: "DERIVED_INDEX_NOT_INITIALIZED" },
  );
}

module.exports = {
  MIGRATIONS,
  createDerivedIndexStore,
  initDerivedIndexStore,
  getDerivedIndexStore,
};
