// 层级：纯单元（登记解析器三档）＋Adapter 契约（写者对解析结果的使用与拒绝形态）。
// WP-076 回归锚：镜像落点不得「变量缺席就按 __dirname 猜仓根」——同族先例 V01/V05，
// 规则＝contracts/runtime-scope.json rules.no_implicit_fallback_on_write。
// 前科＝b3-fresh-validation-receipt.test.cjs 裸跑把 data/governance/decisions-mirror.jsonl 41→1 行。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { resolveMirrorDestDir, registeredVaultRoot, MirrorScopeError, DEFAULT_DEST_DIR } = require("../mirror-scope.cjs");
const { mirrorDecisions } = require("../decisions-mirror.cjs");

const REPO_MIRROR = path.resolve(__dirname, "..", "..", "..", "data", "governance", "decisions-mirror.jsonl");

function tmpVault(withDecisions) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), withDecisions ? "ms-vault-" : "ms-empty-"));
  fs.mkdirSync(path.join(dir, ".ledger"), { recursive: true });
  if (withDecisions) fs.writeFileSync(path.join(dir, ".ledger", "decisions.jsonl"), '{"kind":"ontology_action","trace_id":"probe"}\n', "utf8");
  return dir;
}

/** 每个用例自己管 DECISIONS_MIRROR_DIR／VAULT_PATH，防跨例污染（本域前科就是全局 env 泄漏）。 */
function withEnv(t, patch) {
  const keys = Object.keys(patch);
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of keys) {
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k];
  }
  t.after(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

test("钉扎档：DECISIONS_MIRROR_DIR 给定即落沙箱，与源是否登记真库无关", function (t) {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ms-pin-"));
  withEnv(t, { DECISIONS_MIRROR_DIR: sandbox, VAULT_PATH: tmpVault(false) });
  const r = resolveMirrorDestDir(tmpVault(true));
  assert.equal(r.destDir, path.resolve(sandbox));
  assert.equal(r.sandboxed, true);
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
});

test("登记档：源＝登记真库才配写仓内默认住址（只判解析，零写入）", function (t) {
  withEnv(t, { DECISIONS_MIRROR_DIR: undefined });
  const authority = registeredVaultRoot();
  if (!authority) {
    assert.throws(() => resolveMirrorDestDir(tmpVault(true)), MirrorScopeError, "无登记真库即拒（缺席不猜仓根）");
    return;
  }
  const r = resolveMirrorDestDir(authority);
  assert.equal(r.destDir, DEFAULT_DEST_DIR, "登记真库→仓内默认镜像住址");
  assert.equal(r.sandboxed, false);
});

test("拒档：源非登记真库（夹具/他库态）→ 抛 MirrorScopeError 且点名出口", function (t) {
  withEnv(t, { DECISIONS_MIRROR_DIR: undefined, VAULT_PATH: "/Users/example/registered-vault" });
  assert.throws(
    () => resolveMirrorDestDir(tmpVault(true)),
    (e) => e instanceof MirrorScopeError && /钉 DECISIONS_MIRROR_DIR/.test(e.message) && /≠/.test(e.message),
    "夹具源被拒，且报错给出合法出口",
  );
});

test("拒档：登记真库与源皆缺席 → 抛（写路径不允许隐式回落）", function (t) {
  withEnv(t, { DECISIONS_MIRROR_DIR: undefined, VAULT_PATH: undefined });
  const savedEnvFile = path.resolve(__dirname, "..", "..", ".env");
  if (fs.existsSync(savedEnvFile)) {
    // 本仓有 .env 时登记真库恒可解析——此例只在无 .env 环境（CI）跑；有则跳过并说明
    t.skip("本树存在 .env（登记真库可解析），缺席拒档改由 resolver 单测面覆盖");
    return;
  }
  assert.throws(() => resolveMirrorDestDir(undefined), MirrorScopeError);
});

test("写者面：夹具源未钉扎 → 拒写且仓内真账面一字节不动（本包要消灭的正是这一格）", function (t) {
  withEnv(t, { DECISIONS_MIRROR_DIR: undefined });
  const before = fs.existsSync(REPO_MIRROR) ? fs.readFileSync(REPO_MIRROR) : null;
  const r = mirrorDecisions(tmpVault(true), { info() {}, warn() {}, error() {} });
  assert.equal(r.mirrored, false, "夹具态不得镜像进仓内真账面");
  assert.equal(r.reason, "scope-refused");
  const after = fs.existsSync(REPO_MIRROR) ? fs.readFileSync(REPO_MIRROR) : null;
  if (before) assert.ok(after.equals(before), "仓内镜像字节不变（撤掉闸即在此红）");
});

test("写者面：钉扎态照旧写沙箱并保哈希自证，仓内真账面不受影响", function (t) {
  const sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ms-writer-"));
  withEnv(t, { DECISIONS_MIRROR_DIR: sandbox });
  const before = fs.existsSync(REPO_MIRROR) ? fs.readFileSync(REPO_MIRROR) : null;
  const r = mirrorDecisions(tmpVault(true), { info() {}, warn(e) { t.diagnostic(`warn:${e && e.event}`); }, error() {} });
  assert.equal(r.mirrored, true, "钉扎态仍正常落账（收紧不误伤隔离路径）");
  assert.equal(r.sandboxed, true);
  assert.equal(r.hashVerified, true, "PR-114 哈希自证仍在（强度未动）");
  assert.ok(fs.existsSync(path.join(sandbox, "decisions-mirror.jsonl")));
  const after = fs.existsSync(REPO_MIRROR) ? fs.readFileSync(REPO_MIRROR) : null;
  if (before) assert.ok(after.equals(before), "沙箱写不动仓内账面");
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
});
