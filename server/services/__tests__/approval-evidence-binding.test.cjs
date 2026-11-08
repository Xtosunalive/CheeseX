// B2/D2+D3 红灯先行：证据链验证缺失（同根，与 D3 合并切片）。
// 修复前行为（红灯原因）：
//   D2-① publish 无来源重验：confirm 后篡改源文件字节 → publish 照样成功（凭据被静默重绑到篡改内容）
//   D2-② publish/standardize 采信客户端 contentHash（article.contentHash=input.contentHash||现算，客户端优先）
//   D2-③ resolveContentHash 优先客户端哈希，文件现算只是兜底 → 审计可绑定到与源文件不符的哈希
//   D2-④ snapshotSingleFile 不校验 contentHash === sha256(raw)（文件名哈希=内容哈希不变式可破）
//   D3-① resubmit 仅状态拨回 pending，不执行标准化管线（feature:88「重新标准化」缺位）
//   D3-② 转移响应无 revision 字段（前端无从自报）
// 修复后：publish 重验 sha256(当前源) === approval.contentHash（唯一对照锚，ADR043 D2'）→ 否则 409
//   APPROVAL_EVIDENCE_STALE；哈希一律服务端现算；snapshotSingleFile 入口断言 SNAPSHOT_HASH_MISMATCH；
//   resubmit 复用 standardize 管线（probe→snapshot→revision 刷新，转移表一字不动）；响应带 revision。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createApprovalStateMachine } = require("../release-governance/approval-state-machine-service.cjs");
const { createSnapshotStore } = require("../release-governance/snapshot-store-service.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

const SOURCE = "知识库/raw/precleaned/a1.md";
const RAW = "# A1\n正文";
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const REAL_HASH = sha256(RAW);

function fixture({ probe, publishArticle, recordFailure, snapshotArticle } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-evidence-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-approval-evi-"); // Master 加固批：approval 镜像刷新写通道钉 /tmp（防写真仓镜像砸 repo 洁净面）
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE), RAW, "utf8");
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, warn() {}, error() {} },
    standardizationProbe: probe || (() => ({ standardizationStatus: "standardized", formalContentHash: REAL_HASH })),
    publishArticle,
    recordFailure,
    snapshotArticle,
  });
  return { dir, sm };
}

// 批准（证据绑定真实文件哈希；探针哈希同值——探针=真实标准化产物语义）
async function approve(sm) { // PR-056：transition 异步化随迁
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
}

