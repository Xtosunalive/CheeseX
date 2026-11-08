'use strict';
// WP-049 L1（SPEC-044 C1/C2/C6）：词表装载入口——三态可分、来源指纹、信封往返、读放大预算、
// fail-closed 无隐式回落。临时库文件面测试（THESCHEMA_DIR 注入解析阶梯——theschema-root 语义：
// 注入优先于 vault 侧阶梯），不监听 HTTP、不触第三方（层级＝纯单元，对象＝装载端口本身）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  VOCAB_FILE_NAMES,
  ENVELOPE_VERSION,
  loadVocabBundle,
  loadVocabFromDir,
  vocabLookup,
  serializeVocabEnvelope,
  parseVocabEnvelope,
  getVocabReadStats,
} = require('../vocab-load-port.cjs');

const FIXTURES = {
  'enums.yaml': [
    'domains: {}',
    'subdomains: {}',
    'layer_aliases:', // 未声明顶层键：additionalProperties=true 原样透传——三态不被宽容转换吞并
    '  旧层A: ""',
    '  旧层B: []',
    '  旧层C:',
    '    - 正式C',
    '',
  ].join('\n'),
  'fields.yaml': 'fields: {}\n',
  'versions.yaml': 'products: {}\n',
  'ontology.yaml': 'node_types: {}\nrelation_types: {}\n',
  'dependencies.yaml': 'rules: []\n',
};

function makeTree(overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-port-'));
  const ts = path.join(dir, 'theschema');
  fs.mkdirSync(ts, { recursive: true });
  const files = { ...FIXTURES, ...(overrides || {}) };
  for (const [name, text] of Object.entries(files)) {
    if (text === null) continue; // null＝该件缺席
    fs.writeFileSync(path.join(ts, name), text);
  }
  return { dir, ts };
}

function withInjection(ts, fn) {
  const prev = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = ts;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = prev;
  }
}

test('装载五件：状态 present、指纹为 sha256、读取计数＋5', () => {
  const { ts } = makeTree();
  const bundle = withInjection(ts, () => loadVocabBundle(null));
  assert.deepEqual([...VOCAB_FILE_NAMES].sort(), ['dependencies', 'enums', 'fields', 'ontology', 'versions']);
  for (const name of VOCAB_FILE_NAMES) {
    assert.equal(bundle.files[name].state, 'present', `${name} 应 present`);
    assert.match(bundle.files[name].fingerprint, /^[0-9a-f]{64}$/);
  }
  const before = getVocabReadStats().fileReads;
  withInjection(ts, () => loadVocabBundle(null));
  assert.equal(getVocabReadStats().fileReads, before + 5, '单次装载＝恰好 5 读');
});

test('missing 是显式状态不是静默空表（C1/C6）', () => {
  const { ts } = makeTree({ 'fields.yaml': null });
  const bundle = withInjection(ts, () => loadVocabBundle(null));
  assert.equal(bundle.files.fields.state, 'missing');
  assert.equal(bundle.files.enums.state, 'present');
  assert.equal(vocabLookup(bundle, 'fields', 'any', 'k').state, 'file-missing');
});

test('三态可分：空串／空数组／缺键／映射缺席各有其形（P3 病根显形）', () => {
  const { ts } = makeTree();
  const bundle = withInjection(ts, () => loadVocabBundle(null));
  const look = (key) => vocabLookup(bundle, 'enums', 'layer_aliases', key).state;
  assert.equal(look('旧层A'), 'empty-string');
  assert.equal(look('旧层B'), 'empty-collection');
  assert.equal(look('旧层C'), 'present');
  assert.equal(look('不存在键'), 'key-absent');
  assert.equal(vocabLookup(bundle, 'enums', '不存在的映射', 'k').state, 'map-absent');
  assert.deepEqual(vocabLookup(bundle, 'enums', 'layer_aliases', '旧层C').value, ['正式C']);
});

test('来源指纹随内容变化（收据不是权威，但可对拍）', () => {
  const { ts } = makeTree();
  const first = withInjection(ts, () => loadVocabBundle(null)).files.enums.fingerprint;
  fs.writeFileSync(path.join(ts, 'enums.yaml'), FIXTURES['enums.yaml'] + '# touched\n');
  const second = withInjection(ts, () => loadVocabBundle(null)).files.enums.fingerprint;
  assert.notEqual(first, second);
});

test('信封往返：三态在序列化下保持，missing 件不入 files／指纹（C2）', () => {
  const { ts } = makeTree({ 'versions.yaml': null });
  const bundle = withInjection(ts, () => loadVocabBundle(null));
  const envelope = parseVocabEnvelope(JSON.stringify(serializeVocabEnvelope(bundle)));
  assert.equal(envelope.envelope_version, ENVELOPE_VERSION);
  assert.ok(envelope.files.enums, 'present 件入载荷');
  assert.ok(!('versions' in envelope.files), 'missing 件不入载荷');
  assert.ok(!('versions' in envelope.source_fingerprint), 'missing 件不入指纹');
  // 三态保真："" 保空串、[] 保空数组、键保持
  assert.equal(envelope.files.enums.layer_aliases['旧层A'], '');
  assert.deepEqual(envelope.files.enums.layer_aliases['旧层B'], []);
  assert.deepEqual(envelope.files.enums.layer_aliases['旧层C'], ['正式C']);
});

