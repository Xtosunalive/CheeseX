'use strict';
// WP-138 R5b（SPEC-087 C-6）：文档键源单点 document-keys.cjs——
//   ① 键名值逐字钉死（等价替换的安全网：值漂移即红）；
//   ② 与契约 entity-readiness-rules.json article.fields 双向对账（生成优先：契约是表单形状唯一事实源）；
//   ③ 归零 meter：六落点 frontmatter 派生键名的手抄「键访问/键清单」结构位＝0（可一键复算），
//      裸词残量 ⊆ 豁免登记表（文案／判别值／注释——名单只减不增）；
//   ④ 消费钉：六落点服务文件均 require 本单点。
// 层级：纯单元（①②④）＋ 源码扫描（③——扫描的是仓库工作树源文件）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ARTICLE, ENTITY, GRAPH } = require('../document-keys.cjs');

// ① 键名值逐字钉死（＝frontmatter 里的逐字拼写；漂移即红——消费方行为随之漂移）
test('ARTICLE 族键名逐字钉死（契约在册 12 键＋托管/溯源 4 键＋legacy 2 拼写）', () => {
  assert.deepEqual({ ...ARTICLE }, {
    articleId: 'article_id',
    title: 'title',
    product: 'product',
    version: 'version',
    module: 'module',
    articleType: 'article_type',
    docType: 'doc-type',
    docTypeLegacy: 'doc_type',
    categoryPath: 'category-path',
    categoryPathLegacy: 'category_path',
    tags: 'tags',
    body: 'body',
    archLayer: 'arch_layer',
    archCategory: 'arch_category',
    sourceFile: 'source_file',
    date: 'date',
    updated: 'updated',
    status: 'status',
  });
});

test('ENTITY 族键名逐字钉死（身份/生长/版本区间/托管＋legacy 拼写）', () => {
  assert.deepEqual({ ...ENTITY }, {
    architectureNodeId: 'architecture-node-id',
    architectureNodeIdLegacy: 'architecture_node_id',
    archComponent: 'arch_component',
    archLayer: 'arch_layer',
    archCategory: 'arch_category',
    archSubdomain: 'arch_subdomain',
    archSince: 'arch_since',
    archUntil: 'arch_until',
    archVersionOverrides: 'arch_version_overrides',
    title: 'title',
    module: 'module',
    aliases: 'aliases',
    tags: 'tags',
    date: 'date',
    updated: 'updated',
    status: 'status',
  });
});

test('GRAPH 族键名逐字钉死（extract_graph 搬进 properties 袋的 frontmatter 派生键）', () => {
  assert.deepEqual({ ...GRAPH }, { subdomainId: 'subdomain_id', domainId: 'domain_id', name: 'name' });
});

test('三族均冻结；族内值唯一；跨族共拼写一致（title/module/tags/date/updated/status）', () => {
  for (const family of [ARTICLE, ENTITY, GRAPH]) {
    assert.equal(Object.isFrozen(family), true, '族对象必须冻结（键名清单不可被运行时改写）');
    const values = Object.values(family);
    assert.equal(new Set(values).size, values.length, '族内键名值不得重复');
  }
  for (const shared of ['title', 'module', 'tags', 'date', 'updated', 'status']) {
    assert.equal(ARTICLE[shared], ENTITY[shared], `跨族共拼写 ${shared} 必须一致`);
  }
});

// ② 生成优先：契约对账（article.fields 表单形状键集 ≡ ARTICLE 契约在册子集，双向）
test('契约对账：article.fields 键集 ≡ ARTICLE 值集 − {托管/溯源 4 键}（双向）', () => {
  const readiness = require('../../../contracts/entity-readiness-rules.json');
  const contractKeys = Object.keys(readiness.article.fields).filter((k) => k !== '$comment');
  const managedOrLineage = new Set([ARTICLE.sourceFile, ARTICLE.date, ARTICLE.updated, ARTICLE.status]);
  // legacy 拼写（doc_type/category_path）是契约键的存量别名，不是契约独立条目——对账时归并到主键
  const legacyAliases = new Set([ARTICLE.docTypeLegacy, ARTICLE.categoryPathLegacy]);
  const declaredContractSide = Object.values(ARTICLE).filter((k) => !managedOrLineage.has(k) && !legacyAliases.has(k)).sort();
  for (const legacy of legacyAliases) {
    assert.equal(contractKeys.includes(legacy), false, `legacy 拼写 ${legacy} 不应单独入契约（它是契约键的存量别名）`);
  }
  assert.deepEqual(declaredContractSide, [...contractKeys].sort(),
    'ARTICLE 契约在册键必须与契约 article.fields 双向相等（缺一/多一都红）');
  for (const key of managedOrLineage) {
    assert.equal(contractKeys.includes(key), false, `托管/溯源键 ${key} 不应在契约表单段（它不是表单字段）`);
  }
});

// ③ 归零 meter（可一键复算）：扫描六落点服务源文件
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_FILES = [
  'server/services/projection/master-graph-service.cjs',
  'server/shared/version-contract.cjs',
  'server/services/governance/anomaly-issue-collector.cjs',
  'server/services/anomaly/gap-detail-declarations.cjs',
  'server/services/entity-compliance/entity-repair-service.cjs',
  ...fs.readdirSync(path.join(REPO_ROOT, 'server/services/article-workflow'))
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => `server/services/article-workflow/${f}`),
].filter((f, i, arr) => arr.indexOf(f) === i);

