#!/usr/bin/env node
// WP-049 L1（SPEC-044 C3）：存在制断言破坏实验——端口外词表读取路径必须红并点名文件:行；
// JS 测试面与行注释不算命中；端口实现文件合法持有。子进程真实运行检查器（VOCAB_GATE_ROOT
// 注入扫描根），层级＝纯单元（对象＝检查器判据本身，非真实词表内容）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-vocab-load-port.mjs');

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-gate-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function runGate(root) {
  const result = spawnSync(process.execPath, [CHECKER], {
    env: { ...process.env, VOCAB_GATE_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

// WP-084：基线从门禁文件里的手抄 map 搬进 contracts/vocab-load-baseline.json（生成物）——
// 夹具态必须自带基线，不再隐性借用真仓那份；缺文件＝无上限，比在册更严（见下方专项）
function withBaseline(root, entries) {
  const abs = path.join(root, 'contracts', 'vocab-load-baseline.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ schema_version: 1, expiresAt: '2099-01-01', entries }, null, 2));
  return root;
}

test('净树：读取只发生在端口实现文件 → ok', () => {
  const root = makeTree({
    'server/shared/vocab-load-port.cjs': 'const t = fs.readFileSync(path.join(dir, "enums.yaml"));\n',
    'scripts/innocent.mjs': 'console.log("hello");\n',
  });
  const { code, out } = runGate(root);
  assert.equal(code, 0, out);
  assert.match(out, /vocab_load_port=ok/);
});

test('破坏实验①：新增 Python 读取路径 → 必红并点名文件:行（裁决零知识面）', () => {
  const root = makeTree({
    'scripts/vault-py/new_reader.py': 'import yaml\nenums = yaml.safe_load(open(p / "enums.yaml"))\n',
  });
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /vocab_load_port=FAIL/);
  assert.match(out, /scripts\/vault-py\/new_reader\.py:2/);
});

test('破坏实验②：新增 JS 生产读取旁路 → 必红并点名文件:行', () => {
  const root = makeTree({
    'scripts/quality/some-check.mjs': 'const n = 1;\nconst t = fs.readFileSync("data/theschema/ontology.yaml");\n',
  });
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /scripts\/quality\/some-check\.mjs:2/);
});

test('破坏实验③：基线文件超上限 → 红（只减不增的增侧执法）', () => {
  const root = makeTree({
    'scripts/quality/check-wave0.mjs': Array.from({ length: 4 }, () => 'fs.readFileSync("enums.yaml");\n').join(''),
  });
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /check-wave0\.mjs:4/);
});

test('JS 测试面不在执法面（与 ADR §一 9 点口径一致）；行注释不算', () => {
  const root = makeTree({
    '__tests__/fixture.test.mjs': 'const t = fs.readFileSync(path.join(fx, "enums.yaml"));\n',
    'scripts/quality/note.mjs': '// 参见 data/theschema/enums.yaml\n',
    'scripts/vault-py/comment.py': '# enums.yaml 只在注释里出现\n',
  });
  const { code, out } = runGate(root);
  assert.equal(code, 0, out);
});

test('symlink 物理去重：同一物理文件两个入口只计一次（A 类 symlink 不误红）', () => {
  // WP-052 T3：kb_paths 基线行已退役——改用 archive-enums-legacy.py（上限 3）构造同款场景
  const baselineShaped = withBaseline(makeTree({ 'scripts/vault-runtime/archive-enums-legacy.py': 'a = "enums.yaml"\nb = "enums.yaml"\nc = "enums.yaml"\n' }), { 'scripts/vault-runtime/archive-enums-legacy.py': 3 });
  fs.mkdirSync(path.join(baselineShaped, 'server'), { recursive: true });
  fs.symlinkSync(path.join(baselineShaped, 'scripts/vault-runtime/archive-enums-legacy.py'), path.join(baselineShaped, 'server/vault-runtime-link.py'));
  const linked = runGate(baselineShaped);
  assert.equal(linked.code, 0, linked.out); // 3 命中＝基线上限，symlink 副本不计第 4 次
});

// ── WP-053 V-C：词法追踪面破坏实验（跨行旁路必红）──
test('V-C 破坏实验④：跨行间接读（变量赋值→读取调用）→ 必红并点名', () => {
  const root = makeTree({
    'scripts/quality/indirect-reader.mjs': [
      'const p = path.join(dir, "enums.yaml");',
      'const data = fs.readFileSync(p, "utf8");',
    ].join('\n'),
  });
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /indirect-reader\.mjs:2/);
});

test('V-C 正例：端口内文件词法面豁免；无读取调用的 basename 变量不误伤', () => {
  const root = makeTree({
    'server/shared/vocab-load-port.cjs': 'const p = path.join(dir, "enums.yaml");\nconst data = fs.readFileSync(p, "utf8");\n',
    'scripts/quality/namer.mjs': 'const label = "enums.yaml 是词表";\nconsole.log(label);\n',
  });
  const { code, out } = runGate(root);
  assert.equal(code, 0, out);
});

// ── WP-084：基线从门禁文件内联 map 搬进 contracts/vocab-load-baseline.json（PR-208 剩余半边第一处消灭）──

test('WP-084 破坏实验⑤：夹具根无基线文件＝无上限，同样三命中必须红（缺省不静默放行）', () => {
  const root = makeTree({ 'scripts/vault-runtime/archive-enums-legacy.py': 'a = "enums.yaml"\nb = "enums.yaml"\nc = "enums.yaml"\n' });
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /archive-enums-legacy\.py:1/);
  assert.match(out, /violations=3/);
});

test('WP-084 真仓等值自证：搬家前后判据与数值逐条相同（并源不并语义，此断言红即说明搬动改了口径）', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const baseline = JSON.parse(fs.readFileSync(path.join(repoRoot, 'contracts', 'vocab-load-baseline.json'), 'utf8'));
  // 迁移版数值＝原 check-vocab-load-port.mjs 内联 map（15 条，上限合计 33；出处：本仓 main de008f67 版本）
  assert.equal(Object.keys(baseline.entries).length, 15, '条目数须与手抄版一致');
  assert.equal(Object.values(baseline.entries).reduce((a, b) => a + b, 0), 33, '上限合计须与手抄版一致（33）——收紧数值是独立动作，须同批 --write 并写明');
  assert.equal(baseline.expiresAt, '2026-12-31', '失效日期随基线走，不再在代码里手抄第二份');
  assert.equal(baseline.generator, 'scripts/quality/check-vocab-load-port.mjs');
  assert.match(baseline.generated_by, /--write/);
  const { code, out } = runGate(repoRoot);
  assert.equal(code, 0, out);
  assert.match(out, /vocab_load_port=ok baseline_remaining=33\/33 expires=2026-12-31/);
});

test('WP-084 承重自证：门禁源码里不得再出现手抄基线 map（残留即红）', () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-vocab-load-port.mjs'), 'utf8');
  assert.ok(!/const BASELINE = \{/.test(src), '内联手抄 map 回来了——本批消灭的东西不许复活');
  assert.ok(!/const BASELINE_EXPIRES = /.test(src), '失效日期也不许在代码里再抄一份');
  assert.ok(/export function loadBaseline/.test(src), '读单源的入口须在场');
});
