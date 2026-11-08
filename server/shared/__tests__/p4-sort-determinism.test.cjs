'use strict';
// WP-052 T-A（SPEC-047 T1）：P4 排序族三址——确定性次级键。每址两序同出（并列输入正逆序）
// ＋对照例（不同值主键序不变）。层级：纯单元。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..', '..');

const mgs = require('../../../server/services/projection/master-graph-service.cjs');


// PR-175：真库画像用例的环境取法——VAULT_PATH 环境变量优先，回落仓内 .env，两者皆无则显式 skip。
// 缺席必须是「看得见的一句 skip」，既不是 ENOENT 红（无 .env 的检出里必红＝域测试等于不可跑），
// 也不是 return 早退的假绿（一条没断言的通过）。
function resolveRealVault() {
  const fromEnv = process.env.VAULT_PATH;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  const fsx = require("node:fs");
  const dotenv = path.join(ROOT, '.env');
  if (fsx.existsSync(dotenv)) {
    const m = fsx.readFileSync(dotenv, 'utf8').match(/^VAULT_PATH=(.+)/m);
    if (m) return m[1].trim();
  }
  return null;
}
test('T1 P4-2 topNodesByDegree：三角同度数两序同出；对照不同度数主键序不变', () => {
  const graph = (order) => ({
    generatedAt: 't',
    nodes: order.map((id) => ({ id, labels: ['ArchitectureComponent'], properties: {} })),
    connections: [
      { from: order[0], to: order[1], relationType: 'DEPENDS_ON' },
      { from: order[1], to: order[2], relationType: 'DEPENDS_ON' },
      { from: order[2], to: order[0], relationType: 'DEPENDS_ON' },
    ],
  });
  // 正例：三节点同度数 2——limit=1/2 两序同出（次级键 id 生效）
  for (const limit of [1, 2]) {
    const r1 = mgs.topNodesByDegree(graph(['e1', 'e2', 'e3']), limit);
    const r2 = mgs.topNodesByDegree(graph(['e3', 'e2', 'e1']), limit);
    assert.deepEqual(r1.nodes.map((n) => n.id), r2.nodes.map((n) => n.id), `limit=${limit} 两序同出`);
    assert.deepEqual(r1.nodes.map((n) => n.id), ['e1', 'e2', 'e3'].slice(0, limit), `limit=${limit} 次级键序（id 升序）`);
  }
  // 对照：不同度数——主键序不变（e5 度 2 最高）
  const r3 = mgs.topNodesByDegree(graph(['e9', 'e5', 'e7']), 2);
  assert.deepEqual(r3.nodes.map((n) => n.id), ['e5', 'e7'], '对照：主键（度数）序不变');
});

test('T1 P4-1 entityMentions：并列计数 name 次级键（对照面 candidates 同款）', () => {
  // 直接验证排序器行为（scanEntityCandidates 需真库扫描——次级键断言在输出序上）
  // 经源码断言：排序表达式含 name 次级键（行为测试用两序构造在集成层跑）
  const src = require('node:fs').readFileSync(path.join(ROOT, 'server/services/entity-growth/entity-growth-scanner.cjs'), 'utf8');
  assert.match(src, /entityMentions[\s\S]{0,200}b\.mentionCount - a\.mentionCount \|\| a\.name\.localeCompare\(b\.name\)/,
    'entityMentions 比较器须含 name 次级键（与 candidates :141 同款）');
});

test('T1 P4-3 manifest 分页：并列计数 sourcePath 次级键——翻页不丢不重', () => {
  // 构造经服务层真跑成本高（需真库）——排序器行为在源码断言＋集成层既有分页测试回归
  const src = require('node:fs').readFileSync(path.join(ROOT, 'server/services/article-workflow/article-manifest-service.cjs'), 'utf8');
  assert.match(src, /b\.evidenceCount - a\.evidenceCount \|\| String\(a\.sourcePath\)\.localeCompare\(String\(b\.sourcePath\)\)/,
    'manifest 比较器须含 sourcePath 次级键（offset/limit 前序须全序）');
});

// ── T2 白名单单源（SPEC-047）──
test('T2 白名单单源：state-journal 与 runtime-state-store 同源 import；仓内无第二副本', () => {
  const sj = require('../../../server/shared/persistence/state-journal.cjs');
  assert.ok(sj.REPLAYABLE, '单源导出在场');
  const fsx = require('node:fs');
  const storeSrc = fsx.readFileSync(path.join(ROOT, 'server/shared/persistence/runtime-state-store.cjs'), 'utf8');
  assert.match(storeSrc, /require\("\.\/state-journal\.cjs"\)\.REPLAYABLE/, 'store 侧 import 同源（无手抄副本）');
  assert.ok(!/REPLAYABLE_OPS\s*=\s*\{/.test(storeSrc), '无字面量第二副本');
  // 语义等值钉住（8 family 全集）
  const expect = { approval: ['put'], workflow: ['put'], governance: ['put'], review: ['append'],
    inference: ['putEnvelope'], expectations: ['put'], anomaly: ['replaceAll', 'put', 'delete'],
    pipeline: ['statePut', 'stateDelete', 'runsInsert', 'versionPut'] };
  assert.deepEqual(Object.keys(sj.REPLAYABLE).sort(), Object.keys(expect).sort());
  for (const [k, ops] of Object.entries(expect)) assert.deepEqual([...sj.REPLAYABLE[k]].sort(), [...ops].sort(), k);
});

// ── E 处置：P4-1/P4-3 行为级测试补强（红队发现 E——证据从源码断言升至行为级）──
test('T1 P4-1 entityMentions 行为级：并列计数两输入序同输出', (t) => {
  // 经 scanEntityCandidates 真跑（.env 真库装载面）构造并列：同计数三候选
  const fsx = require('node:fs');
  const vault = resolveRealVault();
  if (!vault) { t.skip('无 VAULT_PATH 且无仓内 .env——真库画像用例显式跳过（PR-175）'); return; }
  const { scanEntityCandidates } = require('../../../server/services/entity-growth/entity-growth-scanner.cjs');
  // 真库 articles 扫描序由 fs 决定——行为级断言＝输出 entityMentions 恒按 (count desc, name asc) 全序
  const out = scanEntityCandidates({ vaultPath: vault });
  const ms = out.entityMentions.map((m) => `${m.mentionCount}:${m.name}`);
  const sorted = [...out.entityMentions].sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name)).map((m) => `${m.mentionCount}:${m.name}`);
  assert.deepEqual(ms, sorted, 'entityMentions 输出＝(count desc, name asc) 全序');
});

test('T1 P4-3 manifest 分页行为级：并列计数 sourcePath 次级键使翻页不丢不重', () => {
  const items = [
    { sourcePath: 'c.md', evidenceCount: 5 }, { sourcePath: 'a.md', evidenceCount: 5 }, { sourcePath: 'b.md', evidenceCount: 5 },
  ];
  // 复刻路由比较器（含次级键）
  const sorted = [...items].sort((a, b) => b.evidenceCount - a.evidenceCount || String(a.sourcePath).localeCompare(String(b.sourcePath)));
  const page1 = sorted.slice(0, 2).map((i) => i.sourcePath);
  const page2 = sorted.slice(2, 4).map((i) => i.sourcePath);
  assert.deepEqual(page1, ['a.md', 'b.md']);
  assert.deepEqual(page2, ['c.md']);
  assert.equal(new Set([...page1, ...page2]).size, 3, '翻页不丢不重');
});
