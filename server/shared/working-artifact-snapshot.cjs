// Request-scoped working-copy reads. Revisions are hashes of the exact bytes
// parsed for the response; this module deliberately has no cache or persistence.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
// SPEC-012 wave-2 图族：master_graph/extract_manifest 真身迁 derived-index.db——
// 原文行字节精确，revision=库原文 Buffer sha256（与旧文件字节同口径，指纹不漂移）
const { getDerivedIndexStore } = require("./persistence/derived-index-store.cjs");
const { readGraphArtifactText, readExtractManifestText } = require("./persistence/graph-artifact-ingest.cjs");
const { readFrozenArtifactSnapshot } = require("./frozen-artifact-reader.cjs"); // PR-084：SA 族经读侧唯一咽喉
const { resolveTheSchemaDir } = require("./theschema-root.cjs");

function sha256Revision(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactError(code, message, filePath, cause) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = { path: filePath };
  if (cause) error.cause = cause;
  return error;
}

function readArtifact(filePath, parse, options = {}) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return { data: null, bytes: null, revision: null, path: absolutePath, exists: false };
  }
  let bytes;
  try {
    bytes = fs.readFileSync(absolutePath);
  } catch (error) {
    throw artifactError("WORKING_ARTIFACT_READ_FAILED", `Unable to read working artifact: ${absolutePath}`, absolutePath, error);
  }
  try {
    return {
      data: parse ? parse(bytes.toString("utf8")) : bytes,
      bytes,
      revision: sha256Revision(bytes),
      path: absolutePath,
      exists: true,
    };
  } catch (error) {
    throw artifactError(options.invalidCode || "WORKING_ARTIFACT_INVALID", `Invalid working artifact: ${absolutePath}`, absolutePath, error);
  }
}

function readJsonArtifact(filePath) {
  return readArtifact(filePath, (text) => JSON.parse(text), { invalidCode: "WORKING_JSON_INVALID" });
}

function readYamlArtifact(filePath) {
  return readArtifact(filePath, (text) => YAML.parse(text) || {}, { invalidCode: "WORKING_YAML_INVALID" });
}

function readBytesArtifact(filePath) {
  return readArtifact(filePath, null);
}

// SPEC-012 wave-2：图族工件快照读库（scopeKey=vault root——生产装配后恒全局实例，测试懒建按 vault 隔离）。
// 无行=missingArtifact（与旧「文件不存在」同构）；原文 JSON 非法=同款 WORKING_JSON_INVALID（fail-closed）。
function readStoreArtifactSnapshot(scopeKey, readText, fallbackPath) {
  let text;
  try {
    text = readText(getDerivedIndexStore(scopeKey));
  } catch (_error) {
    return missingArtifact(fallbackPath);
  }
  if (text === null) return missingArtifact(fallbackPath);
  try {
    const bytes = Buffer.from(text, "utf8");
    return { data: JSON.parse(text), bytes, revision: sha256Revision(bytes), path: fallbackPath, exists: true };
  } catch (error) {
    throw artifactError("WORKING_JSON_INVALID", `Invalid working artifact: ${fallbackPath}`, fallbackPath, error);
  }
}

function readMasterGraphArtifact(vaultPath) {
  const root = path.resolve(vaultPath);
  return readStoreArtifactSnapshot(root, readGraphArtifactText, require("../vault-paths.cjs").getMasterFilePath(root)) // PR-243 批B：单源;
}

function readExtractManifestArtifact(vaultPath) {
  const root = path.resolve(vaultPath);
  return readStoreArtifactSnapshot(root, readExtractManifestText, path.join(require("../vault-paths.cjs").getLedgerDir(root), "extract_manifest.json")) // PR-243 批B：单源;
}

function resolveVaultFile(vaultPath, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || path.isAbsolute(relativePath)) return null;
  const normalized = path.posix.normalize(relativePath.trim().replaceAll("\\", "/"));
  if (!normalized || normalized === ".." || normalized.startsWith("../")) return null;
  const root = path.resolve(vaultPath);
  const absolutePath = path.resolve(root, ...normalized.split("/"));
  if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) return null;
  return { relativePath: normalized, absolutePath };
}

