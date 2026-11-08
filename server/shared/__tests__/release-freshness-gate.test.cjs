const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createFreshnessGate, checkFreshness, readVaultHead } = require("../release-freshness-gate.cjs");
// seq163（#1325）：夹具 git spawn 一律走 gitFixtureEnv 净化——防 GIT_DIR 等把 init 重定向到宿主仓
const { gitFixtureEnv } = require("../../../scripts/quality/shared/git-fixture-env.cjs");

function makeGitVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-gate-"));
  const env = gitFixtureEnv(process.env);
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir, env });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir, env });
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  execFileSync("git", ["add", "."], { cwd: dir, env });
  execFileSync("git", ["commit", "-qm", "c1"], { cwd: dir, env });
  const head1 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8", env }).trim();
  return { dir, head1 };
}

const CONTEXT = (commit) => ({ sourceCommit: commit, readMasterGraph: () => ({ from: "release" }) });
const NOW = () => new Date("2026-09-09T00:00:00Z");

test("readVaultHead: git 仓库返回 HEAD，非仓库返回 null", async () => { // PR-056：随 gate 异步化
  const { dir, head1 } = makeGitVault();
  assert.strictEqual(await readVaultHead(dir), head1);
  assert.strictEqual(await readVaultHead(fs.mkdtempSync(path.join(os.tmpdir(), "no-git-"))), null);
  assert.strictEqual(await readVaultHead(null), null);
});

test("checkFreshness: fresh/stale/unknown 三态 + dataOrigin 标注", async () => { // PR-056：随 gate 异步化
  const { dir, head1 } = makeGitVault();
  const fresh = await checkFreshness(CONTEXT(head1), dir, NOW);
  assert.strictEqual(fresh.status, "fresh");
  assert.strictEqual(fresh.dataOrigin, "release");
  assert.strictEqual(fresh.releaseSourceCommit, head1);
  assert.strictEqual(fresh.liveHead, head1);

  const stale = await checkFreshness(CONTEXT("0".repeat(40)), dir, NOW);
  assert.strictEqual(stale.status, "stale");
  assert.strictEqual(stale.dataOrigin, "working-projection");
  assert.strictEqual(stale.releaseSourceCommit, "0".repeat(40));
  assert.strictEqual(stale.liveHead, head1);

  const unknown = await checkFreshness(CONTEXT(head1), path.join(os.tmpdir(), "no-such-vault-xyz"), NOW);
  assert.strictEqual(unknown.status, "unknown");
  assert.strictEqual(unknown.dataOrigin, "release");
});

test("gate: fresh 透传原 context（release 路径零扰动）", async () => { // PR-056：随 gate 异步化
  const { dir, head1 } = makeGitVault();
  const context = CONTEXT(head1);
  const gate = createFreshnessGate({
    formalConsumer: { withPinnedRelease: (cb) => cb(context) },
    vaultPath: dir,
    now: NOW,
  });
  let seen;
  await gate.withFreshness((ctx, freshness) => { seen = { ctx, freshness }; });
  assert.strictEqual(seen.ctx, context);
  assert.strictEqual(seen.freshness.status, "fresh");
});

test("gate: stale → callback(null, freshness)，分流到既有活读分支", async () => {
  const { dir } = makeGitVault();
  const gate = createFreshnessGate({
    formalConsumer: { withPinnedRelease: (cb) => cb(CONTEXT("0".repeat(40))) },
    vaultPath: dir,
    now: NOW,
  });
  let seen;
  await gate.withFreshness((ctx, freshness) => { seen = { ctx, freshness }; });
  assert.strictEqual(seen.ctx, null);
  assert.strictEqual(seen.freshness.status, "stale");
  assert.strictEqual(seen.freshness.dataOrigin, "working-projection");
});

test("gate: unknown（git 不可用）fail-open 维持 release 读法", async () => {
  const gate = createFreshnessGate({
    formalConsumer: { withPinnedRelease: (cb) => cb(CONTEXT("0".repeat(40))) },
    vaultPath: path.join(os.tmpdir(), "no-such-vault-xyz"),
    now: NOW,
  });
  let seen;
  await gate.withFreshness((ctx, freshness) => { seen = { ctx, freshness }; });
  assert.ok(seen.ctx, "unknown 必须透传 context");
  assert.strictEqual(seen.freshness.status, "unknown");
});

test("gate: 无 consumer → callback(null, null)（等价既有 withFormal 空分支）", async () => {
  const gate = createFreshnessGate({ formalConsumer: null, vaultPath: null, now: NOW });
  let seen;
  await gate.withFreshness((ctx, freshness) => { seen = { ctx, freshness }; });
  assert.strictEqual(seen.ctx, null);
  assert.strictEqual(seen.freshness, null);
});

// PR-139：空库（无 current Release）分流——degrade 选项降级 null-context；缺省上抛（正式投影面产品语义）
test("PR-139 空库分流：onEmptyRelease=degrade → callback(null, degraded freshness)；缺省 → NO_CURRENT_RELEASE 上抛", async () => {
  const { createFreshnessGate } = require("../release-freshness-gate.cjs");
  const emptyReaderError = Object.assign(new Error("No current Release"), { code: "NO_CURRENT_RELEASE", status: 404 });
  const formalConsumer = {
    withPinnedRelease: async () => { throw emptyReaderError; },
  };
  const gate = createFreshnessGate({ formalConsumer, vaultPath: null });
  const degraded = await gate.withFreshness((context, freshness) => ({ context, freshness }), { onEmptyRelease: "degrade" });
  assert.equal(degraded.context, null);
  assert.equal(degraded.freshness.reason, "no-current-release");
  await assert.rejects(
    () => gate.withFreshness((context) => ({ context })),
    (e) => e.code === "NO_CURRENT_RELEASE",
  );
});
