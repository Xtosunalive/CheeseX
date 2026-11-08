'use strict';

// WP-048 W1-A（SPEC-043 C4）：action-registry 快照——approved 活消费、OpenAPI 对账、
// 与静态 ROUTE_ROLES 互斥、revision 缓存与重建失败保旧。纯函数＋临时库文件面测试，
// 不监听 HTTP、不触第三方（层级＝纯单元）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  initActionRegistry,
  getActiveActionSnapshot,
  actionRouteRoleFor,
  resetActionRegistry,
  canonicalRouteKey,
} = require('../action-registry.cjs');
const { listRouteRoleBindings } = require('../auth/route-roles.cjs');

function writeTheSchema(vaultPath, ontologyYaml) {
  const dir = path.join(vaultPath, '知识库', 'TheSchema');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'enums.yaml'), 'modules: {}\n');
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), ontologyYaml);
}

function ontologyWith(actions, risks) {
  const lines = ['node_types: {}', 'relation_types: {}'];
  if (actions && Object.keys(actions).length) {
    lines.push('action_types:');
    for (const [id, def] of Object.entries(actions)) {
      lines.push(`  ${id}:`);
      for (const [key, value] of Object.entries(def)) {
        if (Array.isArray(value)) lines.push(`    ${key}: ${JSON.stringify(value)}`);
        else if (typeof value === 'object' && value !== null) lines.push(`    ${key}: ${JSON.stringify(value)}`);
        else lines.push(`    ${key}: ${JSON.stringify(value)}`);
      }
    }
  }
  if (risks && Object.keys(risks).length) {
    lines.push('risk_types:');
    for (const [id, def] of Object.entries(risks)) {
      lines.push(`  ${id}:`);
      for (const [key, value] of Object.entries(def)) lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function makeVault(ontologyYaml) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'wp048-registry-'));
  writeTheSchema(vault, ontologyYaml);
  return vault;
}

test.afterEach(() => {
  resetActionRegistry();
});

test('快照只收 approved 动作；缺省 lifecycle_status 视为 approved（ADR-014 §3.1）', () => {
  const vault = makeVault(ontologyWith({
    'a.ok': { http_route: 'PUT /api/schema/ontology', executor: 't.ok', required_roles: ['admin'] },
    'a.defaulted': { http_route: 'PUT /api/schema/enums', executor: 't.ok2', required_roles: [] },
    'a.draft': { http_route: 'PUT /api/schema/fields', executor: 't.draft', required_roles: [], lifecycle_status: 'draft' },
    'a.retired': { http_route: 'PUT /api/schema/versions', executor: 't.retired', required_roles: [], lifecycle_status: 'retired' },
  }));
  const snap = initActionRegistry({ vaultPath: vault, logger: null });
  assert.equal(snap.actions.size, 2);
  assert.equal(snap.routeRoles.get('PUT /api/schema/ontology').roles[0], 'admin');
  assert.deepEqual(snap.routeRoles.get('PUT /api/schema/enums').roles, []);
  assert.ok(!snap.routeAction.has('PUT /api/schema/fields'));
  assert.ok(!snap.routeAction.has('PUT /api/schema/versions'));
});

test('OpenAPI 对账：动作路由不在契约操作表＝构建失败（boot fail-closed）', () => {
  const vault = makeVault(ontologyWith({
    'a.ghost': { http_route: 'PUT /api/schema/not-in-contract', executor: 't.x', required_roles: [] },
  }));
  assert.throws(() => initActionRegistry({ vaultPath: vault, logger: null }), (error) => {
    assert.match(error.message, /不在契约操作表/);
    return true;
  });
});

test('互斥对账：同一端点同时挂快照与静态 ROUTE_ROLES＝构建失败（两份角色声明）', () => {
  const staticKey = 'POST /api/schema/enums/preview'; // 静态表在册键（未迁移端点）
  assert.ok(listRouteRoleBindings()[staticKey], '前置：该键确在静态表');
  const vault = makeVault(ontologyWith({
    'a.dup': { http_route: staticKey, executor: 't.x', required_roles: ['admin'] },
  }));
  assert.throws(() => initActionRegistry({ vaultPath: vault, logger: null }), (error) => {
    assert.match(error.message, /两份角色声明/);
    return true;
  });
});

test('快照构建期形状自查（红队发现②）：required_roles 非数组/坏 override/success_status 越界＝构建失败不静默回落', () => {
  const base = { http_route: 'PUT /api/schema/ontology', executor: 't.x' };
  for (const [label, def] of [
    ['required_roles 字符串', { ...base, required_roles: 'admin' }],
    ['required_roles 非串元素', { ...base, required_roles: ['admin', 42] }],
    ['override 非 roles 数组', { ...base, required_roles: [], payload_role_overrides: [{ body_field: 'op', equals: 'x', roles: 'publish' }] }],
    ['override 缺 body_field', { ...base, required_roles: [], payload_role_overrides: [{ equals: 'x', roles: ['publish'] }] }],
    ['success_status 500', { ...base, required_roles: [], success_status: 500 }],
    ['success_status 字符串', { ...base, required_roles: [], success_status: '201' }],
  ]) {
    const vault = makeVault(ontologyWith({ 'a.bad': def }));
    assert.throws(() => initActionRegistry({ vaultPath: vault, logger: null }), (error) => {
      assert.match(error.message, /required_roles|payload_role_overrides|success_status|两个动作/, label + ' 应构建失败: ' + error.message);
      return true;
    }, label);
    resetActionRegistry();
  }
});