function projectionPart(value) {
  return typeof value === "string" && value.trim() && !value.includes("/") && !value.includes("\\") && value.trim() !== ".."
    ? value.trim()
    : null;
}

function missingArtifact(filePath = null) {
  return { data: null, bytes: null, revision: null, path: filePath, exists: false };
}

function readPropertyInspectionArtifacts(vaultPath) {
  const root = path.resolve(vaultPath);
  // WP-049 余量批：词表经装载端口（工件形状等价重建：bytes/revision＝同字节同哈希）
  const { loadVocabBundle } = require("./vocab-load-port.cjs");
  const efile = loadVocabBundle(root, { files: ["enums"] }).files.enums;
  const enumsPath = path.join(resolveTheSchemaDir(root), "enums.yaml");
  const enums = efile && efile.state === "present"
    ? {
        data: YAML.parse(efile.text) || {},
        bytes: Buffer.from(efile.text, "utf8"),
        revision: "sha256:" + efile.fingerprint,
        path: enumsPath,
        exists: true,
      }
    : missingArtifact(enumsPath);
  const projection = enums.data?.architecture_projection || {};
  const product = projectionPart(process.env.ARCH_PRODUCT || process.env.PRODUCT_NAME)
    || projectionPart(projection.product || projection.product_name);
  const version = projectionPart(process.env.ARCH_VERSION || process.env.ARCH_BRANCH)
    || projectionPart(projection.version || projection.branch);
  // PR-082：SA 读派生库通用槽（无产品门控——通用版零产品概念）
  // PR-084：经读侧唯一咽喉的字节级快照（注册表 sa 槽；展示路径取自注册表，不在此硬编码）
  const semanticArchitecture = readFrozenArtifactSnapshot(root, "sa");
  const masterGraph = readMasterGraphArtifact(root);
  const extractManifest = readExtractManifestArtifact(root);
  return {
    enums,
    semanticArchitecture,
    masterGraph,
    extractManifest,
    workingRevisions: {
      enums: enums.revision,
      semanticArchitecture: semanticArchitecture.revision,
      masterGraph: masterGraph.revision,
      extractManifest: extractManifest.revision,
    },
  };
}

function readVaultSourceIdentity(vaultPath, sourcePath) {
  if (typeof sourcePath !== "string" || !sourcePath.trim()) return null;
  const resolved = path.isAbsolute(sourcePath)
    ? { absolutePath: path.resolve(sourcePath.trim()) }
    : resolveVaultFile(vaultPath, sourcePath);
  if (!resolved || !fs.existsSync(resolved.absolutePath)) return null;
  let rootRealPath;
  let sourceRealPath;
  try {
    rootRealPath = fs.realpathSync(path.resolve(vaultPath));
    sourceRealPath = fs.realpathSync(resolved.absolutePath);
  } catch (_error) {
    return null;
  }
  if (sourceRealPath === rootRealPath || !sourceRealPath.startsWith(`${rootRealPath}${path.sep}`)) return null;
  let stat;
  let bytes;
  try {
    stat = fs.statSync(sourceRealPath);
    if (!stat.isFile()) return null;
    bytes = fs.readFileSync(sourceRealPath);
  } catch (_error) {
    return null;
  }
  return {
    sourceKey: path.relative(rootRealPath, sourceRealPath).split(path.sep).join("/"),
    revision: {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentHash: sha256Revision(bytes),
    },
  };
}

module.exports = {
  readArtifact,
  readBytesArtifact,
  readExtractManifestArtifact,
  readJsonArtifact,
  readMasterGraphArtifact,
  readPropertyInspectionArtifacts,
  readVaultSourceIdentity,
  readYamlArtifact,
  resolveVaultFile,
  sha256Revision,
};