// 结构位（键访问/键清单的语法位）——这些位置出现手抄键名字面量即红，无豁免。
const KEY_WORDS = [
  'article_id', 'article_type', 'doc-type', 'doc_type', 'category-path', 'category_path',
  'architecture-node-id', 'architecture_node_id', 'arch_component', 'arch_layer', 'arch_category',
  'arch_subdomain', 'arch_since', 'arch_until', 'arch_version_overrides', 'subdomain_id', 'domain_id',
  'source_file', 'title', 'product', 'version', 'module', 'tags', 'date', 'updated', 'status',
  'aliases', 'body', 'name',
];
// 剥注释（行注释整行＋行尾 //——行尾拼接会误伤含 // 的字符串，故行尾剥离仅当 // 前是空白或代码边界；
// 六落点无含 // 的键名字符串，误伤面为空，探测到即人工核对）
function stripComments(line) {
  const code = line.replace(/(^|\s)\/\/.*$/, '$1');
  return code.trim().length === 0 || /^\s*\* /.test(line) || line.trim().startsWith('/*') ? '' : code;
}

function buildPatterns() {
  const alt = KEY_WORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return [
    new RegExp(`\\b(?:frontmatter|fm|current|props)\\.(${alt})\\b`),
    new RegExp(`\\b(?:frontmatter|fm|current|props|changes|fields|userChanges|effectiveChanges|properties)\\[["'](${alt})["']\\]`),
    new RegExp(`\\b(?:documentText|docField|docFieldClosedSet)\\([^,()]*,\\s*["'](${alt})["']`),
    new RegExp(`\\b(?:fill|suggest)\\(\\s*["'](${alt})["']`),
  ];
}

// 裸词残量豁免登记表（只减不增；每条＝仍含键名拼写的一行代码的判别子串）：
//   用户可见文案／错误消息里的字段名提述（不是键访问位）；
//   identitySource 判别值（document-identity 出参标签集「article_id|sourcePath」——值域住
//   document-identity.cjs，非六落点，改值即改 record 语义）。
const EXEMPT_LINES = [
  'const categoryError = configured ? validateCategoryPath(value, ruleSet) : "category-path 尚未配置录入规则";',
  'throw invalidPath("source_file 须为归档角色内的相对路径");',
  'plan.warnings.push("未找到 source_file 溯源锚——归档副本不在本次清理范围（需人工确认）");',
  'plan.warnings.push("source_file 指向的归档件不存在（悬空）");',
  '"article_id 在候选目录中重复"',
  'value.identitySource === "article_id"',
  'const articleId = identitySource === "article_id" ? legacyArticleId : "";',
  'record.identitySource = "article_id";',
  'articleId ? "article_id" : "sourcePath"',
];

test('归零 meter：六落点零手抄键访问/键清单结构位；裸词残量 ⊆ 豁免登记表', () => {
  const patterns = buildPatterns();
  const violations = [];
  const bareResidual = [];
  for (const rel of SCAN_FILES) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, idx) => {
      const code = stripComments(line);
      if (code === '') return;
      for (const re of patterns) {
        if (re.test(code)) violations.push(`${rel}:${idx + 1} 结构位手抄键名: ${code.trim().slice(0, 120)}`);
      }
      // 裸词抽查：无歧义多词键（不含 title/name 等常见词——它们由结构位覆盖）
      const unambiguous = ['article_id', 'article_type', 'doc-type', 'doc_type', 'category-path', 'category_path',
        'architecture-node-id', 'architecture_node_id', 'arch_component', 'arch_layer', 'arch_category',
        'arch_subdomain', 'arch_since', 'arch_until', 'arch_version_overrides', 'subdomain_id', 'domain_id', 'source_file'];
      if (unambiguous.some((k) => new RegExp(`\\b${k.replace(/-/g, '\\-')}\\b`).test(code)) && !/DK\.(ARTICLE|ENTITY|GRAPH)/.test(code)) {
        bareResidual.push({ rel, line: idx + 1, text: code.trim() });
      }
    });
  }
  assert.deepEqual(violations, [], '结构位不得出现手抄键名（键名一律经 document-keys 单点）');
  const unregistered = bareResidual.filter((r) => !EXEMPT_LINES.some((e) => r.text.includes(e)));
  assert.deepEqual(unregistered, [], `裸词残量必须逐一登记豁免（文案/判别值），未登记: ${JSON.stringify(unregistered, null, 1)}`);
});

// ④ 消费钉：六落点全部 require 本单点（键源收口不是声明完就算——消费方必须真接线）
test('消费钉：六落点服务文件均 require document-keys 单点', () => {
  const REQUIRED_CONSUMERS = [
    'server/services/projection/master-graph-service.cjs',
    'server/shared/version-contract.cjs',
    'server/services/governance/anomaly-issue-collector.cjs',
    'server/services/anomaly/gap-detail-declarations.cjs',
    'server/services/entity-compliance/entity-repair-service.cjs',
    'server/services/article-workflow/article-admission-policy.cjs',
    'server/services/article-workflow/article-compliance-service.cjs',
    'server/services/article-workflow/article-draft-workflow.cjs',
    'server/services/article-workflow/article-workflow-service.cjs',
    'server/services/article-workflow/article-workflow-store.cjs',
    'server/services/article-workflow/article-lifecycle-reconciler.cjs',
    'server/services/article-workflow/draft-source-scanner.cjs',
  ];
  const missing = [];
  for (const rel of REQUIRED_CONSUMERS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const isConsumer = /require\(["'][^"']*document-keys\.cjs["']\)/.test(src);
    // version-contract／gap-detail 今日无 frontmatter 键访问位——不强制接线，只登记零消费事实
    const hasKeySurface = rel.includes('version-contract') || rel.includes('gap-detail-declarations');
    if (!isConsumer && !hasKeySurface) missing.push(rel);
  }
  assert.deepEqual(missing, [], '六落点键访问方必须消费键源单点');
});
