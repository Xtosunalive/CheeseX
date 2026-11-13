// Component: Approval-State-Machine-Assembly
// @responsible: 状态机装配——创建并返回状态机（ADR-004：HTTP 注册职责归 routes 层，本模块不持有端点）
// CI 切片：注入 publishArticle（打包 Release + 原子 current），激活 snapshot-store（#1041/#1042）
const path = require("node:path");
const { resolveReleasesDir } = require("../../shared/releases-dir.cjs");
const { execFileSync } = require("node:child_process");
const { createApprovalStateMachine } = require("./approval-state-machine-service.cjs");
const { createSnapshotStore } = require("./snapshot-store-service.cjs");
const { createReleaseBuilderService } = require("./release-builder-service.cjs");
const { createReleaseReaderService } = require("./release-reader-service.cjs");
const { createReleasePublisherService } = require("./release-publisher-service.cjs");
const { validateArticleIndividual } = require("../article-workflow/article-individual.cjs");
const { collectCompleteArtifacts } = require("./complete-release-artifact-service.cjs");

// Vault HEAD（sourceCommit 内容寻址，ADR043 D5'）
function vaultHead(vaultPath) {
  // PR-056 豁免：boot 期一次性锚定（listen 前完成，不阻塞请求路径）——服务装配在 main.cjs 顶层
  // eslint-disable-next-line no-restricted-syntax
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: vaultPath, encoding: "utf8" }).trim();
}

