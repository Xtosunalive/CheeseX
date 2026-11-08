// Component: Graph-Provenance-Service
// @responsible: 校验主图哈希与参与分析的 Vault 来源文件是否仍匹配最近一次抽取基线。
// @inputs: master_graph.json、pipeline_version.json、extract_manifest.json、来源文件路径
// @outputs: SHA-256 内容哈希与 fresh/stale/unknown 判定
// @context: Pipeline

const crypto = require("node:crypto");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs"); // SPEC-012 WP-A
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs"); // SPEC-012 wave-2 图族
const { readGraphArtifactText, readExtractManifestText } = require("../../shared/persistence/graph-artifact-ingest.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { collectMissingRelationLineage, inspectRelationLineage } = require("../../shared/relation-lineage.cjs");

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeHash(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("sha256:") ? normalized : `sha256:${normalized}`;
}

// SPEC-012 wave-2 图族：extract_manifest 真身迁 derived-index.db——原文行 parse 读
// （无行/解析失败/非对象 → null，与旧文件 readJson 三态兜底同构）
function readExtractManifest(scopeKey) {
  let text;
  try {
    text = readExtractManifestText(getDerivedIndexStore(scopeKey));
  } catch (_error) {
    return null;
  }
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

function combineFreshness(items, checkedAt) {
  const values = items.filter(Boolean);
  const statuses = new Set(values.map((item) => item.status));
  const status = statuses.has("stale") ? "stale" : statuses.has("unknown") || values.length === 0 ? "unknown" : "fresh";
  const changedFields = [...new Set(values.flatMap((item) => Array.isArray(item.changedFields) ? item.changedFields : []))].sort();
  return { status, checkedAt, changedFields };
}

// 结构血缘校验（inspectRelationLineage / collectMissingRelationLineage）已迁移到
// ../shared/relation-lineage.cjs；此处按需再导出，保持既有 API 与实例方法不变。

function createGraphProvenanceService({ vaultPath, now = () => new Date() } = {}) {
  const rootPath = path.resolve(vaultPath || process.cwd());

  function checkedAt() {
    return now().toISOString();
  }

  function resolveSourcePath(sourcePath) {
    if (typeof sourcePath !== "string" || !sourcePath.trim()) return null;
    const normalized = sourcePath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
    const candidates = [normalized];
    if (!normalized.startsWith("知识库/")) candidates.push(`知识库/${normalized}`);
    for (const candidate of candidates) {
      const absolutePath = path.resolve(rootPath, candidate);
      if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${path.sep}`)) continue;
      if (fs.existsSync(absolutePath)) return { normalized: candidate, absolutePath };
    }
    return null;
  }

  function inspectSource(sourcePath, expectedHash) {
    const resolved = resolveSourcePath(sourcePath);
    if (!resolved || !fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
      return { sourcePath: typeof sourcePath === "string" ? sourcePath : "", contentHash: null, freshness: { status: "unknown", checkedAt: checkedAt(), changedFields: [] } };
    }

    const bytes = fs.readFileSync(resolved.absolutePath);
    const contentHash = sha256(bytes);
    const expectedContentHash = normalizeHash(expectedHash);
    const changedFields = [];
    if (expectedContentHash && expectedContentHash !== contentHash) changedFields.push("sourceHash");

    const manifest = readExtractManifest(rootPath);
    const baseline = manifest && manifest.files && typeof manifest.files === "object" && !Array.isArray(manifest.files)
      ? manifest.files[resolved.normalized]
      : null;
    let revisionKnown = false;
    if (baseline && typeof baseline === "object" && !Array.isArray(baseline)) {
      const stat = fs.statSync(resolved.absolutePath, { bigint: true });
      const baselineSize = typeof baseline.size === "number" ? baseline.size : null;
      const baselineMtime = typeof baseline.mtime_ns === "number" ? baseline.mtime_ns : null;
      if (baselineSize !== null && baselineMtime !== null) {
        revisionKnown = true;
        const mtimeDrift = Math.abs(Number(stat.mtimeNs) - baselineMtime);
        if (Number(stat.size) !== baselineSize || mtimeDrift > 1_000_000) changedFields.push("sourceRevision");
      }
    }

    const status = changedFields.length > 0 ? "stale" : expectedContentHash || revisionKnown ? "fresh" : "unknown";
    return { sourcePath: resolved.normalized, contentHash, freshness: { status, checkedAt: checkedAt(), changedFields: [...new Set(changedFields)].sort() } };
  }

  function inspectGraph(sourcePaths = []) {
    // SPEC-012 wave-2 图族：主图 sha256 改读 derived-index.db 原文行（Buffer 同口径——
    // 与 pipeline_version 记录的文件字节指纹比对不漂移）
    const graphRaw = (() => {
      try { return readGraphArtifactText(getDerivedIndexStore(rootPath)); } catch (_error) { return null; }
    })();
    const pipelineVersion = (() => { try { return getRuntimeStateStore(rootPath).pipeline.versionGet(); } catch (_) { return null; } })();
    const contentHash = graphRaw !== null ? sha256(Buffer.from(graphRaw, "utf8")) : null;
    const expectedHash = normalizeHash(pipelineVersion && pipelineVersion.master_graph_sha256);
    const graphFreshness = contentHash && expectedHash
      ? { status: contentHash === expectedHash ? "fresh" : "stale", checkedAt: checkedAt(), changedFields: contentHash === expectedHash ? [] : ["sourceHash"] }
      : { status: "unknown", checkedAt: checkedAt(), changedFields: [] };

    const uniquePaths = [...new Set(sourcePaths.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
    const sourceFreshness = uniquePaths.map((sourcePath) => {
      const result = inspectSource(sourcePath);
      return {
        ...result.freshness,
        changedFields: result.freshness.changedFields.map((field) => `${field}:${sourcePath}`),
      };
    });
    return { contentHash, freshness: combineFreshness([graphFreshness, ...sourceFreshness], checkedAt()) };
  }

  return { inspectGraph, inspectSource, inspectRelationLineage, collectMissingRelationLineage };
}

module.exports = { combineFreshness, collectMissingRelationLineage, createGraphProvenanceService, inspectRelationLineage, normalizeHash, sha256 };
