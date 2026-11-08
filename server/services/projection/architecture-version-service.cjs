// @responsible: 读取实时或快照架构版本并提供版本列表、详情与差异比较。
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeVersion } = require("../../shared/version-contract.cjs");
const { createDecisionEvidenceService } = require("../../shared/decision-lineage.cjs");

const { createError: serviceError } = require("../../shared/error-factory.cjs");

function hash(raw) {
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

function text(value) {
  return typeof value === "string" || typeof value === "number" ? `${value}`.trim() : "";
}

function normalizeComponent(raw) {
  const id = text(raw && (raw.id || raw["architecture-node-id"] || raw.architecture_node_id));
  if (!id) return null;
  return {
    id,
    label: text(raw.label || raw.name || raw.title) || "未命名架构组件",
    layer: text(raw.layer || raw.arch_layer),
    category: text(raw.category || raw.arch_category),
    role: text(raw.arch_role),
  };
}

function normalizeRelation(raw) {
  const source = text(raw && (raw.source || raw.from));
  const target = text(raw && (raw.target || raw.to));
  const type = text(raw && (raw.type || raw.relationType)) || "DEPENDS_ON";
  if (!source || !target) return null;
  // WP-051 I-B（P2 实跑址 3）：依赖行键经身份入口——去重 Map 不再静默丢一条
  return { key: require("../../shared/identity-port.cjs").makeId("dep", [source, type, target]), source, target, type };
}

function normalizeDocument(raw) {
  const documentId = text(raw && (raw.documentId || raw.document_id || raw.articleId || raw.article_id || raw.sourcePath));
  if (!documentId) return null;
  return {
    documentId,
    articleId: text(raw.articleId || raw.article_id),
    title: text(raw.title) || documentId,
    sourcePath: text(raw.sourcePath || raw.source_path),
  };
}

function uniqueSorted(items, key) {
  return [...new Map(items.filter(Boolean).map((item) => [item[key], item])).values()].sort((left, right) => left[key].localeCompare(right[key]));
}

function normalizeState(raw, filterRelations = (relations) => relations) {
  const components = uniqueSorted((Array.isArray(raw.components) ? raw.components : []).map(normalizeComponent), "id");
  const labels = new Map(components.map((item) => [item.id, item.label]));
  const relations = filterRelations(Array.isArray(raw.dependencies) ? raw.dependencies : []);
  return {
    components,
    relations: uniqueSorted(relations.map(normalizeRelation).map((relation) => relation && ({
      ...relation,
      sourceLabel: labels.get(relation.source) || "未命名架构组件",
      targetLabel: labels.get(relation.target) || "未命名架构组件",
    })), "key"),
    documents: uniqueSorted((Array.isArray(raw.documents) ? raw.documents : []).map(normalizeDocument), "documentId"),
  };
}

function changedFields(source, target, fields) {
  return fields.filter((field) => source[field] !== target[field]).map((field) => ({ field, before: source[field], after: target[field] }));
}

function diffByKey(sourceItems, targetItems, key, fields) {
  const source = new Map(sourceItems.map((item) => [item[key], item]));
  const target = new Map(targetItems.map((item) => [item[key], item]));
  const added = targetItems.filter((item) => !source.has(item[key]));
  const removed = sourceItems.filter((item) => !target.has(item[key]));
  const changed = [];
  for (const [id, sourceItem] of source) {
    const targetItem = target.get(id);
    if (!targetItem) continue;
    const changes = changedFields(sourceItem, targetItem, fields);
    if (changes.length) changed.push({ id, source: sourceItem, target: targetItem, changes });
  }
  return { added, removed, changed };
}

function createArchitectureVersionService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const getRegistry = options.getRegistry;
  const projectVersion = options.projectVersion;
  const searchDocuments = options.searchDocuments;
  const readSnapshotArtifact = options.readSnapshotArtifact;
  const filterRelations = typeof options.filterRelations === "function" ? options.filterRelations : (relations) => relations;
  const evidenceService = options.decisionEvidenceService || createDecisionEvidenceService();

  function registry() {
    const current = typeof getRegistry === "function" ? getRegistry() : null;
    if (!current || !current.products || typeof current.products !== "object") throw serviceError("VERSION_REGISTRY_UNAVAILABLE", "产品版本注册表不可用", 503);
    return current;
  }

  function findEntry(product, version) {
    const definition = registry().products[product];
    const entry = definition && Array.isArray(definition.versions) ? definition.versions.find((item) => item.id === version) : null;
    if (!entry) throw serviceError("VERSION_NOT_FOUND", "产品版本不存在", 404, { product, version });
    return entry;
  }

  function listVersions() {
    const items = [];
    for (const [product, definition] of Object.entries(registry().products)) {
      for (const entry of definition.versions || []) items.push({
        product, version: entry.id, label: entry.label, status: entry.status,
        sourceMode: entry.status === "released" || entry.status === "deprecated" ? "snapshot" : "live",
      });
    }
    return { items };
  }

  function readSnapshot(product, version, entry) {
    if (!entry.snapshot || typeof entry.snapshot.path !== "string") throw serviceError("VERSION_SNAPSHOT_MISSING", "已发布版本缺少快照坐标", 409, { product, version });
    const absolutePath = path.resolve(vaultPath, entry.snapshot.path);
    if (absolutePath !== vaultPath && !absolutePath.startsWith(vaultPath + path.sep)) throw serviceError("INVALID_VERSION_SNAPSHOT_PATH", "版本快照路径越界", 400);
    if (!readSnapshotArtifact && !fs.existsSync(absolutePath)) throw serviceError("VERSION_SNAPSHOT_MISSING", "版本快照文件不存在", 409, { product, version });
    const raw = readSnapshotArtifact ? readSnapshotArtifact(entry.snapshot.path) : fs.readFileSync(absolutePath, "utf8");
    const actualHash = hash(raw);
    const expectedHash = text(entry.snapshot.sha256);
    if (expectedHash && actualHash !== expectedHash) throw serviceError("STALE_VERSION_SNAPSHOT", "版本快照哈希与注册表不一致", 409, { product, version });
    let snapshot;
    try { snapshot = JSON.parse(raw); }
    catch (error) { throw serviceError("INVALID_VERSION_SNAPSHOT", "版本快照不是合法 JSON: " + error.message, 500); }
    if (snapshot.product !== product || normalizeVersion(snapshot.version) !== version || !Array.isArray(snapshot.components) || !Array.isArray(snapshot.dependencies)) {
      throw serviceError("INVALID_VERSION_SNAPSHOT", "版本快照的产品、版本或结构不匹配", 500, { product, version });
    }
    return {
      raw: snapshot,
      generatedAt: snapshot.generated_at || entry.snapshot.generated_at || null,
      sourcePath: entry.snapshot.path,
      contentHash: expectedHash || null,
      freshness: expectedHash ? "fresh" : "unknown",
    };
  }

  function liveProjection(product, version) {
    if (typeof projectVersion !== "function") throw serviceError("VERSION_PROJECTOR_NOT_FOUND", "版本投影器不可用", 503);
    const projection = projectVersion(product, version);
    if (!projection || projection.product !== product || !Array.isArray(projection.components) || !Array.isArray(projection.dependencies)) {
      throw serviceError("INVALID_VERSION_PROJECTION", "版本投影结构不合法", 500, { product, version });
    }
    const documents = typeof searchDocuments === "function" ? (searchDocuments({ product, version, limit: 200, offset: 0 }).documents || []) : [];
    return {
      raw: { ...projection, documents },
      generatedAt: projection.generated_at || null,
      sourcePath: "data/staging/sa/semantic_architecture.json", // PR-082：派生通用槽
      contentHash: null,
      freshness: "unknown",
    };
  }

  function getVersion(productValue, versionValue) {
    const product = text(productValue);
    const version = normalizeVersion(versionValue);
    if (!product || !version) throw serviceError("INVALID_QUERY", "product 和 version 不能为空", 400);
    const entry = findEntry(product, version);
    const sourceMode = entry.status === "released" || entry.status === "deprecated" ? "snapshot" : "live";
    const loaded = sourceMode === "snapshot" ? readSnapshot(product, version, entry) : liveProjection(product, version);
    return {
      product, version, label: entry.label, status: entry.status, sourceMode, generatedAt: loaded.generatedAt,
      lineage: evidenceService.build({
        source: { kind: sourceMode === "snapshot" ? "version-snapshot" : "live-projection", path: loaded.sourcePath, contentHash: loaded.contentHash, coordinate: `version:${product}:${version}` },
        rule: { ruleId: "architecture-version.active-state", ruleRevision: "runtime:architecture-version-v1", reasonCode: sourceMode === "snapshot" ? "RELEASED_SNAPSHOT" : "DRAFT_LIVE_PROJECTION" },
        scope: { product, version },
        freshness: { status: loaded.freshness, checkedAt: new Date().toISOString(), changedFields: [] },
      }),
      ...normalizeState(loaded.raw, filterRelations),
    };
  }

  function compare(product, sourceVersion, targetVersion) {
    if (normalizeVersion(sourceVersion) === normalizeVersion(targetVersion)) throw serviceError("INVALID_QUERY", "源版本和目标版本不能相同", 400);
    const sourceState = getVersion(product, sourceVersion);
    const targetState = getVersion(product, targetVersion);
    const components = diffByKey(sourceState.components, targetState.components, "id", ["label", "layer", "category", "role"]);
    const relations = diffByKey(sourceState.relations, targetState.relations, "key", ["source", "target", "type"]);
    const documents = diffByKey(sourceState.documents, targetState.documents, "documentId", ["articleId", "title", "sourcePath"]);
    return {
      product,
      source: { version: sourceState.version, label: sourceState.label, status: sourceState.status, sourceMode: sourceState.sourceMode, generatedAt: sourceState.generatedAt },
      target: { version: targetState.version, label: targetState.label, status: targetState.status, sourceMode: targetState.sourceMode, generatedAt: targetState.generatedAt },
      lineage: evidenceService.build({
        source: { kind: sourceState.sourceMode === "snapshot" && targetState.sourceMode === "snapshot" ? "version-snapshot-comparison" : "version-state-comparison", path: `${sourceState.lineage.source.path} -> ${targetState.lineage.source.path}`, contentHash: sourceState.lineage.source.contentHash && targetState.lineage.source.contentHash ? hash(`${sourceState.lineage.source.contentHash}\0${targetState.lineage.source.contentHash}`) : null, coordinate: `version-compare:${product}:${sourceState.version}->${targetState.version}` },
        rule: { ruleId: "architecture-version.compare", ruleRevision: "runtime:architecture-version-v1", reasonCode: "STABLE_ID_DIFF" },
        scope: { product, version: targetState.version },
        freshness: {
          status: sourceState.lineage.freshness.status === "fresh" && targetState.lineage.freshness.status === "fresh" ? "fresh" : sourceState.lineage.freshness.status === "stale" || targetState.lineage.freshness.status === "stale" ? "stale" : "unknown",
          checkedAt: new Date().toISOString(),
          changedFields: [],
        },
      }),
      summary: {
        componentsAdded: components.added.length, componentsRemoved: components.removed.length, componentsChanged: components.changed.length,
        relationsAdded: relations.added.length, relationsRemoved: relations.removed.length,
        documentsAdded: documents.added.length, documentsRemoved: documents.removed.length,
      },
      components, relations, documents,
    };
  }

  return { listVersions, getVersion, compare };
}

module.exports = { createArchitectureVersionService, normalizeComponent, normalizeRelation, normalizeDocument };
