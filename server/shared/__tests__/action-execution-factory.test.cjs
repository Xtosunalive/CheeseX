'use strict';

// WP-048 W1-A（SPEC-043 C1/C5/C6/C7）：统一执行工厂八步编排——失败语义可判定、
// 每请求恰好一笔 ontology_action 审计事件、审计失败不假完整成功、风险四处置、
// 前置/后置 fail-closed。纯单元层：真实文件面（临时库＋vault-io 通道），不监听 HTTP。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  initActionFactory,
  registerActionExecutor,
  registerPreconditionInterpreter,
  executeAction,
  resetActionFactory,
} = require('../action-execution-factory.cjs');
const { initActionRegistry, resetActionRegistry } = require('../action-registry.cjs');
const { initVaultIO, resetVaultIO } = require('../vault-io.cjs');
const { createError } = require('../error-factory.cjs');

function makeVault(actions, risks) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'wp048-factory-'));
  const dir = path.join(vault, '知识库', 'TheSchema');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'enums.yaml'), 'modules: {}\n');
  const lines = ['node_types: {}', 'relation_types: {}', 'action_types:'];
  for (const [id, def] of Object.entries(actions)) {
    lines.push(`  ${id}:`);
    for (const [key, value] of Object.entries(def)) lines.push(`    ${key}: ${JSON.stringify(value)}`);
  }
  if (risks && Object.keys(risks).length) {
    lines.push('risk_types:');
    for (const [id, def] of Object.entries(risks)) {
      lines.push(`  ${id}:`);
      for (const [key, value] of Object.entries(def)) lines.push(`    ${key}: ${JSON.stringify(value)}`);
    }
  }
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), lines.join('\n') + '\n');
  initVaultIO({ vaultPath: vault });
  initActionRegistry({ vaultPath: vault, logger: null });
  initActionFactory({ vaultPath: vault, logger: null });
  return vault;
}

function fakeReply() {
  const reply = {
    raw: {},
    statusCode: null,
    sentPayload: null,
    headers: {},
    header(name, value) { this.headers[name] = value; return this; },
    code(status) { this.statusCode = status; return this; },
    type() { return this; },
    send(payload) { this.sentPayload = payload; return this; },
  };
  return reply;
}

const fakeRequest = (body) => ({ body });

async function run(actionId, body) {
  const reply = fakeReply();
  const outcome = await executeAction({ actionId, request: fakeRequest(body), reply }).then(
    () => ({ ok: true, reply }),
    (error) => ({ ok: false, error, reply }),
  );
  return outcome;
}