function registerApprovalStateMachine(options) {
  // 源头校验探针：复用 article-workflow 的 getPrecleaned（权威判定 standardizationStatus/formalContentHash）
  const standardizationProbe = (options.articleWorkflowService && typeof options.articleWorkflowService.getPrecleaned === "function")
    ? function probe(articleId) {
        try {
          const item = options.articleWorkflowService.getPrecleaned(articleId);
          return item ? { standardizationStatus: item.standardizationStatus, formalContentHash: item.formalContentHash || null, sourcePath: item.sourcePath } : null;
        } catch (error) {
          if (options.logger && typeof options.logger.warn === "function") options.logger.warn({ event: "standardization-probe-failed", articleId, error: error && error.message });
          return null;
        }
      }
    : null;

  // CI 切片：snapshot-store + release-builder（复用旧链路 releasesDir 约定 .git/anyshare-releases）
  // 旧链路约定：.git/anyshare-releases（formal-consumer 消费端读这里）
  const releasesDir = resolveReleasesDir({ vaultPath: options.vaultPath, releasesDir: options.releasesDir }).dir; // WP-023：唯一解析点（新家 .releases/）
  const builderService = createReleaseBuilderService({ releasesDir, logger: options.logger });
  const snapshotStore = createSnapshotStore({ vaultPath: options.vaultPath, builderService, logger: options.logger });
  // S4 修复（gherkin 场景⑧）：publish 失败必须落持久 Issue。复用 release-publisher-service.recordFailure
  // （唯一 Issue 写入实现，规则 8 单源；/api/anomalies 经 listIssues 读同一 issues/publication-issues.json）。
  // 只取 recordFailure，不引入 publisher.publish 全套（publish 流程仍由本装配层的 snapshot+collect+buildRelease 驱动）。
  const readerService = createReleaseReaderService({ builderService, releasesDir });
  const publisherService = createReleasePublisherService({ builderService, readerService, releasesDir, logger: options.logger });

  // snapshotArticle：读候选文件 → 产正式区标准文章快照（standardize 时调用，ADR043 D2'）
  function snapshotArticle(article) {
    return snapshotStore.snapshotSingleFile({
      articleId: article.articleId,
      contentHash: article.contentHash,
      raw: article.raw,
      sourcePath: article.sourcePath,
      document: article.document,
    });
  }

  // publishArticle：收集完整正式产物 → 打包 Release → 原子写 current（ADR043 D5'）
  // 修复（浏览器实测 #1050）：只打包文章快照导致消费端 RELEASE_ARTIFACT_MISSING（enums.yaml 等缺失）。
  // 复用 complete-release-artifact-service.collectCompleteArtifacts 收集完整产物（Schema 规则/master_graph/索引/统计），
  // 叠加新文章快照；过滤 .git/ 与 .ledger-backups/ 等非正式源（规则 1 复用，规则 30 不自造第二套）。
  const IGNORED_ARTIFACT_PREFIXES = [".git/", ".ledger-backups/", ".releases/"]; // .releases 同批收进 filesUnder 源头禁区——此处纵深保留
  // WP-017：铸版核心（与文章无关）——文章审批发布与独立发布入口（POST /api/releases/mint）共用，单源。
  // 语义与原 publishArticle 内联实现逐项等价：阶段追踪（S4 失败落 Issue）→ build → 原子 current →
  // 取代在册失败账（B3/#1794）→ 发布后图谱重建联动（B3，失败不阻断）。
  function recordPublicationFailure(stage, sourceCommit, buildConfiguration, error) {
    try {
      publisherService.recordFailure(stage, { sourceCommit, buildConfiguration }, error, publisherService.getCurrentReleaseId()); // WP-069 S3：读经 owner
    } catch (issueError) {
      if (options.logger && typeof options.logger.error === "function") {
        options.logger.error({ event: "release.issue-record-failed", stage, error: issueError && issueError.message });
      }
    }
  }

  function mintRelease({ artifacts, buildConfiguration, sourceCommit }) {
    // WP-017 红队建议#3：入口单次计算后传入（收集段失败账与铸版本体同锚，消除双算子进程开销）
    const commitAnchor = sourceCommit || vaultHead(options.vaultPath);
    let stage = "artifact-collection";
    try {
      stage = "build";
      const release = snapshotStore.buildRelease({ sourceCommit, artifacts, buildConfiguration });
      stage = "current-pointer";
      const current = {
        releaseId: release.releaseId,
        sourceCommit,
        manifestHash: release.manifestHash,
        publishedAt: new Date().toISOString(),
        previousReleaseId: publisherService.getCurrentReleaseId(), // WP-069 S3：读经 owner
      };
      publisherService.writeCurrentPointer(current); // WP-069 S3：写经 owner（唯一写入口）
      // B3（#1794）：成功发布取代在册失败账——账本写失败不得阻断已成功的发布
      try {
        publisherService.resolveSupersededIssues({ releaseId: release.releaseId, sourceCommit: commitAnchor });
      } catch (retireError) {
        if (options.logger && typeof options.logger.error === "function") {
          options.logger.error({ event: "release.issue-retire-failed", error: retireError && retireError.message });
        }
      }
      // B3：发布→图谱重建联动（源变图不变=投影说谎；joinExisting 幂等，失败不阻断只记日志）
      if (options.pipelineRunService && typeof options.pipelineRunService.startDiagnostic === "function") {
        try {
          options.pipelineRunService.startDiagnostic("full");
          if (options.logger && typeof options.logger.info === "function") {
            options.logger.info({ event: "post-publish-graph-rebuild-triggered", releaseId: release.releaseId });
          }
        } catch (rebuildError) {
          if (options.logger && typeof options.logger.warn === "function") {
            options.logger.warn({ event: "post-publish-graph-rebuild-failed", releaseId: release.releaseId, error: rebuildError && rebuildError.message });
          }
        }
      }
      return { releaseId: release.releaseId, manifestHash: release.manifestHash, sourceCommit: commitAnchor, artifactCount: Object.keys(artifacts).length, previousReleaseId: current.previousReleaseId };
    } catch (error) {
      // S4：失败落持久 Issue（防重复由 error.publicationIssueRecorded 置位控制）
      recordPublicationFailure(stage, commitAnchor, buildConfiguration, error);
      throw error;
    }
  }

  function publishArticle(article) {
    const sourceCommit = vaultHead(options.vaultPath);
    const buildConfiguration = { model: "plan-b-complete", publishedAt: new Date().toISOString(), articleId: article.articleId };
    let snapshot;
    let artifacts;
    try {
      snapshot = snapshotArticle(article);
      // PR-303：豁免本次快照（其字节即待批内容，其余正式文章须与 current Release 一致）
      const baseArtifacts = collectCompleteArtifacts(options.vaultPath, { exemptFormalPaths: [snapshot.snapshotPath] });
      artifacts = Object.fromEntries(
        Object.entries(baseArtifacts)
          .filter(([name]) => !IGNORED_ARTIFACT_PREFIXES.some((prefix) => name.startsWith(prefix)))
      );
      artifacts[snapshot.snapshotPath] = Buffer.from(article.raw, "utf8");
      // 断链修复（AI 消费端契约）：把审批凭据注入 document 索引，下游读正式文章时可核验"谁批/何时"
      if (article.approval) {
        const docIndexName = "indexes/document-search.json";
        const docIndex = artifacts[docIndexName];
        if (docIndex) {
          const parsed = JSON.parse(docIndex.toString("utf8"));
          parsed.documents = Array.isArray(parsed.documents)
            ? parsed.documents.map((doc) => (doc && doc.articleId === article.articleId
                ? { ...doc, approvedBy: article.approval.decidedBy, approvedAt: article.approval.decidedAt }
                : doc))
            : parsed.documents;
          artifacts[docIndexName] = Buffer.from(JSON.stringify(parsed));
        }
      }
    } catch (error) {
      recordPublicationFailure("artifact-collection", sourceCommit, buildConfiguration, error);
      throw error;
    }
    const minted = mintRelease({ artifacts, buildConfiguration, sourceCommit });
    return { ...minted, snapshotPath: snapshot.snapshotPath };
  }

  // WP-017 独立发布入口核心：不绑文章审批——收集当前全库产物并铸版（人工触发；Master 裁①选项 B，
  // OpenMAIC「按钮→job」形态参照；铸版语义/失败账/重建联动与文章发布完全同源）
  function publishCurrent() {
    const sourceCommit = vaultHead(options.vaultPath);
    const buildConfiguration = { model: "standalone-mint", publishedAt: new Date().toISOString(), trigger: "manual" };
    let artifacts;
    try {
      const baseArtifacts = collectCompleteArtifacts(options.vaultPath);
      artifacts = Object.fromEntries(
        Object.entries(baseArtifacts)
          .filter(([name]) => !IGNORED_ARTIFACT_PREFIXES.some((prefix) => name.startsWith(prefix)))
      );
    } catch (error) {
      recordPublicationFailure("artifact-collection", sourceCommit, buildConfiguration, error);
      throw error;
    }
    return mintRelease({ artifacts, buildConfiguration, sourceCommit });
  }

  const approvalStateMachine = createApprovalStateMachine({
    vaultPath: options.vaultPath,
    logger: options.logger,
    standardizationProbe,
    validateIndividual: standardizationProbe ? (raw) => validateArticleIndividual(options.vaultPath, raw) : null,
    publishArticle: typeof options.disablePublish === "function" && options.disablePublish() ? null : publishArticle,
    snapshotArticle,
    // B1/D1：publish 前置准入失败/releaseId 非法时落持久 Issue（S4 单源 = publisherService.recordFailure）
    recordFailure: publisherService.recordFailure,
    // SPEC-010-W10 WP2：审批写回 git 落账（main.cjs 注入；缺省 no-op 不破旧装配/测试）
    gitLedger: options.gitLedger,
  });
  // ADR-004 / W2-WP2：路由注册职责上移 main.cjs（routes 层），服务层不再 require 路由模块。
  return { ...approvalStateMachine, publishCurrent };
}

module.exports = { registerApprovalStateMachine };
