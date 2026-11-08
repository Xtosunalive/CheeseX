'use strict';
// PR-165（DDL 单源双端执行）：三面测试——单源文件完整性、桩真跑行为、投递面元执法。
// 层级标注：本文件属「纯单元＋真实子进程行为」层——桩以真实 python3 进程执行、
// SQLite 以真实文件落库断言；不冒充 HTTP e2e（那由 dashboard 流 nightly 承载）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PYTHON = process.env.PYTHON_PATH || 'python3';
const SQL_FILE = path.join(ROOT, 'scripts', 'vault-py', 'graph', 'document_index.sql');
const STUB = path.join(ROOT, 'test', 'fixtures', 'minimal-vault', '知识库', '.claude', 'scripts', 'pipeline-runner.py');
const BUILDER = path.join(ROOT, 'scripts', 'e2e', 'lib', 'build-e2e-vault.mjs');

// 投递件的同目录依赖扫描谓词（面 3／面 4 共用，不另抄一份）。
// 两种词法形态都必须认，缺一即是对本事故形态失明（2026-11-06 nightly 文章流 promote 500 实证）：
//   ①行首缩进——函数级 import 是 Python 破环常规写法（write_gateway→human_edit_guard 即此形态，
//     旧谓词 `^(?:import|from)` 只认行首，对本面自己举的例失明）；
//   ②`import a, b, c` 逗号多名——旧谓词只取首名（桩 pipeline-runner 的 json, os, sqlite3, sys, time）。
// `from X import a, b` 的依赖是 X，不拆逗号（否则把属性名当模块＝假阳）。
function scanImportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/^[ \t]*(import|from)\s+([^\n#]+)/gm)) {
    const clause = m[2];
    const mods = m[1] === 'from' ? [clause.split(/\s+import\b/)[0]] : clause.split(',');
    for (const raw of mods) {
      const mod = raw.trim().split(/\s+as\s+/)[0].split('.')[0].replace(/["'()]/g, '');
      if (/^[A-Za-z_]\w*$/.test(mod)) names.add(mod);
    }
  }
  return names;
}

// 投递面真身派生（面 3／面 4 共用，不另抄一份）。
// 旧取法直接把 builder 里的 "知识库/.claude/scripts/…" 路径字面量当投递清单——而那些字面量
// 全部住在 required 自检数组内，等于拿「声明要自检的件」冒充「真投递的件」：撤掉 copyFromRuntime
// 一行只留 required 项，本执法面毫无反应（2026-11-06 破坏实验实测：pass 6 fail 0）。
// 现取法＝真实调用点并集：copyFromRuntime/symlinkFromRuntime 件名 ＋ required 块外的路径字面量。
function deriveDelivery(builderSrc) {
  const requiredBlock = builderSrc.match(/const required = \[([\s\S]*?)\]/);
  assert.ok(requiredBlock, '构建器必须保留 required 自检数组');
  const required = new Set([...requiredBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const outside = builderSrc.replace(requiredBlock[0], 'const required = [];');
  const delivered = new Set([
    ...outside.matchAll(/"知识库\/\.claude\/scripts\/([^"]+)"/g),
    ...outside.matchAll(/(?:copyFromRuntime|symlinkFromRuntime)\("([^"]+)"\)/g),
  ].map((m) => `知识库/.claude/scripts/${m[1]}`));
  return { required, delivered, requiredPaths: [...required].filter((p) => p.startsWith('知识库/.claude/scripts/')) };
}

function py(script, extraEnv = {}) {
  return execFileSync(PYTHON, ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

// ── 面 1：单源文件自身完整性（schema 段可执行、模板与列对齐、extracted_at 由 datetime('now') 填充）──
test('document_index.sql 单源完整性：schema 可执行、11 列、模板列与占位符对齐、extracted_at 落库', () => {
  const out = py(`
import json, sqlite3, sys
sys.path.insert(0, ${JSON.stringify(path.dirname(SQL_FILE))})
lines = open(${JSON.stringify(SQL_FILE)}, encoding="utf-8").read().splitlines()
schema_lines, template = [], None
for line in lines:
    if line.startswith("-- insert-template:"):
        template = line.split(":", 1)[1].strip()
    elif not line.lstrip().startswith("--"):
        schema_lines.append(line)
assert template, "缺 insert-template 行"
db = sqlite3.connect(":memory:")
db.executescript("\\n".join(schema_lines))
cols = [r[1] for r in db.execute("PRAGMA table_info(document_index)")]
tpl_cols = template[template.index("(") + 1 : template.index(")")].replace(" ", "").split(",")
placeholders = template.count("?")
db.execute(template, tuple(f"v{i}" for i in range(placeholders)))
row = db.execute("SELECT extracted_at FROM document_index WHERE node_id='v0'").fetchone()
print(json.dumps({"cols": cols, "tpl_cols": tpl_cols, "placeholders": placeholders,
                  "extracted_at": row[0] if row else None}))
`);
  const r = JSON.parse(out);
  const EXPECTED = [
    'node_id', 'file_path', 'file_mtime', 'module',
    'arch_layer', 'arch_layer_canonical', 'arch_category', 'arch_category_canonical',
    'arch_subdomain', 'arch_subdomain_canonical', 'extracted_at',
  ];
  assert.deepEqual(r.cols, EXPECTED, 'schema 段执行后必须得到 11 列（单源即真身）');
  assert.deepEqual(r.tpl_cols, EXPECTED, 'insert-template 列清单必须与表列完全一致');
  assert.equal(r.placeholders, EXPECTED.length - 1, '占位符数＝列数−1（extracted_at 为 datetime 字面量）');
  assert.ok(r.extracted_at, 'extracted_at 必须由 datetime(\'now\') 真实填充');
});

// ── 面 2：桩真跑（修前红锚点：生成链时代桩 import 即崩 / INSERT 截断报 incomplete input）──
test('e2e 桩真跑：单源建表插入、11 列落库、runtime-state 经网关落行', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-ssot-'));
  const scripts = path.join(tmp, 'vault', '知识库', '.claude', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  // 复刻 build-e2e-vault 的投递面：桩（fixture）＋单源 DDL＋网关两件（vault-runtime）
  for (const f of ['pipeline-runner.py']) fs.copyFileSync(path.join(path.dirname(STUB), f), path.join(scripts, f));
  for (const f of ['document_index.sql']) fs.copyFileSync(path.join(ROOT, 'scripts', 'vault-py', 'graph', f), path.join(scripts, f));
  for (const f of ['_runtime_state_db.py', '_vault_ledger.py', 'kb_paths.py']) {
    fs.copyFileSync(path.join(ROOT, 'scripts', 'vault-runtime', f), path.join(scripts, f));
  }
  const entities = path.join(tmp, 'vault', '知识库', 'wiki', 'entities');
  fs.mkdirSync(entities, { recursive: true });
  fs.writeFileSync(path.join(entities, 'ssot-test-entity.md'), [
    '---',
    'architecture-node-id: ssot-test-entity',
    'module: e2e-module',
    'arch_layer: service',
    'arch_category: 服务',
    'arch_subdomain: auth',
    '---',
    '',
    '# 单源测试实体',
    '',
  ].join('\n'), 'utf8');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  execFileSync(PYTHON, [path.join(scripts, 'pipeline-runner.py')], {
    encoding: 'utf8',
    env: { ...process.env, KB_VAULT: path.join(tmp, 'vault'), KB_DATA_DIR: dataDir },
  });

  const check = py(`
import json, sqlite3
mg = sqlite3.connect(${JSON.stringify(path.join(dataDir, 'master_graph.db'))})
cols = [r[1] for r in mg.execute("PRAGMA table_info(document_index)")]
row = mg.execute("SELECT module, arch_layer, arch_subdomain, extracted_at FROM document_index WHERE node_id='ssot-test-entity'").fetchone()
rs = sqlite3.connect(${JSON.stringify(path.join(dataDir, 'runtime-state.db'))})
runs = rs.execute("SELECT count(*) FROM pipeline_runs").fetchone()[0]
summary = json.loads(rs.execute("SELECT run_json FROM pipeline_runs ORDER BY seq DESC LIMIT 1").fetchone()[0])
ver = json.loads(rs.execute("SELECT version_json FROM pipeline_version WHERE id=1").fetchone()[0])
print(json.dumps({"cols": cols, "row": row, "runs": runs,
                  "status": summary.get("status"), "sha": ver.get("master_graph_sha256")}))
`);
  const r = JSON.parse(check);
  assert.equal(r.cols.length, 11, 'document_index 必须 11 列（单源建表）');
  assert.ok(r.row, '实体行必须落库');
  assert.equal(r.row[0], 'e2e-module');
  assert.ok(r.row[3], 'extracted_at 必须填充');
  assert.ok(r.runs >= 1, 'pipeline_runs 必须经网关落行');
  assert.equal(r.status, 'success');
  assert.match(r.sha || '', /^[0-9a-f]{64}$/, '版本指纹 sha256 必须落库');
});

// ── 面 3：投递面元执法（openbkn 模式——护栏的护栏：增删投递物不自检即红）──
test('投递面元执法：桩的文件依赖必须在构建器复制清单与 required 自检清单', () => {
  const builderSrc = fs.readFileSync(BUILDER, 'utf8');
  const stubSrc = fs.readFileSync(STUB, 'utf8');

  // 构建器投递清单＝真实调用点派生；required 自检清单＝数组原文（同派生器供两栏）
  const { delivered, required, requiredPaths } = deriveDelivery(builderSrc);
  // 双向对账：自检项必须有投递调用点与之对应（撤 copyFromRuntime 只留自检项＝声明投递而实未投递）
  for (const item of requiredPaths) {
    assert.ok(delivered.has(item), `required 自检项 ${item} 无投递调用点——声明要它却在投递面不存在（撤投递行只留自检行的形态）`);
  }

  // 桩的本地文件依赖：import 的本地模块（非标准库）＋ open 的同目录件名
  const STDLIB = new Set(['json', 'os', 'sqlite3', 'sys', 'time', 'hashlib']);
  const deps = new Set();
  for (const n of scanImportedNames(stubSrc)) {
    if (!STDLIB.has(n)) deps.add(`知识库/.claude/scripts/${n}.py`);
  }
  for (const m of stubSrc.matchAll(/"([\w.-]+\.sql)"/g)) deps.add(`知识库/.claude/scripts/${m[1]}`);
  assert.ok(deps.size >= 2, '桩至少依赖 _runtime_state_db 与 document_index.sql（解析面失效即红）');

  for (const dep of deps) {
    assert.ok(delivered.has(dep), `桩依赖 ${dep} 必须在构建器投递清单（PR-165 P0-2 复发即红）`);
    assert.ok(required.has(dep), `投递物 ${dep} 必须进 required 自检清单（清单缺项即红）`);
  }
  for (const item of delivered) {
    assert.ok(required.has(item), `投递物 ${item} 无自检项——投递不自检是 PR-165 事故原形态`);
  }
});

// ── 面 4（PR-166 泛化）：全部投递 .py 的本地 import 必须可解析到投递清单 ──
// 事故形态：65aee107 把 Python 写者迁 write_gateway 后，promote-article/sa_projection_support
// 新增同目录依赖而投递清单未跟上——钉 VAULT_RUNTIME_SCRIPTS_DIR 形态（CI nightly）import 即崩
// （2026-10-14 _vault_ledger 同族第二次复发）。本面把「桩依赖对账」泛化为「全投递件依赖对账」。
test('投递面元执法泛化：每个投递 .py 的本地 import 均在投递清单（write_gateway 类缺口即红）', () => {
  const builderSrc = fs.readFileSync(BUILDER, 'utf8');
  const { delivered } = deriveDelivery(builderSrc);
  // 解释器级依赖：标准库＋已装第三方（yaml/jsonschema 住解释器不在脚本位）
  const INTERPRETER = new Set([
    '__future__', 'json', 'os', 'sys', 're', 'time', 'sqlite3', 'hashlib', 'subprocess', 'argparse',
    'tempfile', 'shutil', 'uuid', 'datetime', 'pathlib', 'typing', 'collections', 'functools',
    'contextlib', 'dataclasses', 'enum', 'io', 'codecs', 'platform', 'traceback', 'math', 'glob',
    'stat', 'signal', 'logging', 'warnings', 'csv', 'textwrap', 'unicodedata', 'xml', 'copy',
    'yaml', 'jsonschema', 'shlex', 'fnmatch', 'urllib', 'base64', 'random', 'string', 'itertools',
    'operator', 'threading', 'struct', 'types', 'heapq', 'bisect', 'zlib', 'gzip', 'socket',
    'concurrent', // pipeline-runner 函数级 from concurrent.futures（标准库包名）
    'ruamel', // human_edit_guard 的第三方 YAML 依赖——须由 CI pip 步骤声明（quality.yml），非脚本位投递物
  ]);
  const pyScripts = [...delivered].filter((p) => p.endsWith('.py'));
  assert.ok(pyScripts.length >= 8, '投递 .py 至少八件（解析面失效即红）');
  for (const rel of pyScripts) {
    const name = rel.split('/').pop();
    const runtimeCopy = path.join(ROOT, 'scripts', 'vault-runtime', name);
    const src = fs.existsSync(runtimeCopy)
      ? fs.readFileSync(runtimeCopy, 'utf8') // copyFromRuntime 件：真身住仓内
      : fs.readFileSync(path.join(ROOT, 'test/fixtures/minimal-vault', rel), 'utf8'); // fixture 件（桩）
    const scanned = scanImportedNames(src);
    for (const n of scanned) {
      if (INTERPRETER.has(n)) continue;
      assert.ok(
        delivered.has(`知识库/.claude/scripts/${n}.py`),
        `${name} import ${n}——该同目录依赖未投递（PR-166 事故形态：钉 scripts 目录形态即 ModuleNotFoundError）`,
      );
    }
  }
  // 扫描面自证伪（两把，各钉一种词法形态）：谓词退回旧写法即红，不许靠被防对象在场默证。
  // 均锚在**具体那件**上，不取全投递件并集——并集会被别的单名 import 补齐，锚就成了空的。
  assert.ok(
    scanImportedNames(fs.readFileSync(path.join(ROOT, 'scripts', 'vault-runtime', 'write_gateway.py'), 'utf8')).has('human_edit_guard'),
    '扫描面必须从 write_gateway 的函数级（缩进）import 抓到 human_edit_guard——谓词退回行首锚定＝执法面对本事故形态失明',
  );
  const stubNames = scanImportedNames(fs.readFileSync(STUB, 'utf8'));
  for (const n of ['os', 'sqlite3', 'sys', 'time']) {
    assert.ok(
      stubNames.has(n),
      `扫描面必须吃下桩的 \`import json, os, sqlite3, sys, time\` 逗号多名，缺 ${n}＝谓词退化为只取首名`,
    );
  }
});

// ── 面 5（PR-165 收口批·入口唯一＋世界冻结）：平行替身生态出生即红 ──
// 结构性收敛（Master 2026-10-31「做」）：把「以后出现平行生态再说」钉死为「出现即红」——
// ①全仓含「知识库/.claude/scripts」替身世界的测试夹具恰为 minimal-vault（登记的唯一世界）；
// ②该世界文件清单冻结——生成器/第二写者往夹具长新件（PR-162 生成物病返潮形态）即红。
// 新增替身世界前必须先改本面登记（模式库 P13：不允许未看管的投递面存在）。
test('替身世界入口唯一＋文件冻结：平行生态出生或生成物返潮即红', () => {
  const FIXTURES = path.join(ROOT, 'test', 'fixtures');
  const worlds = fs
    .readdirSync(FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(FIXTURES, name, '知识库', '.claude', 'scripts')));
  assert.deepEqual(
    worlds.sort(),
    ['minimal-vault'],
    '全仓脚本替身世界必须唯一——发现第二个夹具替身世界：先并入本执法面登记（模式库 P13），不允许未看管的投递面存在',
  );
  const worldDir = path.join(FIXTURES, 'minimal-vault', '知识库', '.claude', 'scripts');
  const entries = fs.readdirSync(worldDir).sort();
  assert.deepEqual(
    entries,
    ['pipeline-runner.py'],
    '登记替身世界文件冻结——发现清单外新件：生成器/第二写者返潮形态（PR-162 病）；变更须显式改本冻结单并说明',
  );
});

// ── 面 6：e2e 单跑别名必须回指 tests[] 单源，不得抄第二份脚本路径 ──
// 事故形态：五个 test:e2e:* 别名各自硬写 scripts/e2e/<flow>.e2e.mjs，eb05e587（WP-096/T3）
// 把旧自研件退役改跑 playwright 运行器后无人同步——至 2026-11-06 实测 `npm run test:e2e:article`
// 仍 MODULE_NOT_FOUND，README 还在宣传该用法。本面把「别名↔流清单」钉成对账：抄第二份源即红。
test('e2e 单跑别名对账：每个 test:e2e:* 经 --only 命中 tests[] 现存流名，且不在 package.json 另写脚本路径', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  const runnerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'e2e', 'run-all-e2e.mjs'), 'utf8');
  // tests[] 的流名＝数组条目里 4 空格缩进的 name: 字段（Safety Net 等 push 内的内联 name 不入集）
  const flowNames = [...runnerSrc.matchAll(/^ {4}name:\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(flowNames.length >= 7, `tests[] 至少七条流（当前解析到 ${flowNames.length} 条——提取面失效即红，勿改判据来凑）`);

  const aliases = Object.keys(scripts).filter((k) => k.startsWith('test:e2e:') && k !== 'test:e2e');
  assert.ok(aliases.length >= 5, `test:e2e:* 单跑别名至少五条（当前 ${aliases.length} 条——被删而不补即红）`);
  for (const key of aliases) {
    const cmd = scripts[key];
    const m = cmd.match(/^node scripts\/e2e\/run-all-e2e\.mjs --only "(.+)"$/);
    assert.ok(
      m,
      `${key} 必须形如 node scripts/e2e/run-all-e2e.mjs --only "<子串>"（现值：${cmd}）——直写脚本文件＝抄第二份源，漂移即悬空引用`,
    );
    const hits = flowNames.filter((n) => n.toLowerCase().includes(m[1].toLowerCase()));
    assert.ok(hits.length >= 1, `${key} 的 --only "${m[1]}" 未命中 tests[] 任何流名（悬空别名——本面要防的原形态）`);
    // 单跑别名须恰指一条：子串命中多条时「单跑」语义即失效（--only "a" 这类过宽写法不得混进别名表）
    assert.equal(hits.length, 1, `${key} 的 --only "${m[1]}" 命中 ${hits.length} 条流，非单跑：${hits.join("、")}`);
  }
});