function readEvents(vault) {
  const file = path.join(vault, '.ledger', 'decisions.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function baseDefs() {
  return {
    't.success': { http_route: 'PUT /api/schema/ontology', executor: 'x.success', required_roles: ['admin'], effects: [{ kind: 'revision_present' }] },
    't.notactive': { http_route: 'PUT /api/schema/enums', executor: 'x.success', required_roles: [], lifecycle_status: 'draft' },
    't.noexec': { http_route: 'PUT /api/schema/fields', executor: 'x.missing', required_roles: [] },
    't.riskblock': { http_route: 'PUT /api/schema/dependencies', executor: 'x.success', required_roles: [], risk_id: 'rk.block' },
    't.riskconfirm': { http_route: 'PUT /api/schema/relations', executor: 'x.success', required_roles: [], risk_id: 'rk.confirm' },
    't.riskapprove': { http_route: 'PUT /api/schema/versions', executor: 'x.success', required_roles: [], risk_id: 'rk.approve' },
    't.riskghost': { http_route: 'PUT /api/schema/product-identity', executor: 'x.success', required_roles: [], risk_id: 'rk.missing' },
    't.precondghost': { http_route: 'POST /api/schema/ontology/rollback', executor: 'x.success', required_roles: [], preconditions: [{ kind: 'nope' }] },
    't.domainfail': { http_route: 'POST /api/schema/enums/rollback', executor: 'x.domainfail', required_roles: [] },
    't.postfail': { http_route: 'POST /api/rules/lifecycle', executor: 'x.norevision', required_roles: [], effects: [{ kind: 'revision_present' }] },
    't.verifierghost': { http_route: 'POST /api/governance/resolve', executor: 'x.success', required_roles: [], effects: [{ kind: 'ghost_verifier' }] },
  };
}

const RISKS = {
  'rk.block': { action_ids: ['t.riskblock'], decision: 'block', level: 'high' },
  'rk.confirm': { action_ids: ['t.riskconfirm'], decision: 'confirm', level: 'medium' },
  'rk.approve': { action_ids: ['t.riskapprove'], decision: 'approve', level: 'high' },
};

test.beforeEach(() => {});
test.afterEach(() => {
  resetActionFactory();
  resetActionRegistry();
  resetVaultIO();
});

test('成功路径：执行器结果 200 返回＋恰好一笔 outcome=success 事件（字段齐全）', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  let executorCalls = 0;
  registerActionExecutor('x.success', () => { executorCalls += 1; return { revision: 'sha256:out1', affectedFile: 'data/theschema/ontology.yaml', category: 'ontology' }; });

  const result = await run('t.success', { revision: 'sha256:in1' });
  assert.ok(result.ok);
  assert.equal(result.reply.statusCode, 200);
  assert.equal(result.reply.sentPayload.data.revision, 'sha256:out1');
  assert.equal(executorCalls, 1);

  const events = readEvents(vault);
  assert.equal(events.length, 1, '恰好一笔动作业务事件');
  const event = events[0];
  assert.equal(event.kind, 'ontology_action');
  assert.equal(event.action_id, 't.success');
  assert.equal(event.outcome, 'success');
  assert.equal(event.input_revision, 'sha256:in1');
  assert.equal(event.output_revision, 'sha256:out1');
  assert.match(event.trace_id, /^tr_/);
  assert.ok(event.occurred_at);
  assert.equal(event.source_refs[0].path, 'data/theschema/ontology.yaml');
  assert.equal(event.source_refs[0].contentHash, 'sha256:out1');
  assert.equal(event.rule_refs[0].ruleId, 't.success');
  assert.ok(event.rule_refs[0].ruleRevision, 'ruleRevision=快照 revision');
  // 事件 trace_id 与响应 envelope trace_id 同源（§6.4 可追溯口径）
  assert.equal(event.trace_id, result.reply.sentPayload.trace_id);
});

test('未找到 approved 动作：500 ACTION_NOT_ACTIVE，不调执行器，事件 outcome=rejected', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  let executorCalls = 0;
  registerActionExecutor('x.success', () => { executorCalls += 1; return { revision: 'r' }; });
  const result = await run('t.notactive', {});
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'ACTION_NOT_ACTIVE');
  assert.equal(result.error.status, 500);
  assert.equal(executorCalls, 0);
  const events = readEvents(vault);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, 'rejected');
  assert.equal(events[0].error_code, 'ACTION_NOT_ACTIVE');
});

test('风险四处置：block/未声明风险 403 拒；confirm 未确认 409、confirm:true 放行；approve 恒拒 403', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  registerActionExecutor('x.success', () => ({ revision: 'r' }));

  const blocked = await run('t.riskblock', {});
  assert.equal(blocked.error.code, 'ACTION_RISK_BLOCKED');
  assert.equal(blocked.error.status, 403);

  const ghost = await run('t.riskghost', {});
  assert.equal(ghost.error.code, 'ACTION_RISK_BLOCKED');
  assert.match(ghost.error.details.reason, /risk_unresolved/);

  const confirmMissing = await run('t.riskconfirm', {});
  assert.equal(confirmMissing.error.code, 'ACTION_CONFIRM_REQUIRED');
  assert.equal(confirmMissing.error.status, 409);

  const confirmed = await run('t.riskconfirm', { confirm: true });
  assert.ok(confirmed.ok, 'confirm:true 后放行');

  const approve = await run('t.riskapprove', {});
  assert.equal(approve.error.code, 'ACTION_APPROVAL_REQUIRED');
  assert.equal(approve.error.status, 403);

  // 五次尝试各恰好一笔事件：四次 rejected＋一次 success（§6.4 每请求一笔）
  const events = readEvents(vault);
  assert.equal(events.length, 5);
  assert.equal(events.filter((e) => e.outcome === 'rejected').length, 4);
  assert.equal(events.filter((e) => e.outcome === 'success').length, 1);
});

