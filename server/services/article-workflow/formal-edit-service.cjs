"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const { loadDocument } = require("../../shared/document-load-port.cjs");
const { writeVault, writeVaultExclusive, contentRevision } = require("../../shared/vault-io.cjs");
const { safeArticleDirectory } = require("./article-workflow-store.cjs");
const DK = require("../../shared/document-keys.cjs");

function summarizeChange(previousRaw, currentRaw) {
  if (typeof previousRaw !== "string") return null;
  const before = loadDocument(previousRaw).frontmatter || {};
  const after = loadDocument(currentRaw).frontmatter || {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => key !== "content_hash" && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
    .map((field) => ({ field, before: before[field] == null ? "" : String(before[field]), after: after[field] == null ? "" : String(after[field]) }));
  const beforeBody = loadDocument(previousRaw).body.trim();
  const afterBody = loadDocument(currentRaw).body.trim();
  return { fields, bodyChanged: beforeBody !== afterBody, beforeExcerpt: beforeBody.slice(0, 600), afterExcerpt: afterBody.slice(0, 600) };
}

function createFormalEditService({ vaultPath, articleWorkflowService, approvalStateMachine, logger }) {
  const log = logger || { warn() {}, info() {} };
  const formalRoot = articleLifecycle.formalArticlesDir(vaultPath);
  const workingRoot = articleLifecycle.workingDir(vaultPath);

  function handleFile(absPath) {
    const relative = path.relative(vaultPath, absPath).split(path.sep).join("/");
    if (!articleLifecycle.isUnderFormal(relative) || !absPath.endsWith(".md") || !fs.existsSync(absPath)) return { changed: false };
    const raw = fs.readFileSync(absPath, "utf8");
    const doc = loadDocument(raw, absPath);
    const observedId = typeof doc.frontmatter?.[DK.ARTICLE.articleId] === "string" ? doc.frontmatter[DK.ARTICLE.articleId].trim() : "";
    const publishedId = typeof articleWorkflowService.publishedArticleIdForPath === "function" ? articleWorkflowService.publishedArticleIdForPath(relative) : null;
    const articleId = publishedId || observedId;
    if (!articleId) return { changed: false, reason: "article-id-missing" };
    const approval = approvalStateMachine.readRecord(articleId);
    if (!approval || !["snapshot", "approved", "pending"].includes(approval.status)) return { changed: false, reason: "no-active-review" };
    const fileHash = crypto.createHash("sha256").update(raw).digest("hex");
    if (approval.status !== "pending" && approval.approval?.contentHash === fileHash) return { changed: false };
    if (approval.status === "pending" && approval.externalSourceHash === fileHash) return { changed: false };
    const publishedRaw = typeof articleWorkflowService.readPublishedContent === "function" ? articleWorkflowService.readPublishedContent(articleId) : null;
    const changeSummary = summarizeChange(publishedRaw, raw);
    if (approval.status !== "pending" && changeSummary && changeSummary.fields.length === 0 && !changeSummary.bodyChanged) return { changed: false, reason: "metadata-only" };
    if (publishedId && observedId !== publishedId) {
      const pendingHash = crypto.createHash("sha256").update(raw).digest("hex");
      const review = approvalStateMachine.recordExternalEdit(articleId, pendingHash, fileHash, changeSummary);
      return { ...review, articleId, reason: "article-id-changed" };
    }

    fs.mkdirSync(workingRoot, { recursive: true });
    const matching = [];
    for (const name of fs.readdirSync(workingRoot)) {
      if (!name.endsWith(".md")) continue;
      const candidatePath = path.join(workingRoot, name);
      if (!fs.statSync(candidatePath).isFile()) continue;
      const candidateDoc = loadDocument(fs.readFileSync(candidatePath, "utf8"), candidatePath);
      if (candidateDoc.frontmatter?.[DK.ARTICLE.articleId] === articleId) matching.push(candidatePath);
    }
    if (matching.length > 1) throw new Error("同一文章身份有多个工作文件，请先处理重复文件");
    const workingFile = matching[0] || path.join(workingRoot, `${safeArticleDirectory(articleId)}-formal-edit.md`);
    if (fs.existsSync(workingFile)) {
      const previous = fs.readFileSync(workingFile, "utf8");
      const previousId = loadDocument(previous, workingFile).frontmatter?.[DK.ARTICLE.articleId];
      if (previousId !== articleId) throw new Error("正式编辑工作文件已被其他文章占用");
      if (previous !== raw && previous !== publishedRaw) {
        const draft = path.join(articleLifecycle.draftsDir(vaultPath), `${safeArticleDirectory(articleId)}-修改备份-${crypto.randomUUID()}.md`);
        fs.mkdirSync(path.dirname(draft), { recursive: true });
        writeVaultExclusive(draft, previous, { domain: "workflow", summary: "保留正式编辑前的工作副本" }, { encoding: "utf8", flag: "wx", mode: 0o644 });
        log.info({ event: "formal-edit-working-copy-backed-up", articleId, path: path.relative(vaultPath, draft) });
      }
      if (previous !== raw) writeVault(workingFile, raw, { expectedContentHash: contentRevision(previous), domain: "workflow", summary: "同步正式文章外部编辑" });
    } else {
      writeVaultExclusive(workingFile, raw, { domain: "workflow", summary: "接收正式文章外部编辑" }, { encoding: "utf8", flag: "wx", mode: 0o644 });
    }

    let checkError = null;
    try { articleWorkflowService.standardize(articleId, true); }
    catch (error) { checkError = error; }
    const candidate = articleWorkflowService.getPrecleaned(articleId);
    const nextHash = candidate.formalContentHash || crypto.createHash("sha256").update(fs.readFileSync(workingFile)).digest("hex");
    const review = approvalStateMachine.recordExternalEdit(articleId, nextHash, fileHash, changeSummary);
    if (checkError) log.warn({ event: "formal-edit-recheck-blocked", articleId, error: checkError.message });
    else log.info({ event: "formal-edit-recheck-pending", articleId });
    return { ...review, articleId, sourcePath: candidate.sourcePath, checkError: checkError?.code || null };
  }

  function handle(paths) {
    const results = [];
    for (const file of paths || []) {
      try { results.push(handleFile(file)); }
      catch (error) { log.warn({ event: "formal-edit-processing-failed", path: file, error: error.message }); }
    }
    if ((paths || []).some((file) => articleLifecycle.isUnderFormal(path.relative(vaultPath, file).split(path.sep).join("/")))
      && typeof articleWorkflowService.listPublishedVersions === "function") {
      try {
        for (const version of articleWorkflowService.listPublishedVersions()) {
          if (fs.existsSync(path.join(vaultPath, version.snapshotPath))) continue;
          const current = approvalStateMachine.readRecord(version.articleId);
          if (!current) continue;
          const { status } = current;
          if (!["snapshot", "approved"].includes(status)) continue;
          const missingHash = crypto.createHash("sha256").update(`missing:${version.snapshotPath}`).digest("hex");
          approvalStateMachine.recordExternalEdit(version.articleId, missingHash, missingHash, null);
          results.push({ changed: true, articleId: version.articleId, reason: "published-path-missing" });
        }
      } catch (error) { log.warn({ event: "formal-edit-missing-source-check-failed", error: error.message }); }
    }
    return results;
  }

  function reconcile() {
    const files = [];
    const visit = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file);
      }
    };
    visit(formalRoot);
    return handle([...files, path.join(formalRoot, "__missing__.md")]);
  }

  return { handle, reconcile };
}

module.exports = { createFormalEditService };
