// @contract ReviewStatus: "approved" | "pending" | "rejected"
// @see contracts/http-api.openapi.json#/components/schemas/ReviewStatus
// @responsible: 查询文章挂载并生成、写入或移除文章 Manifest 工件。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createArticleManifestQuery } = require("./article-manifest-query.cjs");
const { classifySourceMatch, isSourceExcluded, normalizeSourcePath } = require("./article-manifest-policy.cjs");
const { relationSourceEvidence, sourceKind } = require("../../shared/article-manifest-lineage.cjs");
const { getRuntimeStateStore } = require("../../shared/persistence/runtime-state-store.cjs"); // SPEC-012 WP-A：pipeline_version 读侧迁库
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs"); // SPEC-012 wave-2：manifest 投影迁 derived-index.db（行级）
const { readGraphArtifactText } = require("../../shared/persistence/graph-artifact-ingest.cjs"); // SPEC-012 wave-2 图族：主图原文行

// SPEC-012 wave-2：当前主图 sha256（hex，无前缀）——库原文 Buffer 口径，与旧文件字节同指纹；
// 无图/读失败返回 null（旧 existsSync 失败静默语义不变）
function currentMasterGraphHash(vaultPath) {
  if (!vaultPath) return null;
  try {
    const raw = readGraphArtifactText(getDerivedIndexStore(vaultPath));
    if (raw === null) return null;
    return crypto.createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");
  } catch (_error) { return null; /* best-effort: 失败静默可接受 */ }
}