test('前置解释器未登记：500 ACTION_PRECONDITION_UNKNOWN fail-closed，不执行', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  registerActionExecutor('x.success', () => ({ revision: 'r' }));
  const result = await run('t.precondghost', {});
  assert.equal(result.error.code, 'ACTION_PRECONDITION_UNKNOWN');
  const events = readEvents(vault);
  assert.equal(events.filter((e) => e.error_code === 'ACTION_PRECONDITION_UNKNOWN').length, 1);
});

test('前置失败：422 ACTION_PRECONDITION_FAILED（登记解释器判定不满足）', async () => {
  const vault = makeVault({ 't.pre': { http_route: 'PUT /api/schema/ontology', executor: 'x.success', required_roles: [], preconditions: [{ kind: 'always_no' }] } });
  registerActionExecutor('x.success', () => ({ revision: 'r' }));
  registerPreconditionInterpreter('always_no', () => ({ ok: false, reason: '永远不满足' }));
  const result = await run('t.pre', {});
  assert.equal(result.error.code, 'ACTION_PRECONDITION_FAILED');
  assert.equal(result.error.status, 422);
  assert.equal(readEvents(vault)[0].outcome, 'rejected');
});

test('执行器未登记：500 ACTION_EXECUTOR_UNREGISTERED；执行器领域错误原样上抛＋事件 outcome=failed', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  const noExec = await run('t.noexec', {});
  assert.equal(noExec.error.code, 'ACTION_EXECUTOR_UNREGISTERED');

  registerActionExecutor('x.domainfail', () => { throw createError('SCHEMA_REVISION_CONFLICT', '源已变化', 409, { expected: 'a' }); });
  const domainFail = await run('t.domainfail', {});
  assert.equal(domainFail.error.code, 'SCHEMA_REVISION_CONFLICT', '领域错误不包装');
  assert.equal(domainFail.error.status, 409);
  const failedEvent = readEvents(vault).find((e) => e.outcome === 'failed');
  assert.equal(failedEvent.error_code, 'SCHEMA_REVISION_CONFLICT');
});

test('后置核对：结果缺 revision 500 ACTION_POSTCHECK_FAILED（留双 revision）；核验器未登记同码 fail-closed', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  registerActionExecutor('x.success', () => ({ revision: 'r' }));
  registerActionExecutor('x.norevision', () => ({ foo: 1 }));

  const post = await run('t.postfail', {});
  assert.equal(post.error.code, 'ACTION_POSTCHECK_FAILED');
  assert.equal(post.error.status, 500);
  assert.ok(post.error.details.input_revision, '失败响应携带输入 revision');

  const ghost = await run('t.verifierghost', {});
  assert.equal(ghost.error.code, 'ACTION_POSTCHECK_FAILED');
  assert.match(ghost.error.details.effect_kind, /ghost_verifier/);
});

test('审计追加失败：500 ACTION_AUDIT_APPEND_FAILED 不假完整成功（执行已发生，响应带 trace_id 与双 revision）', async () => {
  const defs = baseDefs();
  const vault = makeVault(defs, RISKS);
  registerActionExecutor('x.success', () => ({ revision: 'sha256:done' }));
  // 通道健康库已建 .ledger；用文件占位使追加必败（mkdirSync 撞文件）
  fs.rmSync(path.join(vault, '.ledger'), { recursive: true, force: true });
  fs.writeFileSync(path.join(vault, '.ledger'), 'not-a-dir');

  const result = await run('t.success', { revision: 'sha256:in' });
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'ACTION_AUDIT_APPEND_FAILED');
  assert.equal(result.error.status, 500);
  assert.equal(result.error.details.output_revision, 'sha256:done');
  assert.match(result.error.details.trace_id, /^tr_/);
});

test('工厂未初始化：503 ACTION_FACTORY_UNAVAILABLE（不写事件——装配缺陷无凭可记）', async () => {
  const vault = makeVault(baseDefs(), RISKS);
  resetActionFactory();
  const result = await run('t.success', {});
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'ACTION_FACTORY_UNAVAILABLE');
  assert.equal(result.error.status, 503);
  assert.equal(readEvents(vault).length, 0);
});