test('信封 fail-closed：版本不匹配／指纹非法／坏 JSON 显式拒绝，不回落自读（C2）', () => {
  const { ts } = makeTree();
  const bundle = withInjection(ts, () => loadVocabBundle(null));
  const good = serializeVocabEnvelope(bundle);
  assert.throws(() => parseVocabEnvelope({ ...good, envelope_version: 2 }), /VOCAB_ENVELOPE_VERSION_MISMATCH/);
  assert.throws(
    () => parseVocabEnvelope({ ...good, source_fingerprint: { enums: 'zz' } }),
    /VOCAB_ENVELOPE_UNREADABLE/,
  );
  assert.throws(() => parseVocabEnvelope('{oops'), /VOCAB_ENVELOPE_UNREADABLE/);
  assert.throws(() => parseVocabEnvelope({ ...good, source_fingerprint: null }), /VOCAB_ENVELOPE_UNREADABLE/);
});

test('词表坏内容显式失败，不静默给空对象（无隐式回落）；原始 error.code 透传（上游按 code 派发响应）', () => {
  const broken = makeTree({ 'enums.yaml': 'x: [\n' });
  assert.throws(
    () => withInjection(broken.ts, () => loadVocabBundle(null)),
    (error) => {
      assert.match(error.message, /VOCAB_PARSE_FAILED/);
      assert.ok(error.code, '重包装不得吞掉 yaml 原始错误码（BAD_INDENT 族）——ontology-routes 先例：路由按 error.code 派发');
      return true;
    },
  );
  const arrayTop = makeTree({ 'ontology.yaml': '- a\n- b\n' });
  assert.throws(
    () => withInjection(arrayTop.ts, () => loadVocabBundle(null)),
    /VOCAB_SHAPE_FAILED/,
  );
});

test('读放大预算：超限显式告警一次，统计可观测（ADR-016 §六-1 判据5）', () => {
  const { ts } = makeTree();
  const warnings = [];
  const prev = process.env.VOCAB_READ_BUDGET;
  process.env.VOCAB_READ_BUDGET = '1';
  try {
    withInjection(ts, () => loadVocabBundle(null, { warn: (m) => warnings.push(String(m)) }));
  } finally {
    if (prev === undefined) delete process.env.VOCAB_READ_BUDGET;
    else process.env.VOCAB_READ_BUDGET = prev;
  }
  assert.equal(warnings.filter((w) => w.includes('vocab-read-budget-exceeded')).length, 1, '恰好告警一次');
  assert.ok(getVocabReadStats().fileReads >= 5, '读取计数持续累计');
});

test('未知件名/非映射面查询显式报错', () => {
  const { ts } = makeTree();
  const bundle = withInjection(ts, () => loadVocabBundle(null));
  assert.throws(() => vocabLookup(bundle, 'nope', 'm', 'k'), /未知词表件/);
});

test('子集装载：读放大不增（单件一读）；未知/空子集显式拒绝（L2 面）', () => {
  const { ts } = makeTree();
  const before = getVocabReadStats().fileReads;
  const bundle = withInjection(ts, () => loadVocabBundle(null, { files: ['ontology'] }));
  assert.equal(getVocabReadStats().fileReads, before + 1, '子集＝只读所需件');
  assert.ok(bundle.files.ontology, '子集件在束内');
  assert.ok(!bundle.files.enums, '未选件不在束内');
  assert.throws(() => withInjection(ts, () => loadVocabBundle(null, { files: [] })), /VOCAB_FILES_INVALID/);
  assert.throws(() => withInjection(ts, () => loadVocabBundle(null, { files: ['nope'] })), /VOCAB_FILES_INVALID/);
});

test('loadVocabFromDir：显式目录装载（仓内主源锚定面）；raw/text 视图可用且 raw 保原生形态', () => {
  const { ts } = makeTree();
  const bundle = loadVocabFromDir(ts);
  assert.equal(bundle.dir, ts);
  assert.equal(bundle.files.enums.state, 'present');
  assert.ok(typeof bundle.files.enums.text === 'string');
  assert.deepEqual(JSON.parse(JSON.stringify(bundle.files.enums.raw.layer_aliases['旧层C'])), ['正式C']); // WP-050：装载产物 null 原型——断言走 JSON 值面
  // 空文件：raw 保持 null 原生形态（不静默变 {}）——门禁审计原始内容不假绿
  const emptyTree = makeTree({ 'versions.yaml': '' });
  const emptyBundle = loadVocabFromDir(emptyTree.ts);
  assert.equal(emptyBundle.files.versions.state, 'present');
  assert.equal(emptyBundle.files.versions.raw, null);
  assert.equal(Object.keys(emptyBundle.files.versions.data).length, 0); // WP-050：null 原型空对象——按键集断言
  assert.throws(() => loadVocabFromDir(''), /dir 必须是非空目录路径/);
});

test('子集束信封序列化不炸：未选件自然不入载荷', () => {
  const { ts } = makeTree();
  const bundle = loadVocabFromDir(ts, { files: ['enums'] });
  const envelope = parseVocabEnvelope(JSON.stringify(serializeVocabEnvelope(bundle)));
  assert.ok(envelope.files.enums);
  assert.ok(!('ontology' in envelope.files));
});
