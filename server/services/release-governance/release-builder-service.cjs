// Component: Release-Builder-Service
// @responsible: Complete, content-addressed and byte-stable immutable Releases.

const crypto = require("node:crypto");
const { writeExclusiveSealed, moveAtomic } = require("../../shared/repo-file-io.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { observeOperation } = require("../../shared/operation-observer.cjs");

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
// WP-023：发布物迁 vault 外后不再经 vault-io（原 PR-057 通道只适用于 vault 内落点） 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）
const builderError = bindErrorFactory({ status: 400 });

const COMPLETE_RELEASE_BUILDER_VERSION = "complete-release-v1";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function jsonBytes(value) { return `${JSON.stringify(canonical(value))}\n`; }
function sha256(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }

function assertReleaseId(releaseId) {
  if (!/^release-[0-9a-f]{64}$/.test(releaseId || "")) {
    throw builderError("INVALID_RELEASE_ID", "Invalid Release id");
  }
}

function safeArtifactName(name) {
  if (typeof name !== "string" || name === "" || name.includes("\\") || path.posix.isAbsolute(name)) {
    throw builderError("INVALID_ARTIFACT_PATH", `Unsafe artifact path: ${name}`);
  }
  const normalized = path.posix.normalize(name);
  if (normalized !== name || normalized === ".." || normalized.startsWith("../")) {
    throw builderError("INVALID_ARTIFACT_PATH", `Unsafe artifact path: ${name}`);
  }
  return normalized;
}

function listFiles(root, current = "") {
  const dir = path.join(root, current);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(root, relative) : [relative];
  }).sort();
}