test("B2/T1：confirm 后篡改源文件字节 → publish 409 APPROVAL_EVIDENCE_STALE + 状态 approved + Issue", async () => {
  const failures = [];
  const { dir, sm } = fixture({ publishArticle: () => ({ releaseId: "release-x" }), recordFailure: (...a) => failures.push(a) });
  await approve(sm);
  fs.writeFileSync(path.join(dir, SOURCE), "# A1\n被篡改正文", "utf8");
  await assert.rejects(
    () => sm.transition("a1", "publish", { sourcePath: SOURCE }),
    (e) => e.code === "APPROVAL_EVIDENCE_STALE" && e.status === 409,
  );
  assert.equal(sm.getStatus("a1").status, "approved", "重验失败不得推进 snapshot");
  assert.equal(failures.length, 1, "重验失败必须落持久 Issue");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T2：publish 不采信客户端 contentHash（article.contentHash=服务端现算值）", async () => {
  const seen = [];
  const { dir, sm } = fixture({ publishArticle: (article) => { seen.push(article); return { releaseId: "release-x" }; } });
  await approve(sm);
  await sm.transition("a1", "publish", { sourcePath: SOURCE, contentHash: "f".repeat(64) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].contentHash, REAL_HASH, "客户端假哈希必须被服务端现算覆盖");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T3：confirm 客户端哈希与文件现算不符 → 409 APPROVAL_EVIDENCE_STALE + 审计零新增", async () => {
  const { dir, sm } = fixture({});
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  await assert.rejects(
    () => sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: "e".repeat(64) }),
    (e) => e.code === "APPROVAL_EVIDENCE_STALE" && e.status === 409,
  );
  assert.equal(sm.getStatus("a1").status, "pending", "不符决策不得推进");
  const lines = fs.readFileSync(path.join(dir, ".ledger", "decisions.jsonl"), "utf8").trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 0, "不符证据不得写入审计");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T4：resubmit 未重新标准化 → 409 ARTICLE_NOT_STANDARDIZED + 状态保持 rejected", async () => {
  let probeOk = true;
  const { dir, sm } = fixture({
    probe: () => (probeOk ? { standardizationStatus: "standardized", formalContentHash: REAL_HASH } : { standardizationStatus: "pending_standardization", formalContentHash: null }),
  });
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  await sm.transition("a1", "reject", { sourcePath: SOURCE, contentHash: REAL_HASH });
  probeOk = false; // 模拟「未重新标准化」（探针无新哈希）
  await assert.rejects(
    () => sm.transition("a1", "resubmit", { sourcePath: SOURCE }),
    (e) => e.code === "ARTICLE_NOT_STANDARDIZED" && e.status === 409,
  );
  assert.equal(sm.getStatus("a1").status, "rejected", "失败必须保持 rejected（用户明确看到原因）");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T5：resubmit 标准化后 → pending + revision 刷新（PD-2：standardize/resubmit 不再写快照）", async () => {
  const snaps = [];
  const { dir, sm } = fixture({ snapshotArticle: (a) => { snaps.push(a); return { snapshotPath: "知识库/wiki/articles/y.md" }; } });
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  await sm.transition("a1", "reject", { sourcePath: SOURCE, contentHash: REAL_HASH });
  const result = await sm.transition("a1", "resubmit", { sourcePath: SOURCE });
  assert.equal(result.status, "pending");
  assert.equal(result.revision, `sha256:${REAL_HASH}`, "revision 必须刷新为重新标准化产物");
  assert.equal(snaps.length, 0, "SPEC-030 派②（PD-2）：standardize/resubmit 管线不写快照——快照物理写唯一驱动＝publish");
  assert.equal(sm.getStatus("a1").status, "pending");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T6：standardize/confirm/publish 转移响应携带 revision（前端不再无从自报）", async () => {
  const { dir, sm } = fixture({ publishArticle: () => ({ releaseId: "release-x" }) });
  const r1 = await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  assert.equal(r1.revision, `sha256:${REAL_HASH}`);
  const r2 = await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
  assert.equal(r2.revision, `sha256:${REAL_HASH}`);
  const r3 = await sm.transition("a1", "publish", { sourcePath: SOURCE });
  assert.equal(r3.status, "snapshot");
  assert.equal(r3.revision, `sha256:${REAL_HASH}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T7：存量记录 approval.contentHash 缺失 → publish 409 fail-closed", async () => {
  const { dir, sm } = fixture({ publishArticle: () => ({ releaseId: "release-x" }) });
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  // 手工构造修复前历史形态：approved 但无绑定证据（模拟存量数据——经 runtime-state store 直种，SPEC-012 WP-A）
  getRuntimeStateStore(dir).approval.put("a1", { status: "approved", revision: `sha256:${REAL_HASH}`, updatedAt: "t", decisions: [], approval: null });
  await assert.rejects(
    () => sm.transition("a1", "publish", { sourcePath: SOURCE }),
    (e) => e.code === "APPROVAL_EVIDENCE_STALE",
  );
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T8 golden：未篡改 publish 通路（对照守卫）", async () => {
  const { dir, sm } = fixture({ publishArticle: () => ({ releaseId: "release-gold" }) });
  await approve(sm);
  const result = await sm.transition("a1", "publish", { sourcePath: SOURCE });
  assert.equal(result.status, "snapshot");
  assert.equal(result.releaseId, "release-gold");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B2/T9：snapshotSingleFile 哈希不匹配 → SNAPSHOT_HASH_MISMATCH；匹配成功", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-snap-hash-"));
  const store = createSnapshotStore({ vaultPath: dir, builderService: null, logger: {} });
  assert.throws(
    () => store.snapshotSingleFile({ articleId: "a1", contentHash: "e".repeat(64), raw: RAW, sourcePath: SOURCE, document: { articleId: "a1", title: "A1", product: "", version: "", categoryPath: "ops:maintain:a1" } }),
    (e) => e.code === "SNAPSHOT_HASH_MISMATCH",
  );
  const ok = store.snapshotSingleFile({ articleId: "a1", contentHash: REAL_HASH, raw: RAW, sourcePath: SOURCE, document: { articleId: "a1", title: "A1", product: "", version: "", categoryPath: "ops:maintain:a1" } });
  assert.equal(ok.contentHash, REAL_HASH);
  fs.rmSync(dir, { recursive: true, force: true });
});

// WP-103：服务单元层，探针和发布器为替身；真实文件/真实SQLite不等价于HTTP集成。
async function approvedRecoveryFixture(t, options = {}) {
  let env;
  let ready = true;
  const probe = () => ({ standardizationStatus: ready ? 'standardized' : 'blocked', formalContentHash: sha256(fs.readFileSync(path.join(env.dir, SOURCE))) });
  env = fixture({ probe, publishArticle: options.publishArticle || (() => ({ releaseId: 'release-recovered' })), recordFailure: options.recordFailure });
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }));
  await approve(env.sm);
  return { ...env, probe, setReady(value) { ready = value; }, change(raw = '# A1\n新的待审内容') { fs.writeFileSync(path.join(env.dir, SOURCE), raw); return sha256(raw); } };
}
function recoveryAudit(dir) { return fs.readFileSync(path.join(dir, '.ledger/decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse); }

test('WP-103：批准后内容变化→回待审且旧批准失效→重新确认后才可发布', async (t) => {
  const seen = [];
  const e = await approvedRecoveryFixture(t, { publishArticle: (article) => { seen.push(article); return { releaseId: 'release-recovered' }; } });
  const original = fs.readFileSync(path.join(e.dir, '.ledger/decisions.jsonl'), 'utf8');
  const newHash = e.change();
  await assert.rejects(() => e.sm.transition('a1', 'publish', { sourcePath: SOURCE }), { code: 'APPROVAL_EVIDENCE_STALE' });
  const restored = await e.sm.transition('a1', 'standardize', { sourcePath: SOURCE, contentHash: newHash });
  assert.equal(restored.status, 'pending'); assert.equal(restored.revision, 'sha256:' + newHash);
  const record = e.sm.readRecord('a1');
  assert.equal(record.approval, null); assert.equal(record.decisions.length, 2);
  assert.ok(fs.readFileSync(path.join(e.dir, '.ledger/decisions.jsonl'), 'utf8').startsWith(original));
  assert.deepEqual(recoveryAudit(e.dir).map(x => [x.decision, x.contentHash]), [['approved', REAL_HASH], ['standardized', newHash]]);
  await assert.rejects(() => e.sm.transition('a1', 'publish', { sourcePath: SOURCE }), { code: 'STATE_TRANSITION_FORBIDDEN' });
  await e.sm.transition('a1', 'confirm', { sourcePath: SOURCE, contentHash: newHash });
  assert.equal(e.sm.readRecord('a1').approval.contentHash, newHash);
  assert.equal((await e.sm.transition('a1', 'publish', { sourcePath: SOURCE })).status, 'snapshot');
  assert.equal(seen[0].contentHash, newHash);
  await assert.rejects(() => e.sm.transition('a1', 'standardize', { sourcePath: SOURCE }), { code: 'STATE_TRANSITION_FORBIDDEN' });
});

test('WP-103：未重新标准化或探针缺失拒绝恢复，原批准与审计不变', async (t) => {
  const e = await approvedRecoveryFixture(t); e.change(); e.setReady(false);
  const before = e.sm.readRecord('a1'), events = recoveryAudit(e.dir);
  await assert.rejects(() => e.sm.transition('a1', 'standardize', { sourcePath: SOURCE }), { code: 'ARTICLE_NOT_STANDARDIZED' });
  const noProbe = createApprovalStateMachine({ vaultPath: e.dir, logger: { warn() {} } });
  await assert.rejects(() => noProbe.transition('a1', 'standardize', { sourcePath: SOURCE }), { code: 'ARTICLE_NOT_STANDARDIZED' });
  assert.deepEqual(e.sm.readRecord('a1'), before); assert.deepEqual(recoveryAudit(e.dir), events);
});

test('WP-103：未变化的有效批准不借恢复动作撤销', async (t) => {
  const e = await approvedRecoveryFixture(t), before = e.sm.readRecord('a1');
  await assert.rejects(() => e.sm.transition('a1', 'standardize', { sourcePath: SOURCE }), (error) => {
    assert.equal(error.code, 'STATE_TRANSITION_FORBIDDEN');
    const { createContractResponseProbe } = require('../../shared/api-schema-validator.cjs');
    const result = createContractResponseProbe()('/api/approval/{articleId}/transition', 'POST', 409, { success: false, error: error.message, error_code: error.code, message: error.message, details: error.details, trace_id: 'tr_recovery_unchanged' });
    assert.notEqual(result?.action, 'block', JSON.stringify(result?.violations)); return true;
  });
  assert.deepEqual(e.sm.readRecord('a1'), before); assert.equal(recoveryAudit(e.dir).length, 1);
});

test('WP-103：客户端revision只作并发前提，不能覆盖新内容绑定', async (t) => {
  const e = await approvedRecoveryFixture(t), newHash = e.change();
  await assert.rejects(() => e.sm.transition('a1', 'standardize', { sourcePath: SOURCE, revision: 'sha256:' + 'f'.repeat(64) }), { code: 'ARTICLE_REVISION_CONFLICT' });
  assert.equal(e.sm.getStatus('a1').status, 'approved');
  const r = await e.sm.transition('a1', 'standardize', { sourcePath: SOURCE, revision: 'sha256:' + REAL_HASH });
  assert.equal(r.revision, 'sha256:' + newHash);
});

test('WP-103：恢复审计失败不推进状态，恢复通道后可重试', async (t) => {
  const e = await approvedRecoveryFixture(t); e.change(); const before = e.sm.readRecord('a1');
  const audit = path.join(e.dir, '.ledger/decisions.jsonl'), backup = audit + '.test-backup';
  fs.renameSync(audit, backup); fs.mkdirSync(audit);
  await assert.rejects(() => e.sm.transition('a1', 'standardize', { sourcePath: SOURCE }));
  assert.deepEqual(e.sm.readRecord('a1'), before);
  fs.rmdirSync(audit); fs.renameSync(backup, audit);
  await e.sm.transition('a1', 'standardize', { sourcePath: SOURCE });
  assert.equal(e.sm.getStatus('a1').status, 'pending'); assert.equal(recoveryAudit(e.dir).length, 2);
});

test('WP-103：状态提交失败保旧批准，幂等重试不重复追加恢复收据', async (t) => {
  const failures = [];
  const e = await approvedRecoveryFixture(t); const newHash = e.change();
  const real = getRuntimeStateStore(e.dir);
  const failing = createApprovalStateMachine({ vaultPath: e.dir, logger: { warn() {} }, standardizationProbe: e.probe, recordFailure: (...args) => failures.push(args), runtimeState: { approval: { get: real.approval.get.bind(real.approval), put() { throw new Error('recovery-state-write-failed'); } } } });
  await assert.rejects(() => failing.transition('a1', 'standardize', { sourcePath: SOURCE }), /recovery-state-write-failed/);
  assert.equal(e.sm.getStatus('a1').status, 'approved'); assert.equal(e.sm.readRecord('a1').approval.contentHash, REAL_HASH);
  assert.equal(failures[0][0], 'approval-state-write'); assert.equal(recoveryAudit(e.dir).length, 2);
  await e.sm.transition('a1', 'standardize', { sourcePath: SOURCE });
  await e.sm.transition('a1', 'standardize', { sourcePath: SOURCE });
  assert.equal(e.sm.getStatus('a1').revision, 'sha256:' + newHash); assert.equal(recoveryAudit(e.dir).length, 2);
  const reloaded = createApprovalStateMachine({ vaultPath: e.dir, logger: {}, standardizationProbe: e.probe });
  assert.equal(reloaded.getStatus('a1').status, 'pending'); assert.equal(reloaded.readRecord('a1').approval, null);
});

test('WP-103红队：迟到的恢复不得覆盖后续确认发布或重复追加收据', async (t) => {
  const e = await approvedRecoveryFixture(t); const hash = e.change();
  const slow = e.sm.transition('a1', 'standardize', { sourcePath: SOURCE }).then(value => ({ value }), error => ({ error }));
  await e.sm.transition('a1', 'standardize', { sourcePath: SOURCE, decidedBy: 'fast' });
  await e.sm.transition('a1', 'confirm', { sourcePath: SOURCE, contentHash: hash, decidedBy: 'fast' });
  await e.sm.transition('a1', 'publish', { sourcePath: SOURCE });
  assert.equal(e.sm.getStatus('a1').status, 'snapshot');
  const delayed = await slow;
  assert.equal(delayed.error?.code, 'ARTICLE_REVISION_CONFLICT');
  assert.equal(e.sm.getStatus('a1').status, 'snapshot');
  assert.equal(e.sm.readRecord('a1').approval.contentHash, hash);
  assert.equal(recoveryAudit(e.dir).filter(x => x.decision === 'standardized').length, 1);
});

test('WP-103真实SQLite故障集成：锁超时保旧批准，同输入重试与重开连接不丢新状态', { timeout: 20000 }, async (t) => {
  // SQLite是真依赖；标准化探针/发布器仍为替身，不计为HTTP端到端。
  const { openPersistenceDb } = require('../../shared/persistence/sqlite-adapter.cjs');
  const { createRuntimeStateStore } = require('../../shared/persistence/runtime-state-store.cjs');
  const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-real-lock-'));
  fs.mkdirSync(path.join(dir, path.dirname(SOURCE)), { recursive: true }); fs.writeFileSync(path.join(dir, SOURCE), RAW);
  process.env.DECISIONS_MIRROR_DIR = path.join(dir, 'mirror');
  const dbPath = path.join(dir, 'state.db'); let db = openPersistenceDb({ path: dbPath });
  const make = () => createApprovalStateMachine({ vaultPath: dir, runtimeState: createRuntimeStateStore(db), logger: { warn() {} }, standardizationProbe: () => ({ standardizationStatus: 'standardized', formalContentHash: sha256(fs.readFileSync(path.join(dir, SOURCE))) }) });
  let child;
  t.after(() => { child?.kill(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let sm = make(); await approve(sm);
  const changed = '# A1\n真实锁故障后的新内容', hash = sha256(changed); fs.writeFileSync(path.join(dir, SOURCE), changed);
  const adapter = require.resolve('../../shared/persistence/sqlite-adapter.cjs');
  child = spawn(process.execPath, ['-e', `const {openPersistenceDb}=require(process.argv[1]);const d=openPersistenceDb({path:process.argv[2]});d.transaction(()=>{process.stdout.write('locked\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,7000)});d.close();`, adapter, dbPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('lock child exit ' + code))); });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  await assert.rejects(() => sm.transition('a1', 'standardize', { sourcePath: SOURCE, decidedBy: 'lock-test' }), /locked/);
  assert.equal(sm.getStatus('a1').status, 'approved'); assert.equal(sm.readRecord('a1').approval.contentHash, REAL_HASH);
  await exited;
  await sm.transition('a1', 'standardize', { sourcePath: SOURCE, decidedBy: 'lock-test' });
  await sm.transition('a1', 'standardize', { sourcePath: SOURCE, decidedBy: 'lock-test' });
  assert.equal(recoveryAudit(dir).filter(x => x.decision === 'standardized').length, 1);
  db.close(); db = openPersistenceDb({ path: dbPath }); sm = make();
  assert.equal(sm.getStatus('a1').status, 'pending'); assert.equal(sm.getStatus('a1').revision, 'sha256:' + hash); assert.equal(sm.readRecord('a1').approval, null);
  await assert.rejects(() => sm.transition('a1', 'publish', { sourcePath: SOURCE }), { code: 'STATE_TRANSITION_FORBIDDEN' });
});
