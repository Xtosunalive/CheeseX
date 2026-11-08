// B4/D5 红灯先行：决策审计/状态双写失败语义（ADR043 增补节）。
// 修复前行为（这些用例红灯的原因）：
//   - confirm/reject/publish 的 writeRecord 失败零补偿：不落 Issue（recordFailure 不被调），
//     审计已追加（审计先行）→ 重试必双审计（decisionId=randomUUID，无幂等键）。
//   - publish 侧 current 切换先于 writeRecord（外部生效点先行的正确语义），重试铸造第二个
//     不可变 Release（N1 下无害）——该重试语义由 ADR043 增补节文档化，不做发布幂等化（规则 30）。
// 修复后：writeRecord 失败 = 状态保旧值 + recordFailure("approval-state-write") + 幂等重试
//   （decisionId 确定性化：sha256(articleId|decision|contentHash|decisions.length|UTC日桶)，
//   len 分量区分「重试」（同键跳过追加）与「周期后再决策」（len 已变 → 新键，防误吞真决策）。
// 注入方式（SPEC-012 WP-A 后）：状态账本住 runtime-state store——注入「读真写假」的 store
//   （approval.get 绑真库、approval.put 抛错）精确模拟「审计成功（decisions.jsonl 走 vault 通道）+状态失败」。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createApprovalStateMachine } = require("../release-governance/approval-state-machine-service.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

const SOURCE = "知识库/raw/precleaned/a1.md";
const RAW = "# A1\n正文";
const REAL_HASH = crypto.createHash("sha256").update(RAW).digest("hex");

function fixture({ publishArticle, recordFailure } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-dualwrite-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-approval-sta-"); // Master 加固批：approval 镜像刷新写通道钉 /tmp（防写真仓镜像砸 repo 洁净面）
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  fs.writeFileSync(path.join(dir, SOURCE), RAW, "utf8");
  const makeSm = (runtimeState) => createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, warn() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: REAL_HASH }),
    publishArticle,
    recordFailure,
    runtimeState,
  });
  return { dir, makeSm };
}

function auditLines(dir) {
  const raw = fs.readFileSync(path.join(dir, ".ledger", "decisions.jsonl"), "utf8");
  return raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

// 定点注入：仅 approval.put 失败（get 绑真库——审计/读取不受影响，精确模拟状态写失败）
function failingWriteStore(vaultPath) {
  const realStore = getRuntimeStateStore(vaultPath);
  return {
    approval: {
      get: realStore.approval.get.bind(realStore.approval),
      put() { throw new Error("simulated state write failure"); },
    },
  };
}

test("B4/T1：confirm 状态写失败 → Issue 落盘 + 状态保 pending；恢复重试 → 审计恰 1 条 + approved", async () => {
  const failures = [];
  const { dir, makeSm } = fixture({ recordFailure: (stage, input, error) => failures.push({ stage, input, error }) });
  const sm = makeSm();
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  const failing = makeSm(failingWriteStore(dir));
  await assert.rejects(() => failing.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH }), /simulated state write failure/);
  assert.equal(sm.getStatus("a1").status, "pending", "状态写失败必须保旧值");
  assert.equal(failures.length, 1, "状态写失败必须落持久 Issue");
  assert.equal(failures[0].stage, "approval-state-write");
  assert.equal(failures[0].input.proposalId, "a1");
  assert.equal(auditLines(dir).length, 1, "审计先行的 1 条已落盘");
  // 恢复重试：幂等（不双审计）
  await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
  assert.equal(sm.getStatus("a1").status, "approved");
  const approved = auditLines(dir).filter((line) => line.decision === "approved");
  assert.equal(approved.length, 1, `重试必须幂等（恰 1 条 approved 审计），实际 ${approved.length}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B4/T2 守卫：pending→reject→resubmit→再 reject（同内容同日）→ 恰 2 条 rejected 审计（len 分量防误吞真决策）", async () => {
  const { dir, makeSm } = fixture();
  const sm = makeSm();
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  await sm.transition("a1", "reject", { contentHash: REAL_HASH });
  await sm.transition("a1", "resubmit", { sourcePath: SOURCE });
  await sm.transition("a1", "reject", { contentHash: REAL_HASH });
  const rejected = auditLines(dir).filter((line) => line.decision === "rejected");
  assert.equal(rejected.length, 2, `resubmit 后再拒绝是真决策（不得被幂等键吞掉），实际 ${rejected.length}`);
  assert.notEqual(rejected[0].decisionId, rejected[1].decisionId, "两次拒绝 decisionId 必须不同");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B4/T3：publish 状态写失败 → Issue + 状态保 approved；恢复重试 → 第二次铸造 + 收敛 snapshot", async () => {
  const failures = [];
  let publishCalls = 0;
  const { dir, makeSm } = fixture({
    publishArticle: () => ({ releaseId: `release-${++publishCalls}` }),
    recordFailure: (stage, input, error) => failures.push({ stage, input, error }),
  });
  const sm = makeSm();
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
  const failing = makeSm(failingWriteStore(dir));
  await assert.rejects(() => failing.transition("a1", "publish", { sourcePath: SOURCE }), /simulated state write failure/);
  assert.equal(sm.getStatus("a1").status, "approved", "publish 状态写失败保 approved");
  assert.equal(failures.length, 1, "publish 状态写失败必须落持久 Issue");
  assert.equal(failures[0].stage, "approval-state-write");
  assert.equal(publishCalls, 1, "publishArticle（外部生效点）已执行 1 次");
  // 恢复重试：发布副作用重做（第二个不可变 Release，N1 下无害——ADR043 增补节文档化语义）
  const result = await sm.transition("a1", "publish", { sourcePath: SOURCE });
  assert.equal(result.releaseId, "release-2");
  assert.equal(sm.getStatus("a1").status, "snapshot");
  assert.equal(publishCalls, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
