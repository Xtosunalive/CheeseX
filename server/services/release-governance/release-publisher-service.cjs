// Component: Release-Publisher-Service
// @responsible: Serialized, validated and atomic current pointer movement.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const staleLock = require("./stale-lock.cjs");

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
// WP-069 S3（一表一主收编）：publisher 是 .releases/ 唯一写者——vault-io 目的地执法只辖 vault 树内，
// 本域全部写走 repo-file-io 直写通道（vault-io 通道对 .releases/ 的三次写入自 WP-023 迁仓起即被
// 目的地执法拒绝＝发布问题清单/审计账本静默死亡，2026-11-02 勘察实锤，本批收编修复）。
const { writeRepoFileAtomic } = require("../../shared/repo-file-io.cjs");
const publisherError = bindErrorFactory({ status: 400 });

function createReleasePublisherService(options) {
  const builderService = options.builderService;
  const logger = options.logger;
  const releasesDir = path.resolve(options.releasesDir);
  // WP-023/PR-127 缺口修补（2026-11-01 实测）：发布物迁 vault 外后 vault-io 目的地执法不再覆盖
  // .releases/——默认 pointerWriter 仍走 replaceVault 致 current 恢复接口自迁仓起即死
  //（VAULT_WRITE_DESTINATION_REJECTED 假红；发布链同文件经 snapshotStore.writeCurrent 直写无恙）。
  // 默认改直写与铸版链对齐；注入口保留（测试桩不变）。
  const pointerWriter = options.pointerWriter || ((temp, target, bytes) => {
    writeRepoFileAtomic(target, bytes); // temp 参数为旧签名兼容保留——原子性由通道内 temp+rename 保证
  });
  const LOCK_NAME = "publish"; // SPEC-012 WP-A：锁迁 runtime-state.db locks 表（旧 .publish.lock 文件形态退役）
  const issuesPath = path.join(releasesDir, "issues", "publication-issues.json");
  const auditPath = path.join(releasesDir, "issues", "publish-failures.jsonl");

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  }

  function pointerPath() { return path.join(releasesDir, "current.json"); }

  // WP-069 S3：current 指针唯一写入口（铸版链 mintRelease 与恢复链 restoreCurrent 同经此——
  // 自 snapshot-store writeCurrent 收编；一表一主＝读写都归 owner 模块，第二条写 lane 无处发生）
  // 红队 2026-11-02 必修②：指针移动自身入锁——铸版链（mintRelease）与恢复链同受 publish 锁，
  // 并发铸版/恢复 → 第二方 409 PUBLISH_BUSY 而非 last-rename-wins（previousReleaseId 链不再可错）。
  // 调用方已持锁（restoreCurrent）经 lockDepth 重入放行。
  function writeCurrentPointer(current) {
    return withLock(() => {
      fs.mkdirSync(releasesDir, { recursive: true });
      return writeRepoFileAtomic(pointerPath(), `${JSON.stringify(current, null, 2)}\n`);
    });
  }
  function getCurrent() {
    if (!fs.existsSync(pointerPath())) return null;
    return JSON.parse(fs.readFileSync(pointerPath(), "utf8"));
  }
  function getCurrentReleaseId() {
    // T3/#875：current.json 损坏（非法 JSON/缺字段）时返回 null 而非抛错——
    // 恢复 API 需要能读取"损坏前"状态并自救（否则非法 JSON 直接阻断 restore）。
    try { return getCurrent()?.releaseId || null; }
    catch { return null; }
  }

  function readIssues() {
    if (fs.existsSync(issuesPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(issuesPath, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    }
    return [];
  }

  function writeIssues(issues) {
    fs.mkdirSync(path.dirname(issuesPath), { recursive: true });
    writeRepoFileAtomic(issuesPath, `${JSON.stringify(issues, null, 2)}\n`); // PR-083：清单由发布器全权再生成（直写通道）
  }

  // 审计 JSONL 追加（只追加、0o600）——vault 外直写；写失败不掩盖指针移动（T3/#875 auditWarning 语义不变）
  function appendAuditJsonl(file, line) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, { mode: 0o600 });
  }

  function recordFailure(stage, input = {}, error = {}, previousReleaseId = getCurrentReleaseId()) {
    const replayIdentity = canonical({
      proposalId: input.proposalId || null,
      sourceCommit: input.sourceCommit || null,
      builderVersion: input.builderVersion || builderService.builderVersion,
      buildConfiguration: input.buildConfiguration || {},
    });
    // B3（#1794）：指纹=逻辑问题本身，不含 previousReleaseId——掺入前任指针会让同一逻辑失败
    // 在每次成功发布后裂成新 issueId（双记/幽灵，ADR063「被成功发布取代」判定永不聚合）。
    // previousReleaseId 仍作为现场字段记录在 issue 上供审计。
    const fingerprint = JSON.stringify(replayIdentity);
    const issueId = `publication-${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
    const issues = readIssues();
    const existing = issues.find((item) => item.issueId === issueId);
    const now = new Date().toISOString();
    const issue = {
      ...(existing || {}),
      issueId,
      status: "open",
      kind: "release-publication-failure",
      issueKind: "release_publication_failure",
      severity: "error",
      title: "Release publication failed",
      ...replayIdentity,
      stage,
      errorCode: error.code || "UNKNOWN",
      message: error.message || "Release publication failed",
      previousReleaseId,
      occurrenceCount: (existing?.occurrenceCount || 0) + 1,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const next = issues.filter((item) => item.issueId !== issueId).concat(issue)
      .sort((left, right) => left.issueId.localeCompare(right.issueId));
    writeIssues(next);
    appendAuditJsonl(auditPath, `${JSON.stringify(issue)}\n`);
    if (error && typeof error === "object") error.publicationIssueRecorded = true;
    return { ...issue };
  }

  function listIssues() { return readIssues().map((issue) => ({ ...issue })); }

  function listActiveIssues() {
    // ADR063 #1746 读时对账（#1794 措辞勘误后语义）：失败记录被其后成功发布取代（status 已退休）
    // 或同 commit 已在 current 指针（兜底）时，不作活检出——publication-issues.json 与
    // publish-failures.jsonl 保留全史供审计。
    const current = getCurrent();
    const currentSourceCommit = current?.sourceCommit || null;
    return readIssues()
      .filter((issue) => {
        if (issue.status && issue.status !== "open") return false;
        if (currentSourceCommit && issue.sourceCommit === currentSourceCommit) return false;
        return true;
      })
      .map((issue) => ({ ...issue }));
  }

  // B3（#1794）：成功发布取代——其后一次成功发布即退休全部在册失败（系统已走出失败态，
  // 产出新的合法产物；若逻辑问题仍在，重试失败时按同指纹重新打开、occurrence 递增，
  // fail-closed 可见性不丢）。此前 retire 只对账 current 同 commit，任何后续成功发布
  // 把指针移走后历史失败重新复活（幽灵条目实录）。
  function resolveSupersededIssues(release) {
    const releaseId = release?.releaseId || null;
    if (!releaseId) return false;
    const now = new Date().toISOString();
    const issues = readIssues();
    let changed = false;
    const next = issues.map((issue) => {
      if (issue.status && issue.status !== "open") return issue;
      changed = true;
      return { ...issue, status: "resolved", resolvedByReleaseId: releaseId, resolvedBySourceCommit: release?.sourceCommit || null, resolvedAt: now, updatedAt: now };
    });
    if (changed) writeIssues(next);
    return changed;
  }

  let lockDepth = 0; // 同调用栈重入计数（restoreCurrent 持锁内调 writeCurrentPointer 不二次取锁）
  function withLock(callback) {
    // T1/#822：owner 元数据 + pid 探活——崩溃遗留锁自动接管，活锁仍 BUSY。
    if (lockDepth > 0) { lockDepth += 1; try { return callback(); } finally { lockDepth -= 1; } }
    if (!staleLock.acquireWithStaleRecovery(LOCK_NAME)) {
      throw publisherError("PUBLISH_BUSY", "Another publish is in progress", 409);
    }
    lockDepth = 1;
    try { return callback(); }
    finally { lockDepth = 0; staleLock.release(LOCK_NAME); }
  }

  function restoreCurrent(input) {
    // T3/#822：current 指针损坏后的显式恢复——从历史 Release 恢复指针。
    // 复用 withLock（并发保护）+ verifyRelease（合法性校验）+ pointerWriter（原子写）。
    const releaseId = typeof input?.releaseId === "string" ? input.releaseId : null;
    if (!releaseId) throw publisherError("VALIDATION_ERROR", "releaseId is required", 400);
    return withLock(() => {
      const validation = builderService.verifyRelease(releaseId);
      if (!validation.valid) throw publisherError("RELEASE_RESTORE_INVALID", validation.reason || "目标 Release 校验失败", 400);
      const manifest = builderService.readRelease(releaseId);
      if (!manifest) throw publisherError("RELEASE_RESTORE_NOT_FOUND", `Release ${releaseId} not found`, 404);
      const previousReleaseId = getCurrentReleaseId();
      const pointer = {
        releaseId,
        sourceCommit: manifest.sourceCommit,
        manifestHash: manifest.manifestHash,
        previousReleaseId,
        restoredAt: new Date().toISOString(),
        restored: true,
      };
      const temp = `${pointerPath()}.${crypto.randomUUID()}.tmp`;
      try { pointerWriter(temp, pointerPath(), `${JSON.stringify(pointer, null, 2)}\n`); }
      finally { fs.rmSync(temp, { force: true }); }
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      // T3/#875：审计写失败不掩盖"指针已移动"的成功——附加 auditWarning 供可观测，指针本身已生效。
      let auditWarning = null;
      try {
        appendAuditJsonl(auditPath, `${JSON.stringify({ ...pointer, event: "release.current-restored" })}\n`);
      } catch (auditError) {
        auditWarning = auditError && typeof auditError === "object" ? auditError.message : String(auditError);
        if (logger) logger.warn({ event: "release.current-restored-audit-failed", release_id: releaseId, error: auditWarning });
      }
      logger?.info({ event: "release.current-restored", release_id: releaseId, previous_release_id: previousReleaseId });
      return auditWarning ? { ...pointer, auditWarning } : pointer;
    });
  }

  return { restoreCurrent, writeCurrentPointer, getCurrent, getCurrentReleaseId, listIssues, listActiveIssues, recordFailure, resolveSupersededIssues };
}

module.exports = { createReleasePublisherService };
