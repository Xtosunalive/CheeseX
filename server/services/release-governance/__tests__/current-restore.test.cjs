const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitFixtureEnv } = require("../../../../scripts/quality/shared/git-fixture-env.cjs");

const { createReleaseBuilderService } = require("../release-builder-service.cjs");
const { createReleasePublisherService } = require("../release-publisher-service.cjs");
const { createReleaseReaderService } = require("../release-reader-service.cjs");
const { createJsonLogger } = require("../../../shared/json-logger.cjs");

function git(args, cwd) {
  return execFileSync("git", args, { env: gitFixtureEnv(process.env), cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
}
function oid(character) { return character.repeat(40); }

function withRepo(callback) {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "t3-restore-"));
  const cleanup = () => { try { fs.rmSync(repoPath, { recursive: true, force: true }); } catch {} };
  try {
    git(["init", "-b", "main"], repoPath);
    git(["config", "user.email", "test@example.invalid"], repoPath);
    git(["config", "user.name", "T3 Test"], repoPath);
    fs.writeFileSync(path.join(repoPath, "README.md"), "# Fixture\n");
    git(["add", "README.md"], repoPath);
    git(["commit", "-m", "fixture"], repoPath);
    const result = callback(repoPath);
    if (result && typeof result.then === "function") return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) { cleanup(); throw error; }
}

function services(repoPath) {
  const releasesDir = path.join(repoPath, ".ledger", "releases");
  const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
  const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t3-v1", logger });
  const readerService = createReleaseReaderService({ builderService, releasesDir });
  const publisherService = createReleasePublisherService({ builderService, readerService, releasesDir, logger });
  return { releasesDir, builderService, readerService, publisherService };
}

// E5：publisherService.publish 已退役（生产零调用死代码），setup 不再借它造 release。
// 等价构造：builderService.build 建 Release + 直接写 current.json 指针（语义与原 publish 的 build+pointer 一致）。
function publishRelease(svc, input) {
  const release = svc.builderService.build(input);
  const pointer = {
    releaseId: release.releaseId,
    sourceCommit: release.sourceCommit,
    manifestHash: release.manifestHash,
    previousReleaseId: svc.publisherService.getCurrentReleaseId(),
    publishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(svc.releasesDir, "current.json"), `${JSON.stringify(pointer, null, 2)}\n`);
  return pointer;
}

describe("T3 current pointer restore", () => {
  it("restores current pointer to a historical Release after corruption", () => withRepo((repoPath) => {
    const svc = services(repoPath);
    const first = publishRelease(svc, { sourceCommit: oid("1"), artifacts: { "a.json": "one" } });
    const second = publishRelease(svc, { sourceCommit: oid("2"), artifacts: { "a.json": "two" } });
    assert.equal(svc.publisherService.getCurrentReleaseId(), second.releaseId);

    // 模拟指针损坏：写非法 releaseId
    const pointerPath = path.join(svc.releasesDir, "current.json");
    fs.writeFileSync(pointerPath, JSON.stringify({ releaseId: "release-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", sourceCommit: oid("x"), manifestHash: "bad" }, null, 2));

    const restored = svc.publisherService.restoreCurrent({ releaseId: first.releaseId });
    assert.equal(restored.releaseId, first.releaseId);
    assert.equal(restored.sourceCommit, oid("1"));
    assert.equal(restored.previousReleaseId, "release-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    assert.equal(restored.restored, true);
    assert.equal(svc.publisherService.getCurrentReleaseId(), first.releaseId);
    // 恢复后 current 可被 reader 正常解析
    assert.equal(svc.readerService.resolveCurrentReleaseId(), first.releaseId);
  }));

  it("rejects restore of a non-existent or invalid Release", () => withRepo((repoPath) => {
    const svc = services(repoPath);
    publishRelease(svc, { sourceCommit: oid("1"), artifacts: { "a.json": "one" } });
    assert.throws(() => svc.publisherService.restoreCurrent({ releaseId: "release-" + oid("f").slice(0, 64) }), (err) => err.code === "RELEASE_RESTORE_INVALID" || err.code === "RELEASE_RESTORE_NOT_FOUND");
    assert.throws(() => svc.publisherService.restoreCurrent({}), { code: "VALIDATION_ERROR" });
  }));

  it("restore writes atomic pointer and audit entry", () => withRepo((repoPath) => {
    const svc = services(repoPath);
    const first = publishRelease(svc, { sourceCommit: oid("1"), artifacts: { "a.json": "one" } });
    publishRelease(svc, { sourceCommit: oid("2"), artifacts: { "a.json": "two" } });
    const pointerPath = path.join(svc.releasesDir, "current.json");
    fs.writeFileSync(pointerPath, JSON.stringify({ releaseId: "broken" }));
    svc.publisherService.restoreCurrent({ releaseId: first.releaseId });
    // 无 .tmp 残留
    assert.equal(fs.readdirSync(svc.releasesDir).some((name) => name.endsWith(".tmp")), false);
    // 审计含恢复事件
    const audit = fs.readFileSync(path.join(svc.releasesDir, "issues", "publish-failures.jsonl"), "utf8");
    assert.ok(audit.includes("release.current-restored"));
  }));
});

describe("T3 逆向核查补充（#875）", () => {
  it("restores even when current.json is corrupt (invalid JSON), not just invalid releaseId", () => withRepo((repoPath) => {
    const svc = services(repoPath);
    const first = publishRelease(svc, { sourceCommit: oid("1"), artifacts: { "a.json": "one" } });
    // 非法 JSON（截断）而非可解析但非法 releaseId
    const pointerPath = path.join(svc.releasesDir, "current.json");
    fs.writeFileSync(pointerPath, '{"releaseId": "release-broken', { encoding: "utf8" });
    // 修复前 getCurrentReleaseId 抛错 → restore 无法自救；修复后返回 null 并恢复
    const restored = svc.publisherService.restoreCurrent({ releaseId: first.releaseId });
    assert.equal(restored.releaseId, first.releaseId);
    assert.equal(restored.previousReleaseId, null, "损坏 current 时 previousReleaseId 应为 null（容错）");
    assert.equal(svc.publisherService.getCurrentReleaseId(), first.releaseId);
  }));

  it("audit write failure does not mask pointer movement success", () => withRepo((repoPath) => {
    const svc = services(repoPath);
    const first = publishRelease(svc, { sourceCommit: oid("1"), artifacts: { "a.json": "one" } });
    // 让审计目录不可写
    const auditDir = path.join(svc.releasesDir, "issues");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.chmodSync(auditDir, 0o500);
    let result;
    try {
      result = svc.publisherService.restoreCurrent({ releaseId: first.releaseId });
    } finally {
      fs.chmodSync(auditDir, 0o755);
    }
    assert.equal(result.releaseId, first.releaseId, "指针应已移动");
    assert.ok(result.auditWarning, "应附加 auditWarning（不掩盖成功）");
  }));
});
