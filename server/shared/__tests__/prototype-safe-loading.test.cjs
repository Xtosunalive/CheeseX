'use strict';
// WP-050 D-A（SPEC-045 D1/D4）：原型安全装载——P1 词表面址探针（正/反/对照三例）。
// 反例键＝P1 判据保留名族（constructor/toString/valueOf/__proto__）作内容键；
// 断言＝不抛 TypeError、不静默污染（显式报错或语义正确），对照键行为不变。
// 层级：纯单元（对象面＝装载产物与站点闭集，无 fs/进程）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ── D1 机制面：端口产物五键不可表达 ──
const { loadVocabBundle } = require('../../../server/shared/vocab-load-port.cjs');

function makeVocabTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-vocab-'));
  const ts = path.join(dir, 'theschema');
  fs.mkdirSync(ts, { recursive: true });
  fs.writeFileSync(path.join(ts, 'enums.yaml'), 'domains: {}\nlayer_aliases:\n  A: ""\n  B: []\n');
  fs.writeFileSync(path.join(ts, 'versions.yaml'), 'products:\n  ghost:\n    versions:\n      - id: 1.0.0\n        aliases: []\n');
  fs.writeFileSync(path.join(ts, 'ontology.yaml'), 'node_types: {}\nrelation_types: {}\n');
  fs.writeFileSync(path.join(ts, 'fields.yaml'), 'fields: []\n');
  fs.writeFileSync(path.join(ts, 'dependencies.yaml'), 'dependencies: []\n');
  return { dir, ts };
}


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
test('D1 端口产物：五保留键全 undefined（data/raw 两视图）＋正常键不受影响', () => {
  const { dir, ts } = makeVocabTree();
  const prev = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = ts;
  try {
    const bundle = loadVocabBundle(dir);
    const KEYS = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
    for (const key of KEYS) {
      assert.equal(bundle.files.versions.data.products[key], undefined, `data.products[${key}] 应 undefined`);
      assert.equal(bundle.files.versions.raw.products[key], undefined, `raw.products[${key}] 应 undefined`);
    }
    assert.ok(bundle.files.versions.data.products.ghost, '正常键 ghost 在册');
    assert.deepEqual([...Object.keys(bundle.files.enums.data.layer_aliases)].sort(), ['A', 'B'], '键集保序完整');
    assert.equal(JSON.parse(JSON.stringify(bundle.files.versions.data.products)).ghost.versions.length, 1, 'JSON 往返保真');
  } finally {
    if (prev === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = prev;
  }
});

// ── D4 逐址：文档装载宿主（frontmatter 产物 null 原型）──
// WP-116：版本契约死导出已退役——D4 安全装载纪律由宿主 loadDocument 延续
// （null 原型产物语义相同：保留名内容值作键不可命中原型面，不炸不污染；
// 显式拒因面由下方准入链 A03 用例与 version-contract 既有套件钉）。
const { loadDocument, docField } = require('../../../server/shared/document-load-port.cjs');

test('D4 文档装载宿主：保留名内容值作键 → 不可命中原型面（不炸不污染）；对照语义不变', () => {
  const md = (p) => `---\ntitle: t\nproduct: ${p}\nversion: 1.0.0\n---\n正文`;
  for (const key of ['constructor', 'toString', '__proto__', 'valueOf']) {
    const doc = loadDocument(md(key));
    assert.equal(docField(doc, 'product').value, key, `${key} 作内容值忠实装载`);
    assert.equal(doc.frontmatter[key], undefined, `内容值 ${key} 直取键 → undefined（不可命中原型面）`);
    assert.equal(docField(doc, 'version').state, 'present', `相邻键不受 ${key} 污染`);
  }
  const ghost = loadDocument(md('ghost'));
  assert.equal(ghost.frontmatter.product, 'ghost', '对照：正常值语义不变');
  assert.equal(ghost.frontmatter.version, '1.0.0', '对照：相邻键保全');
});

// ── D4 逐址：value-domain-resolver（操作闭集 null 原型）──
const { resolveValueDomains } = require('../../../server/shared/value-domain-resolver.cjs');

test('D4 value-domain：op=保留名 → 「未知操作」红；缺段报悬空；对照 op 语义不变', () => {
  const base = { enums: { lifecycle: { status: ['在线', '灰度'] } }, versions: {} };
  const mk = (op) => ({ fields: { fields: [{ name: 's', scope: ['entity'], value_domain: { source: 'lifecycle.status', resolve: { op } } }] }, ...base });
  for (const op of ['constructor', 'toString', '__proto__']) {
    const r = require('../../../server/shared/value-domain-resolver.cjs').resolveValueDomains(mk(op));
    assert.ok(r.errors.some((e) => e.includes('未知操作') && e.includes(op)), `${op} → 未知操作红`);
  }
  const ok = resolveValueDomains(mk('values'));
  assert.deepEqual(ok.byField[0].values, ['在线', '灰度'], '对照：values 取段值');
  const dangling = resolveValueDomains({ fields: { fields: [{ name: 's', scope: ['entity'], value_domain: { source: 'no.such', resolve: { op: 'values' } } }] }, ...base });
  assert.ok(dangling.errors.some((e) => e.includes('值域引用悬空')), '缺段报悬空');
});

// ── D4 逐址：formal-relation-selector（内容对象容器 null 原型——保留名证据字段不可命中）──
const frs = require('../../../server/shared/formal-relation-selector.cjs');
const { buildCapabilityRegistry } = require('../../../server/shared/relation-capability-selector.cjs');

test('D4 formal-relation：required_evidence 含保留名 → REQUIRED_EVIDENCE_MISSING（不再判 ALLOWED）；对照证据语义不变', () => {
  const mkRelation = (evidence) => ({ id: 'e1', relationType: 'DEPENDS_ON', source: 'a', target: 'b', properties: { source: 'entity-wikilink', assertion: { status: 'approved', assertedBy: { actorType: 'human' }, evidence } } });
  const def = (required) => ({
    label_cn: '依赖', description: 'd', source_types: ['System'], target_types: ['System'],
    semantic_role: 'architecture_skeleton', candidate_enabled: true, fact_encoding: 'typed_wikilink',
    weight_default: 0.8, direction: 'A → B', projected: true, versionable: true, impact_propagation: 'reverse', legacy_policy: 'keep',
    assertion_policies: [{ source_kind: 'entity-wikilink', producer: 'extract_graph.entity_typed_wikilink', decision_mode: 'reviewed', required_evidence: required, working_projection: 'approved_only', formal_consumers: ['topology'] }],
  });
  const badRegistry = buildCapabilityRegistry({ relation_types: { DEPENDS_ON: def(['constructor', 'target_identity']) } });
  const bad = frs.inspectFormalRelation(badRegistry, mkRelation([{ target_identity: 'b' }]), 'topology');
  assert.equal(bad.reason, 'REQUIRED_EVIDENCE_MISSING', '保留名证据字段不可命中原型——实得 ' + bad.reason);
  const goodRegistry = buildCapabilityRegistry({ relation_types: { DEPENDS_ON: def(['source_revision', 'target_identity']) } });
  const good = frs.inspectFormalRelation(goodRegistry, mkRelation([{ source_revision: 'sha256:x', target_identity: 'b' }]), 'topology');
  assert.equal(good.reason, 'ALLOWED', '对照：真实证据字段语义不变（不因 null 原型误伤）');
});

// ── D4 逐址：confidence-bands（档位值映射 null 原型）──
const { confidenceBandValues } = require('../../../server/shared/confidence-bands.cjs');

test('D4 confidence-bands：保留名档位 → undefined（无档位回落）；对照三档值不变', () => {
  const bands = confidenceBandValues({});
  for (const key of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
    assert.equal(bands[key], undefined, `bands[${key}] 应 undefined`);
  }
  assert.equal(bands.high, 0.85);
  assert.equal(bands.medium, 0.5);
  assert.equal(bands.low, 0.3);
});

// ── D4 逐址：vocabulary-lineage（行表 null 原型——保留名词条回落 blueprint）──
const vl = require('../../../server/services/schema-profiling/vocabulary-lineage.cjs');

test('D4 vocabulary-lineage：保留名词条 → origin=blueprint（不误判 grown）；对照在册词条 grown', () => {
  const rows = { 服务: { route: 'r1', at: '2026-10-01' } };
  const words = [
    { word: '服务', dimension: 'category' },
    { word: 'toString', dimension: 'category' },
    { word: 'constructor', dimension: 'category' },
  ];
  const out = vl.withOrigin(words, rows);
  assert.equal(out[0].origin, 'grown', '对照：在册词条 grown');
  assert.equal(out[1].origin, 'blueprint', 'toString 回落 blueprint');
  assert.equal(out[2].origin, 'blueprint', 'constructor 回落 blueprint');
});

// ── D4 文档面九址探针（经真实规则集/装载面——WP-050 D-C）──
test('D4 准入链：内容 product 保留名 → 显式 blockers（不再 TypeError）；对照在册产品语义不变', async (t) => {
  const fsx = require('node:fs');
  const vault = resolveRealVault();
  if (!vault) { t.skip('无 VAULT_PATH 且无仓内 .env——真库画像用例显式跳过（PR-175）'); return; }
  const aap = require('../../../server/services/article-workflow/article-admission-policy.cjs');
  const md = (p) => `---\ntitle: t\nproduct: ${p}\nversion: 1.0.0\n---\n正文`;
  for (const p of ['constructor', 'toString', '__proto__']) {
    const out = aap.checkAdmissionBlockers(vault, md(p), '知识库/raw/precleaned/x.md');
    assert.ok(Array.isArray(out.blockers), `${p} → blockers 数组（不炸）`);
    assert.ok(out.blockers.some((b) => b.ruleId === 'A03'), `${p} → A03 product 不在册`);
  }
  const ghost = aap.checkAdmissionBlockers(vault, md('ghost'), '知识库/raw/precleaned/x.md');
  assert.ok(Array.isArray(ghost.blockers), '对照：在册/未册统一走 blockers 面（不因装载面炸）');
});

test('D4 master-graph：内容 subdomain_id 保留名 → 不炸不 NaN 不误入原型面', () => {
  const mgs = require('../../../server/services/projection/master-graph-service.cjs');
  const graph = { generatedAt: 't', nodes: [
    { id: 'a', labels: ['Entity'], properties: { subdomain_id: 'toString' } },
    { id: 'b', labels: ['Entity'], properties: { subdomain_id: 'constructor' } },
    { id: 'c', labels: ['Entity'], properties: { subdomain_id: 'sd1' } },
    { id: 'd', labels: ['Document'], properties: {} },
  ], connections: [] };
  const kt = mgs.buildKnowledgeTopology(graph, { limit: 10 });
  assert.ok(!JSON.stringify(kt).includes('NaN'), '无 NaN 计数');
  const tree = mgs.buildTaxonomyTree(graph);
  const poisoned = JSON.stringify(tree);
  assert.ok(!poisoned.includes('"entityCount":NaN'), '分类桶无 NaN');
});

test('D4 anomaly 连线标签：正文 toString::[[X]] → relationTypeStatus=unknown（不再判 known/塞函数）', (t) => {
  const fsx = require('node:fs');
  const vault = resolveRealVault();
  if (!vault) { t.skip('无 VAULT_PATH 且无仓内 .env——真库画像用例显式跳过（PR-175）'); return; }
  const aic = require('../../../server/services/governance/anomaly-issue-collector.cjs');
  const { loadRuleSetForVault } = require('../../../server/services/schema-manager/compliance-rule-set-service.cjs');
  const mk = (type) => aic.candidateIssue({
    issueId: 'i1', title: 't', sourceNodeId: 'n1', targetNodeId: 'n2',
    links: [{ type, target: 'X' }],
    sourcePath: '知识库/wiki/entities/a.md', sourceRevision: 'sha256:x', ruleRevision: 'sha256:y',
    ruleSet: loadRuleSetForVault(vault), knownNodeIds: new Set(), relationRegistry: null,
  });
  const bad = mk('toString');
  assert.ok(!JSON.stringify(bad).includes('function toString'), '不塞 JS 函数原文');
  const statuses = [];
  (function find(obj) {
    if (Array.isArray(obj)) return obj.forEach(find);
    if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (k === 'relationTypeStatus') statuses.push(v); find(v); }
  })(bad);
  assert.ok(statuses.every((s) => s === 'unknown'), 'toString → unknown（不误判 known）');
  const good = mk('依赖');
  const goodStatuses = [];
  (function find2(obj) {
    if (Array.isArray(obj)) return obj.forEach(find2);
    if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (k === 'relationTypeStatus') goodStatuses.push(v); find2(v); }
  })(good);
  assert.ok(goodStatuses.every((s) => s === 'known'), '对照：依赖 → known');
});

test('D4 gap 文案：labels 含 constructor → 「其他类型」（不渲染函数原文）', () => {
  const { plainLabels } = require('../../../server/services/anomaly/gap-detail-declarations.cjs');
  assert.equal(plainLabels(['constructor']), '其他类型');
  assert.equal(plainLabels(['toString']), '其他类型');
});

test('D4 entity-repair 版本闸：内容 product 保留名 → 显式 400 VALIDATION_ERROR（不再 TypeError→500）', (t) => {
  const fsx = require('node:fs');
  const vault = resolveRealVault();
  if (!vault) { t.skip('无 VAULT_PATH 且无仓内 .env——真库画像用例显式跳过（PR-175）'); return; }
  const { loadRuleSetForVault } = require('../../../server/services/schema-manager/compliance-rule-set-service.cjs');
  const rs = loadRuleSetForVault(vault);
  for (const p of ['constructor', 'toString', '__proto__']) {
    const allowedVersions = (rs.versionsByProduct || {})[p] || [];
    assert.deepEqual(allowedVersions, [], `${p} → 空版本集（显式 400 面，非原型命中）`);
  }
});
