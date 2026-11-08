// WP-117 批2（SPEC-084 §二.1）：文档信封物化器行为钉＋跨语言等价抽查。
// 层级：纯单元（tmp 夹具 vault）＋子进程真函数探针（extract_graph.parse_frontmatter 同语义对拍——
// 重依赖模块以桩件隔离：schema_loader/article_admission_manifest 以空模块顶替，parse_frontmatter
// 本体只用 yaml，逐字保持原实现，不复制语义）。测试面在 walk 扫描豁免目录（__tests__），可自由
// 使用三横字面量构造夹具与参照切分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);  // WP-117：python-path 为 CJS 单源（ADR-002 禁裸 python3——ESM 侧经 createRequire 引入）
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

import { buildDocEnvelope, serializeDocEnvelope, writeDocEnvelope, DOC_ENVELOPE_VERSION } from '../../server/shared/doc-envelope-materializer.cjs';
import { buildVaultRuntimeEnv } from '../../server/shared/vault-runtime-spawn.cjs';

const GBK_LEGACY_TEXT = '---\ntitle: 旧文件\n---\n\n旧编码正文。\n'; // 十六进制字节见夹具构造（python gbk 编码产物）

function makeFixtureVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'wp117-doc-envelope-'));
  fs.mkdirSync(path.join(vault, '知识库')); // 真函数探针要求 KB_VAULT 仓库根含知识库目录
  fs.mkdirSync(path.join(vault, '子目录'));
  for (const dir of ['.obsidian', '.git', '.claude']) { // skip 口径探针：跳过目录内 .md 不得入信封
    fs.mkdirSync(path.join(vault, dir));
    fs.writeFileSync(path.join(vault, dir, 'ignored.md'), '---\ntitle: 跳过我\n---\n不应出现在信封\n');
  }
  // 带 frontmatter＋正文含三横分隔线：哑切分语义下分隔线属 body（body 全文不裁的边界钉）；
  // 夹具 fm 用规范 YAML——yaml 可解析性属消费批（safe_load）语义，本批钉的是文本切分形态
  fs.writeFileSync(path.join(vault, '笔记.md'), '---\ntitle: 测试\ntags:\n  - a\n  - b\n---\n\n正文第一段。\n\n---\n\n分隔线后仍是正文。\n');
  fs.writeFileSync(path.join(vault, 'plain.md'), '无 frontmatter 的普通文档。\n');
  fs.writeFileSync(path.join(vault, '子目录', '中文 路径.md'), '---\nstatus: draft\n---\n正文。');
  fs.writeFileSync(path.join(vault, 'gbk-legacy.md'), Buffer.from('2d2d2d0a7469746c653a20bec9cec4bcfe0a2d2d2d0a0abec9b1e0c2ebd5fdcec4a1a30a', 'hex'));
  fs.writeFileSync(path.join(vault, 'bom.md'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('---\ntitle: bom\n---\n\nBOM 正文\n', 'utf8')]));
  // 红队 03-C 对拍案例转正：CRLF 行尾文件——旧 python open() 文本态 universal newlines 会把
  // \r\n 归一为 \n，信封侧须同归一（P2-1），否则迁移后产物逐字漂移。
  fs.writeFileSync(path.join(vault, '03-C.md'), '---\r\ntitle: crlf\r\n---\r\n\r\nCRLF 正文第一行。\r\nCRLF 正文第二行。\r\n');
  // 红队 P2-4 夹具：符号链接指向目录、名字以 .md 结尾——收集面须显式跳过（不整库硬红）
  fs.symlinkSync(vault, path.join(vault, 'dir-link.md'), 'dir');
  return vault;
}

// python str.split(sep, maxsplit=2) 直译——参照切分（语义锚＝extract_graph.parse_frontmatter 的哑 split）
function pySplit2(text, sep) {
  const parts = [];
  let rest = text;
  while (parts.length < 2) {
    const idx = rest.indexOf(sep);
    if (idx < 0) break;
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + sep.length);
  }
  parts.push(rest);
  return parts;
}

