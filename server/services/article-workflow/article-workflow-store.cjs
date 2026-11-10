// @responsible: 规范化并持久化文章工作流状态及创建不可变标准版本。
const crypto = require("crypto");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const fs = require("fs");
const path = require("path");
const { normalizeUploadStatus, stringArray } = require("./article-upload-status.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");
const { writeVault, writeVaultExclusive, contentRevision } = require("../../shared/vault-io.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）
const { loadDocument } = require("../../shared/document-load-port.cjs");
const { buildFileName } = require("../../shared/readable-path-mapper.cjs");

const STORE_VERSION = "6.0";
const STANDARDIZATION_STATUSES = ["pending_standardization", "blocked", "standardized"];

function textValue(value, fallback) { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function stableId(value) { return crypto.createHash("sha256").update(value).digest("hex").slice(0, 20); }
function candidateId(articleId, sourcePath) { return articleId || `candidate:${stableId(sourcePath)}`; }
// SPEC-012 WP-A：storePathFor（vault .ledger 路径）随③类迁出退役——工作流状态住 runtime-state.db

function normalizeDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const decisionId = textValue(value.decisionId, null);
  const contentHash = textValue(value.contentHash, null);
  if (!decisionId || !contentHash) return null;
  return {
    decisionId,
    decision: value.decision === "approved" ? "approved" : value.decision === "standardized" ? "standardized" : "rejected",
    contentHash,
    rulesHash: textValue(value.rulesHash, null), // PR-158 批次一：审批现场计算的规则指纹（审计收据）
    decidedAt: textValue(value.decidedAt, null),
    decidedBy: textValue(value.decidedBy, "local-architect"),
    proposalId: textValue(value.proposalId, null),
    proposalCommit: textValue(value.proposalCommit, null),
    checksId: textValue(value.checksId, null),
    previewHash: textValue(value.previewHash, null),
    releaseId: textValue(value.releaseId, null),
    sourceCommit: textValue(value.sourceCommit, null),
  };
}

function normalizeStandardizationWarning(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = textValue(value.message, null);
  if (!message) return null;
  return {
    code: textValue(value.code, "standardization-warning"),
    message,
    ruleId: textValue(value.ruleId, null),
    proposalId: textValue(value.proposalId, null),
    proposalCommit: textValue(value.proposalCommit, null),
    checksId: textValue(value.checksId, null),
    sourceCoordinate: textValue(value.sourceCoordinate, null),
  };
}

function normalizeStandardizationCheck(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposalId = textValue(value.proposalId, null);
  const proposalCommit = textValue(value.proposalCommit, null);
  const checksId = textValue(value.checksId, null);
  if (!proposalId || !proposalCommit || !checksId) return null;
  return { proposalId, proposalCommit, checksId, blocking: value.blocking === true };
}

function normalizeArticleRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.sourcePath !== "string") return null;
  const legacyArticleId = textValue(value.articleId, "");
  const identitySource = value.identitySource === "article_id" || (legacyArticleId && legacyArticleId !== stableId(value.sourcePath)) ? "article_id" : "sourcePath";
  const articleId = identitySource === "article_id" ? legacyArticleId : "";
  const currentHash = textValue(value.contentHash, null);
  const rawStandardizationStatus = STANDARDIZATION_STATUSES.includes(value.standardizationStatus)
    ? value.standardizationStatus
    : null;
  const standardizationStatus = rawStandardizationStatus === "blocked"
    ? "blocked"
    : rawStandardizationStatus === "standardized"
      ? "standardized"
      : "pending_standardization";
  return {
    candidateId: textValue(value.candidateId, candidateId(articleId, value.sourcePath)),
    articleId,
    identitySource,
    sourcePath: value.sourcePath,
    contentHash: currentHash,
    admissionBlockers: Array.isArray(value.admissionBlockers) ? value.admissionBlockers : null,
    decisions: Array.isArray(value.decisions) ? value.decisions.map(normalizeDecision).filter(Boolean) : [],
    standardizationStatus,
    validatedAt: textValue(value.validatedAt, null),
    standardizationWarnings: Array.isArray(value.standardizationWarnings) ? value.standardizationWarnings.map(normalizeStandardizationWarning).filter(Boolean) : [],
    lastStandardizationCheck: normalizeStandardizationCheck(value.lastStandardizationCheck),
    updatedAt: textValue(value.updatedAt, null),
  };
}

function normalizeTaskRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const taskId = textValue(value.taskId, null);
  const originalFileName = textValue(value.originalFileName, null);
  const draftPath = textValue(value.draftPath, null);
  const createdAt = textValue(value.createdAt, null);
  if (!taskId || !originalFileName || !draftPath || !createdAt) return null;
  return {
    taskId, originalFileName, draftPath,
    precleanedPath: textValue(value.precleanedPath, null),
    precleanedPaths: stringArray(value.precleanedPaths),
    articleIds: stringArray(value.articleIds),
    candidateCount: Number.isSafeInteger(value.candidateCount) && value.candidateCount >= 0 ? value.candidateCount : 0,
    status: normalizeUploadStatus(value.status),
    sizeBytes: Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 0 ? value.sizeBytes : 0,
    createdAt,
    updatedAt: textValue(value.updatedAt, createdAt),
    // 【退役兼容·只读】promote 快照通道已退役（2026-09-05）：字段缺口卡改由扫描通道读时派生；
    // 此处仅保留对历史账本数据的读取兼容，不再有任何写入者。
    pendingIssues: Array.isArray(value.pendingIssues)
      ? value.pendingIssues.filter((item) => item && typeof item === "object")
          .map((item) => ({ issue: textValue(item.issue, ""), source: textValue(item.source, "promote-validation"), resolved: Boolean(item.resolved) }))
          .filter((item) => item.issue)
      : undefined,
  };
}

// SPEC-012 WP-A：③类迁 runtime-state.db（整文档单行，事务内整体替换——并发读改写竞态由事务消解）
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs");

function readWorkflowState(vaultPath) {
  const got = getRuntimeStateStore(vaultPath).workflow.get();
  // WP-018：get 返回 { state, revision }（revision 供写侧乐观锁用；读侧只关心 state）
  const state = got ? got.state : undefined;
  if (!state) return { schemaVersion: STORE_VERSION, generatedAt: null, tasks: [], articles: [] };
  try {
    return {
      schemaVersion: STORE_VERSION,
      generatedAt: textValue(state.generatedAt, null),
      tasks: Array.isArray(state.tasks) ? state.tasks.map(normalizeTaskRecord).filter(Boolean) : [],
      articles: Array.isArray(state.articles) ? state.articles.map(normalizeArticleRecord).filter(Boolean) : [],
    };
  } catch (_error) {
    const error = new Error("上传任务状态数据损坏"); error.code = "UPLOAD_STORE_INVALID"; error.status = 503; throw error;
  }
}

function readWorkflowStateWithRevision(vaultPath) {
  // WP-022（PR-112 后续波次）：乐观锁 HTTP 接线——读侧带修订号（服务层入口预检＋写侧锁锚）
  const got = getRuntimeStateStore(vaultPath).workflow.get();
  if (!got) return { state: undefined, revision: 0 };
  return { state: got.state, revision: got.revision };
}

function writeWorkflowState(vaultPath, state, options) {
  state.schemaVersion = STORE_VERSION;
  state.generatedAt = new Date().toISOString();
  // WP-022：options.expectedRevision（可选）透传 workflow.put 乐观锁——缺省不锁＝存量调用零行为变化
  return getRuntimeStateStore(vaultPath).workflow.put(state, options);
}

function documentCategoryPath(document) {
  // document 形态两派兜底：parseEntityDocument 产物（frontmatter["category-path"] 嵌套）与
  // 审批装配手构（categoryPath 平铺）——域段解析入口统一取值（SPEC-030 派②）。
  // WP-138 R5b：键名经文档键源单点。
  if (document && typeof document.categoryPath === "string") return document.categoryPath;
  const fm = document && document.frontmatter;
  return fm && typeof fm[DK.ARTICLE.categoryPath] === "string" ? fm[DK.ARTICLE.categoryPath] : "";
}

function safeArticleDirectory(articleId) {
  return /^[A-Za-z0-9._-]+$/.test(articleId) ? articleId : `article-${stableId(articleId)}`;
}


