// B3（#1794）红灯证据工具：发布失败账「指纹聚合 + 成功发布取代」语义。
// 缺陷机理（实录：真实 Vault issues/publication-issues.json 两条 open 同 sourceCommit 双记）：
//   ① recordFailure 指纹掺入 previousReleaseId → 同一逻辑失败在不同前任 Release 下裂成多条 issueId（双记）；
//   ② retire 谓词只对账「sourceCommit === current.sourceCommit」→ 其后任何成功发布把 current 移走后，
//     历史失败记录复活（幽灵条目反复出现，用户 8 问题条目③④实录）。
// 修后语义（ADR063 意图勘误版）：指纹=逻辑问题（不含前任指针）；其后一次成功发布即取代全部在册失败
//   （若问题仍在，重试失败时按同指纹重新打开、occurrence 递增——fail-closed 可见性不丢）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createReleasePublisherService } = require("../release-governance/release-publisher-service.cjs");

function makePublisher(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return createReleasePublisherService({
    builderService: { builderVersion: "test-builder-1" },
    logger: { info() {}, warn() {}, error() {} },
    releasesDir: dir,
  });
}

function seedCurrentPointer(dir, releaseId, sourceCommit) {
  fs.writeFileSync(path.join(dir, "current.json"), `${JSON.stringify({ releaseId, sourceCommit, manifestHash: `sha256:${"f".repeat(64)}`, publishedAt: new Date().toISOString() }, null, 2)}\n`);
}

const FAILURE_INPUT = { proposalId: "proposal-1", sourceCommit: "sha256:commit-a", buildConfiguration: { target: "graph" } };

test("B3 TC1 指纹聚合：同一逻辑失败跨不同前任 Release 只记一条（occurrence 递增）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b3-fingerprint-"));
  const publisher = makePublisher(dir);
  publisher.recordFailure("artifact-collection", FAILURE_INPUT, { code: "COLLECT_FAILED", message: "boom" });
  // 模拟其间发生过一次成功发布（current 移到新指针）→ previousReleaseId 变化
  seedCurrentPointer(dir, "release-r2", "sha256:commit-b");
  publisher.recordFailure("artifact-collection", FAILURE_INPUT, { code: "COLLECT_FAILED", message: "boom" });

  const issues = publisher.listIssues();
  assert.equal(issues.length, 1, `同一逻辑失败应聚合为一条，实际 ${issues.length} 条（指纹掺 previousReleaseId 裂变双记）`);
  assert.equal(issues[0].occurrenceCount, 2);
  assert.equal(issues[0].issueKind, "release_publication_failure");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B3 TC2 成功发布取代：其后任一成功发布退休在册失败，幽灵不再随 current 移动复活", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b3-supersede-"));
  const publisher = makePublisher(dir);
  publisher.recordFailure("artifact-collection", FAILURE_INPUT, { code: "COLLECT_FAILED", message: "boom" });

  // 其后一次成功发布（sourceCommit 与失败不同也算系统级取代——若问题仍在，重试失败会重新落账）
  const changed = publisher.resolveSupersededIssues({ releaseId: "release-success-1", sourceCommit: "sha256:commit-b" });
  assert.equal(changed, true, "resolveSupersededIssues 应报告发生了退休");
  assert.deepEqual(publisher.listActiveIssues(), [], "被成功发布取代后不应再作为活检出（幽灵退休）");
  const ledger = publisher.listIssues();
  assert.equal(ledger[0].status, "resolved");
  assert.equal(ledger[0].resolvedByReleaseId, "release-success-1");

  // 幽灵复活防护：current 再移动（新成功发布），已退休记录不得重新变活
  seedCurrentPointer(dir, "release-r3", "sha256:commit-c");
  assert.deepEqual(publisher.listActiveIssues(), [], "current 移动不得让已退休失败复活");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("B3 TC3 边界负例：被取代的失败若重演，按同指纹重新打开且 occurrence 递增（fail-closed 可见性）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b3-reopen-"));
  const publisher = makePublisher(dir);
  publisher.recordFailure("artifact-collection", FAILURE_INPUT, { code: "COLLECT_FAILED", message: "boom" });
  publisher.resolveSupersededIssues({ releaseId: "release-success-1", sourceCommit: "sha256:commit-b" });

  publisher.recordFailure("artifact-collection", FAILURE_INPUT, { code: "COLLECT_FAILED", message: "boom again" });
  const active = publisher.listActiveIssues();
  assert.equal(active.length, 1, "失败重演必须重新可见（不得被退休状态吞掉）");
  assert.equal(active[0].status, "open");
  assert.equal(active[0].occurrenceCount, 2, "同指纹重演应递增发生次数");
  fs.rmSync(dir, { recursive: true, force: true });
});
