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

  // PR-306：源文章删除读时销账——发布失败 Issue 是文章发布尝试的派生物，文章从半成品区
  // 消失后 B3 取代通道（同一文章再成功发布）对已删文章是死路，不销账即僵尸
  //（2026-11-15 实录：文章删除后「Release publication failed」永挂待处理）。
  // 红队必修回归面：批量探针单次装载（禁逐单全量扫描）＋幂等＋审计面保留全史。
  it("PR-306 源文章已删除的文章绑定失败单读时销账（批量探针单次装载），幂等且审计面保留全史", () => withRepo((repoPath) => {
    const releasesDir = path.join(repoPath, ".ledger", "releases");
    const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
    const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t5-v1", logger });
    const readerService = createReleaseReaderService({ builderService, releasesDir });
    const calls = [];
    const publisherService = createReleasePublisherService({
      builderService, readerService, releasesDir, logger,
      resolveArticlesPresence: (articleIds) => {
        calls.push([...articleIds].sort());
        return Object.fromEntries(articleIds.map((articleId) => [articleId, articleId !== "article-gone"]));
      },
    });
    publisherService.recordFailure("artifact-collection", { sourceCommit: oid("a"), buildConfiguration: { articleId: "article-gone", model: "plan-b-complete" } }, Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" }), null);
    publisherService.recordFailure("artifact-collection", { sourceCommit: oid("b"), buildConfiguration: { articleId: "article-alive", model: "plan-b-complete" } }, Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" }), null);
    // 独立铸版失败单（无文章引用）：不辖，即使探针说所有文章都不在
    publisherService.recordFailure("artifact-collection", { sourceCommit: oid("c"), buildConfiguration: { model: "standalone-mint", trigger: "manual" } }, Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" }), null);
    const active = publisherService.listActiveIssues();
    assert.equal(active.length, 2, "源文章已删的失败单不再作活检出，其余两条仍活");
    assert.ok(active.every((issue) => issue.buildConfiguration.articleId !== "article-gone"), "已销账条目不出现在活清单");
    const stored = publisherService.listIssues().find((issue) => issue.buildConfiguration.articleId === "article-gone");
    assert.equal(stored.status, "resolved", "销账写入 status=resolved（非读时过滤的纯隐藏）");
    assert.equal(stored.resolvedReason, "source_article_deleted");
    // 批量契约（红队必修）：第一次读恰一次探针调用，覆盖去重后的两个文章引用
    assert.equal(calls.length, 1, "单次读恰一次批量探针调用（非逐单）");
    assert.deepEqual(calls[0], ["article-alive", "article-gone"], "探针入参＝去重后的在册文章引用");
    // 幂等：第二次读探针只被仍 open 的文章绑定条目触发（已销账条目与独立铸版条目跳过）
    const activeAgain = publisherService.listActiveIssues();
    assert.equal(activeAgain.length, 2, "第二次读结果一致");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ["article-alive"], "已销账条目不再触发探针");
  }));

  it("PR-306 探针异常/缺键按文章仍在处理（fail-safe 不误销）；不注入探针即不销账", () => withRepo((repoPath) => {
    const releasesDir = path.join(repoPath, ".ledger", "releases");
    const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
    const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t5-v1", logger });
    const readerService = createReleaseReaderService({ builderService, releasesDir });
    const recordGone = (publisherService) => publisherService.recordFailure("artifact-collection", { sourceCommit: oid("a"), buildConfiguration: { articleId: "article-x", model: "plan-b-complete" } }, Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" }), null);
    // 探针整体抛错 → 跳过本轮销账
    const throwing = createReleasePublisherService({
      builderService, readerService, releasesDir, logger,
      resolveArticlesPresence: () => { throw new Error("probe down"); },
    });
    recordGone(throwing);
    assert.equal(throwing.listActiveIssues().length, 1, "探针异常时失败单保持活跃（不误销）");
    // 探针返回缺键（应答不完整）→ 缺键按文章仍在
    const partial = createReleasePublisherService({
      builderService, readerService, releasesDir, logger,
      resolveArticlesPresence: () => ({}),
    });
    recordGone(partial);
    assert.equal(partial.listActiveIssues().length, 1, "探针缺键按文章仍在处理（不误销）");
    // 未注入探针（旧装配形态）→ 不销账
    const bare = createReleasePublisherService({ builderService, readerService, releasesDir, logger });
    recordGone(bare);
    assert.equal(bare.listActiveIssues().length, 1, "缺省（未注入探针）不销账，旧装配零影响");
  }));

  // PR-306 红队记档①：重开的 open 单不得残留销账印章（B3 resolvedByReleaseId 族与本批
  // source_article_deleted 同一规则——重开即重新在册，旧退休理由对 open 单失真）。
  it("PR-306 同指纹失败重开时清除销账印章，occurrenceCount/createdAt 保留", () => withRepo((repoPath) => {
    const releasesDir = path.join(repoPath, ".ledger", "releases");
    const logger = createJsonLogger({ level: "silent", stream: fs.createWriteStream("/dev/null") });
    const builderService = createReleaseBuilderService({ releasesDir, builderVersion: "t5-v1", logger });
    const readerService = createReleaseReaderService({ builderService, releasesDir });
    const publisherService = createReleasePublisherService({
      builderService, readerService, releasesDir, logger,
      resolveArticlesPresence: (articleIds) => Object.fromEntries(articleIds.map((articleId) => [articleId, false])),
    });
    const input = { sourceCommit: oid("a"), buildConfiguration: { articleId: "article-y", model: "plan-b-complete" } };
    const error = Object.assign(new Error("missing"), { code: "RELEASE_ARTIFACT_MISSING" });
    const first = publisherService.recordFailure("artifact-collection", input, error, null);
    // 读时销账（探针说文章不在）
    publisherService.listActiveIssues();
    const resolved = publisherService.listIssues().find((issue) => issue.issueId === first.issueId);
    assert.equal(resolved.status, "resolved", "前置：销账已落账");
    // 文章重现后同逻辑失败再现 → 同指纹重开，印章清除、occurrence 递增
    const reopened = publisherService.recordFailure("artifact-collection", input, error, null);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.issueId, first.issueId, "同指纹同单");
    assert.equal(reopened.occurrenceCount, 2, "出现次数递增");
    assert.equal(reopened.createdAt, first.createdAt, "首见时间保留");
    for (const stamp of ["resolvedReason", "resolvedAt", "resolvedByReleaseId", "resolvedBySourceCommit"]) {
      assert.equal(reopened[stamp], undefined, `重开单不得残留 ${stamp}`);
    }
  }));
});
