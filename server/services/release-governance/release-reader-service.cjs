// Component: Release-Reader-Service
// @responsible: Validated request-scoped access to one immutable Release.

const fs = require("node:fs");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const readerError = bindErrorFactory({ status: 400 });

function validReleaseId(releaseId) { return /^release-[0-9a-f]{64}$/.test(releaseId || ""); }

function createReleaseReaderService(options) {
  const builderService = options.builderService;
  const releasesDir = path.resolve(options.releasesDir);
  const storage = new AsyncLocalStorage();

  function resolveCurrentReleaseId() {
    const pointerPath = path.join(releasesDir, "current.json");
    if (!fs.existsSync(pointerPath)) throw readerError("NO_CURRENT_RELEASE", "No current Release", 404);
    let pointer;
    try { pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")); }
    catch (error) {
      // D9-2（G2）：existsSync(:24) 与 readFileSync 之间的 TOCTOU 窗口内指针被删 → ENOENT
      // 语义是「无当前 Release」（404 NO_CURRENT_RELEASE，与 ：24 同码），不是指针损坏（500）
      if (error && error.code === "ENOENT") throw readerError("NO_CURRENT_RELEASE", "No current Release", 404);
      throw readerError("CURRENT_POINTER_INVALID", "Current pointer is invalid", 500);
    }
    if (!validReleaseId(pointer.releaseId)) throw readerError("CURRENT_POINTER_INVALID", "Current pointer has an unsafe releaseId", 500);
    const validation = builderService.verifyRelease(pointer.releaseId);
    if (!validation.valid) throw readerError("CURRENT_RELEASE_INVALID", validation.reason, 500);
    const manifest = builderService.readRelease(pointer.releaseId);
    if (pointer.sourceCommit !== manifest.sourceCommit || pointer.manifestHash !== manifest.manifestHash) {
      throw readerError("CURRENT_POINTER_MISMATCH", "Current pointer metadata does not match its Release", 500);
    }
    return pointer.releaseId;
  }

  function withPinnedRelease(callback) {
    const releaseId = resolveCurrentReleaseId();
    return storage.run(releaseId, () => callback(releaseId));
  }

  function getPinnedReleaseId(requestedId) {
    const pinned = storage.getStore();
    if (!pinned) throw readerError("NOT_IN_PINNED_CONTEXT", "Release read requires a pinned request context");
    if (requestedId && requestedId !== pinned) {
      throw readerError("RELEASE_ID_LOCKED", `Request is pinned to ${pinned}`, 409, { pinned, requestedId });
    }
    return pinned;
  }

  function readRelease(releaseId) {
    const effective = releaseId || getPinnedReleaseId();
    if (releaseId) getPinnedReleaseId(releaseId);
    return builderService.readRelease(effective);
  }

  function readArtifact(artifactName) {
    return builderService.readArtifact(getPinnedReleaseId(), artifactName).toString("utf8");
  }

  function validateRelease(releaseId) {
    if (!validReleaseId(releaseId)) return { valid: false, reason: "Invalid Release id" };
    return builderService.verifyRelease(releaseId);
  }

  return { withPinnedRelease, getPinnedReleaseId, readRelease, readArtifact, validateRelease, resolveCurrentReleaseId };
}

module.exports = { createReleaseReaderService };