test('同路由双动作拒绝（红队发现④）：后声明不得静默顶替先声明', () => {
  const vault = makeVault(ontologyWith({
    'a.first': { http_route: 'PUT /api/schema/ontology', executor: 't.x', required_roles: ['admin'] },
    'a.second': { http_route: 'PUT /api/schema/ontology', executor: 't.y', required_roles: [] },
  }));
  assert.throws(() => initActionRegistry({ vaultPath: vault, logger: null }), (error) => {
    assert.match(error.message, /两个动作|同路由双动作/);
    return true;
  });
});

test('载荷敏感角色升级：payload_role_overrides 首条 body 等值匹配生效，未匹配回落基线（W1-B）', () => {
  const vault = makeVault(ontologyWith({
    'a.transition': {
      http_route: 'POST /api/approval/{articleId}/transition',
      executor: 't.x',
      required_roles: ['review'],
      payload_role_overrides: [{ body_field: 'operation', equals: 'publish', roles: ['publish'] }],
    },
  }));
  initActionRegistry({ vaultPath: vault, logger: null });
  assert.deepEqual(actionRouteRoleFor('POST', '/api/approval/:articleId/transition'), ['review'], '无 body 回落基线');
  assert.deepEqual(actionRouteRoleFor('POST', '/api/approval/:articleId/transition', { operation: 'confirm' }), ['review'], '不匹配回落基线');
  assert.deepEqual(actionRouteRoleFor('POST', '/api/approval/:articleId/transition', { operation: 'publish' }), ['publish'], '等值匹配整体替换');
});

test('http_route 归一到契约模板键；actionRouteRoleFor 同口径查询', () => {
  assert.equal(canonicalRouteKey('PUT /api/schema/ontology'), 'PUT /api/schema/ontology');
  assert.equal(canonicalRouteKey('put /api/anomalies/{issueId}/{operation}'), 'PUT /api/anomalies/{x}/{x}');
  assert.equal(canonicalRouteKey('not-a-route'), null);

  const vault = makeVault(ontologyWith({
    'a.ok': { http_route: 'PUT /api/schema/ontology', executor: 't.ok', required_roles: ['admin'] },
  }));
  initActionRegistry({ vaultPath: vault, logger: null });
  assert.deepEqual(actionRouteRoleFor('PUT', '/api/schema/ontology'), ['admin']);
  assert.equal(actionRouteRoleFor('PUT', '/api/schema/fields'), null);
  assert.equal(actionRouteRoleFor('PUT', '/nonexistent'), null);
});

test('revision 变更触发重建；解析失败保留旧快照（新 revision 不激活）', () => {
  const vault = makeVault(ontologyWith({
    'a.ok': { http_route: 'PUT /api/schema/ontology', executor: 't.ok', required_roles: ['admin'] },
  }));
  const first = initActionRegistry({ vaultPath: vault, logger: null });

  // 同 revision：命中缓存（同实例）
  assert.equal(getActiveActionSnapshot(), first);

  // 追加一个动作 → revision 变 → 重建
  writeTheSchema(vault, ontologyWith({
    'a.ok': { http_route: 'PUT /api/schema/ontology', executor: 't.ok', required_roles: ['admin'] },
    'a.two': { http_route: 'PUT /api/schema/enums', executor: 't.two', required_roles: [] },
  }));
  const second = getActiveActionSnapshot();
  assert.notEqual(second, first);
  assert.equal(second.actions.size, 2);

  // 写坏 YAML → readOntology 抛错 → 保留旧快照
  writeTheSchema(vault, 'node_types: [broken\n  - {{{\n');
  const kept = getActiveActionSnapshot();
  assert.equal(kept, second);
  assert.equal(kept.actions.size, 2);
});

test('风险注册表只收 approved；供工厂静态评估消费', () => {
  const vault = makeVault(
    ontologyWith(
      { 'a.ok': { http_route: 'PUT /api/schema/ontology', executor: 't.ok', required_roles: ['admin'] } },
      {
        'rk.block': { action_ids: ['a.ok'], decision: 'block', level: 'high' },
        'rk.draft': { action_ids: ['a.ok'], decision: 'block', level: 'high', lifecycle_status: 'draft' },
      },
    ),
  );
  const snap = initActionRegistry({ vaultPath: vault, logger: null });
  assert.ok(snap.risks.has('rk.block'));
  assert.ok(!snap.risks.has('rk.draft'));
});