// parse_frontmatter 同语义参照：三横起头＋split maxsplit=2；len(parts)<3 即无块（fmText=空、body=全文）
function refFrontmatter(content) {
  if (!content.startsWith('---')) return { fmText: '', body: content };
  const parts = pySplit2(content, '---');
  if (parts.length < 3) return { fmText: '', body: content };
  return { fmText: parts[0] + '---' + parts[1] + '---', body: parts[2] };
}

function fixtureFiles(vault) {
  return ['笔记.md', 'plain.md', '子目录/中文 路径.md', 'gbk-legacy.md', 'bom.md', '03-C.md'].map((rel) => path.join(vault, ...rel.split('/')));
}

// 真函数探针（红队 P1-1 修复）：先物化夹具信封（dump-doc-envelope 单源 CLI→<vault>/.ledger/
// doc-envelope.json）并注入 DOC_ENVELOPE_PATH——extract_graph 进程入口自批2 起 fail-closed 强制
// 装载信封，无信封即退出。探针读信封逐 doc 按新双参签名 parse_frontmatter(fmText, body) 调用，
// 返回 { has_fm, body }——语义对拍的真值锚（真函数，不复制实现）。
const PARSE_FRONTMATTER_PROBE = `
import sys, os, types, json
loader = types.ModuleType('schema_loader')
for fn in ('domains', 'subdomains', 'module_subdomain_map', 'module_system_map', 'category_map'):
    setattr(loader, fn, lambda: {})
sys.modules['schema_loader'] = loader
adm = types.ModuleType('article_admission_manifest')
adm.load_admitted_precleaned_paths = lambda *a, **k: set()
sys.modules['article_admission_manifest'] = adm
sys.path.insert(0, sys.argv[1])
from extract_graph import parse_frontmatter
with open(os.environ['DOC_ENVELOPE_PATH'], encoding='utf-8') as fh:
    envelope = json.load(fh)
out = {}
for doc in envelope['documents']:
    parsed = parse_frontmatter(doc['fmText'], doc['body'])
    out[doc['path']] = {'has_fm': parsed is not None, 'body': parsed[1] if parsed is not None else None}
print(json.dumps(out, ensure_ascii=False))
`;

function probeFrontmatter(vault, targets) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/vault-runtime/dump-doc-envelope.mjs'), '--vault', vault], {
    encoding: 'utf8',
    env: { ...process.env, KB_VAULT: vault, KB_DATA_DIR: path.join(vault, 'data'), ARCH_REPO: ROOT },
  });
  const stdout = execFileSync(require_('../../server/shared/python-path.cjs').resolvePythonPath(), ['-c', PARSE_FRONTMATTER_PROBE, path.join(ROOT, 'scripts/vault-py/graph'), vault, ...targets], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KB_VAULT: vault,
      KB_DATA_DIR: path.join(vault, 'data'),
      ARCH_REPO: ROOT,
      DOC_ENVELOPE_PATH: path.join(vault, '.ledger', 'doc-envelope.json'),
    },
  });
  return JSON.parse(stdout.trim().split('\n').pop());
}