function createReleaseBuilderService(options) {
  const releasesDir = path.resolve(options.releasesDir);
  const builderVersion = options.builderVersion || COMPLETE_RELEASE_BUILDER_VERSION;
  const logger = options.logger;

  function normalizeInput(input) {
    if (!/^[0-9a-f]{40}$/.test(input?.sourceCommit || "")) {
      throw builderError("INVALID_SOURCE_COMMIT", "sourceCommit must be a 40-character Git object id");
    }
    const buildConfiguration = canonical(input.buildConfiguration || {});
    const names = Object.keys(input.artifacts || {}).map(safeArtifactName).sort();
    if (new Set(names).size !== names.length) throw builderError("DUPLICATE_ARTIFACT", "Duplicate normalized artifact path");
    const contents = new Map();
    const artifacts = names.map((name) => {
      const value = input.artifacts[name];
      if (!(typeof value === "string" || Buffer.isBuffer(value))) {
        throw builderError("INVALID_ARTIFACT_CONTENT", `Artifact ${name} must be string or Buffer`);
      }
      const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
      contents.set(name, content);
      return { name, hash: sha256(content), sizeBytes: content.length };
    });
    const identity = { sourceCommit: input.sourceCommit, builderVersion, buildConfiguration, artifacts };
    const releaseId = `release-${crypto.createHash("sha256").update(jsonBytes(identity)).digest("hex")}`;
    const core = {
      releaseId,
      kind: "release",
      ...identity,
      validationResults: { artifactCount: artifacts.length, complete: true },
    };
    return { contents, manifest: { ...core, manifestHash: sha256(jsonBytes(core)) } };
  }

  function releaseDir(releaseId) { assertReleaseId(releaseId); return path.join(releasesDir, releaseId); }

  function verifyExpected(dir, expected) {
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== jsonBytes(expected.manifest)) return false;
    if (JSON.stringify(listFiles(path.join(dir, "artifacts"))) !== JSON.stringify([...expected.contents.keys()].sort())) return false;
    for (const [name, content] of expected.contents) {
      const target = path.join(dir, "artifacts", name);
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) return false;
    }
    return true;
  }

  function buildInternal(input) {
    const expected = normalizeInput(input);
    const targetDir = releaseDir(expected.manifest.releaseId);
    if (fs.existsSync(targetDir)) {
      if (!verifyExpected(targetDir, expected)) {
        throw builderError("RELEASE_INPUT_MISMATCH", "Existing Release bytes do not match requested inputs", 409);
      }
      return { ...expected.manifest, existing: true };
    }
    fs.mkdirSync(releasesDir, { recursive: true });
    const tempDir = path.join(releasesDir, `.build-${crypto.randomUUID()}`);
    try {
      fs.mkdirSync(path.join(tempDir, "artifacts"), { recursive: true });
      for (const [name, content] of expected.contents) {
        const target = path.join(tempDir, "artifacts", name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // WP-023/PR-127：发布物住 vault 同级 .releases/（vault 外）——vault-io 通道只写 vault 内（执法拒根外），
        // 改直写文件系统（publisher pointerWriter 先例同形）；wx＋0o444 只读语义与原子 rename 不变（本就 noLedger，无账本损失）
        // 波5 批②：原语收口 repo-file-io（wx＋0o444 独占封存语义在通道内保持）
        writeExclusiveSealed(target, content);
      }
      writeExclusiveSealed(path.join(tempDir, "manifest.json"), jsonBytes(expected.manifest));
      try { moveAtomic(tempDir, targetDir); }
      catch (error) {
        if (!fs.existsSync(targetDir) || !verifyExpected(targetDir, expected)) throw error;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      for (const dir of listFiles(path.join(targetDir, "artifacts")).map((name) => path.dirname(path.join(targetDir, "artifacts", name)))) {
        try { fs.chmodSync(dir, 0o555); } catch { /* best-effort: 清理/降级失败静默可接受 */ }
      }
      fs.chmodSync(path.join(targetDir, "artifacts"), 0o555);
      fs.chmodSync(targetDir, 0o555);
      return { ...expected.manifest, existing: false };
    } catch (error) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort: 清理/降级失败静默可接受 */ }
      if (error.code) throw error;
      throw builderError("BUILD_FAILED", error.message, 500);
    }
  }

  function build(input) {
    return observeOperation({
      logger,
      name: "release.build",
      fields: { source_commit: input?.sourceCommit || null, builder_version: builderVersion },
      resultFields: (release) => ({ release_id: release.releaseId, existing: release.existing }),
    }, () => buildInternal(input));
  }

  function readRelease(releaseId) {
    const target = path.join(releaseDir(releaseId), "manifest.json");
    if (!fs.existsSync(target)) throw builderError("RELEASE_NOT_FOUND", `Release ${releaseId} not found`, 404);
    return JSON.parse(fs.readFileSync(target, "utf8"));
  }

  function readArtifact(releaseId, artifactName) {
    const manifest = readRelease(releaseId);
    const safeName = safeArtifactName(artifactName);
    if (!manifest.artifacts.some((item) => item.name === safeName)) {
      throw builderError("ARTIFACT_NOT_FOUND", `Artifact ${safeName} is not declared`, 404);
    }
    return fs.readFileSync(path.join(releaseDir(releaseId), "artifacts", safeName));
  }

  function verifyRelease(releaseId) {
    let manifest;
    try { manifest = readRelease(releaseId); }
    catch (error) { return { valid: false, reason: error.code || error.message }; }
    const core = { ...manifest }; delete core.manifestHash;
    if (manifest.manifestHash !== sha256(jsonBytes(core))) return { valid: false, reason: "Manifest hash mismatch" };
    const declared = manifest.artifacts.map((item) => item.name).sort();
    const actual = listFiles(path.join(releaseDir(releaseId), "artifacts"));
    if (JSON.stringify(declared) !== JSON.stringify(actual)) return { valid: false, reason: "Artifact set mismatch" };
    for (const artifact of manifest.artifacts) {
      const content = fs.readFileSync(path.join(releaseDir(releaseId), "artifacts", safeArtifactName(artifact.name)));
      if (artifact.hash !== sha256(content) || artifact.sizeBytes !== content.length) {
        return { valid: false, reason: `Artifact mismatch: ${artifact.name}` };
      }
    }
    return { valid: true, releaseId };
  }

  function listReleases() {
    if (!fs.existsSync(releasesDir)) return [];
    return fs.readdirSync(releasesDir).filter((name) => /^release-[0-9a-f]{64}$/.test(name))
      .map((releaseId) => readRelease(releaseId));
  }

  return { build, readRelease, readArtifact, verifyRelease, listReleases, builderVersion };
}

module.exports = { COMPLETE_RELEASE_BUILDER_VERSION, createReleaseBuilderService };
