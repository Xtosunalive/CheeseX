// Component: Snapshot-Store-Service
// @responsible: Plan-B 快照打包——收集 approved 文件 → 复用 createStandardVersion 不可变快照 → temp/rename 原子写
// @inputs: approved 候选（articleId/contentHash/raw/sourcePath）
// @outputs: 不可变快照目录 + releaseId（供 release-builder 打包）
// @context: Vault
//
// 设计决策（ADR043 D5'，落死）：
// - 单文件快照复用 article-workflow-store.createStandardVersion（wiki/articles/{id}/{hash}.md, 0o444）
// - 整 Release 打包复用 release-builder-service（消费端三件套，零改动）
// - 原子写用 temp + rename（与 release-publisher 同模式）
// - 不得自造第二套快照写入（规则 30 identity 判定）
const crypto = require("node:crypto");
const { writeRepoFileAtomic } = require("../../shared/repo-file-io.cjs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { createStandardVersion } = require("../article-workflow/article-workflow-store.cjs");

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const { writeVault, writeVaultExclusive, replaceVault } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）；PR-083：指针为全权替换
const snapshotError = bindErrorFactory({ status: 400 });

function createSnapshotStore({ vaultPath, builderService, logger }) {
  // SPEC-030 派②：受管域集（category-path 首段值域）——enums 单源；解析失败回空集（不校验，
// fail-open：域值面失效时不阻断发布——域段仍必有〔resolveDomainSegment 缺失即拦〕，仅放开枚举校验）
function allowedDomainsFor(vaultPath) {
  try {
    const { loadArticleRuleSet } = require("../schema-manager/compliance-rule-set-service.cjs");
    return Object.keys((loadArticleRuleSet(vaultPath) || {}).domains || {});
  } catch (_error) { return []; }
}

function snapshotSingleFile({ articleId, contentHash, raw, sourcePath, document }) {
    if (!articleId || !contentHash || typeof raw !== "string") {
      throw snapshotError("SNAPSHOT_INPUT_INVALID", "快照输入不完整（articleId/contentHash/raw 必填）", 400);
    }
    // B2/D2：「文件名哈希=内容哈希」不变式入口断言（原靠 createStandardVersion 的 ARTICLE_SNAPSHOT_CONFLICT
    // 碰巧兜底，升格为显式 fail-closed）——命名规则见 article-workflow-store.cjs:155，不采信客户端哈希。
    const actualHash = crypto.createHash("sha256").update(raw).digest("hex");
    if (contentHash !== actualHash) {
      throw snapshotError("SNAPSHOT_HASH_MISMATCH", "快照 contentHash 与内容现算 sha256 不一致（不得采信客户端哈希）", 409, { articleId, provided: contentHash, actual: actualHash });
    }
    const now = new Date().toISOString();
    // 复用 createStandardVersion（不可变快照格式，0o444，contentHash 命名＋SPEC-030 派②域段落位）——不自造第二套
    const effectiveDocument = document || { articleId, title: articleId, product: "", version: "" };
    const result = createStandardVersion(vaultPath,
      { contentHash, sourcePath: sourcePath || `${articleLifecycle.WORKING_ROOT}/${articleId}.md` },
      raw,
      effectiveDocument,
      now,
      { allowedDomains: allowedDomainsFor(vaultPath) }
    );
    // S5（#1050 场景⑧）＋SPEC-030 派②扩面：正式区是「当前快照」暂存区，不是追加日志——
    // scanFormalReleaseSources 按 article_id 判重，同 articleId 两快照并存会让 collectCompleteArtifacts
    // 抛 DUPLICATE_DOCUMENT_ID。取代语义随域段扩为全域：清同 articleId 的一切旧快照（含跨域残留——
    // category-path 改域后旧域目录的文章）。先写新再删旧（写失败不删旧，fail-closed）；历史版本字节
    // 保留在 Release 产物（releasesDir/{releaseId}/artifacts/），删工作树旧快照不影响已发布 Release 不可变性。
    const snapshotAbs = path.join(vaultPath, result.version.snapshotPath);
    const targetName = path.basename(snapshotAbs);
    const articleDirName = path.basename(path.dirname(snapshotAbs));
    const formalRootAbs = articleLifecycle.formalArticlesDir(vaultPath);
    for (const domainEntry of fs.readdirSync(formalRootAbs, { withFileTypes: true })) {
      if (!domainEntry.isDirectory()) continue;
      for (const articleEntry of fs.readdirSync(path.join(formalRootAbs, domainEntry.name), { withFileTypes: true })) {
        if (!articleEntry.isDirectory() || articleEntry.name !== articleDirName) continue;
        const dirAbs = path.join(formalRootAbs, domainEntry.name, articleEntry.name);
        for (const fileEntry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
          if (fileEntry.isFile() && fileEntry.name.endsWith(".md") && fileEntry.name !== targetName) {
            fs.rmSync(path.join(dirAbs, fileEntry.name), { force: true });
          }
        }
      }
    }
    return { snapshotPath: result.version.snapshotPath, contentHash: result.version.contentHash, domainSegment: result.version.domainSegment, decisionId: result.decision.decisionId };
  }

  // 整 Release 打包（复用 release-builder；sourceCommit 用 Vault HEAD 前 40 位内容寻址，ADR043 D5'）
  function buildRelease({ sourceCommit, artifacts, buildConfiguration }) {
    if (!builderService || typeof builderService.build !== "function") {
      throw snapshotError("BUILDER_UNAVAILABLE", "release-builder 服务不可用", 500);
    }
    if (!/^[0-9a-f]{40}$/.test(sourceCommit || "")) {
      throw snapshotError("INVALID_SOURCE_COMMIT", "sourceCommit 必须是 40 位内容寻址 hash", 400);
    }
    const release = builderService.build({
      sourceCommit,
      buildConfiguration: buildConfiguration || { model: "plan-b-snapshot", publishedAt: new Date().toISOString() },
      artifacts,
    });
    return release;
  }

  // WP-069 S3 一表一主收编：current 指针读写整体移交 release-publisher（唯一写者/读者）——
  // 原 writeCurrent/readCurrentReleaseId 退役；此前双 lane（本模块直写＋publisher pointerWriter）
  // 即恢复接口死链根源。读侧消费方经 publisherService.getCurrentReleaseId()。
  return { snapshotSingleFile, buildRelease };
}

module.exports = { createSnapshotStore };
