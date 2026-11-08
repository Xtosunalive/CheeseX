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
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "t5-issue-"));
  const cleanup = () => { try { fs.rmSync(repoPath, { recursive: true, force: true }); } catch {} };
  try {
    git(["init", "-b", "main"], repoPath);
    git(["config", "user.email", "test@example.invalid"], repoPath);
    git(["config", "user.name", "T5 Test"], repoPath);
    fs.writeFileSync(path.join(repoPath, "README.md"), "# Fixture\n");
    git(["add", "README.md"], repoPath);
    git(["commit", "-m", "fixture"], repoPath);
    const result = callback(repoPath);
    if (result && typeof result.then === "function") return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) { cleanup(); throw error; }
}

describe("T5 publication Issue delivery", () => {
  it("normal failure records an Issue without observable flag", () => withRepo((repoPath) => {
    const releasesDir = path.join(repoPath, ".ledger", "releases");
    const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
    const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t5-v1", logger });
    const readerService = createReleaseReaderService({ builderService, releasesDir });
    const publisherService = createReleasePublisherService({ builderService, readerService, releasesDir, logger });
    // E5：publisherService.publish 已退役，setup 不再借它触发失败路径——
    // 先成功构建一个 Release（对照：成功不产生 Issue），再直接调 recordFailure 模拟发布失败落 Issue。
    const release = builderService.build({ sourceCommit: oid("1"), artifacts: { "a": "1" } });
    fs.writeFileSync(path.join(releasesDir, "current.json"), `${JSON.stringify({
      releaseId: release.releaseId, sourceCommit: release.sourceCommit, manifestHash: release.manifestHash,
      previousReleaseId: null, publishedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    assert.equal(publisherService.listIssues().length, 0, "成功发布不应产生 Issue");
    const issue = publisherService.recordFailure("build", { sourceCommit: oid("1"), buildConfiguration: {} }, Object.assign(new Error("build boom"), { code: "BUILD_FAILED" }), release.releaseId);
    assert.equal(issue.issueRecordFailed, undefined, "正常记录不应有 issueRecordFailed");
    assert.equal(publisherService.listIssues().length, 1, "Issue 应正常记录");
  }));

  it("Issue storage failure surfaces observable signal instead of silent swallow", () => withRepo((repoPath) => {
    const releasesDir = path.join(repoPath, ".ledger", "releases");
    const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
    const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t5-v1", logger });
    const readerService = createReleaseReaderService({ releasesDir });
    const publisherService = createReleasePublisherService({ builderService, readerService, releasesDir, logger });
    // 让 issues 目录不可写（chmod 0）→ writeIssues 写 temp 失败 → recordFailure 抛错（不静默吞掉）。
    // E5：publish 已退役，原「publish catch 附加 issueRecordFailed 信号」随 publish 删除；
    // 生产上记录失败由调用方（approval-state-machine-assembly 等）各自 catch 处理，此处直接验证 recordFailure 不静默。
    fs.mkdirSync(path.join(releasesDir, "issues"), { recursive: true });
    fs.chmodSync(path.join(releasesDir, "issues"), 0o500);
    let caught;
    try {
      publisherService.recordFailure("build", { sourceCommit: oid("1"), artifacts: { "a": "1" } }, Object.assign(new Error("build boom"), { code: "BUILD_FAILED" }), null);
    } catch (error) { caught = error; }
    fs.chmodSync(path.join(releasesDir, "issues"), 0o755);
    assert.ok(caught, "Issue 记录失败必须抛出，不静默吞掉");
    assert.ok(typeof caught.code === "string" && caught.code.length > 0, "错误应携带 code（如 EACCES 或 ISSUE_RECORD_FAILED）");
  }));

  it("ADR063 #1746 listActiveIssues: 同 commit 失败记录被成功发布取代后不再作活检出", () => withRepo((repoPath) => {
    const releasesDir = path.join(repoPath, ".ledger", "releases");
    const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
    const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t5-v1", logger });
    const readerService = createReleaseReaderService({ builderService, releasesDir });
    const publisherService = createReleasePublisherService({ builderService, readerService, releasesDir, logger });
    const commitA = oid("a");
    const commitB = oid("b");
    // 无 current 指针：失败记录全部是活的
    publisherService.recordFailure("artifact-collection", { sourceCommit: commitA, buildConfiguration: {} }, Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" }), null);
    publisherService.recordFailure("artifact-collection", { sourceCommit: commitB, buildConfiguration: {} }, Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" }), null);
    assert.equal(publisherService.listActiveIssues().length, 2, "无成功发布前两条失败都是活的");
    // 同 commit A 发布成功（current 指针指向 A）：A 的失败记录被取代，B 仍活
    const release = builderService.build({ sourceCommit: commitA, artifacts: { "a": "1" } });
    fs.writeFileSync(path.join(releasesDir, "current.json"), `${JSON.stringify({
      releaseId: release.releaseId, sourceCommit: release.sourceCommit, manifestHash: release.manifestHash,
      previousReleaseId: null, publishedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    assert.equal(publisherService.listIssues().length, 2, "listIssues（审计面）保留全史");
    const active = publisherService.listActiveIssues();
    assert.equal(active.length, 1, "同 commit 已成功发布的失败记录不再作活检出");
    assert.equal(active[0].sourceCommit, commitB);
  }));
});
