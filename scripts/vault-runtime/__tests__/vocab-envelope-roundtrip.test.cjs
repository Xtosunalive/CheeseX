'use strict';
// WP-049 L3a（SPEC-044 C2·Adapter 契约层）：Node 物化信封 → 真实 Python 子进程消费的
// 跨语言往返——三态保真（""/[]/键）与指纹透传。真实子进程（resolvePythonPath 单源解析，
// ADR-002），非 mock；对象＝两侧信封契约本身。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const require_ = createRequire(__filename);
const { resolvePythonPath } = require_('../../../server/shared/python-path.cjs');
const { materializeVocabEnvelope } = require_('../../../server/shared/vocab-envelope-materializer.cjs');

const RUNTIME_DIR = path.resolve(__dirname, '..');

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-rt-'));
  const ts = path.join(dir, '知识库', 'TheSchema');
  fs.mkdirSync(ts, { recursive: true });
  fs.writeFileSync(path.join(ts, 'enums.yaml'), 'domains: {}\nlayer_aliases:\n  旧层A: ""\n  旧层B: []\n  旧层C:\n    - 正式C\n');
  fs.writeFileSync(path.join(ts, 'fields.yaml'), 'fields: {}\n');
  fs.writeFileSync(path.join(ts, 'versions.yaml'), 'products: {}\n');
  fs.writeFileSync(path.join(ts, 'ontology.yaml'), 'node_types: {}\nrelation_types: {}\n');
  fs.writeFileSync(path.join(ts, 'dependencies.yaml'), 'rules: []\n');
  return dir;
}

function pythonProbe(envelopePath, code) {
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})`,
    'from vocab_envelope import load_envelope',
    `env = load_envelope(${JSON.stringify(envelopePath)})`,
    'result = {}',
    code,
    'print("RESULT:" + json.dumps(result, ensure_ascii=False))',
  ].join('\n');
  const run = spawnSync(resolvePythonPath(), ['-c', script], { encoding: 'utf8', env: { ...process.env, VOCAB_ENVELOPE_PATH: envelopePath } });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT:'));
  return JSON.parse(line.slice('RESULT:'.length));
}

test('跨语言往返：Node 物化 → Python 消费，三态与指纹保真', () => {
  const vault = makeVault();
  const envelopePath = materializeVocabEnvelope(vault);
  const out = pythonProbe(envelopePath, [
    "result['states'] = [env.lookup('enums', 'layer_aliases', k)['state'] for k in ['旧层A', '旧层B', '旧层C', '不存在']]",
    "result['names'] = env.names()",
    "result['fp64'] = len(env.fingerprint('enums')) == 64",
  ].join('\n'));
  assert.deepEqual(out.states, ['empty-string', 'empty-collection', 'present', 'key-absent']);
  assert.deepEqual(out.names, ['dependencies', 'enums', 'fields', 'ontology', 'versions']);
  assert.equal(out.fp64, true);
});

test('坏信封 fail-closed：版本不符时 Python 拒绝消费并显式报错（不回落自读）', () => {
  const vault = makeVault();
  const envelopePath = materializeVocabEnvelope(vault);
  const payload = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  payload.envelope_version = 2;
  fs.writeFileSync(envelopePath, JSON.stringify(payload));
  const run = spawnSync(resolvePythonPath(), ['-c', [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})`,
    'from vocab_envelope import load_envelope, VocabEnvelopeError',
    `try:`,
    `    load_envelope(${JSON.stringify(envelopePath)})`,
    'except VocabEnvelopeError as e:',
    '    print("EXPECTED:" + str(e))',
  ].join('\n')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /EXPECTED:VOCAB_ENVELOPE_VERSION_MISMATCH/);
});