test('buildDocEnvelope：全语料产出——版本/指纹/键闭集/path 稳定序/skip 口径', () => {
  const vault = makeFixtureVault();
  try {
    const envelope = buildDocEnvelope(vault);
    assert.equal(envelope.envelope_version, 1);
    assert.equal(envelope.envelope_version, DOC_ENVELOPE_VERSION);
    assert.ok(!Number.isNaN(Date.parse(envelope.generated_at)), 'generated_at 为 ISO 时间戳');
    const paths = envelope.documents.map((doc) => doc.path);
    assert.deepEqual(paths, ['03-C.md', 'bom.md', 'gbk-legacy.md', 'plain.md', '子目录/中文 路径.md', '笔记.md'], 'documents 按 path 排序稳定序（POSIX 相对路径，码点序）');
    for (const doc of envelope.documents) {
      assert.deepEqual(Object.keys(doc).sort(), ['body', 'fmText', 'path', 'sha16', 'sha256'], '成员键闭集五键');
    }
    const totalBytes = fixtureFiles(vault).reduce((sum, file) => sum + fs.statSync(file).size, 0);
    assert.deepEqual(envelope.vault_fingerprint, { file_count: 6, total_bytes: totalBytes }, 'vault 指纹＝文件数＋字节量');
    assert.ok(!paths.some((p) => p.includes('ignored.md')), 'skip 口径：.obsidian/.git/.claude 内 .md 不入信封');
    assert.ok(!paths.some((p) => p.includes('dir-link')), 'P2-4：符号链接目录态收集面跳过，不入信封');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('等价抽查①：fmText＋body 逐文件按哑切分语义还原原文（与 parse_frontmatter 切分同语义）', () => {
  const vault = makeFixtureVault();
  try {
    const envelope = buildDocEnvelope(vault);
    const byPath = new Map(envelope.documents.map((doc) => [doc.path, doc]));
    // utf-8 夹具：原文＝utf8 读文件（含 BOM 文件的 BOM 字符）；gbk 夹具：原文＝已知 gbk 文本；
    // CRLF 夹具（03-C）：交付文本＝universal newlines 归一后形态（非盘上原字节）——P2-1 口径
    const originals = new Map([
      ['笔记.md', fs.readFileSync(path.join(vault, '笔记.md'), 'utf8')],
      ['plain.md', fs.readFileSync(path.join(vault, 'plain.md'), 'utf8')],
      ['子目录/中文 路径.md', fs.readFileSync(path.join(vault, '子目录', '中文 路径.md'), 'utf8')],
      ['bom.md', '\uFEFF---\ntitle: bom\n---\n\nBOM 正文\n'],
      ['gbk-legacy.md', GBK_LEGACY_TEXT],
      ['03-C.md', '---\ntitle: crlf\n---\n\nCRLF 正文第一行。\nCRLF 正文第二行。\n'],
    ]);
    for (const [rel, original] of originals) {
      const doc = byPath.get(rel);
      const expected = refFrontmatter(original);
      assert.equal(doc.fmText, expected.fmText, `${rel} fmText＝含定界符块原文`);
      assert.equal(doc.body, expected.body, `${rel} body＝块后全文（不裁）`);
      assert.equal(doc.fmText + doc.body, original, `${rel} fmText＋body 逐字节还原原文`);
    }
    // 语义边界钉：BOM 文件不视为 frontmatter（parse_frontmatter utf-8 解码保留 BOM→不起头即无块）
    assert.equal(byPath.get('bom.md').fmText, '', 'BOM 文件无 frontmatter（与 parse_frontmatter None 对齐）');
    // 正文三横分隔线属 body（哑切分 maxsplit=2 语义，非宿主换行闭合语义）
    assert.ok(byPath.get('笔记.md').body.includes('---'), '正文内三横留在 body');
    // P2-1：交付文本零 CR（\r\n→\n 归一；孤 \r 同归）——对齐旧 python open() universal newlines
    for (const doc of envelope.documents) {
      assert.ok(!doc.fmText.includes('\r') && !doc.body.includes('\r'), `${doc.path} 交付文本零 CR（universal newlines 归一）`);
    }
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('等价抽查②：extract_graph.parse_frontmatter 真函数子进程对拍（has_fm 对齐＋fm 文件 body 逐字相等）', () => {
  const vault = makeFixtureVault();
  try {
    const envelope = buildDocEnvelope(vault);
    const byPath = new Map(envelope.documents.map((doc) => [doc.path, doc]));
    const targets = fixtureFiles(vault);
    const probe = probeFrontmatter(vault, targets);
    for (const target of targets) {
      const rel = path.relative(vault, target).split(path.sep).join('/');
      const doc = byPath.get(rel);
      const truth = probe[rel];
      assert.ok(truth, `${rel} 在探针产出中（信封 path 键）`);
      assert.equal(doc.fmText !== '', truth.has_fm, `${rel} 有无 frontmatter 与 parse_frontmatter 对齐`);
      if (truth.has_fm) {
        assert.equal(doc.body, truth.body, `${rel} body 与 parse_frontmatter 返回 body 逐字相等（含 gbk 链解码等价）`);
      }
    }
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

// 红队 03-C 对拍案例转正（P2-1）：CRLF 文件迁移等价——旧 python open() 文本态 universal newlines
// 把 \r\n（含孤 \r）归一为 \n，信封交付文本须同归一，否则迁移后产物逐字漂移。
test('P2-1 CRLF 归一（红队 03-C 转正）：交付文本＝universal newlines 形态——fm 切分/正文/对拍全链零 CR', () => {
  const vault = makeFixtureVault();
  try {
    const envelope = buildDocEnvelope(vault);
    const doc = envelope.documents.find((d) => d.path === '03-C.md');
    assert.ok(doc, '03-C.md 入信封');
    assert.equal(doc.fmText, '---\ntitle: crlf\n---', 'fmText＝归一后含定界符块原文（零 CR）');
    assert.equal(doc.body, '\n\nCRLF 正文第一行。\nCRLF 正文第二行。\n', 'body＝归一后块后全文（零 CR）');
    assert.equal(doc.fmText + doc.body, '---\ntitle: crlf\n---\n\nCRLF 正文第一行。\nCRLF 正文第二行。\n', 'fmText＋body＝归一文本（与旧 open() 读出形态逐字一致）');
    const rawOnDisk = fs.readFileSync(path.join(vault, '03-C.md'), 'utf8');
    assert.ok(rawOnDisk.includes('\r\n'), '盘上原文确为 CRLF（夹具有效性）');
    assert.notEqual(doc.fmText + doc.body, rawOnDisk, '交付文本≠盘上原字节文本（归一非恒等——口径变化，SPEC-084 §八）');
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

// 红队 P2-4 转正：符号链接指向目录（名字 .md 结尾）——收集面显式跳过＋stderr 记一条，
// 不整库硬红（旧形态：读期 EISDIR→DOC_ENVELOPE_FILE_UNREADABLE 整库失败）。
test('P2-4 EISDIR 显式跳过：symlink 目录夹具不入信封、stderr 记一条、其余文档不受累', () => {
  const vault = makeFixtureVault();
  const savedWrite = process.stderr.write;
  let stderrText = '';
  try {
    process.stderr.write = (chunk) => { stderrText += typeof chunk === 'string' ? chunk : String(chunk); return true; };
    const envelope = buildDocEnvelope(vault);
    const paths = envelope.documents.map((d) => d.path);
    assert.ok(!paths.some((p) => p.includes('dir-link')), 'symlink 目录不入信封');
    assert.equal(paths.length, 6, '其余文档不受累（跳过非整库红）');
    assert.match(stderrText, /DOC_ENVELOPE_SYMLINK_DIR_SKIPPED/, 'stderr 显式记一条（非静默）');
    assert.match(stderrText, /dir-link\.md/, 'stderr 点名跳过对象');
  } finally {
    process.stderr.write = savedWrite;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('指纹对拍：sha256＝交付文本 utf-8 收据（无 CR 的 utf-8 文件与原文件字节哈希恒等；sha16＝前 16）', () => {
  const vault = makeFixtureVault();
  try {
    const envelope = buildDocEnvelope(vault);
    const byPath = new Map(envelope.documents.map((doc) => [doc.path, doc]));
    const shaOf = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    for (const rel of ['笔记.md', 'plain.md', '子目录/中文 路径.md', 'bom.md']) {
      const doc = byPath.get(rel);
      const rawBytesHash = createHash('sha256').update(fs.readFileSync(path.join(vault, ...rel.split('/')))).digest('hex');
      assert.equal(doc.sha256, shaOf(doc.fmText + doc.body), `${rel} sha256＝交付文本收据`);
      assert.equal(doc.sha256, rawBytesHash, `${rel} utf-8 无 CR 文件交付文本与原文件字节哈希恒等`);
      assert.equal(doc.sha16, doc.sha256.slice(0, 16), `${rel} sha16＝sha256 前 16 位`);
    }
    const gbk = byPath.get('gbk-legacy.md');
    assert.equal(gbk.sha256, shaOf(gbk.fmText + gbk.body), 'gbk 文件 sha256＝链解码交付文本收据（接收侧零文件读取可复算）');
    assert.equal(gbk.sha16, gbk.sha256.slice(0, 16));
    // CRLF 文件（P2-1 归一后）＝交付文本收据，与原文件字节哈希不恒等——口径变化如实钉死
    // （增量指纹首轮翻牌一次，SPEC-084 §八注记）
    const crlf = byPath.get('03-C.md');
    assert.equal(crlf.sha256, shaOf(crlf.fmText + crlf.body), 'CRLF 文件 sha256＝归一交付文本收据');
    const crlfRawHash = createHash('sha256').update(fs.readFileSync(path.join(vault, '03-C.md'))).digest('hex');
    assert.notEqual(crlf.sha256, crlfRawHash, 'CRLF 文件交付文本与原文件字节哈希不恒等（归一口径）');
    assert.equal(crlf.sha16, crlf.sha256.slice(0, 16));
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('空 vault：空数据态合法产出（documents 空数组、计数归零）', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'wp117-doc-envelope-empty-'));
  try {
    const envelope = buildDocEnvelope(vault);
    assert.deepEqual(envelope.documents, []);
    assert.deepEqual(envelope.vault_fingerprint, { file_count: 0, total_bytes: 0 });
    assert.equal(envelope.envelope_version, DOC_ENVELOPE_VERSION);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('缺 vault 目录 fail-closed：build/write 显式报错不产空信封', () => {
  const missing = path.join(os.tmpdir(), 'wp117-doc-envelope-missing-' + process.pid);
  assert.throws(() => buildDocEnvelope(missing), (e) => /DOC_ENVELOPE_VAULT_UNREADABLE/.test(e.message));
  assert.throws(() => writeDocEnvelope(missing), (e) => /DOC_ENVELOPE_VAULT_UNREADABLE/.test(e.message));
});

test('writeDocEnvelope＋serializeDocEnvelope：落 <vault>/.ledger/doc-envelope.json（getLedgerDir 单源）且 JSON round-trip 保形', () => {
  const vault = makeFixtureVault();
  try {
    const target = writeDocEnvelope(vault);
    assert.equal(target, path.join(vault, '.ledger', 'doc-envelope.json'), '产物槽位＝.ledger 单源目录');
    const written = JSON.parse(fs.readFileSync(target, 'utf8'));
    const built = buildDocEnvelope(vault);
    assert.equal(written.envelope_version, built.envelope_version);
    assert.deepEqual(written.vault_fingerprint, built.vault_fingerprint);
    assert.deepEqual(written.documents, built.documents);
    assert.deepEqual(JSON.parse(serializeDocEnvelope(built)), built, 'serialize＝JSON.stringify round-trip 保形');
    // 写后复跑：信封自身不入 documents（.json 非 .md）——file_count 稳定
    const again = buildDocEnvelope(vault);
    assert.equal(again.documents.length, built.documents.length);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

test('拉起接线：docEnvelope 选项经 DOC_ENVELOPE_PATH 下发（物化重写）＋false 显式 delete 不继承父环境', () => {
  const vault = makeFixtureVault();
  const saved = process.env.DOC_ENVELOPE_PATH;
  process.env.DOC_ENVELOPE_PATH = '/parent-stale-doc-envelope.json';
  try {
    const env = buildVaultRuntimeEnv({ vaultPath: vault, docEnvelope: true });
    assert.equal(env.DOC_ENVELOPE_PATH, path.join(vault, '.ledger', 'doc-envelope.json'), 'true＝本次拉起物化并注入');
    assert.ok(fs.existsSync(env.DOC_ENVELOPE_PATH), '信封随拉起物化落盘');
    const off = buildVaultRuntimeEnv({ vaultPath: vault });
    assert.equal(off.DOC_ENVELOPE_PATH, undefined, 'false＝显式 delete，父环境陈旧值不漏入子进程');
  } finally {
    if (saved === undefined) delete process.env.DOC_ENVELOPE_PATH; else process.env.DOC_ENVELOPE_PATH = saved;
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
