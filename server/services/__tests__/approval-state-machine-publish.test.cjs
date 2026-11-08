// B1/D1 红灯先行：publish 分支 fail-closed（INV-05「releaseId 非空才算发布生效」）。
// 修复前行为（这些用例红灯的原因）：
//   - publishArticle 缺席 / sourcePath 缺失 / 文件不存在 → 静默跳过发布块 → 照写 snapshot + releaseId=null（假成功）
//   - input.releaseId 自报可直达 snapshot（伪造入口，状态机自造第二判定）
//   - 全程无 recordFailure（不落持久 Issue）
// 修复后：前置准入 409 PUBLISH_SOURCE_UNAVAILABLE；publishArticle 返回非空 releaseId 才写 snapshot，
//   否则 409 PUBLISH_RELEASE_INVALID；两条失败路径均调用注入的 recordFailure（S4 单源）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApprovalStateMachine } = require("../release-governance/approval-state-machine-service.cjs");

const SOURCE = "知识库/raw/precleaned/a1.md";
const RAW = "# A1\n正文";
const REAL_HASH = require("node:crypto").createHash("sha256").update(RAW).digest("hex");

async function fixtureApproved({ withFile = true, publishArticle, recordFailure } = {}) { // PR-056：transition 异步化随迁
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asm-publish-")); process.env.DECISIONS_MIRROR_DIR = path.join(os.tmpdir(), "dm-approval-sta-"); // Master 加固批：approval 镜像刷新写通道钉 /tmp（防写真仓镜像砸 repo 洁净面）
  fs.mkdirSync(path.join(dir, "知识库/raw/precleaned"), { recursive: true });
  if (withFile) fs.writeFileSync(path.join(dir, SOURCE), RAW, "utf8");
  const sm = createApprovalStateMachine({
    vaultPath: dir,
    logger: { info() {}, warn() {}, error() {} },
    standardizationProbe: () => ({ standardizationStatus: "standardized", formalContentHash: REAL_HASH }),
    publishArticle,
    recordFailure,
  });
  await sm.transition("a1", "standardize", { sourcePath: SOURCE });
  // B2/D2：confirm 证据绑定真实文件哈希（publish 来源重验的对照锚）
  await sm.transition("a1", "confirm", { sourcePath: SOURCE, contentHash: REAL_HASH });
  return { dir, sm };
}

test("B1/T1：无 sourcePath publish → 409 PUBLISH_SOURCE_UNAVAILABLE，状态保持 approved", async () => {
  const { dir, sm } = await fixtureApproved({ publishArticle: () => ({ releaseId: "release-x" }) });
  await assert.rejects(
    () => sm.transition("a1", "publish", {}),
    (e) => e.code === "PUBLISH_SOURCE_UNAVAILABLE" && e.status === 409,
  );
  assert.equal(sm.getStatus("a1").status, "approved", "不得推进 snapshot");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T2：sourcePath 文件不存在 → 409 PUBLISH_SOURCE_UNAVAILABLE，状态保持 approved", async () => {
  const { dir, sm } = await fixtureApproved({ withFile: false, publishArticle: () => ({ releaseId: "release-x" }) });
  await assert.rejects(() => sm.transition("a1", "publish", { sourcePath: SOURCE }), { code: "PUBLISH_SOURCE_UNAVAILABLE" });
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T3：publishArticle 返回 releaseId=null → throw + 状态 approved + recordFailure 被调", async () => {
  const failures = [];
  const { dir, sm } = await fixtureApproved({
    publishArticle: () => ({ releaseId: null }),
    recordFailure: (stage, input, error) => failures.push({ stage, input, error }),
  });
  await assert.rejects(() => sm.transition("a1", "publish", { sourcePath: SOURCE }), { code: "PUBLISH_RELEASE_INVALID" });
  assert.equal(sm.getStatus("a1").status, "approved");
  assert.equal(failures.length, 1, "releaseId 非法必须落持久 Issue");
  assert.equal(failures[0].input.proposalId, "a1");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T4：伪造 input.releaseId 无 sourcePath → 409（状态机不得自造第二判定）", async () => {
  const { dir, sm } = await fixtureApproved({ publishArticle: () => ({ releaseId: "release-real" }) });
  await assert.rejects(() => sm.transition("a1", "publish", { releaseId: "release-forged" }), { code: "PUBLISH_SOURCE_UNAVAILABLE" });
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T5 golden：publishArticle 真实 releaseId → snapshot + releaseId 持久（回归守卫）", async () => {
  const { dir, sm } = await fixtureApproved({ publishArticle: () => ({ releaseId: "release-gold", snapshotPath: "x" }) });
  const result = await sm.transition("a1", "publish", { sourcePath: SOURCE });
  assert.equal(result.status, "snapshot");
  assert.equal(result.releaseId, "release-gold");
  assert.equal(sm.getStatus("a1").status, "snapshot");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T7 边界（独立验证指正）：sourcePath 空串 → 409 PUBLISH_SOURCE_UNAVAILABLE（不得解析为 vault 目录裸 EISDIR）", async () => {
  const { dir, sm } = await fixtureApproved({ publishArticle: () => ({ releaseId: "release-x" }) });
  await assert.rejects(() => sm.transition("a1", "publish", { sourcePath: "" }), { code: "PUBLISH_SOURCE_UNAVAILABLE", status: 409 });
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T8 边界：sourcePath 指向目录 → 409 PUBLISH_SOURCE_UNAVAILABLE（isFile 校验，非文件即拒绝）", async () => {
  const { dir, sm } = await fixtureApproved({ publishArticle: () => ({ releaseId: "release-x" }) });
  await assert.rejects(() => sm.transition("a1", "publish", { sourcePath: "知识库/raw/precleaned" }), { code: "PUBLISH_SOURCE_UNAVAILABLE", status: 409 });
  assert.equal(sm.getStatus("a1").status, "approved");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("B1/T6 recordFailure 参数契约：stage / proposalId / 错误码", async () => {
  const failures = [];
  const { dir, sm } = await fixtureApproved({
    publishArticle: () => ({ releaseId: null }),
    recordFailure: (stage, input, error) => failures.push({ stage, input, error }),
  });
  await assert.rejects(() => sm.transition("a1", "publish", { sourcePath: SOURCE }));
  assert.equal(failures[0].stage, "approval-publish");
  assert.equal(failures[0].error.code, "PUBLISH_RELEASE_INVALID");
  fs.rmSync(dir, { recursive: true, force: true });
});
