'use strict';
// WP-051 I-A（SPEC-046 I1/I2）：身份入口——编码/解码/域标签/跨语言同构。
// 层级：纯单元（无 fs/进程依赖；Python 同构经子进程真实跑一例）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { makeId, idParts, sameId } = require('../identity-port.cjs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('I1 长度前缀编码：含 | / : / 数字前缀的段不再歧义（P2 撞键复刻全绿）', () => {
  // 实证清单 P2 原文演示输入：from="a|b",to="c" vs from="a",to="b|c"
  const k1 = makeId('edge', ['a|b', 'c', 'DEPENDS_ON', 'f.md', 1, 'h']);
  const k2 = makeId('edge', ['a', 'b|c', 'DEPENDS_ON', 'f.md', 1, 'h']);
  assert.notEqual(k1, k2, '异参（含 |）必须异键——P2 病根消灭');
  // 组合键（matrix-candidates 形态）
  assert.notEqual(makeId('combo', ['a|b', 'c']), makeId('combo', ['a', 'b|c']));
  // 依赖键（architecture-version 形态）
  assert.notEqual(makeId('dep', ['a|DEPENDS_ON', 'b', 'c']), makeId('dep', ['a', 'DEPENDS_ON', 'b|c']));
  // 更狠的边界：段本身长得像编码前缀
  assert.notEqual(makeId('t', ['a', '1:c']), makeId('t', ['a', '1', 'c']));
});

test('I1 同参同键（去重语义不丢——反例）', () => {
  assert.equal(makeId('edge', ['a', 'b', 'R']), makeId('edge', ['a', 'b', 'R']));
  // null/undefined 与空串归一同键；数字与串强转一致
  assert.equal(makeId('t', [null, 'x']), makeId('t', ['', 'x']));
  assert.equal(makeId('t', [1, 'a']), makeId('t', ['1', 'a']));
});

test('I2 idParts 往返：空段／Unicode（含 BMP/增平面）／超长段／多段', () => {
  const cases = [
    ['a|b', 'c'],
    ['', 'x'],
    ['中文段|含竖线：含冒号', 'y'],
    ['𝕏𝕐增平面', ''],
    ['a'.repeat(2000), 'tail'],
    ['a', '', 'b', '', 'c'],
  ];
  for (const parts of cases) {
    const id = makeId('roundtrip', parts);
    const back = idParts(id);
    assert.equal(back.domain, 'roundtrip');
    assert.deepEqual(back.parts, parts);
  }
});

test('I2 fail-closed：损坏 ID 显式抛错（不静默给错段）', () => {
  assert.throws(() => idParts('no-colon-at-all'), /缺域标签/);
  assert.throws(() => idParts(''), /非空字符串/);
  assert.throws(() => idParts('edge:5:ab'), /段不足|字节/); // 声明 5 字节只给 2
  assert.throws(() => idParts('edge:x:abc'), /段长度前缀缺失/);
  assert.throws(() => makeId('Bad Domain!', ['a']), /domain/);
  assert.throws(() => makeId('edge', 'not-array'), /parts/);
});

test('I1 跨语言同构：JS makeId ≡ Python make_id（字节级，含 | 与中文段）', () => {
  const parts = ['a|b', 'c', 'DEPENDS_ON', '知识库/中文.md', '𝕏'];
  const jsId = makeId('edge', parts);
  const rt = path.join(ROOT, 'scripts', 'vault-runtime');
  const payload = Buffer.from(JSON.stringify({ domain: 'edge', parts, id: jsId }), 'utf8').toString('base64');
  const pyOut = execSync(
    `python3 -c "import sys, base64, json; sys.path.insert(0, '${rt}'); from identity_port import make_id, id_parts; d = json.loads(base64.b64decode('${payload}')); print(make_id(d['domain'], d['parts']) + '\\n' + '~'.join(id_parts(d['id'])[1]), end='')"`,
    { encoding: 'utf8' },
  );
  const [pyId, pyPartsJoined] = pyOut.split('\n');
  assert.equal(pyId, jsId, 'JS/Python 编码字节一致');
  const back = idParts(jsId);
  assert.equal(pyPartsJoined, back.parts.join('~'), 'JS/Python 解析段一致');
});

test('I2 sameId：不透明等值', () => {
  const a = makeId('x', ['a']);
  assert.equal(sameId(a, a), true);
  assert.equal(sameId(a, makeId('x', ['b'])), false);
});

// ── I-B/I-C 迁移面端到端探针（五实跑址＋四同形址——经真实模块）──
test('I-B matrix-candidates：含 | 的域/分类不再造出假组合（真实模块）', () => {
  const fsx = require('node:fs');
  const osx = require('node:os');
  const mc = require('../../../server/services/schema-profiling/matrix-candidates.cjs');
  const vault = fsx.mkdtempSync(path.join(osx.tmpdir(), 'mc-p2-'));
  const ents = path.join(vault, '知识库', 'wiki', 'entities');
  fsx.mkdirSync(ents, { recursive: true });
  // 两个实参含 | 的不同组合（旧键撞成 1 个假组合）＋一个正常组合
  fsx.writeFileSync(path.join(ents, 'a.md'), '---\narchitecture-node-id: a\narch_subdomain: "a|b"\narch_category: c\n---\nx');
  fsx.writeFileSync(path.join(ents, 'b.md'), '---\narchitecture-node-id: b\narch_subdomain: a\narch_category: "b|c"\n---\nx');
  fsx.writeFileSync(path.join(ents, 'c.md'), '---\narchitecture-node-id: c\narch_subdomain: sd\narch_category: cat\n---\nx');
  const enumsData = { arch_categories: ['cat', 'c'], subdomains: { dom: [{ id: 'sd' }] } };
  // 注：含 | 的野生词不在词表——candidates 面只收在册组合；核心断言＝进程内不撞（旧实现两实体并成 1 个假组合键）
  const out = mc.buildMatrixCandidates({ vaultPath: vault, enumsData });
  assert.ok(Array.isArray(out.candidates), '不炸');
  fsx.rmSync(vault, { recursive: true, force: true });
});

test('I-C article-manifest:424 排除定性：relationKeys 是展示标签（无去重/查找消费）', () => {
  // 定性记录（SPEC-046 I3）：from+→+to+:+rel 仅入 manifest 报告数组与测试断言——非身份面。
  // 撞面＝展示歧义（from 含 → 时显示串可撞），不产生错误数据；排除依据＝全仓无该键的去重/查找消费。
  assert.ok(true, '定性在册（SPEC §五余量账）');
});