// 标准化校验通过后写入已验证版本：快照机制与旧批准快照共用同一不可变位置，
// 但记录字段只写新语义（validatedAt/standardizedBy），不产生新的批准写入。
// SPEC-030 派②（PD-2，2026-10-28）：正式区落位唯一驱动＝审批 publish→snapshot——
// 本函数仅供发布链调用；standardize（工作流侧/审批管线）改用 computeStandardVersion（纯元数据冻结，不落盘）。
// 位置维：wiki/articles/<域>/<articleId目录>/<内容哈希>.md（域=category-path 首段，resolveDomainSegment fail-closed）。
function createStandardVersion(vaultPath, candidate, raw, document, now, options) {
  const domainSegment = articleLifecycle.resolveDomainSegment(
    documentCategoryPath(document),
    options && options.allowedDomains
  );
  const formalRoot = articleLifecycle.formalArticlesDir(vaultPath);
  const existing = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const doc = loadDocument(fs.readFileSync(file, "utf8"), file);
        if (doc.frontmatter && doc.frontmatter[DK.ARTICLE.articleId] === document.articleId) existing.push(file);
      }
    }
  };
  visit(formalRoot);
  if (existing.length > 1) {
    const error = new Error("同一文章身份有多个正式文件，请先修复重复文件"); error.code = "ARTICLE_FORMAL_IDENTITY_AMBIGUOUS"; error.status = 409; throw error;
  }
  let snapshotPath = existing[0];
  if (snapshotPath && /[0-9a-f]{64}\.md$/.test(snapshotPath)) {
    const error = new Error("正式文件仍为旧哈希路径，请先运行可读路径迁移预览与切换"); error.code = "ARTICLE_REVISION_CONFLICT"; error.status = 409; throw error;
  }
  if (!snapshotPath) {
    const directory = articleLifecycle.formalDomainDir(vaultPath, domainSegment);
    fs.mkdirSync(directory, { recursive: true });
    const fileName = buildFileName({ title: document.title, version: document.version });
    const base = fileName.replace(/\.md$/, "");
    let suffix = 0;
    do { snapshotPath = path.join(directory, `${base}${suffix ? `-${suffix}` : ""}.md`); suffix += 1; }
    while (fs.existsSync(snapshotPath));
    writeVaultExclusive(snapshotPath, raw, { domain: "workflow", summary: "创建可编辑正式文章" }, { encoding: "utf8", flag: "wx", mode: 0o644 });
  } else {
    const previous = fs.readFileSync(snapshotPath, "utf8");
    if (previous !== raw) writeVault(snapshotPath, raw, { expectedContentHash: contentRevision(previous), domain: "workflow", summary: "更新可编辑正式文章" });
  }
  const decisionId = crypto.randomUUID();
  return {
    version: {
      articleId: document.articleId,
      contentHash: candidate.contentHash,
      snapshotPath: path.relative(vaultPath, snapshotPath).split(path.sep).join("/"),
      domainSegment,
      candidateSourcePath: candidate.sourcePath,
      title: document.title,
      product: document.product,
      version: document.version,
      validatedAt: now,
      standardizedBy: "local-architect",
      decisionId,
    },
    decision: { decisionId, decision: "standardized", contentHash: candidate.contentHash, decidedAt: now, decidedBy: "local-architect" },
  };
}

// 纯元数据冻结（standardize 用——SPEC-030 派②：标准化不再写正式区，快照物理写延至 publish；
// 域段仍在此解析校验：标准化时即拦非法 category-path，不让坏域值活到发布才爆）。
function computeStandardVersion(vaultPath, candidate, document, now, options) {
  const domainSegment = articleLifecycle.resolveDomainSegment(
    documentCategoryPath(document),
    options && options.allowedDomains
  );
  const decisionId = crypto.randomUUID();
  return {
    version: {
      articleId: document.articleId,
      contentHash: candidate.contentHash,
      domainSegment,
      snapshotPath: articleLifecycle.formalSourcePath(domainSegment, safeArticleDirectory(document.articleId), `${candidate.contentHash}.md`),
      candidateSourcePath: candidate.sourcePath,
      title: document.title,
      product: document.product,
      version: document.version,
      validatedAt: now,
      standardizedBy: "local-architect",
      decisionId,
    },
    decision: { decisionId, decision: "standardized", contentHash: candidate.contentHash, decidedAt: now, decidedBy: "local-architect" },
  };
}

module.exports = {
  STORE_VERSION,
  candidateId,
  normalizeDecision,
  computeStandardVersion,
  createStandardVersion,
  readWorkflowState,
  safeArticleDirectory,
  stableId,
  writeWorkflowState,
  readWorkflowStateWithRevision,
};
