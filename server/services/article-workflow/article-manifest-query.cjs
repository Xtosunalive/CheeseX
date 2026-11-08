// @responsible: 查询文章 Manifest 的新鲜度、覆盖统计、筛选与分页结果。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs"); // SPEC-012 WP-A：pipeline_version 读侧迁库
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs"); // SPEC-012 wave-2：manifest 行级投影
const { readGraphArtifactText } = require("../../shared/persistence/graph-artifact-ingest.cjs"); // SPEC-012 wave-2 图族：主图原文行
const { buildArticleManifestKey } = require("./article-manifest-paths.cjs");

function createArticleManifestQuery({ vaultPath, queryArticleSources, isSourceExcluded }) {
  function queryArticleManifests(options = {}) {
    const filter = options.filter || "all";
    const q = String(options.q || "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
    const offset = Math.max(Number(options.offset) || 0, 0);
    // SPEC-012 wave-2：当前图 hash 改读 derived-index.db 原文（Buffer 同口径——freshness 判定与旧文件字节一致不漂移）
    let currentGraphHash = null;
    let versionGraphHash = null;
    if (vaultPath) {
      try {
        const raw = readGraphArtifactText(getDerivedIndexStore(vaultPath));
        if (raw !== null) currentGraphHash = crypto.createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");
      } catch (_error) { /* best-effort: 失败静默可接受 */ }
    }
    if (vaultPath) {
      try { versionGraphHash = getRuntimeStateStore(vaultPath).pipeline.versionGet()?.master_graph_sha256 || null; } catch (_error) { /* best-effort: 失败静默可接受 */ }
    }

    const allSources = [];
    let pageOffset = 0;
    while (true) {
      const page = queryArticleSources({ limit: 200, offset: pageOffset });
      if (!page.items?.length) break;
      allSources.push(...page.items);
      if (page.items.length < 200) break;
      pageOffset += 200;
    }

    const items = [];
    const counts = { fresh: 0, missing: 0, stale: 0, unknown: 0, excluded: 0, relational: 0, sourceOnly: 0, staleRelational: 0, staleSourceOnly: 0, unknownRelational: 0, unknownSourceOnly: 0, missingEligible: 0 };
    for (const source of allSources) {
      const normalizedPath = source.normalizedSourcePath || "";
      const canonicalPath = source.sourcePath || normalizedPath;
      let exclusion = isSourceExcluded(canonicalPath);
      if (!exclusion.excluded && canonicalPath !== normalizedPath) exclusion = isSourceExcluded(normalizedPath);
      const excluded = exclusion.excluded;
      // SPEC-012 wave-2：manifest 真身迁 derived-index.db 行级——读 store 行（key 校验沿
      // buildArticleManifestKey，非法 key/读失败按缺行处理；行由 put/导入侧 JSON 序列化落库，
      // 旧「文件在场但解析失败」分支构造性消失。relativePath 是 Release 包内工件路径，布局不变）
      let manifestData = null;
      if (normalizedPath && vaultPath) {
        try {
          manifestData = getDerivedIndexStore(vaultPath).articleManifests.get(buildArticleManifestKey(normalizedPath));
        } catch (_error) { manifestData = null; }
      }
      let manifest = { exists: false, fresh: false, status: "missing", relativePath: null, generatedAt: null, reason: excluded ? `excluded: ${exclusion.reason}` : "manifest 文件不存在" };
      let manifestMode = null;
      if (manifestData) {
        manifestMode = manifestData.manifestMode || "relational";
        const manifestGraphHash = manifestData.masterGraphHash || null;
        if (currentGraphHash && manifestGraphHash) {
          const fresh = currentGraphHash === manifestGraphHash && (!versionGraphHash || manifestGraphHash === versionGraphHash);
          manifest = { exists: true, fresh, status: fresh ? "fresh" : "stale", relativePath: `.ledger/article-manifests/${normalizedPath}.json`, generatedAt: manifestData.generatedAt || null, reason: fresh ? "manifest 与当前 master_graph hash 一致" : "master_graph hash 已变更 — manifest 过期", manifestMode };
        } else {
          manifest = { exists: true, fresh: false, status: "unknown", relativePath: `.ledger/article-manifests/${normalizedPath}.json`, generatedAt: manifestData.generatedAt || null, reason: "无法校验 hash", manifestMode };
        }
      }

      counts[manifest.status] += 1;
      if (excluded) counts.excluded += 1;
      else if (["fresh", "stale", "unknown"].includes(manifest.status)) {
        const sourceOnly = manifestMode === "source_only";
        counts[sourceOnly ? "sourceOnly" : "relational"] += 1;
        if (manifest.status === "stale") counts[sourceOnly ? "staleSourceOnly" : "staleRelational"] += 1;
        if (manifest.status === "unknown") counts[sourceOnly ? "unknownSourceOnly" : "unknownRelational"] += 1;
      } else counts.missingEligible += 1;

      const itemManifestMode = excluded ? "excluded" : (manifestMode || (manifest.exists ? "relational" : null));
      if (filter === "relational" && itemManifestMode !== "relational") continue;
      if (filter === "source_only" && itemManifestMode !== "source_only") continue;
      if (filter === "excluded" && !excluded) continue;
      if (filter === "missing_eligible" && (excluded || manifest.status !== "missing")) continue;
      if (["missing", "fresh", "stale", "unknown"].includes(filter) && manifest.status !== filter) continue;
      if (q && !source.title.toLowerCase().includes(q) && !source.sourcePath.toLowerCase().includes(q) && !normalizedPath.toLowerCase().includes(q)) continue;
      items.push({ sourcePath: source.sourcePath, normalizedSourcePath: normalizedPath, title: source.title, kind: source.kind, nodeEvidenceCount: source.nodeEvidenceCount, directRelationCount: source.directRelationCount, unresolvedCount: 0, manifest, manifestMode: itemManifestMode || "unknown", excluded, exclusionReason: exclusion.reason || null, eligible: !excluded });
    }

    const statusOrder = { missing: 0, stale: 1, unknown: 2, fresh: 3 };
    items.sort((left, right) => Number(right.excluded) - Number(left.excluded) || statusOrder[left.manifest.status] - statusOrder[right.manifest.status] || right.directRelationCount - left.directRelationCount);
    const eligibleSources = allSources.length - counts.excluded;
    const coveredSources = counts.relational + counts.sourceOnly;
    return {
      summary: {
        totalSources: allSources.length, totalManifests: counts.fresh + counts.stale + counts.unknown,
        fresh: counts.fresh, missing: counts.missing, stale: counts.stale, unknown: counts.unknown,
        totalSourcesRaw: allSources.length, excludedSources: counts.excluded, eligibleSources,
        relationalManifests: counts.relational, sourceOnlyManifests: counts.sourceOnly, coveredSources,
        missingEligible: counts.missingEligible, coverageRatio: eligibleSources > 0 ? coveredSources / eligibleSources : 0,
        staleRelational: counts.staleRelational, staleSourceOnly: counts.staleSourceOnly,
        unknownRelational: counts.unknownRelational, unknownSourceOnly: counts.unknownSourceOnly,
      },
      query: { filter, q: options.q || "", limit, offset },
      items: items.slice(offset, offset + limit),
    };
  }
  return queryArticleManifests;
}

module.exports = { createArticleManifestQuery };
