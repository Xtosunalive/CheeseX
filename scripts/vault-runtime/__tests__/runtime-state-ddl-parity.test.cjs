'use strict';
// PR-165：兑现 _runtime_state_db.py 头注承诺的 py↔node DDL 镜像对账——
// Python 侧 _DDL 与 server/shared/persistence/runtime-state-store.cjs 迁移 SQL
// 归一空白后逐语句比对，双侧漂移即红。层级：纯单元（文本对账），不建库、不起服务。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PY = path.join(ROOT, 'scripts', 'vault-runtime', '_runtime_state_db.py');
const CJS = path.join(ROOT, 'server', 'shared', 'persistence', 'runtime-state-store.cjs');

function normalizeStatements(sqlText) {
  return new Set(
    sqlText
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
}

test('runtime-state DDL 镜像对账：Python _DDL ≡ Node 迁移 SQL（逐语句、归一空白）', () => {
  const pySrc = fs.readFileSync(PY, 'utf8');
  const ddlMatch = pySrc.match(/_DDL = """([\s\S]*?)"""/);
  assert.ok(ddlMatch, '_runtime_state_db.py 必须保留 _DDL 定义（解析面失效即红）');
  const pyStmts = normalizeStatements(ddlMatch[1]);

  const cjsSrc = fs.readFileSync(CJS, 'utf8');
  // 镜像纪律锁「0002-pipeline 族」：只取含 pipeline 三表的迁移块（0001/0003~0005 各族
  // （runtime_migration、anomaly 等）不属 Python 自举镜像范围——手工 CLI 先于 server 起跑
  // 时需要自建的只有 pipeline 族）。
  const PIPELINE_TABLES = ['pipeline_state', 'pipeline_runs', 'pipeline_version'];
  const cjsStmts = new Set();
  for (const m of cjsSrc.matchAll(/sql:\s*`([^`]+)`/g)) {
    if (PIPELINE_TABLES.some((t) => m[1].includes(t))) {
      for (const s of normalizeStatements(m[1])) cjsStmts.add(s);
    }
  }
  assert.ok(cjsStmts.size >= 3, '0002-pipeline 族迁移至少含三建表语句');

  assert.deepEqual([...pyStmts].sort(), [...cjsStmts].sort(), '双侧 DDL 语句集必须一致（漂移即红）');
  for (const table of PIPELINE_TABLES) {
    assert.ok([...pyStmts].some((s) => s.includes(`CREATE TABLE IF NOT EXISTS ${table}`)), `缺 ${table} 建表语句`);
  }
});
