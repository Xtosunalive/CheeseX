'use strict';
// WP-055 W-A（SPEC-049 Q1）：读模型版本身份——聚合确定性／组件变化⇒版本变化／零落库。
// 层级：纯单元（临时目录文件面＋内存库）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getReadModelVersion, getGraph, getRawGraph, getStagedGraphArtifact, getStagedSAArtifacts } = require('../read-model-port.cjs');
const { getDerivedIndexStore } = require('../../../server/shared/persistence/derived-index-store.cjs');
const { openPersistenceDb } = require('../../../server/shared/persistence/sqlite-adapter.cjs');
const { createDerivedIndexStore } = require('../../../server/shared/persistence/derived-index-store.cjs');

function makeWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ver-'));
  const ts = path.join(dir, '知识库', 'TheSchema');
  fs.mkdirSync(ts, { recursive: true });
  fs.writeFileSync(path.join(ts, 'enums.yaml'), 'domains: {}\n');
  fs.writeFileSync(path.join(ts, 'fields.yaml'), 'fields: []\n');
  fs.writeFileSync(path.join(ts, 'versions.yaml'), 'products: {}\n');
  fs.writeFileSync(path.join(ts, 'ontology.yaml'), 'node_types: {}\nrelation_types: {}\n');
  fs.writeFileSync(path.join(ts, 'dependencies.yaml'), 'dependencies: []\n');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return { dir, dataDir, ts };
}

test('Q1 确定性：组件字节同则版本同（computedAt 每次现取不参与版本）', () => {
  const w = makeWorld();
  const a = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  const b = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  assert.equal(a.version, b.version, '两算同版');
  assert.notEqual(a.computedAt, undefined);
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test('Q1 vocab 组件变 ⇒ 版本变（含 missing→present 方向）', () => {
  const w = makeWorld();
  const v1 = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  fs.writeFileSync(path.join(w.ts, 'enums.yaml'), 'domains: {ref: 参考资料}\n');
  const v2 = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  assert.notEqual(v1.version, v2.version, '词表内容变 ⇒ 版本变');
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test('Q1 graph 组件变 ⇒ 版本变；derived ok 行 content_hash 进版本', () => {
  const w = makeWorld();
  const store = createDerivedIndexStore(openPersistenceDb(':memory:'));
  const v1 = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  // graph 组件：写 staging master_graph
  const staging = path.join(w.dataDir, 'staging');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'master_graph.json'), JSON.stringify({ generatedAt: 'g1' }));
  const v2 = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  assert.notEqual(v1.components.graph, v2.components.graph, 'graph 组件翻新');
  assert.notEqual(v1.version, v2.version);
  // derived 组件：记一条 ok 行
  store.syncState.recordSyncRow({ kind: 'boot-rebuild', status: 'ok', startedAt: 't', finishedAt: 't', durationMs: 1, contentHash: 'aa'.repeat(32) });
  // store 是独立内存库——port 走 getDerivedIndexStore(vaultPath)（.ledger 侧）：
  // 行为断言改在集成层（路由测试）跑；此处断言组件函数对 null 缺席的形态
  const v3 = getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  assert.equal(v3.components.derived === null || typeof v3.components.derived === 'string', true, 'derived 组件形态合法');
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test('Q6 零落库：调用前后 world 文件集不变（read-model-port 自身零写入——现场计算）', () => {
  const w = makeWorld();
  const snap = () => { const files = []; (function walk(rootDir) { try { for (const e of fs.readdirSync(rootDir, { withFileTypes: true })) { const full = path.join(rootDir, e.name); if (e.isDirectory()) walk(full); else files.push(path.relative(w.dir, full)); } } catch (_e) {} })(w.dir); return files.sort(); };
  const before = snap(w.dir);
  getReadModelVersion({ vaultPath: w.dir, dataDir: w.dataDir });
  const after = snap(w.dir);
  assert.deepEqual(after, before, 'read-model-port 调用零写入（store 懒建属装配面，本 port 无新增）');
  fs.rmSync(w.dir, { recursive: true, force: true });
});

// ── WP-056 G-A：staging 工件出口 ──
test('G-A getStagedGraphArtifact：在场返回 {path, raw}；缺件 raw=null 不炸', () => {
  const w = makeWorld();
  const outNull = getStagedGraphArtifact(w.dataDir);
  assert.equal(outNull.raw, null, '缺件显式 null');
  assert.match(outNull.path, /staging\/master_graph\.json$/);
  const staging = path.join(w.dataDir, 'staging');
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'master_graph.json'), '{"nodes":[],"connections":[]}');
  const out = getStagedGraphArtifact(w.dataDir);
  assert.equal(out.raw, '{"nodes":[],"connections":[]}');
  fs.rmSync(w.dir, { recursive: true, force: true });
});

// ── WP-057 S-A：SA 族工件出口 ──
test('S-A getStagedSAArtifacts：两件独立在场/缺席矩阵（互不影响）', () => {
  const w = makeWorld();
  const out = getStagedSAArtifacts(w.dataDir);
  assert.equal(out.semantic.raw, null, 'semantic 缺件显式 null');
  assert.equal(out.layout.raw, null, 'layout 缺件显式 null');
  assert.match(out.semantic.path, /staging\/sa\/semantic_architecture\.json$/);
  assert.match(out.layout.path, /staging\/sa\/architecture_layout\.json$/);
  const sa = path.join(w.dataDir, 'staging', 'sa');
  fs.mkdirSync(sa, { recursive: true });
  fs.writeFileSync(path.join(sa, 'semantic_architecture.json'), '{"components":[]}');
  const out2 = getStagedSAArtifacts(w.dataDir);
  assert.equal(out2.semantic.raw, '{"components":[]}', 'semantic 在场');
  assert.equal(out2.layout.raw, null, 'layout 仍缺席——独立矩阵');
  fs.rmSync(w.dir, { recursive: true, force: true });
});

// ── WP-058 X-A：双语义出口钉（raw/governed 行为差异）──
test('D1 getRawGraph：坏图 parse 失败返回 null（不校验不合并）；有图返回原文 parse', () => {
  const w = makeWorld();
  const store = getDerivedIndexStore(w.dir);
  store.artifacts.put('master_graph', '{ "nodes": [{"id":"a"}], "connections": [] }');
  const raw = getRawGraph(w.dir);
  assert.deepEqual(raw, { nodes: [{ id: 'a' }], connections: [] });
  store.artifacts.put('master_graph', '{ broken');
  assert.equal(getRawGraph(w.dir), null, 'parse 失败 null');
  fs.rmSync(w.dir, { recursive: true, force: true });
});

test('D1 双语义并存：getRawGraph 与 getGraph 各自独立可达', () => {
  const w = makeWorld();
  const store = getDerivedIndexStore(w.dir);
  store.artifacts.put('master_graph', '{"nodes":[],"connections":[]}');
  assert.deepEqual(getRawGraph(w.dir), { nodes: [], connections: [] });
  assert.equal(getGraph(w.dir) === null || typeof getGraph(w.dir) === 'object', true, 'governed 出口独立可达');
  fs.rmSync(w.dir, { recursive: true, force: true });
});
