// 层级：L1 单元＋源树扫描 tripwire（WP-069 S3／SPEC-069 §3.3——release-artifact-data 一表一主执法）。
// 被测对象：current.json 写位点唯一（owner=release-publisher）；snapshot-store 指针读写已退役。
// 结构保证双层：①模块导出面（owner 暴露 writeCurrentPointer，store 不再暴露指针读写）；
// ②源树面（writeCurrent(/readCurrentReleaseId( 调用点 ⊆ owner 定义＋owner API 消费）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const { createReleasePublisherService } = require("../release-publisher-service.cjs");
const store = require("../snapshot-store-service.cjs");

test("owner 导出面：publisher 暴露唯一写入口 writeCurrentPointer；snapshot-store 指针读写已退役", () => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "pointer-owner-"));
  try {
    const publisher = createReleasePublisherService({
      builderService: { verifyRelease: () => ({ valid: true }), readRelease: () => null },
      releasesDir: tmp,
    });
    assert.equal(typeof publisher.writeCurrentPointer, "function", "owner 唯一写入口在册");
    assert.equal(typeof publisher.getCurrentReleaseId, "function", "owner 读面在册");
    // 唯一写入口真实可写＋读回（铸版链与恢复链同通道的结构锚）
    publisher.writeCurrentPointer({ releaseId: "release-A", previousReleaseId: null });
    assert.equal(publisher.getCurrentReleaseId(), "release-A");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  for (const retired of ["writeCurrent", "readCurrentReleaseId"]) {
    assert.equal(retired in store, false, `snapshot-store.${retired} 已退役（双 lane 根除）`);
  }
});

test("源树 tripwire：current.json 写位点唯一——函数名面＋路径面双守（红队 2026-11-02：只守函数名可被直写绕过）", () => {
  const ALLOW = new Set([
    "server/services/release-governance/release-publisher-service.cjs", // owner（定义 writeCurrentPointer/getCurrentReleaseId）
    "server/services/release-governance/approval-state-machine-assembly.cjs", // owner API 消费（mintRelease 链）
    "server/services/release-governance/__tests__/current-pointer-ownership.test.cjs", // 本 tripwire 自身
  ]);
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(cjs|mjs|js)$/.test(e.name)) hits.push(full);
    }
  };
  walk(path.join(ROOT, "server"));
  const offenders = [];
  for (const file of hits) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (ALLOW.has(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (/writeCurrent\s*\(|readCurrentReleaseId\s*\(/.test(text)) offenders.push(`${rel}（函数名面）`);
    // 路径面（生产代码）：owner 之外 "current.json" 字面量与写原语同现即第二 lane。
    // 测试树夹具直写指针是合法播种（模拟损坏/历史态），不属生产 lane——排除 __tests__。
    if (!rel.includes("/__tests__/") && /["'`]current\.json["'`]/.test(text) && /writeFileSync|writeFile\(|appendFileSync|renameSync|writeRepoFileAtomic|replaceVault|writeVault/.test(text)) offenders.push(`${rel}（路径面）`);
  }
  assert.deepEqual(offenders, [], "current 指针写位点不得出现第二 lane——函数名或路径面任一命中即红（新消费方须经 publisher owner API）");
});

test("writeCurrentPointer 在 publish 锁内（红队 2026-11-02 必修②）：持锁期间第二方 409 PUBLISH_BUSY；restoreCurrent 持锁内写指针不自锁", () => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "pointer-lock-"));
  try {
    const staleLock = require("../stale-lock.cjs");
    const publisher = createReleasePublisherService({
      builderService: { verifyRelease: () => ({ valid: true }), readRelease: (id) => ({ releaseId: id, sourceCommit: "1".repeat(40), manifestHash: "sha256:x" }) },
      releasesDir: tmp,
    });
    // 外部持锁（模拟并发铸版方）→ 指针写入必须 409 而非 last-rename-wins
    assert.ok(staleLock.acquireWithStaleRecovery("publish"), "测试先占锁");
    try {
      assert.throws(() => publisher.writeCurrentPointer({ releaseId: "release-B", previousReleaseId: null }), (e) => e.code === "PUBLISH_BUSY" && e.status === 409);
    } finally { staleLock.release("publish"); }
    // 释放后可写；restoreCurrent 自身持锁内再调 writeCurrentPointer（重入）不得 409
    publisher.writeCurrentPointer({ releaseId: "release-A", previousReleaseId: null });
    const restored = publisher.restoreCurrent({ releaseId: "release-A" });
    assert.equal(restored.releaseId, "release-A", "持锁内重入写指针成功（lockDepth 放行）");
    assert.equal(publisher.getCurrentReleaseId(), "release-A");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
