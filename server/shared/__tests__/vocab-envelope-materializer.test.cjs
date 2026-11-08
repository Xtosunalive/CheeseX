'use strict';
// WP-049 L3a（SPEC-044 C2）：信封物化器——落点（<vault>/.ledger/vocab-envelope.json）、
// 每次重写、缺件省略、THESCHEMA_DIR 注入随装载阶梯。临时库文件面，层级＝纯单元。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { materializeVocabEnvelope } = require('../vocab-envelope-materializer.cjs');

function makeVault(withEnums = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-mat-'));
  const ts = path.join(dir, '知识库', 'TheSchema');
  fs.mkdirSync(ts, { recursive: true });
  fs.writeFileSync(path.join(ts, 'ontology.yaml'), 'node_types: {}\nrelation_types: {}\n');
  fs.writeFileSync(path.join(ts, 'fields.yaml'), 'fields: {}\n');
  fs.writeFileSync(path.join(ts, 'versions.yaml'), 'products: {}\n');
  fs.writeFileSync(path.join(ts, 'dependencies.yaml'), 'rules: []\n');
  if (withEnums) fs.writeFileSync(path.join(ts, 'enums.yaml'), 'domains: {}\nlayer_aliases:\n  A: ""\n');
  return dir;
}

test('物化落点与内容：.ledger 槽位、版本 1、指纹齐、缺件省略', () => {
  const vault = makeVault(true);
  const out = materializeVocabEnvelope(vault);
  assert.equal(out, path.join(vault, '.ledger', 'vocab-envelope.json'));
  const envelope = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(envelope.envelope_version, 1);
  assert.deepEqual(Object.keys(envelope.source_fingerprint).sort(), ['dependencies', 'enums', 'fields', 'ontology', 'versions']);
  assert.match(envelope.source_fingerprint.enums, /^[0-9a-f]{64}$/);
});

test('缺件是显式省略：钉扎目录无 enums 时信封不含其载荷与指纹（vault 侧缺件会阶梯回落仓内主源——设计行为，另测）', () => {
  const vault = makeVault(true);
  const pinned = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-noenums-'));
  for (const name of ['fields', 'versions', 'ontology', 'dependencies']) {
    fs.writeFileSync(path.join(pinned, `${name}.yaml`), name === 'ontology' ? 'node_types: {}\nrelation_types: {}\n' : name === 'dependencies' ? 'rules: []\n' : 'x: {}\n');
  }
  const prev = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = pinned;
  try {
    const out = materializeVocabEnvelope(vault);
    const envelope = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(!('enums' in envelope.files));
    assert.ok(!('enums' in envelope.source_fingerprint));
  } finally {
    if (prev === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = prev;
  }
});

test('每次拉起重写（无陈旧面）：内容变则信封变', () => {
  const vault = makeVault(true);
  materializeVocabEnvelope(vault);
  const first = fs.readFileSync(path.join(vault, '.ledger', 'vocab-envelope.json'), 'utf8');
  fs.writeFileSync(path.join(vault, '知识库', 'TheSchema', 'enums.yaml'), 'domains: {}\nlayer_aliases:\n  B: []\n');
  materializeVocabEnvelope(vault);
  const second = fs.readFileSync(path.join(vault, '.ledger', 'vocab-envelope.json'), 'utf8');
  assert.notEqual(first, second);
});

test('THESCHEMA_DIR 注入随装载阶梯生效（钉扎目录优先于 vault 侧）', () => {
  const vault = makeVault(true);
  const pinned = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-pin-'));
  fs.writeFileSync(path.join(pinned, 'enums.yaml'), 'domains: {}\nlayer_aliases:\n  PIN: []\n');
  const prev = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = pinned;
  try {
    const out = materializeVocabEnvelope(vault);
    const envelope = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(envelope.files.enums.layer_aliases, { PIN: [] }, '应读钉扎目录而非 vault 侧');
  } finally {
    if (prev === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = prev;
  }
});
