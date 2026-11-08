'use strict';
// WP-050 D-B（SPEC-045 D2/D3）：文档装载入口——frontmatter 产物 null 原型＋六态查询＋
// 键闭集。层级：纯单元。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDocument, docField, docFieldClosedSet } = require('../document-load-port.cjs');

test('装载产物 null 原型：保留名键全 undefined；正常键/数组/JSON 往返不受影响', () => {
  const doc = loadDocument('---\ntitle: T\nproduct: ghost\nmodule: [m1, m2]\n---\n正文');
  for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.equal(doc.frontmatter[key], undefined, `frontmatter[${key}] 应 undefined`);
  }
  assert.equal(doc.frontmatter.title, 'T');
  assert.deepEqual(JSON.parse(JSON.stringify(doc.frontmatter.module)), ['m1', 'm2']);
  assert.equal(doc.body, '正文');
});

test('六态查询：doc-absent／key-absent／empty-string／empty-collection／null-value／present', () => {
  const doc = loadDocument('---\na: ""\nb: []\nc: null\nd: x\n---\nbody');
  assert.equal(docField(doc, 'a').state, 'empty-string');
  assert.equal(docField(doc, 'b').state, 'empty-collection');
  assert.equal(docField(doc, 'c').state, 'null-value');
  assert.equal(docField(doc, 'd').state, 'present');
  assert.equal(docField(doc, 'no').state, 'key-absent');
  assert.equal(docField(null, 'd').state, 'doc-absent');
  // P1 病根对照：保留名键不命中原型（旧：frontmatter.constructor → Function）
  assert.equal(docField(doc, 'constructor').state, 'key-absent');
});

test('键闭集：闭集外值显式拒（not-in-closed-set）；在册值过；含档位三态分支', () => {
  const doc = loadDocument('---\nstatus: 在线\nbad: 乱写\nblank: ""\n---\nb');
  const SET = new Set(['灰度', '在线', '退役', '已驳回']);
  assert.deepEqual(docFieldClosedSet(doc, 'status', SET), { ok: true, state: 'present', value: '在线' });
  const bad = docFieldClosedSet(doc, 'bad', SET);
  assert.equal(bad.ok, false);
  assert.equal(bad.state, 'not-in-closed-set', '闭集外显式拒');
  const missing = docFieldClosedSet(doc, 'no', SET);
  assert.equal(missing.state, 'key-absent', '缺键不误判闭集外');
  assert.equal(docFieldClosedSet(doc, 'constructor', SET).state, 'key-absent', '保留名回落缺键');
});

test('坏 YAML：空 frontmatter（null 原型）＋正文保全——不炸不静默污染', () => {
  const doc = loadDocument('---\nx: [unclosed\n---\n正文保全');
  assert.equal(typeof doc.frontmatter.x, 'undefined');
  assert.equal(Object.keys(doc.frontmatter).length, 0);
  // WP-116 红队修复批（P2-4）：恒真断言修正（原第三析取支 body.length >= 0 恒真＝假证据）。
  // 实测（探针）：坏 YAML 件 body＝闭合边界后段 trim「正文保全」——frontmatter 文本被丢弃不回漏。
  assert.equal(doc.body, '正文保全', '正文保全且与宿主切分产物逐字一致');
  assert.ok(!doc.body.includes('unclosed'), 'frontmatter 文本不得回漏进 body');
});

// WP-116（SPEC-083 §二.1）严格通道钉：三边界诊断各一，逐态可判别——parseMarkdown
// （document-source-scanner）fail-closed 委托的事实源；缺省宽容路径不受影响（上方既有钉）。
const { parseEntityDocumentStrict } = require('../yaml-frontmatter.cjs');

test('严格通道钉一：未闭合 `---` → unclosed-frontmatter 诊断（宽容路径同输入照旧放行）', () => {
  const { diagnostics } = parseEntityDocumentStrict('---\ntitle: X\nbody text\n', 'unclosed.md');
  assert.deepEqual(diagnostics, [{ code: 'unclosed-frontmatter', message: 'unclosed frontmatter' }]);
});

test('严格通道钉二：非法 YAML → invalid-yaml 诊断，message 逐字携带底层 detail', () => {
  const { diagnostics } = parseEntityDocumentStrict('---\ntitle: [unclosed\n---\nbody\n', 'badyaml.md');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'invalid-yaml');
  assert.ok(diagnostics[0].message.startsWith('invalid YAML: '), 'invalid-yaml 前缀逐字（parseMarkdown 组装 `${sourcePath}: ${message}` 对齐迁移前）');
  assert.ok(diagnostics[0].message.length > 'invalid YAML: '.length, '底层 yaml 库 detail 在 message 内');
});

test('严格通道钉三：frontmatter 非普通对象（标量/数组）→ frontmatter-not-object 诊断', () => {
  const scalar = parseEntityDocumentStrict('---\nhello\n---\nbody\n', 'scalar.md');
  assert.deepEqual(scalar.diagnostics, [{ code: 'frontmatter-not-object', message: 'frontmatter must be an object' }]);
  const array = parseEntityDocumentStrict('---\n- a\n- b\n---\nbody\n', 'array.md');
  assert.equal(array.diagnostics.length, 1);
  assert.equal(array.diagnostics[0].code, 'frontmatter-not-object');
  assert.equal(array.diagnostics[0].message, 'frontmatter must be an object');
});

// WP-116 批2（SPEC-083 §二.3）纯转发钉：端口三件转发必须是宿主同一函数对象（零包装）——
// 消费面禁直 require 宿主后，转发退化即由此钉捕获。层级：纯单元（函数引用与文本变换）。
const host = require('../yaml-frontmatter.cjs');

test('批2 纯转发钉：parseEntityDocumentStrict／patchFrontmatter／frontmatterBounds 与宿主同一函数对象', () => {
  const port = require('../document-load-port.cjs');
  assert.equal(port.parseEntityDocumentStrict, host.parseEntityDocumentStrict);
  assert.equal(port.patchFrontmatter, host.patchFrontmatter);
  assert.equal(port.frontmatterBounds, host.frontmatterBounds);
});

test('批2 装载等价钉：loadDocument 与宿主 parseEntityDocument 边界矩阵逐元同产出（含 null 原型）', () => {
  const MATRIX = [
    '---\ntitle: t\nmodule: [[X]]\n---\n\nBody [[X]] and [[Y]].\n',
    'Just body [[X]]\n',
    '---\ntitle: t\nBody [[X]]\n', // 未闭合
    '---\ntitle: [unclosed\n---\nBody [[X]]\n', // 坏 YAML
    '',
    '---\r\ntitle: t\r\n---\r\nBody [[X]]\r\n', // CRLF
    '\ufeff---\ntitle: t\n---\nBody [[X]]\n', // BOM
    '---\ntitle: t\n---', // 闭合无尾换行
    '---\ntitle: t\n---  \nBody [[X]]\n', // 闭合行尾空格
    '```md\n[[Z]]\n```\n[[X]]\n', // 代码块
  ];
  for (const raw of MATRIX) {
    const a = JSON.stringify(host.parseEntityDocument(raw, 'p.md'));
    const b = JSON.stringify(loadDocument(raw, 'p.md'));
    assert.equal(a, b, `矩阵元同产出：${raw.slice(0, 20)}`);
  }
  assert.equal(Object.getPrototypeOf(loadDocument(MATRIX[0], 'p').frontmatter), null);
});