function createArticleManifestService({
  vaultPath,
  readMasterGraph,
}) {
  function queryArticleMount(sourcePath, includeSynthetic) {
    if (!sourcePath || typeof sourcePath !== "string" || !sourcePath.trim()) {
      return { _error: true, message: "缺少必填参数 sourcePath" };
    }
    const normalizedPath = normalizeSourcePath(sourcePath, vaultPath);
    const master = readMasterGraph() || { nodes: [], connections: [] };

    // Collect evidence from nodes
    const nodeFields = ["sourceFile", "sourcePath", "source_path", "file", "path", "file_path", "source_vault_path"];
    const matchedNodes = [];
    const sourceMatches = [];
    for (const node of master.nodes || []) {
      const props = node.properties || {};
      for (const field of nodeFields) {
        const val = String(props[field] || node[field] || "").replace(/\\/g, "/");
        if (!val) continue;
        const matchType = classifySourceMatch(normalizedPath, val);
        if (matchType === "exact" || matchType === "suffix") {
          matchedNodes.push({
            id: node.id,
            label: node.label || "",
            category: node.category || "",
            matchField: field,
            matchType,
            graphNodeId: node.id,
          });
          sourceMatches.push({ field, value: val, matchType, nodeId: node.id });
          break;
        }
      }
    }

    // Collect evidence from connections — scan ALL inference_sources per connection
    const directRel = [];
    const seenRelKeys = new Set();
    const contextualRel = [];
    for (const conn of master.connections || []) {
      const props = conn.properties || {};
      const srcs = relationSourceEvidence(conn);
      let connHasDirect = false;
      let connHasSynthetic = false;
      for (const src of srcs) {
        const f = String(src.file || src.path || "").replace(/\\/g, "/");
        if (!f) continue;
        const matchType = classifySourceMatch(normalizedPath, f);
        if (matchType === "exact" || matchType === "suffix") {
          connHasDirect = true;
          const relKey = `${conn.from}\x00${conn.to}\x00${conn.relationType}`;
          if (!seenRelKeys.has(relKey)) {
            seenRelKeys.add(relKey);
            directRel.push({
              from: conn.from,
              to: conn.to,
              relationType: conn.relationType || "REFERENCES",
              reviewStatus: conn.reviewStatus || "none",
              weight: Number.isFinite(Number(props.weight)) ? Number(props.weight) : null,
              source: src.method || src.source || "",
              method: src.method || "",
              evidence: f,
              matchType,
            });
          }
          sourceMatches.push({ field: src.coordinate ? "inputCoordinates" : "inference_sources.file", value: f, matchType, method: src.method || "", connectionId: `${conn.from}→${conn.to}`, confidence: src.confidence, coordinate: src.coordinate || undefined });
        } else if (matchType === "synthetic") {
          connHasSynthetic = true;
          if (includeSynthetic) {
            contextualRel.push({
              from: conn.from, to: conn.to,
              relationType: conn.relationType || "REFERENCES",
              evidence: f, matchType,
            });
          }
        }
      }
      // Only record synthetic in sourceMatches if includeSynthetic AND no direct match exists
      if (includeSynthetic && connHasSynthetic && !connHasDirect) {
        sourceMatches.push({ field: "inference_sources.file", value: "(synthetic)", matchType: "synthetic", connectionId: `${conn.from}→${conn.to}`, count: srcs.filter(s => classifySourceMatch(normalizedPath, String(s.file || s.path || "").replace(/\\/g, "/")) === "synthetic").length });
      }
    }

    // Classify endpoint categories
    const components = [];
    const versions = [];
    const plates = [];
    const seenComp = new Set();
    const seenVer = new Set();
    const seenPlate = new Set();
    for (const rel of directRel) {
      for (const ep of [rel.from, rel.to]) {
        if (seenComp.has(ep) || seenVer.has(ep) || seenPlate.has(ep)) continue;
        if (String(ep).startsWith("plate:")) {
          plates.push({ id: ep, relationTo: rel.from === ep ? rel.to : rel.from, relationType: rel.relationType });
          seenPlate.add(ep);
        } else {
          // Default to component
          components.push({ id: ep, relationTo: rel.from === ep ? rel.to : rel.from, relationType: rel.relationType });
          seenComp.add(ep);
        }
      }
    }

    const unresolved = [];
    if (directRel.length === 0 && matchedNodes.length === 0) {
      if (sourceMatches.some(s => s.matchType === "synthetic"))
        unresolved.push("synthetic_only");
      else
        unresolved.push("source_not_found");
    }
    if (directRel.length === 0 && matchedNodes.length > 0)
      unresolved.push("no_direct_inference_sources");

    return {
      query: { sourcePath, normalizedSourcePath: normalizedPath, includeSynthetic: !!includeSynthetic },
      summary: {
        directRelationCount: directRel.length,
        contextualRelationCount: contextualRel.length,
        extractedEntityCount: matchedNodes.length,
        matchedComponentCount: components.length,
        matchedVersionCount: versions.length,
        matchedPlateCount: plates.length,
        unresolvedCount: unresolved.length,
        review: {
          approved: directRel.filter(r => r.reviewStatus === "approved").length,
          pending: directRel.filter(r => r.reviewStatus === "pending").length,
          rejected: directRel.filter(r => r.reviewStatus === "rejected").length,
          none: directRel.filter(r => r.reviewStatus === "none").length,
        },
      },
      article: matchedNodes[0] ? { title: matchedNodes[0].label, sourcePath: normalizedPath, nodeId: matchedNodes[0].id } : null,
      extracted_entities: matchedNodes,
      matched_components: components,
      matched_versions: versions,
      matched_plates: plates,
      matched_scenarios: [],
      generated_relations: directRel,
      contextual_relations: contextualRel,
      unresolved_fields: unresolved,
      evidence: { sourceMatches },
      manifest: buildArticleMountManifestStatus(normalizedPath),
    };
  }

  function buildArticleMountManifestStatus(normalizedSourcePath) {
    const checkedAt = new Date().toISOString();

    // SPEC-012 wave-2：manifest 真身迁 derived-index.db 行级——读 store 行（key 穿越校验沿
    // buildArticleManifestKey；非法 key/库未初始化按缺行处理，同旧读文件失败静默语义）
    let manifestData = null;
    if (vaultPath && normalizedSourcePath) {
      try {
        manifestData = getDerivedIndexStore(vaultPath).articleManifests.get(buildArticleManifestKey(normalizedSourcePath)) ?? null;
      } catch (_) { /* best-effort: 失败静默可接受 */ }
    }

    if (!manifestData) {
      return {
        exists: false, fresh: false, status: "missing",
        manifestKey: normalizedSourcePath || null, relativePath: null,
        generatedAt: null, checkedAt, reason: "manifest 文件不存在",
        masterGraphHash: null, pipelineVersionHash: null,
      };
    }

    let currentMgHash = null;
    let pvMgHash = null;
    currentMgHash = currentMasterGraphHash(vaultPath); // SPEC-012 wave-2：图 hash 改读库原文
    if (vaultPath) {
      // SPEC-012 WP-A：pipeline_version 读侧迁 runtime-state.db
      try { pvMgHash = getRuntimeStateStore(vaultPath).pipeline.versionGet()?.master_graph_sha256 || null; } catch (_) { /* best-effort: 失败静默可接受 */ }
    }

    const manifestMgHash = manifestData?.masterGraphHash || null;
    let fresh = false;
    let status = "unknown";
    let reason = "";

    if (currentMgHash && manifestMgHash) {
      fresh = currentMgHash === manifestMgHash && (pvMgHash ? manifestMgHash === pvMgHash : true);
      status = fresh ? "fresh" : "stale";
      reason = fresh ? "manifest 与当前 master_graph hash 一致" : "master_graph hash 已变更 — manifest 过期";
    } else if (!currentMgHash) {
      status = "unknown"; reason = "无法读取 master_graph.json";
    } else {
      status = "unknown"; reason = "manifest 缺少 masterGraphHash 字段";
    }

    return {
      exists: true, fresh, status,
      manifestKey: normalizedSourcePath || null,
      relativePath: ".ledger/article-manifests/" + normalizedSourcePath + ".json",
      generatedAt: manifestData?.generatedAt || null,
      checkedAt, reason,
      masterGraphHash: manifestMgHash ? manifestMgHash.substring(0, 16) + "..." : null,
      pipelineVersionHash: pvMgHash ? pvMgHash.substring(0, 16) + "..." : null,
    };
  }

  function queryArticleSources(options) {
    // B4（裁决 #20）：取消静默 clamp，统一抛错——静默 clamp 掩盖调用方错误；上限统一 200。
    const limit = Number(options.limit);
    const offset = Number(options.offset);
    if (limit !== undefined && !Number.isNaN(limit) && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      const error = new Error("limit 必须为 1..200 的整数"); error.code = "INVALID_QUERY"; throw error;
    }
    if (offset !== undefined && !Number.isNaN(offset) && (!Number.isInteger(offset) || offset < 0)) {
      const error = new Error("offset 必须为非负整数"); error.code = "INVALID_QUERY"; throw error;
    }
    const safeLimit = Number.isInteger(limit) ? limit : 50;
    const safeOffset = Number.isInteger(offset) ? offset : 0;
    const q = String(options.q || "").trim().toLowerCase();
    const kind = options.kind || "";
    const includeSynthetic = options.includeSynthetic === true;

    const master = readMasterGraph() || { nodes: [], connections: [] };

    // Normalise helper
    function norm(p) { return String(p || "").replace(/\\/g, "/").trim(); }

    // Aggregate by normalised sourcePath
    const agg = new Map();

    // Scan nodes
    const nodeFields = ["sourceFile","sourcePath","source_path","file","path","file_path","source_vault_path"];
    for (const node of master.nodes || []) {
      const props = node.properties || {};
      for (const f of nodeFields) {
        const raw = norm(props[f] || node[f] || "");
        if (!raw) continue;
        const match = classifySourceMatch("", raw);
        if (match === "synthetic" || !raw) continue;
        const sp = normalizeSourcePath(raw, vaultPath);
        if (!sp) continue;
        let entry = agg.get(sp);
        if (!entry) { entry = { sourcePath: sp, normalizedSourcePath: sp, nodeEvidenceCount: 0, directRelationCount: 0, evidenceCount: 0, syntheticExcludedCount: 0, articleNodeIds: [], articleLabels: [], aliases: [], review: { approved: 0, pending: 0, rejected: 0, none: 0 }, sampleRelations: [], firstSeenFields: [], seenRelKeys: new Set() }; agg.set(sp, entry); }
        entry.nodeEvidenceCount += 1;
        if (entry.aliases.indexOf(raw) === -1) entry.aliases.push(raw);
        entry.articleNodeIds.push(node.id);
        if (node.label) entry.articleLabels.push(node.label);
        if (!entry.firstSeenFields.includes(f)) entry.firstSeenFields.push(f);
        break;
      }
    }

    // Scan connections
    for (const conn of master.connections || []) {
      const props = conn.properties || {};
      const srcs = relationSourceEvidence(conn);
      for (const src of srcs) {
        const raw = norm(src.file || src.path || "");
        if (!raw) continue;
        const match = classifySourceMatch("", raw);
        if (match === "synthetic" || !raw) continue;
        const sp = normalizeSourcePath(raw, vaultPath);
        if (!sp) continue;
        let entry = agg.get(sp);
        if (!entry) { entry = { sourcePath: sp, normalizedSourcePath: sp, nodeEvidenceCount: 0, directRelationCount: 0, evidenceCount: 0, syntheticExcludedCount: 0, articleNodeIds: [], articleLabels: [], aliases: [], review: { approved: 0, pending: 0, rejected: 0, none: 0 }, sampleRelations: [], firstSeenFields: [], seenRelKeys: new Set() }; agg.set(sp, entry); }
        entry.directRelationCount += 1;
        entry.evidenceCount += 1;
        if (entry.aliases.indexOf(raw) === -1) entry.aliases.push(raw);
        const relKey = `${conn.from}\x00${conn.to}\x00${conn.relationType}`;
        if (!entry.seenRelKeys.has(relKey)) {
          entry.seenRelKeys.add(relKey);
          if (entry.sampleRelations.length < 5) entry.sampleRelations.push({ from: conn.from, to: conn.to, relationType: conn.relationType || "REFERENCES", reviewStatus: conn.reviewStatus || "none" });
        }
        const rv = conn.reviewStatus || "none";
        if (entry.review[rv] != null) entry.review[rv] += 1;
        break;
      }
    }

    // Build items, apply filters
    let items = [];
    for (const [sp, entry] of agg) {
      let title = entry.articleLabels[0] || sp.split("/").pop() || sp;
      // Dedup labels
      const uniqueLabels = [...new Set(entry.articleLabels)];
      entry.articleLabels = uniqueLabels;
      if (uniqueLabels.length > 0) title = uniqueLabels[0];

      const k = sourceKind(sp);
      if (kind && k !== kind) continue;
      if (q && !sp.toLowerCase().includes(q) && !title.toLowerCase().includes(q) && !uniqueLabels.some(l => l.toLowerCase().includes(q))) continue;

      // canonical sourcePath: prefer 知识库/-prefixed alias if available
      let canonicalPath = sp;
      for (const a of entry.aliases || []) {
        if (a.startsWith("知识库/")) { canonicalPath = a; break; }
      }

      const clean = { sourcePath: canonicalPath, normalizedSourcePath: sp, aliases: entry.aliases || [], title, kind: k,
        nodeEvidenceCount: entry.nodeEvidenceCount, directRelationCount: entry.directRelationCount,
        evidenceCount: entry.evidenceCount, syntheticExcludedCount: 0,
        articleNodeIds: uniqueLabels.length > 0 ? entry.articleNodeIds : [],
        articleLabels: uniqueLabels,
        review: entry.review, sampleRelations: entry.sampleRelations,
        firstSeenFields: entry.firstSeenFields };
      items.push(clean);
    }

    const total = items.length;
    // WP-052 T1（P4-3）：并列计数 sourcePath 次级键——翻页丢/重收敛（offset/limit 前序须全序）
    items = items.sort((a, b) => b.evidenceCount - a.evidenceCount || String(a.sourcePath).localeCompare(String(b.sourcePath))).slice(safeOffset, safeOffset + safeLimit);

    return {
      summary: { total, directSourceCount: total, syntheticExcludedCount: 0, nodeEvidenceCount: items.reduce((s,i) => s+i.nodeEvidenceCount,0), relationEvidenceCount: items.reduce((s,i) => s+i.directRelationCount,0) },
      query: { q: options.q || "", limit: safeLimit, offset: safeOffset, kind: kind || undefined, includeSynthetic },
      items,
    };
  }

  // 路径族（key 归一化/磁盘枚举/源存在性）已拆至 article-manifest-paths.cjs
  //（规则 2 ≤500 行，#1795 零语义变化）；factory 以同签名绑定 vaultPath 转发，公开面不变。
  // SPEC-012 wave-2：resolveArticleManifestPath 随目录树退役（无外部消费方；穿越校验留在 buildArticleManifestKey）。
  const {
    buildArticleManifestKey,
    listManifestSources,
    sourceExists,
  } = require("./article-manifest-paths.cjs");
  const boundListManifestSources = () => listManifestSources(vaultPath);
  const boundSourceExists = (sourcePath) => sourceExists(vaultPath, sourcePath);

  function generateArticleManifest(sourcePath, options) {
    const mountResult = queryArticleMount(sourcePath, false);
    if (mountResult._error) {
      return {
        manifestVersion: 2, schemaVersion: "v2", generatedAt: new Date().toISOString(),
        manifestKey: null, sourcePathCanonical: sourcePath || "", sourcePathNormalized: null, sourcePathAliases: [],
        masterGraphHash: null, pipelineVersionHash: null,
        freshness: { status: "unknown", checkedAt: new Date().toISOString(), reason: mountResult.message || "article-mount failed" },
        article: null, extraction: null, evidence: null, review: null,
        warnings: [mountResult.message || "article-mount error"],
        generator: { name: "kg-query-service.article-manifest", version: 1 },
      };
    }

    let masterGraphHash = null;
    let pipelineVersionHash = null;
    let pipelineRunId = null;
    let freshnessStatus = "unknown";
    let freshnessReason = "";

    // SPEC-012 wave-2：图 hash 改读 derived-index.db 原文（字节同口径，manifest 指纹不漂移）
    masterGraphHash = currentMasterGraphHash(vaultPath);
    if (vaultPath) {
      // SPEC-012 WP-A：pipeline_version 读侧迁 runtime-state.db
      try {
        const pv = getRuntimeStateStore(vaultPath).pipeline.versionGet();
        pipelineVersionHash = pv?.master_graph_sha256 || null;
        pipelineRunId = pv?.pipeline_run_id || null;
      } catch (_) { /* best-effort: 失败静默可接受 */ }
    }

    if (masterGraphHash && pipelineVersionHash) {
      freshnessStatus = masterGraphHash === pipelineVersionHash ? "fresh" : "stale";
      freshnessReason = freshnessStatus === "fresh"
        ? "master_graph.json hash 与 pipeline_version.json 记录的 hash 一致"
        : "master_graph.json hash 与 pipeline_version.json 不一致 — 需重新运行 pipeline";
    } else if (!masterGraphHash) {
      freshnessStatus = "unknown";
      freshnessReason = "master_graph.json 不存在";
    } else {
      freshnessStatus = "unknown";
      freshnessReason = "pipeline_version.json 缺失，无法判断一致性";
    }

    let manifestKey = null;
    let normalizedPath = "";
    let aliases = [];
    try {
      const normalizedSource = mountResult.query?.normalizedSourcePath || "";
      manifestKey = buildArticleManifestKey(normalizedSource || sourcePath);
      normalizedPath = manifestKey;
      const aliasSet = new Set();
      aliasSet.add(sourcePath);
      if (mountResult.query?.sourcePath) aliasSet.add(mountResult.query.sourcePath);
      if (mountResult.query?.normalizedSourcePath) aliasSet.add(mountResult.query.normalizedSourcePath);
      for (const sm of (mountResult.evidence?.sourceMatches || [])) {
        if (sm.value) aliasSet.add(sm.value);
      }
      aliases = [...aliasSet].filter(Boolean);
    } catch (e) {
      // key validation failed — still return partial manifest
    }

    const article = mountResult.article
      ? { title: mountResult.article.title, articleNodeId: mountResult.article.nodeId, articleKind: sourceKind(mountResult.query?.normalizedSourcePath) }
      : null;

    const extraction = {
      directRelationCount: mountResult.summary?.directRelationCount || 0,
      contextualRelationCount: mountResult.summary?.contextualRelationCount || 0,
      syntheticExcludedCount: 0,
      extractedEntityIds: (mountResult.extracted_entities || []).map(e => e.id),
      matchedComponentIds: (mountResult.matched_components || []).map(c => c.id),
      matchedVersionIds: (mountResult.matched_versions || []).map(v => v.id),
      matchedPlateIds: (mountResult.matched_plates || []).map(p => p.id),
      relationKeys: (mountResult.generated_relations || []).map(r => r.from + "→" + r.to + ":" + r.relationType),
      unresolvedFields: mountResult.unresolved_fields || [],
      sourceOnlyReason: (function() { var drc = mountResult.summary && mountResult.summary.directRelationCount || 0; var urf = mountResult.unresolved_fields || []; if (drc === 0 && urf.indexOf("no_direct_inference_sources") >= 0) return "no_direct_inference_sources"; return null; })()
    };

    const evidence = {
      sourceMatches: (mountResult.evidence?.sourceMatches || []).slice(0, 50),
      nodeEvidenceCount: (mountResult.extracted_entities || []).length,
      relationEvidenceCount: (mountResult.generated_relations || []).length,
    };

    return {
      manifestVersion: 2,
      schemaVersion: "v2",
      generatedAt: new Date().toISOString(),
      manifestKey,
      sourcePathCanonical: sourcePath || "",
      sourcePathNormalized: normalizedPath,
      sourcePathAliases: aliases,
      masterGraphHash,
      pipelineVersionHash,
      pipelineRunId,
      freshness: { status: freshnessStatus, checkedAt: new Date().toISOString(), reason: freshnessReason },
      article,
      extraction,
      evidence,
      review: mountResult.summary?.review || null,
      schemaVersion: "v2.1",
      manifestMode: (mountResult.summary && mountResult.summary.directRelationCount > 0) ? "relational" : "source_only",
      warnings: (function() {
        var raw = mountResult.unresolved_fields && mountResult.unresolved_fields.length ? mountResult.unresolved_fields : [];
        var drc = mountResult.summary && mountResult.summary.directRelationCount || 0;
        if (drc === 0 && raw.length === 1 && raw[0] === "no_direct_inference_sources") return [];
        return raw;
      })(),
      generator: { name: "kg-query-service.article-manifest", version: 1 },
    };
  }

  function writeArticleManifest(sourcePath, options) {
    const exclusion = isSourceExcluded(sourcePath);
    if (exclusion.excluded) {
      const error = new Error(`该来源不能生成正式文章映射：${exclusion.reason}`);
      error.code = "ARTICLE_MANIFEST_SOURCE_EXCLUDED";
      throw error;
    }
    const manifest = generateArticleManifest(sourcePath, options);
    if (!manifest.manifestKey) throw new Error("manifest key 为空，无法写入");
    // SPEC-012 wave-2：②类投影迁 derived-index.db 行级 upsert（key 校验在 buildArticleManifestKey，
    // 路径穿越构造性消失——库行无目录树；旧 mkdir+writeVault 退役）
    getDerivedIndexStore(vaultPath).articleManifests.put(manifest.manifestKey, manifest);
    return { manifest, key: manifest.manifestKey, written: true };
  }

  function removeArticleManifest(sourcePath) {
    const key = buildArticleManifestKey(sourcePath); // 沿 resolveArticleManifestPath 的 key 校验语义（含穿越拒绝）
    const manifests = getDerivedIndexStore(vaultPath).articleManifests;
    if (!manifests.get(key)) return { key, removed: false };
    manifests.delete(key);
    return { key, removed: true };
  }

  const queryArticleManifests = createArticleManifestQuery({ vaultPath, queryArticleSources, isSourceExcluded });

  return {
    queryArticleMount,
    queryArticleSources,
    queryArticleManifests,
    generateArticleManifest,
    buildArticleManifestKey,
    isSourceExcluded,
    writeArticleManifest,
    removeArticleManifest,
    listManifestSources: boundListManifestSources,
    sourceExists: boundSourceExists,
  };
}

module.exports = {
  createArticleManifestService,
};
