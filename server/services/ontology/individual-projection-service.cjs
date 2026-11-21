// Component: Individual-Projection-Service（WP-209／SPEC-100 批 3·交付物③存储投影派生）
// @responsible: 个体存储投影——storageFields（类绑定：字段名/必填/类型）→ 每类投影表自动 DDL
//   （individuals_<class>：individual_id/title/lifecycle_status/created/updated＋字段列＋fields_json）
//   ＋索引（lifecycle_status/updated）＋同步（create/update/retire 后 upsert）＋rebuildAll
//   （删库重建语义——投影可丢弃，删库零损失）。新字段＝ALTER ADD COLUMN（加列式，重建先例同源）。
// @inputs: derived-index.db 裸句柄（main 装配传 derivedIndexDb；测试注入 :memory:）＋类绑定端口
//          （同 individual-crud-service——resolveClassInheritance 现读）＋个体目录扫描（vault 相对路径）
// @outputs: ensureSchema／upsert／markRetired／removeRow／rebuildAll——crud 投影端口与 boot 调用
// @context: 派生层可丢弃（终验 3）——本服务全部产物删库可重建；fail-open：投影失败 warn 不阻断
//   个体主写（主链路＝markdown 事实源，投影只是加速面）。列类型 MVP＝TEXT/NUMERIC 两档（精细化另批）。
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const YAML = require("yaml");
const { INDIVIDUALS_ROOT } = require("./individual-crud-service.cjs");

const TYPE_MAP = {
  integer: "NUMERIC", "unsigned integer": "NUMERIC", float: "NUMERIC", decimal: "NUMERIC", boolean: "NUMERIC",
};

function sanitizeIdent(name) {
  const cleaned = String(name || "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 56);
  return cleaned || "col";
}

function createIndividualProjectionService({ vaultPath, db, logger, bindingsResolver } = {}) {
  if (!vaultPath) throw new TypeError("[individual-projection] 需要 vaultPath");
  if (!db) throw new TypeError("[individual-projection] 需要 derived-index.db 句柄");
  const log = logger || { info() {}, warn() {}, error() {} };
  const individualsRoot = path.join(vaultPath, INDIVIDUALS_ROOT);

  function tableName(classId) {
    return `individuals_${sanitizeIdent(classId)}`;
  }

  /** storageFields 派生（类绑定→投影列描述）。类型映射 MVP：数值/布尔→NUMERIC，余 TEXT。 */
  function storageFieldsOf(classId) {
    const resolved = bindingsResolver(classId);
    const props = (resolved && resolved.data_properties) || {};
    return Object.entries(props).map(([fieldName, def]) => ({
      name: fieldName,
      required: Boolean(def && def.binding && def.binding.required === true),
      type: TYPE_MAP[String((def && def.type) || "").toLowerCase()] || "TEXT",
    }));
  }

  /** 自动 DDL：建表（若缺）＋新字段加列（ALTER ADD COLUMN）＋索引。幂等。 */
  function ensureSchema(classId) {
    const table = tableName(classId);
    const fields = storageFieldsOf(classId);
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      individual_id TEXT PRIMARY KEY,
      title TEXT,
      lifecycle_status TEXT NOT NULL DEFAULT 'active',
      created TEXT,
      updated TEXT,
      fields_json TEXT NOT NULL
    )`);
    const existing = new Set();
    for (const row of db.prepare(`PRAGMA table_info(${table})`).all()) existing.add(row.name);
    for (const field of fields) {
      const col = `f_${sanitizeIdent(field.name)}`;
      if (!existing.has(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${field.type}`);
        existing.add(col);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_lifecycle ON ${table}(lifecycle_status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_updated ON ${table}(updated)`);
    return { table, columns: fields.map((f) => `f_${sanitizeIdent(f.name)}`) };
  }

  function upsert(classId, fm) {
    ensureSchema(classId);
    const table = tableName(classId);
    const fields = storageFieldsOf(classId);
    const values = {
      individual_id: fm.individual_id,
      title: fm.title || "",
      lifecycle_status: fm.lifecycle_status || "active",
      created: fm.created || null,
      updated: fm.updated || null,
      fields_json: JSON.stringify(fm),
    };
    for (const field of fields) {
      values[`f_${sanitizeIdent(field.name)}`] = fm[field.name] === undefined ? null : fm[field.name];
    }
    const cols = ["individual_id", "title", "lifecycle_status", "created", "updated", "fields_json", ...fields.map((f) => `f_${sanitizeIdent(f.name)}`)];
    const colList = cols.join(", ");
    const marks = cols.map(() => "?").join(", ");
    // 标识符经 sanitizeIdent 净化，值全参数化（无拼接注入面）
    db.prepare(`INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${marks})`).run(...cols.map((c) => values[c]));
  }

  function markRetired(classId, individualId, updatedAt) {
    const table = tableName(classId);
    ensureSchema(classId);
    db.prepare(`UPDATE ${table} SET lifecycle_status = 'retired', updated = ? WHERE individual_id = ?`).run(updatedAt || new Date().toISOString(), individualId);
  }

  /** 重建（删库重建语义）：按文件系统真值全量重灌 + 剪除幽灵行（文件已删的残留行）。 */
  function rebuildAll() {
    const fsRoot = individualsRoot;
    if (!fs.existsSync(fsRoot)) return { classes: 0, rows: 0 };
    let classes = 0;
    let rows = 0;
    for (const classId of fs.readdirSync(fsRoot)) {
      const dir = path.join(fsRoot, classId);
      if (!fs.statSync(dir).isDirectory()) continue;
      const table = tableName(classId);
      ensureSchema(classId);
      classes += 1;
      const seen = new Set();
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".md")) continue;
        try {
          const raw = fs.readFileSync(path.join(dir, name), "utf8");
          const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
          const fm = match ? (YAML.parse(match[1]) || {}) : {};
          if (!fm.individual_id) continue;
          upsert(classId, fm);
          seen.add(fm.individual_id);
          rows += 1;
        } catch (error) {
          log.warn({ event: "individual-projection-skip", classId, file: name, error: String(error.message).slice(0, 120) });
        }
      }
      // 剪幽灵行：文件已删的残留行（dead-row 家族——PR-336 语义的投影侧对账）
      const live = db.prepare(`SELECT individual_id FROM ${table}`).all().map((r) => r.individual_id);
      for (const id of live) {
        if (!seen.has(id)) db.prepare(`DELETE FROM ${table} WHERE individual_id = ?`).run(id);
      }
    }
    // WP-213（红队 R1 补口）：类目录已删的整表孤儿——individuals_* 表逐表对账，
    // 目录不存在即整表剪除（投影可丢弃语义，重建由 ensureSchema 按需再生）。
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'individuals_%'").all()) {
      const cls = row.name.replace(/^individuals_/, "");
      if (!fs.existsSync(path.join(fsRoot, cls))) {
        db.exec(`DROP TABLE IF EXISTS ${row.name}`); // 整表剪除（投影可丢弃；类回归时 ensureSchema 按需再生）
        log.info({ event: "individual-projection-orphan-table-pruned", table: row.name });
      }
    }
    if (log) log.info({ event: "individual-projection-rebuilt", classes, rows });
    return { classes, rows };
  }

  return { ensureSchema, upsert, markRetired, removeRow: (classId, individualId) => { db.prepare(`DELETE FROM ${tableName(classId)} WHERE individual_id = ?`).run(individualId); }, rebuildAll, storageFieldsOf, tableName };
}

module.exports = { createIndividualProjectionService, sanitizeIdent, TYPE_MAP };
